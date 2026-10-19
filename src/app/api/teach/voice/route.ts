import { NextResponse } from 'next/server';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import path from 'path';
import fs from 'fs';

function loadKnowledgeSnippet(): string {
  try {
    const indexPath = path.join(process.cwd(), '.knowledge_store', 'index.json');
    if (fs.existsSync(indexPath)) {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const rawItems = Array.isArray(data.items) ? data.items : Object.values(data.items || {});
      const items = rawItems.filter(Boolean);
      const distinct: string[] = [];
      const seen = new Set<string>();

      const priorityKeywords = ['merdeka grill', 'restaurant', 'dining', 'park lounge', 'cacao', 'check-in', 'checkout', 'breakfast', 'pool', 'parking', 'valet', 'pet', 'gym', 'spa', 'hours'];
      const sortedItems = [...items].sort((a, b) => {
        const textA = ((a?.metadata?.text || a?.metadata?.title || a?.title || a?.text) || '').toLowerCase();
        const textB = ((b?.metadata?.text || b?.metadata?.title || b?.title || b?.text) || '').toLowerCase();
        const scoreA = priorityKeywords.reduce((acc, kw) => acc + (textA.includes(kw) ? 2 : 0), 0);
        const scoreB = priorityKeywords.reduce((acc, kw) => acc + (textB.includes(kw) ? 2 : 0), 0);
        return scoreB - scoreA;
      });

      for (const item of sortedItems) {
        if (!item) continue;
        const meta = item.metadata || {};
        if (meta.source === 'clarification') continue;
        const text = (meta.text || meta.title || item.title || item.text || '').trim();
        const key = text.toLowerCase();
        if (text.length > 5 && !seen.has(key)) {
          seen.add(key);
          distinct.push(`- ${text}`);
        }
      }
      return distinct.join('\n');
    }
  } catch {}
  return '';
}

export async function POST(request: Request) {
  try {
    const { speechText, history = [], mode = 'free' } = await request.json();

    if (!speechText || typeof speechText !== 'string' || speechText.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Speech text is required.' },
        { status: 400 }
      );
    }

    const cleanInput = speechText.trim();
    const ai = getGeminiClient();

    let spokenReply = mode === 'assisted'
      ? `Got it. What hotel policy should we review next?`
      : `Hi, how can I help?`;
    let learnedFact: { topic: string; detail: string } | null = null;

    if (ai) {
      const currentKnowledge = loadKnowledgeSnippet();
      const historyContext = history
        .slice(-3)
        .map((h: any) => `${h.role === 'user' ? 'Manager' : 'Concierge'}: ${h.text}`)
        .join('\n');

      const systemPrompt = `ROLE: You are Krayn, hotel AI assistant.
GOAL: Chat simply with the hotel manager. Answer briefly using ONLY facts in HOTEL KNOWLEDGE. Proactively prompt for missing policies, but NEVER ask about details that are already present in HOTEL KNOWLEDGE.

HOTEL KNOWLEDGE:
${currentKnowledge || '- General hotel operations active.'}

User statement:
"${cleanInput}"

RULES:
1. ACKNOWLEDGE USER INPUT & DON'T JUMP ABRUPTLY: When the manager states a policy, rule, or piece of information, or goes straight ahead to say something: acknowledge it simply with "Okay, noted." and ask if there is anything else they would like to add (e.g. "Okay, noted. Is there anything else you'd like to add?"). DO NOT abruptly jump into an unrelated question or the next topic!
2. PROMPT ONLY WHEN REQUESTED OR READY: If the user asks to be prompted (e.g. "prompt me", "guide me", "ask me a question") or confirms "no, nothing else", then ask 1 clear question on missing hotel gaps.
3. INTELLIGENT PROBING ON CRITICAL DETAILS ONLY WHEN NECESSARY: Only if a crucial sub-detail is missing from the exact policy they just mentioned (such as fees, hours, or restrictions), ask 1 concise follow-up probe (e.g. "Okay, noted. Is that complimentary or is there a fee?").
4. NEVER ASK ABOUT INFO YOU ALREADY HAVE: If an item, rule, hour, price, or policy is already recorded in HOTEL KNOWLEDGE, NEVER ask the user about it.
5. STRICT GROUNDING: State only facts in HOTEL KNOWLEDGE. If asked about something missing, say: "We don't have that on file yet. Could you share the details?"
6. MAX 1 SHORT SENTENCE (under 16 words). Plain conversational English.`;

      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

      const bannedGreetings = ['hi', 'hello', 'hey', 'test', 'thanks', 'thank you', 'good morning', 'good afternoon'];
      const isGreeting = bannedGreetings.includes(cleanInput.toLowerCase());

      // Run voice response generation and fact extraction simultaneously in parallel
      const [replyResult, factResult] = await Promise.all([
        (async () => {
          for (const model of candidateModels) {
            try {
              const res = await ai.models.generateContent({
                model,
                contents: systemPrompt,
                config: {
                  maxOutputTokens: 60,
                  temperature: 0.2,
                },
              });
              const raw = res.text?.trim() || '';
              if (raw) {
                return raw.replace(/[*#_~`"]/g, '').replace(/^(Concierge|AI):\s*/i, '').trim();
              }
            } catch {
              // try next model
            }
          }
          return null;
        })(),
        (async () => {
          if (!isGreeting && cleanInput.length > 5) {
            try {
              // Pre-check: Don't extract if obvious user question
              const lower = cleanInput.toLowerCase().trim();
              const questionStarters = ['what', 'when', 'where', 'why', 'who', 'how', 'is there', 'are there', 'can you', 'do you', 'tell me', 'can we', 'is the', 'are the', 'does the'];
              const isObviousQuestion = lower.endsWith('?') || questionStarters.some(q => lower.startsWith(q));

              if (isObviousQuestion) {
                return null;
              }

              const extractPrompt = `The speaker is the hotel manager updating hotel rules or informing the AI about hotel details.
Manager statement: "${cleanInput}"

Recent conversation context:
${historyContext || 'None'}

TASK:
If the manager is stating an operational fact, policy, schedule, fee, or amenity:
Extract as valid JSON:
{
  "topic": "Clean topic name (e.g. 'Checkout Time', 'Luggage Storage Policy', 'Late Checkout Fee', 'Breakfast Hours')",
  "detail": "Direct, authoritative statement preserving EXACT numbers, times, and rules stated by the manager (e.g. if the manager says '12pm checkout', the detail MUST explicitly state 'Checkout time is 12:00 PM'). Never replace explicit times with vague words like 'in the afternoon'."
}

CRITICAL RULES:
1. PRESERVE EXACT NUMBERS & TIMES: If the user states a specific time ("12pm", "11:00 am"), fee ("RM 50", "free"), or limit, use that EXACT figure. NEVER substitute with vague generalizations like "in the afternoon" or "standard fee".
2. NO INVENTED OR EXTRAPOLATED POLICIES: Do not add unmentioned policies (e.g. do not invent "late checkout is permitted" if the user only specified checkout time).
3. ATOMIC TOPICS ONLY: Never combine distinct topics (e.g. no "Luggage and Checkout").
4. NO REPETITION: State each fact once clearly and professionally.
5. If the statement is just a greeting, question, or casual conversational remark ("hello", "yes", "okay", "thanks"), return:
{}

Output ONLY valid JSON.`;

              const extractRes = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents: extractPrompt,
                config: { maxOutputTokens: 250, temperature: 0.1 },
              });
              const rawExtract = extractRes.text?.replace(/```json\n?|\n?```/g, '').trim() || '';
              const parsed = JSON.parse(rawExtract);
              const top = String(parsed?.topic || '').trim();
              const det = String(parsed?.detail || '').trim();

              if (top && det && det.length > 5 && !det.toLowerCase().includes('what is')) {
                return {
                  topic: top,
                  detail: det,
                };
              }
            } catch (err) {
              console.warn('[Fact Extraction Error]:', err);
            }
          }
          return null;
        })(),
      ]);

      if (replyResult) {
        spokenReply = replyResult;
      }
      if (factResult) {
        learnedFact = factResult;
        try {
          const { vectorStore } = await import('@/lib/vector/store');
          const { canonicalizeTopicKey, deduplicateKnowledgeHub } = await import('@/lib/knowledge/deduplicator');
          const nowIso = new Date().toISOString();
          const canonKey = canonicalizeTopicKey(factResult.topic);

          // Check if an existing rule already matches this topic
          const existing = await vectorStore.listItems();
          const match = existing.find(i => {
            const top = String(i.metadata?.topic || i.title || '');
            return canonicalizeTopicKey(top) === canonKey;
          });

          if (match) {
            // Overwrite and update existing rule
            const chunkText = `${factResult.topic}: ${factResult.detail}`;
            await vectorStore.updateItem(match.id, chunkText, factResult.topic, factResult.detail);
            (learnedFact as any).id = match.id;
          } else {
            const chunkText = `${factResult.topic}: ${factResult.detail}`;
            const [savedId] = await vectorStore.addChunksBatch([
              {
                text: chunkText,
                source: 'user_teaching' as const,
                title: factResult.topic,
                timestamp: nowIso,
                metadata: {
                  priority: 'high',
                  isGroundTruth: true,
                  topic: factResult.topic,
                  detail: factResult.detail,
                  taughtAt: nowIso,
                  origin: 'voice_teaching',
                },
              },
            ]);
            (learnedFact as any).id = savedId;
          }
          await deduplicateKnowledgeHub().catch(() => {});
        } catch (saveErr) {
          console.warn('Could not auto-persist single learned rule to vector store:', saveErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      speechText: cleanInput,
      spokenReply,
      learnedFact,
    });
  } catch (error: any) {
    console.error('Voice Teach API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Voice reply failed' },
      { status: 500 }
    );
  }
}
