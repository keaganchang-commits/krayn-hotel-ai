import { NextResponse } from 'next/server';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';

export async function POST(request: Request) {
  try {
    const { questions } = await request.json();

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({ success: true, rankedIds: [] });
    }

    if (questions.length === 1) {
      return NextResponse.json({ success: true, rankedIds: [questions[0].id] });
    }

    // 1. Retrieve all confirmed knowledge and resolved rules
    const allItems = await vectorStore.listItems();
    const confirmedRules = allItems
      .filter(i => i.source !== 'clarification')
      .slice(0, 15)
      .map(i => `[${i.source.toUpperCase()}: ${i.title}] ${i.text}`)
      .join('\n');

    const ai = getGeminiClient();

    // Fallback heuristic scoring if AI client is offline
    const calculateFallbackScore = (q: any) => {
      const text = (q.question + ' ' + (q.title || '')).toLowerCase();
      // Identity & Core Profile highest priority
      if (text.includes('industry') || text.includes('business') || text.includes('operating') || text.includes('how long')) return 100;
      if (text.includes('model') || text.includes('b2b') || text.includes('target customer')) return 95;
      // High-risk legal & financial boundaries
      if (text.includes('legal') || text.includes('chargeback') || text.includes('complaint')) return 90;
      if (text.includes('refund') || text.includes('return') || text.includes('money-back')) return 85;
      if (text.includes('sla') || text.includes('response time') || text.includes('support hours')) return 80;
      if (text.includes('cancellation') || text.includes('cancel')) return 75;
      if (text.includes('pricing') || text.includes('discount') || text.includes('invoice')) return 70;
      if (text.includes('unsupported') || text.includes('competitor')) return 65;
      // Tone & Signoff lower priority
      if (text.includes('tone') || text.includes('voice')) return 60;
      if (text.includes('signoff') || text.includes('signature')) return 40;
      return 50;
    };

    if (!ai) {
      const sorted = [...questions].sort((a, b) => calculateFallbackScore(b) - calculateFallbackScore(a));
      return NextResponse.json({ success: true, rankedIds: sorted.map(q => q.id) });
    }

    const questionListPrompt = questions
      .map((q, idx) => `ID: ${q.id} | Question: "${q.question}" | Topic: ${q.title || 'General'}`)
      .join('\n');

    const prompt = `You are Krayn AI, an executive operations prioritization engine.
Analyze the company profile context below and rank the provided list of pending clarification questions from MOST IMPORTANT to LEAST IMPORTANT.

Confirmed Company Profile & Context:
${confirmedRules || 'New company onboarding in progress. Profile is currently being defined.'}

Pending Questions to Rank:
${questionListPrompt}

Ranking Criteria:
1. Business Foundation First: Foundational profile questions (industry, company stage/age, business model B2B/B2C, target customer) must always rank at the top if unanswered.
2. Commercial Risk & Frequency: Next, rank high-risk operational policies that customers ask about most frequently or carry financial/legal consequences (refund policies, customer disputes, response SLA, support availability).
3. Nuances & Negotiations: Follow with transaction details, discounts, cancellation terms, and fulfillment policies.
4. Cosmetic & Formatting Last: Tone of voice, sign-offs, and formatting preferences rank near the end.
5. Dynamic Adaptation: If the confirmed context reveals the business is B2B/Enterprise, prioritize SLAs, custom contracts, and escalations. If E-Commerce, prioritize return windows, shipping, and order status.

Return ONLY a valid JSON array of question IDs ordered from most important (index 0) to least important, e.g.:
["id1", "id2", "id3", ...]
Do not include explanations or markdown codeblocks.`;

    const modelsToTry = GEMINI_GENERATIVE_MODELS;
    let rankedIds: string[] | null = null;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const text = response.text?.trim() || '';
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            rankedIds = parsed.map(id => String(id));
            break;
          }
        }
      } catch (e) {
        console.warn(`[Ranking Engine] Model ${model} failed, trying next...`);
      }
    }

    if (!rankedIds || rankedIds.length === 0) {
      const sorted = [...questions].sort((a, b) => calculateFallbackScore(b) - calculateFallbackScore(a));
      rankedIds = sorted.map(q => q.id);
    } else {
      // Ensure any missing questions from the original list are appended at the end
      const presentSet = new Set(rankedIds);
      for (const q of questions) {
        if (!presentSet.has(q.id)) {
          rankedIds.push(q.id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      rankedIds,
    });
  } catch (error: any) {
    console.error('Error ranking questions:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Ranking calculation error' },
      { status: 500 }
    );
  }
}
