import { vectorStore } from '../vector/store';
import { chunkText } from '../vector/chunker';

export interface UserFact {
  rule: string;
  topic?: string;
  createdById?: string;
  question?: string;
  selectedOption?: string;
  seedId?: string;
}

import { pruneToConciseFacts } from '../ai/pruner';

/**
 * Save user-taught ground-truth rule into vector database with high priority authority tag.
 * Automatically decomposes multi-aspect statements into atomic, ultra-concise Topic & Detail pairs.
 */
export async function teachUserFact(fact: UserFact): Promise<{
  syncedCount: number;
  rule: string;
  extractedFacts?: Array<{ topic: string; detail: string }>;
}> {
  // Prune down to ultra-concise atomic pairs (e.g., Topic: "Method of purchase", Detail: "Online")
  const prunedFacts = await pruneToConciseFacts({
    question: fact.question,
    answer: fact.selectedOption || fact.rule,
    rawText: fact.rule,
    fallbackTopic: fact.topic,
  });

  let indexedCount = 0;
  const existingItems = await vectorStore.listItems('user_teaching');

  for (const item of prunedFacts) {
    const normTopic = item.topic.trim().toLowerCase();

    // Check if an existing knowledge item covers the exact same operational topic
    const existingMatch = existingItems.find(ex => {
      const exTopic = String(ex.metadata?.topic || ex.title || '').trim().toLowerCase();
      return (
        exTopic === normTopic ||
        (normTopic.length > 5 && exTopic.includes(normTopic)) ||
        (exTopic.length > 5 && normTopic.includes(exTopic))
      );
    });

    if (existingMatch) {
      item.id = existingMatch.id;
      // Consolidate: merge new detail into the existing topic if not already present
      const existingDetail = String(existingMatch.metadata?.detail || existingMatch.text.replace(/^[^:]+:\s*/, '')).trim();
      if (!existingDetail.toLowerCase().includes(item.detail.toLowerCase())) {
        const mergedDetail = `${existingDetail} • ${item.detail}`;
        const updatedChunkText = `${existingMatch.title}: ${mergedDetail}`;
        await vectorStore.updateItem(existingMatch.id, updatedChunkText, existingMatch.title, existingMatch.title);
        indexedCount++;
        continue;
      } else {
        // Already contains this detail
        indexedCount++;
        continue;
      }
    }

    // Otherwise, create a clean new granular entry
    const chunkText = `${item.topic}: ${item.detail}`;
    const newId = await vectorStore.addChunk({
      text: chunkText,
      source: 'user_teaching',
      title: item.topic,
      timestamp: new Date().toISOString(),
      metadata: {
        priority: 'high',
        isGroundTruth: true,
        topic: item.topic,
        detail: item.detail,
        taughtAt: new Date().toISOString(),
        ...(fact.question ? { question: fact.question, resolvedQuestion: fact.question } : {}),
        ...(fact.selectedOption ? { selectedOption: fact.selectedOption } : {}),
        ...(fact.seedId ? { seedId: fact.seedId } : {}),
      },
    });
    item.id = newId;
    indexedCount++;
  }

  return {
    syncedCount: indexedCount,
    rule: fact.rule,
    extractedFacts: prunedFacts as Array<{ topic: string; detail: string; id?: string }>,
  };
}

