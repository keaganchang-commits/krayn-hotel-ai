import { NextResponse } from 'next/server';
import { vectorStore } from '@/lib/vector/store';
import { 
  SEED_ONBOARDING_QUESTIONS, 
  normalizeQuestionText, 
  inferClarificationInputType, 
  inferClarificationMultiSelect,
  getSemanticQuestionKey,
  cleanOptionLabel,
  enrichOptionsWithContext,
  isValidClarificationQuestion
} from '@/lib/clarify/seedQuestions';
import { isQuestionAnsweredInKnowledgeHub } from '@/lib/clarify/knowledgeAuditor';

// GET /api/clarify - Instant fetch of pre-generated & pre-ranked clarification questions
export async function GET() {
  try {
    const allStoreItems = await vectorStore.listItems();
    const allItems = allStoreItems.filter(item => item.source === 'clarification');
    const confirmedItems = allStoreItems.filter(item => item.source !== 'clarification');

    // Collect all questions and semantic topic keys that have already been answered / taught
    const answeredQuestionNorms = new Set<string>();
    const answeredSeedIds = new Set<string>();
    const answeredSemanticKeys = new Set<string>();
    for (const item of allStoreItems) {
      if (item.source === 'user_teaching' || item.source === 'gmail') {
        if (item.metadata?.seedId) answeredSeedIds.add(String(item.metadata.seedId));
        if (item.metadata?.question) {
          answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.question)));
          answeredSemanticKeys.add(getSemanticQuestionKey(String(item.metadata.question)));
        }
        if (item.metadata?.resolvedQuestion) {
          answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.resolvedQuestion)));
          answeredSemanticKeys.add(getSemanticQuestionKey(String(item.metadata.resolvedQuestion)));
        }

        const match = item.text.match(/Regarding ["']?([^"',\n]+)["']?,/i);
        if (match && match[1]) {
          answeredQuestionNorms.add(normalizeQuestionText(match[1]));
          answeredSemanticKeys.add(getSemanticQuestionKey(match[1]));
        }
      }
    }

    // Check how much confirmed knowledge we actually have
    const confirmedCount = confirmedItems.length;

    // Filter questions:
    // 1. If question already has answers in knowledge hub, prune it from vectorStore and do NOT return it!
    // 2. If business is new / knowledge hub is empty (< 2 confirmed items), strictly show ONLY foundational onboarding questions!
    const filteredQuestions: typeof allItems = [];
    const idsToDelete: string[] = [];

    for (const item of allItems) {
      const qText = String(item.metadata?.question || item.text.replace(/^PROACTIVE CLARIFICATION NEEDED for [^:]+:\s*/, ''));
      const norm = normalizeQuestionText(qText);
      const semKey = getSemanticQuestionKey(qText);
      const seedId = item.metadata?.seedId ? String(item.metadata.seedId) : '';

      if (seedId && answeredSeedIds.has(seedId)) {
        idsToDelete.push(item.id);
        continue;
      }
      if (norm && answeredQuestionNorms.has(norm)) {
        idsToDelete.push(item.id);
        continue;
      }
      if (semKey && answeredSemanticKeys.has(semKey)) {
        idsToDelete.push(item.id);
        continue;
      }

      // Check Knowledge Hub: If the question is ALREADY answered in the confirmed facts, PRUNE IT!
      // This applies to both proactive suggestions AND customer questions that have already been resolved.
      const check = await isQuestionAnsweredInKnowledgeHub(qText, confirmedItems);
      if (check.hasAnswer) {
        idsToDelete.push(item.id);
        continue;
      }

      // Never show bounce, mailer-daemon, or automated system notices as customer inquiries
      const senderText = String(item.metadata?.sender || '').toLowerCase();
      const subjectText = String(item.metadata?.subject || '').toLowerCase();
      if (
        senderText.includes('mailer-daemon') ||
        senderText.includes('postmaster') ||
        senderText.includes('no-reply') ||
        senderText.includes('noreply') ||
        subjectText.includes('delivery status notification') ||
        subjectText.includes('failure notice')
      ) {
        idsToDelete.push(item.id);
        continue;
      }

      const isCustomerInquiry = !!(
        item.metadata?.emailId ||
        item.metadata?.sender ||
        item.metadata?.threadId ||
        item.metadata?.originalBody ||
        item.metadata?.sourceType === 'ai_chat' ||
        item.metadata?.originalCustomerQuery
      );

      // Reject greetings, pleasantries, non-inquiries, and assistant phrases framed as questions
      const origQuery = String(item.metadata?.originalCustomerQuery || item.metadata?.subject || item.metadata?.originalBody || '');
      if (!isValidClarificationQuestion(qText, origQuery)) {
        idsToDelete.push(item.id);
        continue;
      }

      filteredQuestions.push(item);
    }

    // Prune all redundant/answered questions in a single atomic batch in the background
    if (idsToDelete.length > 0) {
      vectorStore.deleteItemsBatch(idsToDelete).catch(err => console.warn('Prune batch error:', err));
    }

    const questions = filteredQuestions
      .flatMap(item => {
        const rawQ = String(item.metadata?.question || item.text.replace(/^PROACTIVE CLARIFICATION NEEDED for [^:]+:\s*/, ''));
        const cleanTitle = (item.title || 'Operational Policy').replace(/^Gap Analysis:\s*/i, '');

        // Auto-split compound multi-outlet or multi-aspect questions
        let atomicQuestions: Array<{ qText: string; subId: string; title: string }> = [];
        if (rawQ.includes('Merdeka Grill and Park Lounge') || rawQ.includes('Merdeka Grill & Park Lounge')) {
          atomicQuestions = [
            { qText: 'What are the operational hours for Merdeka Grill?', subId: `${item.id}_grill`, title: 'Dining & Breakfast' },
            { qText: 'What are the operational hours for Park Lounge?', subId: `${item.id}_lounge`, title: 'Dining & Breakfast' },
          ];
        } else if (
          rawQ.toLowerCase().includes('dietary') &&
          (rawQ.toLowerCase().includes('outlet') || rawQ.toLowerCase().includes('these outlets') || rawQ.toLowerCase().includes('restaurant'))
        ) {
          // Break vague "specific dietary menus at these outlets" into precise per-outlet multi-select questions
          const outlets = ['Merdeka Grill', 'Park Lounge', 'Cacao'];
          atomicQuestions = outlets.map(outlet => ({
            qText: `Which dietary accommodations or options are available at ${outlet}?`,
            subId: `${item.id}_dietary_${outlet.toLowerCase().replace(/\s+/g, '_')}`,
            title: `${outlet} Dietary Options`,
          }));
        } else {
          atomicQuestions = [{ qText: rawQ, subId: item.id, title: cleanTitle }];
        }

        return atomicQuestions.map(({ qText, subId, title }) => {
          const inferred = inferClarificationInputType(qText, item.metadata?.inputType as any);
          const allowMultiple = inferred.inputType === 'options' 
            ? inferClarificationMultiSelect(qText, typeof item.metadata?.allowMultiple === 'boolean' ? item.metadata.allowMultiple : undefined)
            : false;

          // Configure options accurately according to inputType
          let finalOptions: string[] = [];
          if (inferred.inputType === 'boolean') {
            finalOptions = ['Yes', 'No'];
          } else if (inferred.inputType === 'options') {
            const rawOpts = Array.isArray(item.metadata?.options) && item.metadata.options.length > 0
              ? item.metadata.options
              : [];
            // Context-aware & geographically enriched options (e.g. Malaysia Touch 'n Go, GrabPay, DuitNow, etc.)
            const contextText = confirmedItems.slice(0, 15).map(c => c.text).join(' ');
            finalOptions = enrichOptionsWithContext(qText, rawOpts, contextText);
          } else {
            // 'text' or 'file' do not have options
            finalOptions = [];
          }

          const priority = typeof item.metadata?.priorityScore === 'number' ? item.metadata.priorityScore : 70;

          return {
            id: subId,
            seedId: item.metadata?.seedId,
            question: qText,
            options: finalOptions,
            title,
            source: item.source,
            timestamp: item.timestamp,
            priorityScore: priority,
            inputType: inferred.inputType,
            placeholder: item.metadata?.placeholder || inferred.placeholder,
            allowMultiple: inferred.inputType === 'boolean' ? false : allowMultiple,
            followUpsByOption: item.metadata?.followUpsByOption,
            emailId: item.metadata?.emailId ? String(item.metadata.emailId) : undefined,
            threadId: item.metadata?.threadId ? String(item.metadata.threadId) : undefined,
            inReplyToMsgId: item.metadata?.inReplyToMsgId ? String(item.metadata.inReplyToMsgId) : undefined,
            sender: item.metadata?.sender ? String(item.metadata.sender) : undefined,
            originalBody: item.metadata?.originalBody ? String(item.metadata.originalBody) : undefined,
            sourceType: item.metadata?.sourceType ? String(item.metadata.sourceType) : undefined,
            originalCustomerQuery: item.metadata?.originalCustomerQuery ? String(item.metadata.originalCustomerQuery) : undefined,
            isOnboarding: !!item.metadata?.isOnboarding,
          };
        });
      });

    // If database had no active questions, fallback to pre-defined seeds (filtering out any answered ones)
    if (questions.length === 0) {
      const fallbackSeeds = SEED_ONBOARDING_QUESTIONS
        .filter(seed => !answeredSeedIds.has(seed.id) && !answeredQuestionNorms.has(normalizeQuestionText(seed.question)))
        .map(seed => ({
          id: seed.id,
          seedId: seed.id,
          question: seed.question,
          options: seed.options,
          title: seed.title,
          source: 'clarification',
          timestamp: new Date().toISOString(),
          priorityScore: seed.priorityScore,
          inputType: seed.inputType || 'options',
          placeholder: seed.placeholder,
          isOnboarding: true,
        }));

      return NextResponse.json({
        success: true,
        questions: fallbackSeeds,
      });
    }

    // Sort by pre-calculated priorityScore descending (highest priority first)
    questions.sort((a, b) => b.priorityScore - a.priorityScore);

    // Dedup questions using semantic topic keys:
    // Only keep the single highest priority question per unique topic dimension for proactive AI suggestions,
    // AND group customer inquiries with the same topic into ONE single clean question card!
    const seenSemanticKeys = new Set<string>();
    const customerInquiryByKey = new Map<string, typeof questions[0] & { waitingEmails?: Array<{ emailId?: string; threadId?: string; inReplyToMsgId?: string; sender?: string; originalBody?: string }> }>();
    const uniqueProactiveQuestions: typeof questions = [];

    for (const q of questions) {
      const isCustomerInquiry = !!(
        q.emailId ||
        q.sender ||
        q.threadId ||
        q.originalBody ||
        (q as any).sourceType === 'ai_chat' ||
        (q as any).originalCustomerQuery
      );

      const key = getSemanticQuestionKey(q.question);

      if (isCustomerInquiry) {
        if (!customerInquiryByKey.has(key)) {
          // Clean the question text to be short, punchy, and direct (e.g. "Does the hotel have a pool?" instead of "Customer asked: ...")
          let cleanQ = q.question;
          const matchCustomerAsked = cleanQ.match(/customer asked:\s*["']?([^"'\n]+)["']?/i);
          if (matchCustomerAsked && matchCustomerAsked[1]) {
            cleanQ = matchCustomerAsked[1].trim();
            // Capitalize first letter and ensure question mark
            cleanQ = cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1);
            if (!cleanQ.endsWith('?')) cleanQ += '?';
          }

          // If asking "Hi may I know if...", strip greeting
          cleanQ = cleanQ.replace(/^(hi|hello|hey|good day)[,\s]+/i, '');
          cleanQ = cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1);

          // Infer clean inputType and options for this consolidated question
          const cleanInferred = inferClarificationInputType(cleanQ);
          const cleanOptions = cleanInferred.inputType === 'boolean'
            ? ['Yes', 'No']
            : (Array.isArray(q.options) && q.options.length > 0 ? q.options : []);

          customerInquiryByKey.set(key, {
            ...q,
            question: cleanQ,
            inputType: cleanInferred.inputType,
            options: cleanOptions,
            allowMultiple: cleanInferred.inputType === 'boolean' ? false : q.allowMultiple,
            waitingEmails: [{
              emailId: q.emailId,
              threadId: q.threadId,
              inReplyToMsgId: (q as any).inReplyToMsgId,
              sender: q.sender,
              originalBody: (q as any).originalBody,
            }],
          });
        } else {
          // Aggregate additional waiting customer email into this same question card
          const existing = customerInquiryByKey.get(key)!;
          if (!existing.waitingEmails) existing.waitingEmails = [];
          existing.waitingEmails.push({
            emailId: q.emailId,
            threadId: q.threadId,
            inReplyToMsgId: (q as any).inReplyToMsgId,
            sender: q.sender,
            originalBody: (q as any).originalBody,
          });
        }
      } else {
        if (seenSemanticKeys.has(key)) {
          // Prune lower-priority duplicate proactive question from store
          if (q.id && !q.id.startsWith('onboard-')) {
            vectorStore.deleteItem(q.id).catch(() => {});
          }
          continue;
        }
        seenSemanticKeys.add(key);
        uniqueProactiveQuestions.push(q);
      }
    }

    const customerInquiries = Array.from(customerInquiryByKey.values());
    const proactiveQuestions = uniqueProactiveQuestions;

    // CYCLE RESTRICTION (Per User Directive):
    // For each cycle of questions (excluding customer questions):
    // 1. Keep it to a MAX OF 10 QUESTIONS in ONE very specific area / topic.
    // 2. This ensures super in-depth information about something specific before gradually progressing.
    // 3. Keep questions rock-solid and stable across page reloads!
    let focusedProactiveQuestions: typeof proactiveQuestions = [];
    if (proactiveQuestions.length > 0) {
      // Group proactive questions by broad operational domain:
      // Dining & F&B, Rooms & Accommodation, Facilities & Wellness, Arrival & Parking, Policies & Logistics
      const domainMap = new Map<string, typeof proactiveQuestions>();
      for (const q of proactiveQuestions) {
        const titleLower = (q.title || '').toLowerCase();
        let domain = q.title || 'General';
        if (titleLower.includes('dining') || titleLower.includes('menu') || titleLower.includes('cacao') || titleLower.includes('breakfast') || titleLower.includes('grill') || titleLower.includes('lounge')) {
          domain = 'Dining & Outlets';
        } else if (titleLower.includes('room') || titleLower.includes('bed') || titleLower.includes('tier') || titleLower.includes('suite') || titleLower.includes('rate')) {
          domain = 'Rooms & Accommodation';
        } else if (titleLower.includes('wellness') || titleLower.includes('gym') || titleLower.includes('fitness') || titleLower.includes('pool') || titleLower.includes('spa')) {
          domain = 'Wellness & Facilities';
        } else if (titleLower.includes('parking') || titleLower.includes('transport') || titleLower.includes('arrival') || titleLower.includes('shuttle')) {
          domain = 'Arrival & Transport';
        } else if (titleLower.includes('policy') || titleLower.includes('pet') || titleLower.includes('cancellation') || titleLower.includes('deposit')) {
          domain = 'Policies & Operations';
        }

        if (!domainMap.has(domain)) domainMap.set(domain, []);
        domainMap.get(domain)!.push(q);
      }

      // Pick the primary domain in a strictly deterministic priority order:
      // 1. Dining & Outlets (tangible core offerings & menus)
      // 2. Rooms & Accommodation (room tiers, bed options, rates)
      // 3. Wellness & Facilities (pool, gym, amenities)
      // 4. Arrival & Transport (parking, valet, shuttle)
      // 5. Policies & Operations (check-in/out, cancellations, pets)
      const DOMAIN_PROGRESSION_ORDER = [
        'Dining & Outlets',
        'Rooms & Accommodation',
        'Wellness & Facilities',
        'Arrival & Transport',
        'Policies & Operations',
      ];

      let primaryDomain = DOMAIN_PROGRESSION_ORDER.find(d => domainMap.has(d) && (domainMap.get(d) || []).length > 0);
      if (!primaryDomain) {
        primaryDomain = Array.from(domainMap.keys())[0] || 'General';
      }

      const clusterQuestions = domainMap.get(primaryDomain) || [];

      // Sort questions deterministically by priorityScore descending, then by stable ID
      clusterQuestions.sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        return a.id.localeCompare(b.id);
      });

      // Take up to 10 max within this single focused domain
      focusedProactiveQuestions = clusterQuestions.slice(0, 10).map(q => ({
        ...q,
        title: primaryDomain,
      }));
    }

    // Combine: Customer Inquiries ALWAYS AT THE VERY TOP + focused single-area proactive questions
    // Deterministically sort customer inquiries by timestamp descending
    customerInquiries.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    const finalCycleQuestions = [...customerInquiries, ...focusedProactiveQuestions];

    return NextResponse.json({
      success: true,
      questions: finalCycleQuestions,
    });
  } catch (error: any) {
    console.error('Clarification GET API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch clarification questions' },
      { status: 500 }
    );
  }
}

// POST /api/clarify - Resolve an open clarification question and trigger instant Gmail reply
export async function POST(request: Request) {
  try {
    const { id, seedId, question, selectedOption, topic, emailId, threadId, inReplyToMsgId, sender, originalBody, waitingEmails } = await request.json();

    if (!question || !selectedOption) {
      return NextResponse.json(
        { success: false, error: 'Both question and selectedOption are required.' },
        { status: 400 }
      );
    }

    const { resolveClarification } = await import('@/lib/ai/clarify');
    const result = await resolveClarification({
      id,
      seedId,
      question,
      selectedOption,
      topic,
      emailId,
      threadId,
      inReplyToMsgId,
      sender,
      originalBody,
      waitingEmails,
    });


    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Clarification API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to resolve clarification' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clarify?id=...&question=...
 * Permanently dismisses a question from Clarifications.
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const question = url.searchParams.get('question');

    if (id) {
      await vectorStore.deleteItem(id).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Clarification dismiss error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to dismiss question' },
      { status: 500 }
    );
  }
}
