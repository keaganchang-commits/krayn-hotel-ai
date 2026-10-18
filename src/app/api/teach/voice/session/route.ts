import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'GEMINI_API_KEY missing' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'assisted';

  // Load verified operational knowledge rules from .knowledge_store in real-time
  let knowledgeSummary = '';
  const knownTopics = new Set<string>();
  const rulesList: string[] = [];

  try {
    const indexPath = path.join(process.cwd(), '.knowledge_store', 'index.json');
    if (fs.existsSync(indexPath)) {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const rawItems = Array.isArray(data.items) ? data.items : Object.values(data.items || {});
      const items = rawItems.filter(Boolean);
      const seenAll = new Set<string>();
      const scored: Array<{ text: string; score: number }> = [];

      const priorityKeywords = [
        'check-in', 'checkout', 'breakfast', 'pool', 'gym', 'fitness', 'spa', 'valet', 'parking', 
        'corkage', 'pet', 'deposit', 'smoking', 'cancellation', 'merdeka grill', 'park lounge', 'cacao', 'luggage', 'hours'
      ];

      for (const item of items) {
        if (!item) continue;
        const meta = item.metadata || {};
        if (meta.source === 'clarification') continue;
        const text = (meta.text || meta.title || item.title || item.text || '').trim();
        const key = text.toLowerCase();
        if (text.length > 5 && !seenAll.has(key)) {
          seenAll.add(key);
          rulesList.push(`- ${text}`);
          if (meta.topic) knownTopics.add(String(meta.topic).toLowerCase());

          let score = 0;
          if (meta.source === 'user_teaching' || meta.origin === 'voice_teaching' || meta.isGroundTruth) score += 10;
          for (const kw of priorityKeywords) {
            if (key.includes(kw)) score += 3;
          }
          scored.push({ text, score });
        }
      }

      // Complete knowledge string for local gap analysis
      const allKnowledgeSummary = rulesList.join('\n');

      // Sort scored rules to supply a concise high-priority context (~80-100 rules, ~2k tokens) to the Live WebSocket
      scored.sort((a, b) => b.score - a.score);
      const topRules = scored.slice(0, 100).map(s => `- ${s.text}`);
      knowledgeSummary = topRules.join('\n');
    }
  } catch (err) {
    console.warn('Could not load knowledge items for voice session:', err);
  }

  // Use the full knowledge store for checking gaps so no known fact is ever re-asked
  const lowerSummary = rulesList.join('\n').toLowerCase();

  // Potential hotel operational topics grouped by operational area and ranked by guest priority
  // The AI will guide the user through one area in-depth before asking confirmation to transition
  // Potential hotel operational topics grouped by operational area and ranked by guest priority
  // The AI will guide the user through one area in-depth before asking confirmation to transition
  // Comprehensive operational areas covering typical hotel policies
  const operationalAreas = [
    {
      name: 'Rooms & Arrival/Departure',
      questions: [
        {
          q: 'What is the standard check-in time and is there early check-in availability?',
          check: (txt: string) => /check-in time|check in time/i.test(txt),
        },
        {
          q: 'What is the standard checkout time and late checkout policy?',
          check: (txt: string) => /(checkout|check-out|check out).*(time|policy|extended|12|11)/i.test(txt),
        },
        {
          q: 'Can guests store luggage before check-in or after checkout, and is it complimentary?',
          check: (txt: string) => /luggage|baggage|bellhop|store.*bag/i.test(txt),
        },
        {
          q: 'What are the charges and availability for extra rollaway beds and baby cribs?',
          check: (txt: string) => /extra bed|rollaway|crib|baby cot/i.test(txt),
        },
        {
          q: 'What is the guest security deposit required at check-in (cash or card hold)?',
          check: (txt: string) => /security deposit|incidental deposit|deposit at check-in/i.test(txt),
        },
      ],
    },
    {
      name: 'Dining & In-Room Service',
      questions: [
        {
          q: 'What are the operating hours and location for breakfast, and what is the walk-in price?',
          check: (txt: string) => /breakfast/i.test(txt) && /(hour|daily|buffet|06:30|price|rm|myr)/i.test(txt),
        },
        {
          q: 'What are the operating hours for in-room dining / room service?',
          check: (txt: string) => /in-room dining|room service/i.test(txt),
        },
        {
          q: 'Can guests order third-party food delivery (GrabFood/Foodpanda) directly to rooms or lobby only?',
          check: (txt: string) => /food delivery|outside food|grabfood|foodpanda/i.test(txt),
        },
        {
          q: 'What is the corkage fee for wine and hard liquor brought by guests?',
          check: (txt: string) => /corkage/i.test(txt),
        },
        {
          q: 'Are hotel dining outlets halal-certified, pork-free, or accommodating vegetarian/vegan diets?',
          check: (txt: string) => /halal|pork-free|pork free|dietary/i.test(txt),
        },
      ],
    },
    {
      name: 'Facilities & Wellness',
      questions: [
        {
          q: 'What are the swimming pool operating hours, and is there a children pool or lifeguard on duty?',
          check: (txt: string) => /pool/i.test(txt) && /(hour|level 99|indoor|lifeguard|children|towel|07:00|daily)/i.test(txt),
        },
        {
          q: 'What are the fitness center / gym operating hours, and is access 24/7 with room key?',
          check: (txt: string) => /(gym|fitness|technogym)/i.test(txt) && /(24|keycard|access|hour)/i.test(txt),
        },
        {
          q: 'Are spa or sauna facilities available, and do they require advance appointment?',
          check: (txt: string) => /spa/i.test(txt) && /(level 99|appointment|booking|treatment|sauna|wellness)/i.test(txt),
        },
      ],
    },
    {
      name: 'Parking & Transportation',
      questions: [
        {
          q: 'What is the valet parking fee per entry or per overnight stay for in-house guests?',
          check: (txt: string) => /valet/i.test(txt) && /(fee|myr|rm|entry|parking)/i.test(txt),
        },
        {
          q: 'Is self-parking free or validated for in-house guests, and what is the visitor rate?',
          check: (txt: string) => /self-parking|parking.*complimentary|complimentary.*parking/i.test(txt),
        },
        {
          q: 'Are electric vehicle (EV) charging stations available on-site, and what is the charging fee?',
          check: (txt: string) => /ev charger|ev charging|electric vehicle/i.test(txt),
        },
        {
          q: 'Does the hotel provide airport transfer or limousine service, and what is the price?',
          check: (txt: string) => /airport transfer|limousine|airport shuttle/i.test(txt),
        },
      ],
    },
    {
      name: 'Special Hotel Policies',
      questions: [
        {
          q: 'Are pets allowed in guestrooms, and what are the pet weight limits and cleaning deposits?',
          check: (txt: string) => /pet policy|pet.*allowed|not allowed.*service animal/i.test(txt),
        },
        {
          q: 'What is the cancellation deadline before arrival to avoid a penalty or no-show fee?',
          check: (txt: string) => /cancellation policy|non-refundable|cancellation deadline/i.test(txt),
        },
        {
          q: 'Where is the designated smoking area, and what is the cleaning fine for smoking in rooms?',
          check: (txt: string) => /smoking fine|designated smoking|strictly non-smoking|smoking is prohibited/i.test(txt),
        },
        {
          q: 'What is the maximum room occupancy policy for adults and children per room type?',
          check: (txt: string) => /occupancy policy|max.*occupancy|maximum guest/i.test(txt),
        },
      ],
    },
  ];

  // Collect active clarification questions directly from the Clarifications Hub
  const gaps: string[] = [];
  try {
    const { vectorStore } = await import('@/lib/vector/store');
    const { isQuestionAnsweredInKnowledgeHub } = await import('@/lib/clarify/knowledgeAuditor');
    const allStoreItems = await vectorStore.listItems();
    const confirmedItems = allStoreItems.filter(item => item.source !== 'clarification');
    const clarificationItems = allStoreItems.filter(item => item.source === 'clarification');

    // Collect questions from active clarification cards
    const activeClarificationQuestions: string[] = [];
    for (const item of clarificationItems) {
      const qText = (item.metadata?.question || item.title || item.text || '').replace(/^PROACTIVE CLARIFICATION NEEDED for [^:]+:\s*/, '').trim();
      if (!qText || qText.length < 5) continue;
      
      // Ensure it is not already answered
      const check = await isQuestionAnsweredInKnowledgeHub(qText, confirmedItems);
      if (!check.hasAnswer) {
        const cat = item.metadata?.category || item.metadata?.title || 'General';
        activeClarificationQuestions.push(`[${cat}] ${qText}`);
      }
    }

    if (activeClarificationQuestions.length > 0) {
      gaps.push('[CLARIFICATIONS HUB QUESTIONS]');
      for (const q of activeClarificationQuestions) {
        gaps.push(`- ${q}`);
      }
    }
  } catch (err) {
    console.warn('Could not read clarification questions for voice session:', err);
  }

  // If no clarification items exist in store, fallback to missing operational areas
  if (gaps.length === 0) {
    for (const area of operationalAreas) {
      const missingInArea = area.questions.filter(item => !item.check(lowerSummary));
      if (missingInArea.length > 0) {
        gaps.push(`[AREA: ${area.name}]`);
        for (const item of missingInArea) {
          gaps.push(`- ${item.q}`);
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    apiKey,
    model: 'models/gemini-2.5-flash-native-audio-latest',
    voiceName: 'Charon', // Deep, calm, and natural professional male voice
    mode,
    totalRulesCount: rulesList.length,
    currentKnowledge: knowledgeSummary,
    knowledgeGaps: gaps,
  });
}
