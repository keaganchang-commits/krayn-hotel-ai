import { vectorStore } from '@/lib/vector/store';
import { getGeminiClient } from '@/lib/ai/gemini';

export interface PreGeneratedClarification {
  id: string;
  question: string;
  options: string[];
  title: string;
  source: string;
  timestamp: string;
  priorityScore: number;
  inputType?: 'options' | 'text' | 'file';
  placeholder?: string;
  emailId?: string;
  threadId?: string;
  inReplyToMsgId?: string;
  sender?: string;
  originalBody?: string;
  isOnboarding?: boolean;
}

import { SEED_ONBOARDING_QUESTIONS, normalizeQuestionText, getSemanticQuestionKey } from './seedQuestions';

let isPreGenerating = false;
let lastPreGenTime = 0;
let pregenCooldownMs = 60_000; // default 60s

export function markQuotaExhausted() {
  // If Google free tier limit is reached, back off for 15 minutes before checking again
  pregenCooldownMs = 15 * 60 * 1000;
  console.log('[Clarification PreGenerator] Backing off generation for 15 minutes due to free-tier quota limits.');
}

/**
 * Runs silently in the background worker loop.
 * 1. Seeds onboarding questions into store if absent and NOT already answered
 * 2. Scans for knowledge gaps and pre-generates 3 sharp choices (excluding answered topics)
 * 3. Pre-ranks all items so fetching the page takes 0ms
 */
export async function runBackgroundClarificationPreGenerator() {
  const now = Date.now();
  if (isPreGenerating || now - lastPreGenTime < pregenCooldownMs) return;
  isPreGenerating = true;
  lastPreGenTime = now;

  try {
    const allItems = await vectorStore.listItems();
    const existingClarifications = allItems.filter(i => i.source === 'clarification');

    // Collect all questions that have already been resolved / answered
    const answeredQuestionNorms = new Set<string>();
    const answeredSemanticKeys = new Set<string>();
    const answeredSeedIds = new Set<string>();

    for (const item of allItems) {
      if (item.source === 'user_teaching') {
        if (item.metadata?.seedId) answeredSeedIds.add(String(item.metadata.seedId));
        if (item.metadata?.question) {
          answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.question)));
          answeredSemanticKeys.add(getSemanticQuestionKey(String(item.metadata.question)));
        }
        if (item.metadata?.resolvedQuestion) {
          answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.resolvedQuestion)));
          answeredSemanticKeys.add(getSemanticQuestionKey(String(item.metadata.resolvedQuestion)));
        }

        // Extract "Regarding <question>" from rule text if present
        const match = item.text.match(/Regarding ["']?([^"',\n]+)["']?,/i);
        if (match && match[1]) {
          answeredQuestionNorms.add(normalizeQuestionText(match[1]));
          answeredSemanticKeys.add(getSemanticQuestionKey(match[1]));
        }
      }
    }

    // Existing active clarification items
    const existingQuestionNorms = new Set(
      existingClarifications.map(i => normalizeQuestionText(String(i.metadata?.question || i.text || '')))
    );
    const existingSemanticKeys = new Set(
      existingClarifications.map(i => getSemanticQuestionKey(String(i.metadata?.question || i.text || '')))
    );

    // 1. Seed initial onboarding questions into the persistent store ONLY if never answered
    for (const seed of SEED_ONBOARDING_QUESTIONS) {
      const normSeed = normalizeQuestionText(seed.question);
      const isAlreadyAnswered = answeredSeedIds.has(seed.id) || answeredQuestionNorms.has(normSeed);
      const isAlreadyInActive = existingQuestionNorms.has(normSeed);

      if (!isAlreadyAnswered && !isAlreadyInActive) {
        await vectorStore.addChunk({
          text: `PROACTIVE CLARIFICATION NEEDED for ${seed.title}: ${seed.question}`,
          source: 'clarification',
          title: seed.title,
          timestamp: new Date().toISOString(),
          metadata: {
            question: seed.question,
            options: seed.options,
            priorityScore: seed.priorityScore,
            isOnboarding: true,
            seedId: seed.id,
            inputType: seed.inputType || 'options',
            placeholder: seed.placeholder,
          },
        });
        existingQuestionNorms.add(normSeed);
      }
    }


    // 2. Progressive Depth Clarification Protocol:
    // Only call the AI to generate new progressive questions when the queue has fewer than 5 active questions.
    // If the user already has pending questions waiting for review/answers, do NOT burn AI quota!
    const confirmedCount = allItems.filter(i => i.source !== 'clarification').length;
    const answeredFoundationalCount = answeredSeedIds.size;
    const hasSufficientFoundation = confirmedCount >= 2 || answeredFoundationalCount >= 2;
    const activeQuestionCount = existingClarifications.length;

    if (hasSufficientFoundation && activeQuestionCount < 5) {
      const { generateProgressiveQuestions } = await import('./progressiveGenerator');
      const progressiveQuestions = await generateProgressiveQuestions();

      const { isQuestionAnsweredInKnowledgeHub } = await import('./knowledgeAuditor');
      for (const item of progressiveQuestions) {
        if (!item.question || !Array.isArray(item.options)) continue;
        const normQ = normalizeQuestionText(item.question);
        const semKey = getSemanticQuestionKey(item.question);
        const isAnswered = answeredQuestionNorms.has(normQ) || answeredSemanticKeys.has(semKey);
        const isActive = existingQuestionNorms.has(normQ) || existingSemanticKeys.has(semKey);

        if (!isAnswered && !isActive) {
          const check = await isQuestionAnsweredInKnowledgeHub(item.question, allItems);
          if (check.hasAnswer) continue;

          await vectorStore.addChunk({
            text: `PROACTIVE CLARIFICATION NEEDED for ${item.topic}: ${item.question}`,
            source: 'clarification',
            title: item.topic,
            timestamp: new Date().toISOString(),
            metadata: {
              question: item.question,
              options: Array.isArray(item.options) ? item.options : [],
              priorityScore: item.priorityScore || 85,
              isOnboarding: false,
              isProgressiveCluster: true,
              inputType: item.inputType || 'options',
              placeholder: item.placeholder,
              allowMultiple: item.allowMultiple !== undefined ? item.allowMultiple : true,
            },
          });
          existingQuestionNorms.add(normQ);
          existingSemanticKeys.add(semKey);
        }
      }
    }
  } catch (err) {
    console.error('[Clarification PreGenerator] Error in background pass:', err);
  } finally {
    isPreGenerating = false;
  }
}
