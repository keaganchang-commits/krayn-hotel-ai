import { teachUserFact } from '@/lib/teaching/store';
import { sendGmailReply } from '@/lib/gmail/send';
import { queryRAGAnswer } from '@/lib/ai/rag';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';

import { normalizeQuestionText } from '@/lib/clarify/seedQuestions';

export interface WaitingCustomerEmail {
  emailId?: string;
  threadId?: string;
  inReplyToMsgId?: string;
  sender?: string;
  originalBody?: string;
}

export interface ClarificationResolution {
  question: string;
  selectedOption: string;
  topic?: string;
  seedId?: string;
  id?: string;
  emailId?: string;
  threadId?: string;
  inReplyToMsgId?: string;
  sender?: string;
  originalBody?: string;
  waitingEmails?: WaitingCustomerEmail[];
}


/**
 * Generate intelligent follow-up questions to continuously probe for missing edge cases & nuances.
 * Strictly checks pre-prepared follow-ups first so users NEVER wait for slow API calls.
 * If no follow-up is deemed necessary by AI / domain heuristics, returns empty [] immediately.
 */
export async function generateFollowUpGapQuestions(
  answeredQuestion: string,
  selectedAnswer: string,
  topic?: string,
  existingFollowUpsMap?: any
): Promise<Array<{ question: string; options: string[]; title?: string; inputType?: any; allowMultiple?: boolean; placeholder?: string }>> {
  try {
    const { getPrePreparedFollowUps } = await import('@/lib/clarify/seedQuestions');
    const { isQuestionAnsweredInKnowledgeHub } = await import('@/lib/clarify/knowledgeAuditor');
    const allItems = await vectorStore.listItems();

    // 1. Instant deterministic retrieval of pre-prepared follow-ups
    const prePrepared = getPrePreparedFollowUps(answeredQuestion, selectedAnswer, topic, existingFollowUpsMap);
    if (prePrepared && prePrepared.length > 0) {
      const validItems: Array<{ question: string; options: string[]; title?: string; inputType?: any; allowMultiple?: boolean; placeholder?: string }> = [];

      for (const item of prePrepared) {
        // Skip if already answered in Knowledge Hub
        const check = await isQuestionAnsweredInKnowledgeHub(item.question, allItems);
        if (check.hasAnswer) continue;

        const dynamicTopic = item.topic || topic || 'Core Operations';
        const chunkId = await vectorStore.addChunk({
          text: `PROACTIVE CLARIFICATION NEEDED for ${dynamicTopic}: ${item.question}`,
          source: 'clarification',
          title: dynamicTopic,
          timestamp: new Date().toISOString(),
          metadata: {
            question: item.question,
            options: item.options,
            parentQuestion: answeredQuestion,
            parentAnswer: selectedAnswer,
            isFollowUp: true,
            priorityScore: 92,
            inputType: item.inputType || 'options',
            placeholder: item.placeholder,
            allowMultiple: item.allowMultiple ?? false,
          },
        });

        validItems.push({
          question: item.question,
          options: item.options,
          title: dynamicTopic,
          inputType: item.inputType || 'options',
          allowMultiple: item.allowMultiple ?? false,
          placeholder: item.placeholder,
        });
      }

      return validItems;
    }

    // Followups are NOT necessary for every question; only whatever is deemed necessary.
    // If not in the pre-prepared necessary list, return [] immediately.
    return [];
  } catch (err) {
    console.error('generateFollowUpGapQuestions error:', err);
    return [];
  }
}

export async function _unused_generateFollowUpGapQuestions(
  answeredQuestion: string,
  selectedAnswer: string,
  topic?: string
): Promise<Array<{ question: string; options: string[] }>> {
  try {
    const ai = getGeminiClient();
    if (!ai) return [];

    // Retrieve existing confirmed knowledge so follow-ups are deeply tailored to their specific business
    const allItems = await vectorStore.listItems();
    const confirmedKnowledge = allItems
      .filter(i => i.source === 'user_teaching')
      .slice(0, 10)
      .map(i => i.text)
      .join('\n');

    const prompt = `You are Krayn AI, an intelligent operations auditor.
A user just answered a question:
Question: "${answeredQuestion}"
Answer given: "${selectedAnswer}"
Topic: "${topic || 'General'}"

Confirmed business background so far:
${confirmedKnowledge || 'Initial setup in progress.'}

Task:
Generate whatever practical, high-value follow-up questions are necessary (typically 1 to 3 cohesive questions) that probe into the next logical tangible layer of this specific business.

CRITICAL PROGRESSIVE DEPTH RULES:
- PROGRESSION: First explore tangible products, facilities, menus, room types, services, and amenities before edge cases or complaints!
  * If Hotel/Hospitality: Ask about on-site restaurants, menus/cuisines, breakfast inclusion, room categories, or guest amenities (pool, gym, spa, parking, Wi-Fi).
  * If Restaurant/Cafe: Ask about menus, dining hours, reservation rules, dietary options.
  * If Clinic: Ask about treatments, consultation pricing, specialist services, insurance.
  * If Service/Agency: Ask about package inclusions, turnaround times, booking models.
- STRAIGHTFORWARD & QUICK:
  * Questions must be plain, direct, and quick to grasp (under 10 words). Fulfill purpose directly without fluff.
  * Keep technical terms intact (e.g. "Valet parking", "Full buffet", "King bed", "Room service"). Do NOT oversimplify technical vocabulary.
- COMPREHENSIVE & GEOGRAPHICALLY GROUNDED OPTIONS:
  * Provide as many distinct, realistic choices as needed (4, 5, 6, 7+ options — do NOT arbitrarily cap at 3!).
  * Ground options in the business's geographical location (e.g. for Malaysia, payment options must include Touch 'n Go eWallet, GrabPay, DuitNow QR, Cards, Cash).
  * 2 to 5 words per option. Clean, professional terms without conversational filler.
- DYNAMIC TITLES: Short, clean category name (e.g. "Dining & Menus", "Room Types", "Amenities & Wellness").

Format strictly as a JSON array:
[
  {
    "topic": "Dining & Menus",
    "question": "Is breakfast complimentary for guests?",
    "options": ["Included in rate", "Available (\$15/person)", "Not offered"]
  }
]
Return ONLY the JSON array, no extra commentary.`;

    const modelsToTry = GEMINI_GENERATIVE_MODELS;
    let followUps: Array<{ question: string; topic?: string; options: string[] }> = [];

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
            followUps = parsed;
            break;
          }
        }
      } catch (e) {
        console.warn(`[Follow-Up Gap] Model ${model} failed, trying next...`);
      }
    }

    // Store follow-up questions into vector memory and gather return items
    const { inferClarificationInputType, inferClarificationMultiSelect } = await import('@/lib/clarify/seedQuestions');
    const { isQuestionAnsweredInKnowledgeHub } = await import('@/lib/clarify/knowledgeAuditor');
    const createdFollowUpItems = [];
    for (const item of followUps) {
      if (item.question && Array.isArray(item.options)) {
        // STRICT CHECK: Skip if already answered in Knowledge Hub
        const check = await isQuestionAnsweredInKnowledgeHub(item.question, allItems);
        if (check.hasAnswer) continue;

        const dynamicTopic = item.topic || topic || 'Core Offerings';
        const inferred = inferClarificationInputType(item.question);
        const allowMultiple = inferClarificationMultiSelect(item.question);

        const { enrichOptionsWithContext } = await import('@/lib/clarify/seedQuestions');
        const enrichedOptions = inferred.inputType === 'boolean' || inferred.inputType === 'text' || inferred.inputType === 'file'
          ? []
          : enrichOptionsWithContext(item.question, item.options, confirmedKnowledge);

        const chunkId = await vectorStore.addChunk({
          text: `PROACTIVE CLARIFICATION NEEDED for ${dynamicTopic}: ${item.question}`,
          source: 'clarification',
          title: dynamicTopic,
          timestamp: new Date().toISOString(),
          metadata: {
            question: item.question,
            options: enrichedOptions,
            parentQuestion: answeredQuestion,
            parentAnswer: selectedAnswer,
            isFollowUp: true,
            priorityScore: 84,
            inputType: inferred.inputType,
            placeholder: inferred.placeholder,
            allowMultiple: inferred.inputType === 'boolean' ? false : allowMultiple,
          },
        });

        createdFollowUpItems.push({
          id: chunkId,
          question: item.question,
          options: enrichedOptions,
          title: dynamicTopic,
          source: 'clarification',
          timestamp: new Date().toISOString(),
          priorityScore: 84,
          inputType: inferred.inputType,
          placeholder: inferred.placeholder,
          allowMultiple: inferred.inputType === 'boolean' ? false : allowMultiple,
        });
      }
    }

    return createdFollowUpItems;
  } catch (err) {
    console.error('Failed to generate follow-up gap questions:', err);
    return [];
  }
}

/**
 * Resolve an open AI clarification question:
 * 1. Save the user's explicit choice into vector memory permanently as ground-truth.
 * 2. Continuously probe for deeper nuances: generate follow-up gap questions.
 * 3. If tied to a waiting email, dispatch automatic reply.
 */
export async function resolveClarification(resolution: ClarificationResolution) {
  const normTarget = normalizeQuestionText(resolution.question);
  const ruleText = `CLARIFICATION RESOLVED: Regarding "${resolution.question}", the confirmed answer is: ${resolution.selectedOption}`;
  
  const result = await teachUserFact({
    rule: ruleText,
    topic: resolution.topic || 'Clarification Resolution',
    question: resolution.question,
    selectedOption: resolution.selectedOption,
    seedId: resolution.seedId || resolution.id,
  });

  // Permanently delete any pending clarification chunks in vector store matching this question
  try {
    const allClarifications = await vectorStore.listItems('clarification');
    for (const item of allClarifications) {
      const qText = String(item.metadata?.question || item.text || '');
      const normItem = normalizeQuestionText(qText);

      const isSeedMatch = (resolution.seedId && item.metadata?.seedId === resolution.seedId) ||
                          (resolution.id && item.id === resolution.id);

      if (isSeedMatch || normItem === normTarget || (normTarget && normItem.includes(normTarget)) || (normItem && normTarget.includes(normItem))) {
        // If this was an asset sharing verification question, apply user decision to asset metadata
        const assetId = item.metadata?.assetId;
        if (assetId) {
          const { updateBusinessAsset } = await import('@/lib/assets/storage');
          const isAllowed = resolution.selectedOption.trim().toLowerCase() === 'yes';
          updateBusinessAsset(String(assetId), {
            whenToShare: isAllowed
              ? 'Approved for direct customer sharing when relevant inquiries are received.'
              : 'Internal reference only. Do NOT attach or send to customers.',
          });
        }
        await vectorStore.deleteItem(item.id);
      }
    }
  } catch (err) {
    console.warn('[Clarification Purge] Failed to remove resolved item from vector store:', err);
  }

  // Continuously probe for deeper operational gaps in background
  const followUpPromise = generateFollowUpGapQuestions(
    resolution.question,
    resolution.selectedOption,
    resolution.topic
  );


  let emailSent = false;
  let sentCount = 0;
  let replyText = '';

  // Collect all waiting customers associated with this question, strictly deduplicated by thread or sender
  const recipientsMap = new Map<string, WaitingCustomerEmail>();

  const getThreadKey = (w: WaitingCustomerEmail) => {
    return w.threadId ? `thread:${w.threadId}` : (w.inReplyToMsgId ? `msg:${w.inReplyToMsgId}` : `sender:${(w.sender || '').toLowerCase().trim()}`);
  };

  if (Array.isArray(resolution.waitingEmails) && resolution.waitingEmails.length > 0) {
    for (const w of resolution.waitingEmails) {
      if (w.sender && (w.threadId || w.inReplyToMsgId)) {
        const key = getThreadKey(w);
        if (!recipientsMap.has(key)) {
          recipientsMap.set(key, w);
        }
      }
    }
  } else if (resolution.sender && (resolution.threadId || resolution.inReplyToMsgId)) {
    const single: WaitingCustomerEmail = {
      sender: resolution.sender,
      threadId: resolution.threadId,
      inReplyToMsgId: resolution.inReplyToMsgId,
      originalBody: resolution.originalBody,
      emailId: resolution.emailId,
    };
    recipientsMap.set(getThreadKey(single), single);
  }

  // Also scan vector store for any other pending clarification chunks with the same semantic question key
  // that have waiting customers, and dispatch to them as well!
  try {
    const { getSemanticQuestionKey } = await import('@/lib/clarify/seedQuestions');
    const targetKey = getSemanticQuestionKey(resolution.question);
    const allClarifications = await vectorStore.listItems('clarification');
    for (const item of allClarifications) {
      const qText = String(item.metadata?.question || item.text || '');
      const itemKey = getSemanticQuestionKey(qText);
      if (itemKey === targetKey && item.metadata?.sender && (item.metadata?.threadId || item.metadata?.inReplyToMsgId)) {
        const candidate: WaitingCustomerEmail = {
          sender: String(item.metadata.sender),
          threadId: item.metadata.threadId ? String(item.metadata.threadId) : undefined,
          inReplyToMsgId: item.metadata.inReplyToMsgId ? String(item.metadata.inReplyToMsgId) : undefined,
          originalBody: item.metadata.originalBody ? String(item.metadata.originalBody) : undefined,
          emailId: item.metadata.emailId ? String(item.metadata.emailId) : undefined,
        };
        const key = getThreadKey(candidate);
        if (!recipientsMap.has(key)) {
          recipientsMap.set(key, candidate);
        }
      }
    }
  } catch (scanErr) {
    console.warn('[Clarification Multi-Reply Scan] Error scanning matching customer emails:', scanErr);
  }

  const recipientsToReply = Array.from(recipientsMap.values());
  const sentThreadKeys = new Set<string>();

  // Dispatch replies to strictly ONE email per waiting thread/customer
  for (const recipient of recipientsToReply) {
    if (!recipient.sender) continue;
    const threadKey = getThreadKey(recipient);
    if (sentThreadKeys.has(threadKey)) {
      console.log(`[Clarification AutoReply] Skipping duplicate thread key ${threadKey} to prevent multiple emails.`);
      continue;
    }
    sentThreadKeys.add(threadKey);

    try {
      // LIVE THREAD VERIFICATION:
      // Before sending an automated reply, fetch the LIVE thread from Gmail to verify:
      // 1. The thread hasn't ALREADY been replied to (avoid duplicate replies!)
      // 2. The latest message in the thread is actually asking about this topic (prevent responding to newer unrelated questions like "Can I make a dinner reservation?" with crib answers!)
      if (recipient.threadId) {
        const { getValidAccessToken } = await import('@/lib/gmail/auth');
        const token = await getValidAccessToken();
        if (token) {
          const liveThreadRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${recipient.threadId}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (liveThreadRes.ok) {
            const liveThreadData = await liveThreadRes.json();
            const threadMsgs: any[] = liveThreadData.messages || [];
            if (threadMsgs.length > 0) {
              const lastMsg = threadMsgs[threadMsgs.length - 1];
              const lastLabels: string[] = lastMsg?.labelIds || [];
              if (lastLabels.includes('SENT')) {
                console.log(`[Clarification AutoReply Guard] Thread ${recipient.threadId} already has a SENT message as latest. Skipping duplicate reply.`);
                continue;
              }

              // Extract body of the latest message in this thread
              let latestMsgBody = lastMsg?.snippet || '';
              if (lastMsg?.payload?.parts) {
                const textPart = lastMsg.payload.parts.find((p: any) => p.mimeType === 'text/plain');
                if (textPart?.body?.data) {
                  latestMsgBody = Buffer.from(textPart.body.data, 'base64').toString('utf8');
                }
              }

              // Check if the latest message is still asking about this topic
              const { getSemanticQuestionKey } = await import('@/lib/clarify/seedQuestions');
              const threadSemKey = getSemanticQuestionKey(latestMsgBody);
              const questionSemKey = getSemanticQuestionKey(resolution.question);

              if (threadSemKey && questionSemKey && threadSemKey !== questionSemKey) {
                console.warn(`[Clarification AutoReply Guard] Thread ${recipient.threadId} topic has moved from "${questionSemKey}" to "${threadSemKey}". Stale reply blocked!`);
                continue;
              }
            }
          }
        }
      }

      const queryPrompt = recipient.originalBody || resolution.topic || resolution.question;
      const reevaluatedRAG = await queryRAGAnswer(queryPrompt);

      let targetReply = '';
      if (reevaluatedRAG.allQuestionsAnswered && reevaluatedRAG.answer.trim()) {
        targetReply = reevaluatedRAG.answer.trim();
      } else {
        targetReply = `Hello,\n\nThank you for reaching out.\n\n${resolution.selectedOption}\n\nPlease let us know if you have any further questions!`;
      }

      await sendGmailReply({
        to: recipient.sender,
        subject: resolution.topic || 'Re: Inquiry',
        body: targetReply,
        threadId: recipient.threadId,
        inReplyToMsgId: recipient.inReplyToMsgId,
      });

      emailSent = true;
      sentCount++;
      if (!replyText) replyText = targetReply;
      console.log(`[Clarification AutoReply] Sent single resolved answer email to waiting customer: ${recipient.sender} (Thread: ${recipient.threadId})`);
    } catch (err) {
      console.error(`Failed to send automatic email reply to ${recipient.sender}:`, err);
    }
  }

  // Audit Log: Record clarification resolution
  try {
    const { logAuditEvent } = await import('@/lib/audit/logger');
    await logAuditEvent({
      category: 'clarification',
      action: 'Clarification Question Resolved',
      title: resolution.question,
      details: `User answered with "${resolution.selectedOption}". ${sentCount > 0 ? `Sent replies to ${sentCount} waiting customer(s).` : 'Saved to knowledge store.'}`,
      metadata: {
        questionId: resolution.id,
        question: resolution.question,
        selectedOption: resolution.selectedOption,
        topic: resolution.topic,
        sentCount,
      },
    });
  } catch (lErr) {
    // Continue silently
  }

  // Await follow-up questions generation
  const followUps = await followUpPromise;

  return {
    success: true,
    emailSent,
    sentCount,
    replyText,
    followUps,
    followUpsCount: followUps.length,
    message: sentCount > 0
      ? `Clarification saved to memory AND email replies automatically sent to ${sentCount} waiting customer(s)!`
      : `Clarification saved permanently.`,
    rule: result.rule,
  };
}
