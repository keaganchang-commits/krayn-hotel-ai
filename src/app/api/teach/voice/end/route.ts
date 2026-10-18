import { NextResponse } from 'next/server';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';

export async function POST(request: Request) {
  try {
    const { history = [] } = await request.json();

    if (!Array.isArray(history) || history.length === 0) {
      return NextResponse.json({ success: true, count: 0, indexedFacts: [] });
    }

    // Combine all user utterances from the voice conversation
    const userUtterances = history
      .filter((h: any) => h.role === 'user' && typeof h.text === 'string' && h.text.trim().length > 3)
      .map((h: any) => h.text.trim());

    if (userUtterances.length === 0) {
      return NextResponse.json({ success: true, count: 0, indexedFacts: [] });
    }

    const fullConversationText = userUtterances.join('\n');
    const ai = getGeminiClient();

    let extractedFacts: Array<{ topic: string; detail: string; id?: string }> = [];

    if (ai) {
      const prompt = `You are Krayn AI Knowledge Indexer.
Review the user's statements from a completed voice training session:
"""
${fullConversationText}
"""

TASK:
Extract ALL verified operational business facts (policies, hours, pricing, rules, procedures, amenities).
- Split compound facts into clean, atomic Topic & Detail pairs.
- Exclude all casual chitchat, greetings ("hi", "hello", "thanks"), questions, or non-policy statements.
- PRESERVE EXACT NUMBERS & TIMES: If the user says "12pm", use "12:00 PM". Never replace explicit times with vague generalities like "in the afternoon".
- DO NOT EXTRAPOLATE: Only record what the user explicitly confirmed. Do not add unmentioned policies.
- Format strictly as JSON array:
[
  { "topic": "Checkout Time", "detail": "Checkout time is 12:00 PM." },
  { "topic": "Valet Parking", "detail": "Complimentary for suite guests." }
]`;

      for (const model of GEMINI_GENERATIVE_MODELS) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: prompt,
          });
          const raw = res.text || '';
          const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(cleaned);

          if (Array.isArray(parsed)) {
            const bannedKeywords = ['greeting', 'hello', 'chitchat', 'test'];
            extractedFacts = parsed
              .filter((f: any) => {
                const top = String(f?.topic || '').toLowerCase();
                const det = String(f?.detail || '').toLowerCase();
                return (
                  top.length > 2 &&
                  det.length > 2 &&
                  !bannedKeywords.some(b => top.includes(b) || det.includes(b))
                );
              })
              .map((f: any) => ({
                topic: String(f.topic).trim(),
                detail: String(f.detail).trim(),
              }));
            break;
          }
        } catch {
          // try next model
        }
      }
    }

    if (extractedFacts.length === 0) {
      return NextResponse.json({ success: true, count: 0, indexedFacts: [] });
    }

    const nowIso = new Date().toISOString();
    const chunksToInsert = extractedFacts.map(fact => {
      const chunkText = `${fact.topic}: ${fact.detail}`;
      return {
        text: chunkText,
        source: 'user_teaching' as const,
        title: fact.topic,
        timestamp: nowIso,
        metadata: {
          priority: 'high',
          isGroundTruth: true,
          topic: fact.topic,
          detail: fact.detail,
          taughtAt: nowIso,
          origin: 'voice_teaching',
        },
      };
    });

    const savedIds = await vectorStore.addChunksBatch(chunksToInsert);
    extractedFacts.forEach((f, idx) => {
      f.id = savedIds[idx];
    });

    const { deduplicateKnowledgeHub } = await import('@/lib/knowledge/deduplicator');
    await deduplicateKnowledgeHub().catch(err => console.warn('Deduplication after voice session end failed:', err));

    return NextResponse.json({
      success: true,
      count: savedIds.length,
      indexedFacts: extractedFacts,
    });
  } catch (error: any) {
    console.error('[Voice End Sync] Error indexing session facts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to index voice session facts' },
      { status: 500 }
    );
  }
}
