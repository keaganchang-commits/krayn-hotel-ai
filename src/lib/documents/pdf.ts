import { pdfToPages } from 'pdf-ts';
import { vectorStore } from '../vector/store';
import { extractKnowledgeFacts } from '../ai/extractor';

/**
 * Extract text from PDF buffer across all pages, extracting every single fact into vector database.
 * NOTE: Uploaded knowledge PDFs are NEVER sent as attachments to customers. They are solely parsed for knowledge facts.
 */
export async function processPdfDocument(
  fileBuffer: Buffer,
  fileName: string,
  assetId?: string
): Promise<{ syncedCount: number; title: string }> {
  try {
    const pages = await pdfToPages(fileBuffer);

    if (!pages || pages.length === 0) {
      throw new Error('PDF document contained no pages or extractable text.');
    }

    console.log(`[PDF Extraction] Processing ${pages.length} pages from "${fileName}"...`);

    // Consolidate pages into compact batches of 4 pages each to ensure exhaustive coverage of all courses/beverages
    const pageBatches: string[] = [];
    const maxBatches = 20;

    for (let i = 0; i < pages.length && pageBatches.length < maxBatches; i += 4) {
      const slice = pages.slice(i, i + 4);
      const combinedText = slice.map(p => p.text.trim()).filter(t => t.length > 20).join('\n\n');
      if (combinedText.length > 20) {
        pageBatches.push(`--- PAGES ${slice.map(p => p.page).join('-')} ---\n${combinedText}`);
      }
    }

    if (pageBatches.length === 0) {
      const fallbackText = pages.map(p => p.text.trim()).join('\n').slice(0, 15000);
      if (fallbackText.length > 20) {
        pageBatches.push(fallbackText);
      } else {
        throw new Error('No readable text found across PDF pages.');
      }
    }

    let totalIndexed = 0;
    const existingItems = await vectorStore.listItems('pdf');

    for (let b = 0; b < pageBatches.length; b++) {
      const batchContent = pageBatches[b];
      const batchTitle = `${fileName} (Part ${b + 1}/${pageBatches.length})`;

      const { facts, proactiveQuestions } = await extractKnowledgeFacts(batchContent, 'pdf', batchTitle);

      for (const fact of facts) {
        const normTopic = fact.topic.trim().toLowerCase();

        const docCleanName = fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
        const venue = fileName.toLowerCase().includes('merdeka')
          ? 'Merdeka Grill'
          : fileName.toLowerCase().includes('park')
          ? 'Park Lounge'
          : docCleanName;

        // Check if an existing item has the same topic AND belongs to the same document/venue to consolidate
        const existingMatch = existingItems.find(ex => {
          const exDoc = String(ex.metadata?.documentName || ex.metadata?.fileName || '').toLowerCase();
          const exVenue = String(ex.metadata?.venue || '').toLowerCase();
          const isSameDoc = !exDoc || exDoc.includes(venue.toLowerCase()) || venue.toLowerCase().includes(exVenue);
          if (!isSameDoc) return false;

          const exTopic = String(ex.metadata?.topic || ex.title || '').trim().toLowerCase();
          return exTopic === normTopic || (normTopic.length > 5 && exTopic.includes(normTopic));
        });

        if (existingMatch) {
          const existingDetail = String(existingMatch.metadata?.detail || existingMatch.text.replace(/^[^:]+:\s*/, '')).trim();
          const cleanEx = existingDetail.toLowerCase().replace(/[.\s]+$/, '');
          const cleanFact = fact.detail.toLowerCase().replace(/[.\s]+$/, '');

          if (cleanEx === cleanFact || cleanEx.includes(cleanFact)) {
            totalIndexed++;
            continue;
          } else if (cleanFact.includes(cleanEx)) {
            const updatedChunkText = `${existingMatch.title}: ${fact.detail}`;
            await vectorStore.updateItem(existingMatch.id, updatedChunkText, existingMatch.title, existingMatch.title);
            existingMatch.text = updatedChunkText;
            totalIndexed++;
            continue;
          } else {
            const mergedDetail = `${existingDetail} • ${fact.detail}`;
            const updatedChunkText = `${existingMatch.title}: ${mergedDetail}`;
            await vectorStore.updateItem(existingMatch.id, updatedChunkText, existingMatch.title, existingMatch.title);
            existingMatch.text = updatedChunkText;
            totalIndexed++;
            continue;
          }
        }

        // Add distinct new fact directly linked to the uploaded asset file and venue
        const chunkText = `${fact.topic}: ${fact.detail}`;
        const newId = await vectorStore.addChunk({
          text: chunkText,
          source: 'pdf',
          title: fact.topic,
          timestamp: new Date().toISOString(),
          metadata: {
            fileName,
            documentName: docCleanName,
            venue,
            assetId: assetId || undefined,
            topic: fact.topic,
            detail: fact.detail,
            uploadedAt: new Date().toISOString(),
          },
        });
        existingItems.push({
          id: newId,
          text: chunkText,
          source: 'pdf',
          title: fact.topic,
          timestamp: new Date().toISOString(),
          metadata: { topic: fact.topic, detail: fact.detail, venue, fileName, documentName: docCleanName },
        });
        totalIndexed++;
      }

      // Final safety deduplication sweep across Knowledge Hub
      const { deduplicateKnowledgeHub } = await import('@/lib/knowledge/deduplicator');
      await deduplicateKnowledgeHub().catch(e => console.warn('Deduplication sweep error:', e));

      // Add proactive questions if any (auditing against knowledge hub and assets first)
      if (proactiveQuestions && proactiveQuestions.length > 0) {
        const { isQuestionAnsweredInKnowledgeHub } = await import('@/lib/clarify/knowledgeAuditor');
        const confirmedCache = await vectorStore.listItems();
        for (const q of proactiveQuestions) {
          if (!q.question || !q.question.trim()) continue;
          
          // Never re-ask if the knowledge hub or uploaded assets already address it
          const check = await isQuestionAnsweredInKnowledgeHub(q.question, confirmedCache);
          if (check.hasAnswer) {
            console.log(`[PDF Extraction] Skipping already answered clarification question: "${q.question}"`);
            continue;
          }

          const categoryTitle = q.topic || `Document Fact: ${fileName.replace(/\.pdf$/i, '')}`;
          await vectorStore.addChunk({
            text: `PROACTIVE CLARIFICATION NEEDED for ${categoryTitle}: ${q.question}`,
            source: 'clarification',
            title: categoryTitle,
            timestamp: new Date().toISOString(),
            metadata: {
              question: q.question,
              options: q.options,
              fileName,
              isUncertain: true,
              status: 'pending',
              inputType: q.inputType || 'options',
              placeholder: q.placeholder,
              priorityScore: 90,
            },
          });
        }
      }
    }

    return { syncedCount: totalIndexed, title: fileName };
  } catch (error: any) {
    console.error(`Error parsing PDF ${fileName}:`, error);
    throw new Error(`PDF Processing Error: ${error.message}`);
  }
}
