import path from 'path';
import fs from 'fs';
import { LocalIndex } from 'vectra';
import { generateEmbedding } from '../ai/gemini';
import { TextChunk } from './chunker';

const INDEX_DIR = path.join(process.cwd(), '.knowledge_store');
const INDEX_FILE = path.join(INDEX_DIR, 'index.json');

// Ensure a safe index file exists on disk with atomic backup
function ensureCleanIndexFile() {
  if (!fs.existsSync(INDEX_DIR)) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
  }
  const BAK_FILE = path.join(INDEX_DIR, 'index.json.bak');
  if (!fs.existsSync(INDEX_FILE)) {
    if (fs.existsSync(BAK_FILE)) {
      try {
        const bakRaw = fs.readFileSync(BAK_FILE, 'utf8');
        JSON.parse(bakRaw);
        fs.writeFileSync(INDEX_FILE, bakRaw, 'utf8');
        return;
      } catch {}
    }
    const emptyIndex = JSON.stringify({ version: 1, metadata_config: { indexed: [] }, items: [] });
    fs.writeFileSync(INDEX_FILE, emptyIndex, 'utf8');
    return;
  }

  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    if (raw && raw.trim().length > 0) {
      JSON.parse(raw);
      // Periodically update verified backup using atomic write
      if (Math.random() < 0.05) {
        const tempBak = `${BAK_FILE}.tmp`;
        fs.writeFileSync(tempBak, raw, 'utf8');
        fs.renameSync(tempBak, BAK_FILE);
      }
    }
  } catch (err: any) {
    console.warn('[KnowledgeVectorStore] Corrupted or incomplete index.json detected, auto-healing...', err?.message || err);
    // If Vectra is mid-write, wait and try once more before recovering
    try {
      const retryRaw = fs.readFileSync(INDEX_FILE, 'utf8');
      if (retryRaw && retryRaw.trim().length > 0) {
        JSON.parse(retryRaw);
        return;
      }
    } catch {}

    // 1. Try restoring from verified backup
    if (fs.existsSync(BAK_FILE)) {
      try {
        const bakContent = fs.readFileSync(BAK_FILE, 'utf8');
        JSON.parse(bakContent);
        fs.writeFileSync(INDEX_FILE, bakContent, 'utf8');
        return;
      } catch {}
    }

    // 2. Try truncating to last valid JSON closing bracket
    try {
      const raw = fs.readFileSync(INDEX_FILE, 'utf8');
      let pos = raw.lastIndexOf('}]}');
      while (pos !== -1) {
        try {
          const candidate = raw.slice(0, pos + 3);
          JSON.parse(candidate);
          fs.writeFileSync(INDEX_FILE, candidate, 'utf8');
          console.log('[KnowledgeVectorStore] Successfully auto-healed index.json');
          return;
        } catch {
          pos = raw.lastIndexOf('}]}', pos - 1);
        }
      }
    } catch {}

    // 3. Fallback: reset to clean state if completely unrecoverable
    const emptyIndex = JSON.stringify({ version: 1, metadata_config: { indexed: [] }, items: [] });
    fs.writeFileSync(INDEX_FILE, emptyIndex, 'utf8');
  }
}

export class KnowledgeVectorStore {
  private index: LocalIndex;
  private isInitialized = false;
  private writeMutex: Promise<any> = Promise.resolve();
  private cachedItems: any[] | null = null;
  private lastCacheTime = 0;

  constructor() {
    ensureCleanIndexFile();
    this.index = new LocalIndex(INDEX_DIR);
  }

  private invalidateCache() {
    this.cachedItems = null;
  }

  // Linearize write operations to prevent concurrent file corruption
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeMutex.then(async () => {
      ensureCleanIndexFile();
      const res = await fn();
      this.invalidateCache();
      return res;
    });
    this.writeMutex = next.catch(() => {});
    return next;
  }

  async init() {
    if (this.isInitialized) {
      ensureCleanIndexFile();
      return;
    }
    try {
      ensureCleanIndexFile();
      if (!(await this.index.isIndexCreated())) {
        await this.index.createIndex();
      }
      this.isInitialized = true;
    } catch (err) {
      console.error('[KnowledgeVectorStore] Init error:', err);
      ensureCleanIndexFile();
      try {
        await this.index.createIndex();
        this.isInitialized = true;
      } catch (e) {
        console.error('[KnowledgeVectorStore] Fatal index create error:', e);
      }
    }
  }

  /**
   * Add text chunk to vector database
   */
  async addChunk(chunk: Omit<TextChunk, 'id'>): Promise<string> {
    const [id] = await this.addChunksBatch([chunk]);
    return id;
  }

  /**
   * Add multiple text chunks in a single batch with parallel embeddings and single disk write lock
   */
  async addChunksBatch(chunks: Array<Omit<TextChunk, 'id'>>): Promise<string[]> {
    if (!chunks || chunks.length === 0) return [];
    await this.init();

    // 1. Generate embeddings in parallel
    const itemsToInsert = await Promise.all(
      chunks.map(async chunk => {
        const vector = await generateEmbedding(chunk.text);
        const id = `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        return {
          id,
          vector,
          metadata: {
            text: chunk.text,
            source: chunk.source,
            title: chunk.title,
            timestamp: chunk.timestamp,
            ...(chunk.metadata || {}),
          },
        };
      })
    );

    // 2. Perform batch insertion within a single lock and single disk flush
    return await this.withLock(async () => {
      await this.index.beginUpdate();
      try {
        for (const item of itemsToInsert) {
          await this.index.insertItem(item);
        }
        await this.index.endUpdate();
      } catch (e) {
        try { this.index.cancelUpdate(); } catch {}
        throw e;
      }
      return itemsToInsert.map(i => i.id);
    });
  }

  /**
   * Query vector store for most relevant knowledge chunks using hybrid vector similarity + text matching
   */
  async query(queryText: string, topK: number = 6) {
    await this.init();
    const queryVector = await generateEmbedding(queryText);
    const items = await this.listItems();

    // Helper to calculate vector norm
    const calcNorm = (vec: number[]) => {
      let sum = 0;
      for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
      return Math.sqrt(sum) || 1;
    };
    const queryNorm = calcNorm(queryVector);

    // Get raw items with vectors from local index
    let rawItems: any[] = [];
    try {
      rawItems = await this.index.listItems();
    } catch {
      rawItems = [];
    }
    const rawById = new Map<string, any>(rawItems.map(r => [r.id, r]));

    const terms = queryText
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);

    const scored = items.map(item => {
      const raw = rawById.get(item.id);
      let sim = 0;

      if (raw && raw.vector && Array.isArray(raw.vector)) {
        const itemVec: number[] = raw.vector;
        const len = Math.min(queryVector.length, itemVec.length);
        if (len > 0) {
          let dot = 0;
          for (let i = 0; i < len; i++) {
            dot += queryVector[i] * itemVec[i];
          }
          const itemNorm = raw.norm || calcNorm(itemVec);
          sim = dot / (queryNorm * itemNorm);
          if (isNaN(sim)) sim = 0;
        }
      }

      // Keyword and semantic title boost
      const lowerText = item.text.toLowerCase();
      const lowerTitle = item.title.toLowerCase();
      let keywordBoost = 0;

      // Exact phrase match (e.g. "dining options", "dining venues", "meeting rooms", "check in")
      const lowerQuery = queryText.toLowerCase().trim();
      if (lowerText.includes(lowerQuery) || lowerTitle.includes(lowerQuery)) {
        keywordBoost += 0.25;
      }

      // Prioritize foundational overview/directory chunks (e.g. "On-Site Dining Venues", "Meeting Rooms", "Hotel Overview")
      const isOverviewChunk = /venues|overview|facilities|amenities|options|directory/i.test(lowerTitle);
      if (isOverviewChunk) {
        keywordBoost += 0.15;
      }

      // Room & Accommodation inquiries: prioritize comprehensive room and suite category items
      const isRoomInquiry = /room\s*types?|types?\s*of\s*rooms?|accommodations?|suites?|guestrooms?|what\s*rooms?/i.test(lowerQuery);
      if (isRoomInquiry) {
        const roomCategoryKeywords = [
          'standard rooms', 'tower view rooms', 'corner king room', 'king studio',
          'deluxe rooms', 'park suite', 'park deluxe suite', 'park executive suite', 'top-tier suites'
        ];
        if (roomCategoryKeywords.some(rk => lowerTitle === rk || lowerTitle.includes(rk))) {
          keywordBoost += 0.75;
        } else if (/(amenities|technology|inventory|level|prayer room|spa room)/i.test(lowerTitle)) {
          keywordBoost -= 0.15;
        }
      }

      for (const term of terms) {
        if (lowerTitle.includes(term)) keywordBoost += 0.12;
        else if (lowerText.includes(term)) keywordBoost += 0.06;
      }

      const finalScore = Math.min(1, sim + keywordBoost);

      return {
        score: finalScore,
        item: {
          id: item.id,
          text: item.text,
          source: item.source,
          title: item.title,
          timestamp: item.timestamp,
        },
      };
    });

    // Filter out clarification questions from search results so we only retrieve confirmed facts
    const factsOnly = scored.filter(s => s.item.source !== 'clarification');
    factsOnly.sort((a, b) => b.score - a.score);

    return factsOnly.slice(0, topK);
  }

  /**
   * List all stored knowledge items with pagination, filtering by source and search query
   */
  async listItems(filterSource?: string, search?: string) {
    const now = Date.now();
    let rawItems = this.cachedItems;

    // Use memory cache if available and younger than 10 seconds, avoiding 28MB JSON disk reads
    if (!rawItems || now - this.lastCacheTime > 10000) {
      await this.init();
      try {
        rawItems = await this.index.listItems();
        this.cachedItems = rawItems;
        this.lastCacheTime = now;
      } catch (err) {
        console.warn('[KnowledgeVectorStore] listItems encountered read error, attempting auto-heal...', err);
        ensureCleanIndexFile();
        this.index = new LocalIndex(INDEX_DIR);
        rawItems = await this.index.listItems().catch(() => []);
        this.cachedItems = rawItems;
        this.lastCacheTime = now;
      }
    }
    
    let result = (rawItems || []).filter(Boolean).map(item => ({
      id: item.id,
      text: (item.metadata?.text as string) || item.text || '',
      source: (item.metadata?.source as TextChunk['source']) || item.source || 'user_teaching',
      title: (item.metadata?.title as string) || item.title || 'Untitled',
      timestamp: (item.metadata?.timestamp as string) || item.timestamp || new Date().toISOString(),
      metadata: item.metadata || {},
    }));

    if (filterSource && filterSource !== 'all') {
      result = result.filter(item => item.source === filterSource);
    }

    if (search && search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        item =>
          item.text.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q)
      );
    }

    // Sort by timestamp descending
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return result;
  }

  /**
   * Delete a knowledge item by ID
   */
  async deleteItem(id: string): Promise<boolean> {
    await this.init();
    return await this.withLock(async () => {
      await this.index.deleteItem(id);
      this.cachedItems = null;
      return true;
    });
  }

  /**
   * Batch delete multiple knowledge items within a single write lock and save
   */
  async deleteItemsBatch(ids: string[]): Promise<boolean> {
    if (!ids || ids.length === 0) return true;
    await this.init();
    return await this.withLock(async () => {
      await this.index.beginUpdate();
      try {
        for (const id of ids) {
          try {
            await this.index.deleteItem(id);
          } catch {}
        }
        await this.index.endUpdate();
      } catch (e) {
        try { this.index.cancelUpdate(); } catch {}
        throw e;
      }
      this.cachedItems = null;
      return true;
    });
  }

  /**
   * Update an existing knowledge item's text and metadata (re-generates vector embedding)
   */
  async updateItem(id: string, newText: string, newTitle?: string, newTopic?: string): Promise<boolean> {
    await this.init();
    const items = await this.index.listItems();
    const existing = items.find(i => i.id === id);

    if (!existing) {
      throw new Error(`Item ${id} not found.`);
    }

    const vector = await generateEmbedding(newText);
    const updatedMetadata = {
      ...existing.metadata,
      text: newText,
      ...(newTitle ? { title: newTitle } : {}),
      ...(newTopic ? { topic: newTopic } : {}),
      detail: newText,
      updatedAt: new Date().toISOString(),
    };

    return await this.withLock(async () => {
      // Replace item in vectra by deleting and re-inserting
      await this.index.deleteItem(id);
      await this.index.insertItem({
        id,
        vector,
        metadata: updatedMetadata,
      });
      return true;
    });
  }

  /**
   * Clear all items or items by source
   */
  async clearSource(source?: string): Promise<number> {
    await this.init();
    const items = await this.index.listItems();
    let deletedCount = 0;

    return await this.withLock(async () => {
      await this.index.beginUpdate();
      try {
        for (const item of items) {
          if (!source || source === 'all' || item.metadata.source === source) {
            await this.index.deleteItem(item.id);
            deletedCount++;
          }
        }
        await this.index.endUpdate();
      } catch (e) {
        try { this.index.cancelUpdate(); } catch {}
        throw e;
      }
      this.cachedItems = null;
      return deletedCount;
    });
  }

  /**
   * Get total count of indexed items
   */
  async getCount(): Promise<number> {
    await this.init();
    const items = await this.index.listItems();
    return items.length;
  }
}

export const vectorStore = new KnowledgeVectorStore();
