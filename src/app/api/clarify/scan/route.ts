import { NextResponse } from 'next/server';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';
import { SEED_ONBOARDING_QUESTIONS, normalizeQuestionText, getSemanticQuestionKey } from '@/lib/clarify/seedQuestions';
import { isQuestionAnsweredInKnowledgeHub } from '@/lib/clarify/knowledgeAuditor';

export async function POST(request: Request) {
  try {
    let mode: string | undefined;
    try {
      const body = await request.json();
      mode = body?.mode;
    } catch (e) {
      // Body may be empty in normal scan
    }

    const allItems = await vectorStore.listItems();
    
    // Existing active clarification items
    const existingClarifications = allItems.filter(i => i.source === 'clarification');

    // Confirmed knowledge items
    const confirmedItems = allItems.filter(i => i.source !== 'clarification');

    // Collect answered questions to never duplicate them
    const answeredQuestionNorms = new Set<string>();
    const answeredSeedIds = new Set<string>();
    for (const item of allItems) {
      if (item.source === 'user_teaching') {
        if (item.metadata?.seedId) answeredSeedIds.add(String(item.metadata.seedId));
        if (item.metadata?.question) answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.question)));
        if (item.metadata?.resolvedQuestion) answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.resolvedQuestion)));
        const match = item.text.match(/Regarding ["']?([^"',\n]+)["']?,/i);
        if (match && match[1]) answeredQuestionNorms.add(normalizeQuestionText(match[1]));
      }
    }

    // Special Mode: Secret trigger for knowledge learned in the past 15 minutes
    if (mode === 'recent_15m') {
      const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
      const recentConfirmedItems = confirmedItems.filter(item => {
        const itemTime = item.timestamp ? new Date(item.timestamp).getTime() : 0;
        return itemTime >= fifteenMinsAgo;
      });

      if (recentConfirmedItems.length === 0) {
        return NextResponse.json({
          success: true,
          addedCount: 0,
          noRecentKnowledge: true,
          message: 'No new knowledge learned in the past 15 minutes.',
        });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return NextResponse.json({ success: true, addedCount: 0, message: 'AI client offline' });
      }

      const recentKnowledgeText = recentConfirmedItems
        .map(i => `[${i.source.toUpperCase()}: ${i.title}] ${i.text}`)
        .join('\n\n');

      const recentAuditPrompt = `You are Krayn AI, an intelligent operations auditor.
New knowledge was recently added to the business memory in the past 15 minutes (such as an uploaded document, PDF menu/brochure, or clarification answer).

Recent Knowledge Learned in the Past 15 Minutes:
${recentKnowledgeText}

Task:
Generate as many necessary, highly-focused clarification questions as needed to turn this newly learned information into comprehensive, operational rules for email automation. There is no arbitrary upper limit—cover all ambiguities, missing specifics, exceptions, terms, or operational procedures needed by customer service.

Requirements:
1. UNIVERSAL CUSTOMER-CENTRICITY (ALL BUSINESS TYPES):
   - ONLY ask for tangible operational details that real customers actually ask for (pricing, rates, operating hours, booking rules, packages, turnaround times, cancellation terms, or documents like menus, rate sheets, service guides).
   - NEVER ask abstract, subjective, or thematic essay questions (e.g. "What is your culinary concept?", "What is your design philosophy?", "What is your business theme?").
   - When offerings or packages are needed, ask for the concrete brochure, menu, or price guide with inputType "file" so the AI can extract details directly and verify with simple YES/NO confirmations.
2. DIRECT, FACTUAL OPTIONS:
   - Provide concrete factual choices that answer the question (e.g. for "What are the cancellation terms?" -> ["Full refund 24h prior", "Deposit non-refundable", "No refunds"]).
   - Never provide vague meta-options.
3. ATOMIC & HYPER-SPECIFIC:
   - One question per policy, product, or procedure.
3. DYNAMIC SECTIONING:
   - Provide a clean, natural business "topic" for each question (e.g., "Pricing & Policies", "Operational Basics & Hours", "Products & Services", "Bookings & Reservations", "Communication & Contact").
4. STRICT INPUT TYPES:
   - "options": Multiple choice decisions. Set "allowMultiple": true or false.
   - "text": For specific names, hours, phone numbers, addresses, custom policies. Options must be empty []. Provide a helpful "placeholder".
   - "file": For menus, catalogs, price sheets, brochures. Options must be empty [].

Return STRICTLY JSON:
{
  "newQuestions": [
    {
      "question": "Clear, direct question about tangible operational details?",
      "topic": "Descriptive Topic Name",
      "inputType": "options",
      "allowMultiple": false,
      "options": ["Direct Choice 1", "Direct Choice 2", "Direct Choice 3"],
      "placeholder": "e.g., ... (if inputType is text)"
    }
  ]
}`;

      const modelsToTry = GEMINI_GENERATIVE_MODELS;
      let generatedQuestions: Array<any> = [];

      for (const model of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: recentAuditPrompt,
          });

          const text = response.text?.trim() || '';
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed && Array.isArray(parsed.newQuestions)) {
              generatedQuestions = parsed.newQuestions;
              break;
            }
          }
        } catch (e) {
          console.warn(`[Recent 15m Scanner] Model ${model} failed, trying next...`);
        }
      }

      let addedCount = 0;
      const seenSemanticKeysInScan = new Set<string>(
        existingClarifications.map(c => getSemanticQuestionKey(String(c.metadata?.question || c.text || '')))
      );

      for (const gap of generatedQuestions) {
        if (!gap.question || (!Array.isArray(gap.options) && gap.inputType !== 'text' && gap.inputType !== 'file')) continue;
        const normGap = normalizeQuestionText(gap.question);
        const semKey = getSemanticQuestionKey(gap.question);

        if (seenSemanticKeysInScan.has(semKey)) continue;
        if (answeredQuestionNorms.has(normGap)) continue;

        // Check if question already has an answer in knowledge
        const check = await isQuestionAnsweredInKnowledgeHub(gap.question, confirmedItems);
        if (check.hasAnswer) continue;

        const alreadyExists = existingClarifications.some(
          c => normalizeQuestionText(String(c.metadata?.question || c.text || '')) === normGap
        );

        if (!alreadyExists) {
          seenSemanticKeysInScan.add(semKey);
          await vectorStore.addChunk({
            text: `PROACTIVE CLARIFICATION NEEDED for ${gap.topic || 'Operations'}: ${gap.question}`,
            source: 'clarification',
            title: gap.topic || 'Operations',
            timestamp: new Date().toISOString(),
            metadata: {
              question: gap.question,
              options: Array.isArray(gap.options) ? gap.options : [],
              inputType: gap.inputType || 'options',
              allowMultiple: !!gap.allowMultiple,
              placeholder: gap.placeholder,
              priorityScore: 9999, // Highest priority to place at the very top
              isRecentKnowledgeGap: true,
            },
          });
          addedCount++;
        }
      }

      return NextResponse.json({
        success: true,
        addedCount,
        noRecentKnowledge: false,
        message: addedCount > 0 ? `Generated ${addedCount} questions from recent knowledge.` : 'Recent knowledge is already clear.',
      });
    }
    
    // Phase 1: If knowledge hub has < 2 confirmed answers, keep & ensure foundational onboarding seeds
    if (confirmedItems.length < 2) {
      let restoredSeedsCount = 0;
      for (const seed of SEED_ONBOARDING_QUESTIONS) {
        const normSeed = normalizeQuestionText(seed.question);
        const isAnswered = answeredSeedIds.has(seed.id) || answeredQuestionNorms.has(normSeed);
        const existsInActive = existingClarifications.some(
          c => normalizeQuestionText(String(c.metadata?.question || c.text || '')) === normSeed || c.metadata?.seedId === seed.id
        );

        if (!isAnswered && !existsInActive) {
          await vectorStore.addChunk({
            text: `PROACTIVE CLARIFICATION NEEDED for ${seed.title}: ${seed.question}`,
            source: 'clarification',
            title: seed.title,
            timestamp: new Date().toISOString(),
            metadata: {
              question: seed.question,
              options: seed.options,
              priorityScore: seed.priorityScore,
              seedId: seed.id,
              isOnboarding: true,
            },
          });
          restoredSeedsCount++;
        }
      }

      return NextResponse.json({
        success: true,
        newGapsCount: restoredSeedsCount,
        message: restoredSeedsCount > 0 
          ? `Preserved foundational questions (${restoredSeedsCount} re-checked). Answer these to unlock in-depth AI questions.`
          : 'Foundational questions are active. Answer them to unlock deeper operational questions.',
      });
    }

    // Phase 2: Knowledge hub has confirmed facts! Perform full AI rethink:
    // Audit existing questions: keep what is relevant, remove low-impact/obsolete ones, add fresh gaps.
    const confirmedKnowledge = confirmedItems
      .slice(0, 15)
      .map(i => `[${i.source.toUpperCase()}: ${i.title}] ${i.text}`)
      .join('\n\n');

    const activeQuestionsList = existingClarifications.map((item, idx) => ({
      index: idx,
      id: item.id,
      seedId: item.metadata?.seedId,
      question: String(item.metadata?.question || item.text.replace(/^PROACTIVE CLARIFICATION NEEDED for [^:]+:\s*/, '')),
      topic: item.title || 'General',
    }));

    const ai = getGeminiClient();
    if (!ai) {
      return NextResponse.json({ success: true, newGapsCount: 0, message: 'AI client offline' });
    }

    const rethinkPrompt = `You are Krayn AI, an intelligent operations auditor.
Your goal is to AUDIT and RETHINK the open clarification questions needed to run email automation effectively.

Confirmed Knowledge Base:
${confirmedKnowledge}

Currently Open Questions:
${JSON.stringify(activeQuestionsList, null, 2)}

Audit Instructions:
1. STRICT RETENTION OF RELEVANT QUESTIONS (HIGH STABILITY):
   - CRITICAL: If currently open questions are relevant and unanswered, DO NOT remove them just for the sake of refreshing or generating new questions! Keep them stable.
   - ONLY mark for removal in "removeQuestionIds" if:
     * The question is redundant or already clearly answered in the Confirmed Knowledge Base.
     * The question is a premature hyper-specific edge case (e.g. handling extreme legal complaints or complex dispute escalation) while basic tangible operational facts are still unknown.
   - If existing questions are solid and relevant, KEEP THEM. "removeQuestionIds" should be empty.
2. DIRECT, LEGITIMATE ANSWERS ONLY (CRITICAL):
   - The options provided for multiple-choice MUST BE DIRECT FACTUAL CHOICES THAT ACTUALLY ANSWER THE QUESTION (e.g. for "What are your check-in hours?" -> "3:00 PM standard", "24-hour check-in", "By appointment only").
   - NEVER generate meta-options or options that describe formats instead of answers.
3. HYPER-SPECIFIC & ATOMIC QUESTIONS ONLY (NO COMPOUND QUESTIONS):
   - Questions MUST ask about ONE single entity or policy at a time.
   - NEVER combine multiple outlets or aspects into one question (e.g. "What are the hours for Outlet A and Outlet B?" is strictly forbidden!).
   - If an existing question asks for 2 things at once (like "What are the specific operational hours for Merdeka Grill and Park Lounge?"), MARK IT IN "removeQuestionIds" and split it into two hyper-specific questions in "newQuestions" ("What are the hours for Merdeka Grill?" and "What are the hours for Park Lounge?").
4. STRICT INPUT TYPE USAGE ("inputType"):
   - "boolean": For simple Yes / No questions (e.g. "Is breakfast included?", "Do you allow pets?", "Is valet available?"). Options must be ["Yes", "No"].
   - "text": For specific names, hours, phone numbers, addresses, custom policies. Options must be empty []. Provide a helpful "placeholder".
   - "file": For menus, catalogs, price sheets, brochures, floor plans, rate cards. Options must be empty [].
   - "options": For multiple choice decisions with however many direct, punchy 2-4 word options that directly answer the question (2, 3, 4, 5+ choices). Set "allowMultiple": true or false.

Return STRICTLY JSON:
{
  "removeQuestionIds": ["id_to_remove"],
  "newQuestions": [
    {
      "question": "Clear, direct question about tangible business details?",
      "topic": "Descriptive Topic Name",
      "inputType": "options",
      "allowMultiple": true,
      "options": ["Direct Choice 1", "Direct Choice 2", "Direct Choice 3"],
      "placeholder": "e.g., ... (if inputType is text)",
      "priorityScore": 85
    }
  ]
}`;

    const modelsToTry = GEMINI_GENERATIVE_MODELS;
    let rethinkResult: { removeQuestionIds?: string[]; newQuestions?: Array<any> } = {};

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: rethinkPrompt,
        });

        const text = response.text?.trim() || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed && (Array.isArray(parsed.removeQuestionIds) || Array.isArray(parsed.newQuestions))) {
            rethinkResult = parsed;
            break;
          }
        }
      } catch (e) {
        console.warn(`[Rethink Scanner] Model ${model} failed, trying next...`);
      }
    }

    // 1. Remove obsolete questions identified by AI
    let removedCount = 0;
    if (Array.isArray(rethinkResult.removeQuestionIds)) {
      for (const id of rethinkResult.removeQuestionIds) {
        const target = existingClarifications.find(c => c.id === id);
        // Protect foundational onboarding questions from being wiped prematurely
        const targetSeedId = String(target?.metadata?.seedId || '');
        if (target && !targetSeedId.startsWith('onboard-')) {
          await vectorStore.deleteItem(id);
          removedCount++;
        }
      }
    }

    // 2. Add fresh newly thought questions
    let addedCount = 0;
    if (Array.isArray(rethinkResult.newQuestions)) {
      for (const gap of rethinkResult.newQuestions) {
        if (!gap.question || !Array.isArray(gap.options)) continue;
        const normGap = normalizeQuestionText(gap.question);
        const isAnswered = answeredQuestionNorms.has(normGap);
        const alreadyExists = existingClarifications.some(
          c => normalizeQuestionText(String(c.metadata?.question || c.text || '')) === normGap
        );

        if (!isAnswered && !alreadyExists) {
          const { isQuestionAnsweredInKnowledgeHub } = await import('@/lib/clarify/knowledgeAuditor');
          const check = await isQuestionAnsweredInKnowledgeHub(gap.question, confirmedItems);
          if (check.hasAnswer) continue;

          const { enrichOptionsWithContext, inferClarificationInputType, inferClarificationMultiSelect } = await import('@/lib/clarify/seedQuestions');
          const contextSummary = confirmedItems.slice(0, 15).map(c => c.text).join(' ');
          const enrichedGapOptions = enrichOptionsWithContext(gap.question, gap.options, contextSummary);
          const inferred = inferClarificationInputType(gap.question, gap.inputType);
          const allowMulti = inferClarificationMultiSelect(gap.question, gap.allowMultiple);

          await vectorStore.addChunk({
            text: `PROACTIVE CLARIFICATION NEEDED for ${gap.topic || 'Operations'}: ${gap.question}`,
            source: 'clarification',
            title: gap.topic || 'Operations',
            timestamp: new Date().toISOString(),
            metadata: {
              question: gap.question,
              options: enrichedGapOptions,
              inputType: inferred.inputType,
              placeholder: gap.placeholder || inferred.placeholder,
              allowMultiple: inferred.inputType === 'boolean' ? false : allowMulti,
              priorityScore: gap.priorityScore || 80,
              isBackgroundGapScan: true,
            },
          });
          addedCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      addedCount,
      removedCount,
      message: `Rethought questions: +${addedCount} new, -${removedCount} pruned.`,
    });
  } catch (error: any) {
    console.error('Failed to run rethink scan:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Rethink scan error' },
      { status: 500 }
    );
  }
}
