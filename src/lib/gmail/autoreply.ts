import { getValidAccessToken } from './auth';
import { queryRAGAnswer } from '../ai/rag';
import { sendGmailReply, EmailAttachment } from './send';
import { vectorStore } from '../vector/store';
import { chunkText } from '../vector/chunker';
import { getAutoReplyConfig } from './autoreply_config';
import { normalizeQuestionText, getSemanticQuestionKey } from '../clarify/seedQuestions';
import { listBusinessAssets, getAssetFilePath } from '../assets/storage';
import fs from 'fs';
import path from 'path';


const REPLIED_LOG_FILE = path.join(process.cwd(), '.replied_messages.json');

function getRepliedIds(): Set<string> {
  if (!fs.existsSync(REPLIED_LOG_FILE)) return new Set<string>();
  try {
    const data = JSON.parse(fs.readFileSync(REPLIED_LOG_FILE, 'utf8'));
    return new Set<string>(Array.isArray(data) ? data : []);
  } catch {
    return new Set<string>();
  }
}

function markIdAsReplied(id: string) {
  if (!id) return;
  const current = getRepliedIds();
  current.add(id);
  try {
    fs.writeFileSync(REPLIED_LOG_FILE, JSON.stringify(Array.from(current), null, 2), 'utf8');
  } catch {}
}

// In-memory set of already replied/evaluated thread IDs so we don't repeatedly inspect them every cycle
const knownRepliedThreads = new Set<string>();
let cachedMyEmail = '';

export interface AutoReplyResult {
  emailId: string;
  sender: string;
  subject: string;
  confidenceScore: number;
  replied: boolean;
  replyText?: string;
  reason?: string;
}

/**
 * Monitor incoming unreplied emails and AUTOMATICALLY send a reply if AI confidence >= 80%.
 * ONLY replies to emails received AFTER Auto-Reply was turned ON (`enabledAt`).
 */
export async function processAutoReplies(maxResults: number = 10): Promise<{
  processedCount: number;
  repliedCount: number;
  enabled: boolean;
  results: AutoReplyResult[];
}> {
  const config = getAutoReplyConfig();

  // If auto-reply toggle is OFF, do not process or send any automated replies!
  if (!config.enabled) {
    return {
      processedCount: 0,
      repliedCount: 0,
      enabled: false,
      results: [],
    };
  }

  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return { processedCount: 0, repliedCount: 0, enabled: true, results: [] };
  }

  // Cache own email address in-memory to save Gmail API quota
  if (!cachedMyEmail) {
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profileData = await profileRes.json().catch(() => ({}));
      cachedMyEmail = profileData.emailAddress || '';
    } catch {}
  }
  const myEmail = cachedMyEmail;

  // STRICT TIME & STATUS FILTER:
  // 1. Only messages arriving AFTER auto-reply was turned ON
  // 2. Only incoming messages (not sent by me, not in SENT)
  // 3. Prioritize 'is:unread' so unread customer inquiries are processed immediately with NO cap
  const enabledAt = config.enabledAt || Math.floor(Date.now() / 1000);
  const queryParam = encodeURIComponent(`is:unread -from:me -in:sent after:${enabledAt}`);

  // Fetch unread incoming emails after enabledAt (limit to 5 to avoid burning Gmail unit quota)
  const fetchLimit = Math.min(maxResults, 5);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${queryParam}&maxResults=${fetchLimit}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!listRes.ok) {
    if (listRes.status === 403) {
      throw new Error('Gmail API 403: Rate limit / Quota exceeded for user per minute');
    }
    throw new Error(`Gmail API list failed: ${listRes.statusText}`);
  }

  const listData = await listRes.json();
  let messages = listData.messages || [];

  const results: AutoReplyResult[] = [];
  let repliedCount = 0;
  const processedThreadIdsInRun = new Set<string>();

  for (const msgInfo of messages) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgInfo.id}?format=full`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!msgRes.ok) continue;

    const msgData = await msgRes.json();
    const headers = msgData.payload?.headers || [];

    const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
    const sender = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
    const dateStr = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
    const messageIdHeader = headers.find((h: any) => h.name.toLowerCase() === 'message-id')?.value || '';

    // Verify message internal timestamp or date header is strictly AFTER enabledAt
    const internalDate = parseInt(msgData.internalDate || '0', 10) / 1000;
    const msgTime = internalDate > 0 ? internalDate : (dateStr ? new Date(dateStr).getTime() / 1000 : 0);

    if (msgTime > 0 && msgTime < enabledAt) {
      console.log(`[AutoReply Filter] Skipping email "${subject}" (${msgInfo.id}): Received before auto-reply was turned ON.`);
      continue;
    }

    // Check persistent disk-backed lock first (persists across restarts/HMR)
    // NOTE: We check msgInfo.id (the specific email message), NEVER threadId, because a customer can reply multiple times in the same thread!
    const repliedIds = getRepliedIds();
    if (repliedIds.has(msgInfo.id)) {
      continue;
    }

    // Skip if this specific message was processed earlier in this execution run
    if (processedThreadIdsInRun.has(msgInfo.id)) {
      continue;
    }

    // Check if this thread was already answered or processed in this cycle
    if (msgData.threadId && processedThreadIdsInRun.has(msgData.threadId)) {
      continue;
    }

    // Target message to evaluate: strictly the LATEST message in the thread
    let activeMsgData = msgData;
    let activeMsgId = msgInfo.id;
    let activeMessageIdHeader = messageIdHeader;
    let activeSender = sender;

    // Only inspect thread if there are multiple messages or thread is not yet cached
    if (msgData.threadId && !knownRepliedThreads.has(msgData.threadId)) {
      try {
        const threadRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${msgData.threadId}?format=minimal`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (threadRes.ok) {
          const threadJson = await threadRes.json();
          const threadMessages = threadJson?.messages || [];
          if (threadMessages.length > 0) {
            const latestMsgSummary = threadMessages[threadMessages.length - 1];
            const latestLabels: string[] = latestMsgSummary?.labelIds || [];
            const latestIsSent = latestLabels.includes('SENT');

            // If latest message is SENT by us or already replied, skip
            if (latestIsSent || repliedIds.has(latestMsgSummary.id)) {
              knownRepliedThreads.add(msgData.threadId);
              continue;
            }

            if (latestMsgSummary.id && latestMsgSummary.id !== msgInfo.id) {
              if (repliedIds.has(latestMsgSummary.id)) {
                knownRepliedThreads.add(msgData.threadId);
                continue;
              }
              const latestFullRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${latestMsgSummary.id}?format=full`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (latestFullRes.ok) {
                activeMsgData = await latestFullRes.json();
                activeMsgId = latestMsgSummary.id;
                const latestH = activeMsgData.payload?.headers || [];
                activeMessageIdHeader = latestH.find((h: any) => h.name.toLowerCase() === 'message-id')?.value || activeMessageIdHeader;
                activeSender = latestH.find((h: any) => h.name.toLowerCase() === 'from')?.value || activeSender;
              }
            }
          }
        }
      } catch (threadFetchErr) {
        // Fall back to current message data if thread inspection fails
      }
    }

    // Extract body text of the LATEST message
    let body = activeMsgData.snippet || '';
    if (activeMsgData.payload?.parts) {
      const findTextPart = (parts: any[]): string | null => {
        for (const p of parts) {
          if (p.mimeType === 'text/plain' && p.body?.data) {
            return Buffer.from(p.body.data, 'base64').toString('utf8');
          }
          if (p.parts) {
            const found = findTextPart(p.parts);
            if (found) return found;
          }
        }
        return null;
      };
      const text = findTextPart(activeMsgData.payload.parts);
      if (text) body = text;
    } else if (activeMsgData.payload?.body?.data) {
      body = Buffer.from(activeMsgData.payload.body.data, 'base64').toString('utf8');
    }

    // Skip if email is from self
    if (activeSender.includes(myEmail)) continue;
    if (sender.includes(myEmail)) continue;

    // Skip automated system bounces, mail delivery subsystem, and no-reply notifications
    const lowerSender = `${sender} ${activeSender}`.toLowerCase();
    const lowerSubject = subject.toLowerCase();
    if (
      lowerSender.includes('mailer-daemon') ||
      lowerSender.includes('postmaster') ||
      lowerSender.includes('no-reply') ||
      lowerSender.includes('noreply') ||
      lowerSender.includes('googlemail.com') && lowerSender.includes('delivery') ||
      lowerSubject.includes('delivery status notification') ||
      lowerSubject.includes('failure notice') ||
      lowerSubject.includes('undeliverable')
    ) {
      console.log(`[AutoReply Filter] Ignoring bounce/system message from ${activeSender} ("${subject}")`);
      markIdAsReplied(activeMsgId);
      markIdAsReplied(msgInfo.id);
      continue;
    }

    // 0. SCENARIO SCRIPT ENGINE: Priority check for scripted prototype demo flows
    try {
      const { matchDemoScript } = await import('./demo_engine');
      const demoResult = matchDemoScript(subject, body || '', msgData.threadId, sender);

      if (demoResult.matched && demoResult.replyBody) {
        console.log(`[Demo Script Engine] Executing exact scripted response for Turn ${demoResult.step} to ${sender}`);

        let attachmentsToSend: EmailAttachment[] = [];
        if (demoResult.attachPdf) {
          try {
            const { generateMeetingAgreementPdf } = await import('../meeting/pdfGenerator');
            const pdfBuffer = await generateMeetingAgreementPdf({
              confirmationNumber: 'PKH-MTG-221026',
              clientName: 'Keagan Chang',
              clientEmail: sender,
              companyName: 'Corporate Executive Delegation',
              meetingTitle: 'Executive Business Conference - Keagan Chang',
              roomName: 'Sky Rooms (Level 114)',
              eventDate: 'Thursday, October 22, 2026',
              startTime: '10:00 AM',
              endTime: '12:00 PM',
              durationHours: '2 Hours',
              attendees: 22,
              setupStyle: 'U-Shape Arrangement',
              avEquipment: ['Dual 4K Laser Displays', 'Wireless Video Conferencing'],
              cateringNotes: 'Complimentary Coffee & Tea Station',
            });
            attachmentsToSend.push({
              filename: 'Park_Hyatt_Meeting_Agreement_PKH-MTG-221026.pdf',
              mimeType: 'application/pdf',
              content: pdfBuffer,
            });
          } catch (pdfErr) {
            console.warn('[Demo Script Engine] PDF generation warning:', pdfErr);
          }
        }

        // Schedule on Google Calendar if this turn triggers booking
        if (demoResult.triggerCalendar) {
          try {
            const { getGoogleCalendarClient } = await import('../calendar/client');
            const { getDiningCalendarConfig } = await import('../calendar/config');
            const clientObj = await getGoogleCalendarClient();
            const config = getDiningCalendarConfig();
            if (clientObj) {
              const startIso = '2026-10-22T10:00:00+08:00';
              const endIso = '2026-10-22T12:00:00+08:00';
              const summaryTitle = '💼 [Meeting Room] Sky Rooms (Level 114) - Keagan Chang (22 pax)';
              
              // Idempotency check: strictly check if event already exists
              const existingList = await clientObj.calendar.events.list({
                calendarId: config.calendarId,
                timeMin: '2026-10-22T00:00:00+08:00',
                timeMax: '2026-10-22T23:59:59+08:00',
                q: 'PKH-MTG-221026',
                singleEvents: true,
              });

              if (existingList.data.items && existingList.data.items.length > 0) {
                console.log('[Demo Script Engine] Meeting event already exists on Google Calendar. Skipping duplicate insertion.');
              } else {
                await clientObj.calendar.events.insert({
                  calendarId: config.calendarId,
                  requestBody: {
                    summary: summaryTitle,
                    description: 'Meeting Room Reservation Agreement: PKH-MTG-221026\nVenue: Sky Rooms (Level 114)\nOrganizer: Keagan Chang\nAttendees: 22 delegates\nSetup: U-Shape Arrangement\nDate: Thursday, 22 October 2026 (10:00 AM - 12:00 PM)',
                    start: { dateTime: startIso },
                    end: { dateTime: endIso },
                    colorId: '9', // Navy Blue / Blueberry
                  },
                });
                console.log('[Demo Script Engine] Successfully scheduled 22 Oct Meeting on Google Calendar!');
              }
            }
          } catch (calErr: any) {
            console.warn('[Demo Script Engine] Google Calendar insert note:', calErr?.message || calErr);
          }
        }

        await sendGmailReply({
          to: sender,
          subject: demoResult.replySubject || subject,
          body: demoResult.replyBody,
          threadId: msgData.threadId,
          inReplyToMsgId: activeMessageIdHeader || messageIdHeader,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        });

        repliedCount++;
        if (msgData.threadId) {
          processedThreadIdsInRun.add(msgData.threadId);
        }
        markIdAsReplied(activeMsgId);
        markIdAsReplied(msgInfo.id);

        results.push({
          emailId: msgInfo.id,
          sender,
          subject,
          confidenceScore: 100,
          replied: true,
          replyText: demoResult.replyBody,
        });
        continue; // Handled flawlessly by Demo Script Engine!
      }
    } catch (demoScriptErr) {
      console.warn('[Demo Script Engine Error]:', demoScriptErr);
    }

    // 0.1. MEETING ROOM AGENT: Check if this email is a meeting or conference room request
    try {
      const { processMeetingBooking } = await import('../meeting/agent');
      const meetingResult = await processMeetingBooking(body || subject, sender, subject);
      if (meetingResult.handled && meetingResult.replyMessage) {
        const hasPdf = !!meetingResult.pdfAttachment;
        console.log(`[Meeting Room Agent] Handled meeting inquiry for ${sender} (Action: ${meetingResult.action}, PDF attached: ${hasPdf})`);

        const attachmentsToSend: EmailAttachment[] = [];
        if (meetingResult.pdfAttachment) {
          attachmentsToSend.push({
            filename: meetingResult.pdfAttachment.filename,
            mimeType: meetingResult.pdfAttachment.mimeType,
            content: meetingResult.pdfAttachment.content,
          });
        }

        await sendGmailReply({
          to: sender,
          subject,
          body: meetingResult.replyMessage,
          threadId: msgData.threadId,
          inReplyToMsgId: activeMessageIdHeader || messageIdHeader,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        });

        repliedCount++;
        if (msgData.threadId) {
          processedThreadIdsInRun.add(msgData.threadId);
        }
        markIdAsReplied(activeMsgId);
        markIdAsReplied(msgInfo.id);
        results.push({
          emailId: msgInfo.id,
          sender,
          subject,
          confidenceScore: 100,
          replied: true,
          replyText: meetingResult.replyMessage,
        });
        continue; // Handled by Meeting Room Agent!
      }
    } catch (meetingErr) {
      console.warn('[AutoReply Meeting Check] Error in meeting booking check:', meetingErr);
    }

    // 0.2. DINING RESERVATION AGENT: Check if this email is a table reservation request
    try {
      const { processDiningBooking } = await import('../calendar/agent');
      const diningResult = await processDiningBooking(body || subject, sender, subject);
      if (diningResult.handled) {
        if ((diningResult.action === 'confirmed' || diningResult.action === 'ask_restaurant') && diningResult.replyMessage) {
          const logMsg = diningResult.action === 'confirmed'
            ? `[Dining Agent] Auto-booked table on Google Calendar for ${sender}. Sending confirmation email...`
            : `[Dining Agent] Asking customer ${sender} which restaurant venue they prefer (Merdeka Grill, Park Lounge, or Cacao)...`;
          console.log(logMsg);
          await sendGmailReply({
            to: sender,
            subject,
            body: diningResult.replyMessage,
            threadId: msgData.threadId,
            inReplyToMsgId: activeMessageIdHeader || messageIdHeader,
          });

          repliedCount++;
          if (msgData.threadId) {
            processedThreadIdsInRun.add(msgData.threadId);
          }
          markIdAsReplied(activeMsgId);
          markIdAsReplied(msgInfo.id);
          results.push({
            emailId: msgInfo.id,
            sender,
            subject,
            confidenceScore: 100,
            replied: true,
            replyText: diningResult.replyMessage,
          });
          continue; // Successfully handled by Dining Reservation Agent!
        } else if (diningResult.action === 'clarify_capacity' || diningResult.action === 'clarify_details') {
          console.log(`[Dining Agent] Table booking needs clarification: ${diningResult.clarificationQuestion}`);
          // Post to Clarification Center with actionable options for restaurant staff
          const clarificationChunk = `PROACTIVE DINING CLARIFICATION for ${subject}: ${diningResult.clarificationQuestion}`;
          const chunks = chunkText(clarificationChunk, 'clarification', `Dining Reservation: ${subject}`);
          for (const chunk of chunks) {
            await vectorStore.addChunk({
              ...chunk,
              metadata: {
                emailId: msgInfo.id,
                threadId: msgData.threadId,
                inReplyToMsgId: messageIdHeader,
                sender,
                subject,
                originalBody: body,
                question: diningResult.clarificationQuestion,
                options: diningResult.clarificationOptions || ['Confirm alternative time', 'Decline reservation'],
                inputType: 'options',
                confidenceScore: 70,
              }
            });
          }
          results.push({
            emailId: msgInfo.id,
            sender,
            subject,
            confidenceScore: 70,
            replied: false,
            reason: `Dining reservation queued for staff confirmation: ${diningResult.clarificationQuestion}`,
          });
          continue;
        }
      }
    } catch (diningErr) {
      console.warn('[AutoReply Dining Check] Error in dining booking check:', diningErr);
    }

    // 1. Query RAG engine for answer & confidence score
    const ragResult = await queryRAGAnswer(body || subject);

    // 2. CHECK AUTONOMOUS THRESHOLD: Confidence must be >= 80% AND not uncertain
    if (ragResult.confidenceScore >= 80 && !ragResult.isUncertain) {
      // Clean reply body - strictly the clean answer without internal thoughts, citations, or debug meta
      const cleanAnswer = ragResult.answer.trim();

      // Resolve any auto-attached business assets
      const attachmentsToSend: EmailAttachment[] = [];
      if (ragResult.attachedAssetIds && ragResult.attachedAssetIds.length > 0) {
        const allAssets = listBusinessAssets();
        for (const assetId of ragResult.attachedAssetIds) {
          const match = allAssets.find(a => a.id === assetId);
          if (match) {
            const filePath = getAssetFilePath(match.filename);
            if (filePath && fs.existsSync(filePath)) {
              attachmentsToSend.push({
                filename: match.name,
                mimeType: match.mimeType,
                content: fs.readFileSync(filePath),
              });
            }
          }
        }
      }

      try {
        await sendGmailReply({
          to: activeSender,
          subject,
          body: cleanAnswer,
          threadId: msgData.threadId,
          inReplyToMsgId: activeMessageIdHeader,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        });

        repliedCount++;
        if (msgData.threadId) {
          processedThreadIdsInRun.add(msgData.threadId);
        }
        markIdAsReplied(activeMsgId);
        markIdAsReplied(msgInfo.id);
        results.push({
          emailId: activeMsgId,
          sender: activeSender,
          subject,
          confidenceScore: ragResult.confidenceScore,
          replied: true,
          replyText: ragResult.answer,
        });

        // Audit Log entry
        try {
          const { logAuditEvent } = await import('@/lib/audit/logger');
          await logAuditEvent({
            category: 'reply',
            action: 'Automated Email Reply Sent',
            title: subject,
            details: `Replied to ${activeSender} with ${ragResult.confidenceScore}% confidence: "${ragResult.answer.slice(0, 150)}..."`,
            metadata: {
              emailId: activeMsgId,
              threadId: msgData.threadId,
              sender: activeSender,
              subject,
              confidenceScore: ragResult.confidenceScore,
              answer: ragResult.answer,
            },
          });
        } catch (lErr) {
          // Continue silently
        }

        // AUTO-PRUNE: If this customer inquiry was previously queued in Clarifications, prune it immediately!
        try {
          const allItems = await vectorStore.listItems();
          const targetSemKey = getSemanticQuestionKey(body || subject);
          for (const item of allItems) {
            if (item.source === 'clarification') {
              const matchesThread = item.metadata?.threadId === msgData.threadId;
              const matchesEmail = item.metadata?.emailId === activeMsgId || item.metadata?.emailId === msgInfo.id;
              const itemQ = String(item.metadata?.question || item.text);
              const matchesSem = getSemanticQuestionKey(itemQ) === targetSemKey;
              if (matchesThread || matchesEmail || matchesSem) {
                await vectorStore.deleteItem(item.id);
                console.log(`[AutoReply Prune] Removed resolved clarification ${item.id} ("${itemQ.slice(0, 50)}")`);
              }
            }
          }
        } catch (pruneErr) {
          console.warn('[AutoReply Prune] Error pruning resolved clarification:', pruneErr);
        }
      } catch (sendErr: any) {
        results.push({
          emailId: activeMsgId,
          sender: activeSender,
          subject,
          confidenceScore: ragResult.confidenceScore,
          replied: false,
          reason: `Send failed: ${sendErr.message}`,
        });
      }
    } else {
      // IF ANY QUESTION IS UNANSWERED / LOW CONFIDENCE:
      // STRICT RULE: DO NOT REPLY! Post each unanswered question to Clarification Center!
      const questionsToStore = (ragResult.unansweredQuestions && ragResult.unansweredQuestions.length > 0)
        ? ragResult.unansweredQuestions
        : [{
            question: subject,
            clarificationQuestion: ragResult.clarificationQuestion || `How should Krayn AI respond to "${subject}" from ${activeSender}? (${body.slice(0, 80)}...)`,
            clarificationOptions: ragResult.clarificationOptions || [
              `Reply with standard response for "${subject}"`,
              `Send custom details to ${activeSender}`,
              `No action needed`
            ]
          }];

      // Query store to ensure we never re-add a question that has already been answered or is already pending
      const allStoreItems = await vectorStore.listItems();
      const answeredQuestionNorms = new Set<string>();
      const pendingQuestionNorms = new Set<string>();

      for (const item of allStoreItems) {
        if (item.source === 'user_teaching') {
          if (item.metadata?.question) answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.question)));
          if (item.metadata?.resolvedQuestion) answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.resolvedQuestion)));
          const match = item.text.match(/Regarding ["']?([^"',\n]+)["']?,/i);
          if (match && match[1]) answeredQuestionNorms.add(normalizeQuestionText(match[1]));
        } else if (item.source === 'clarification') {
          const qText = String(item.metadata?.question || item.text.replace(/^PROACTIVE CLARIFICATION NEEDED for [^:]+:\s*/, ''));
          pendingQuestionNorms.add(normalizeQuestionText(qText));

        }
      }

      for (const uq of questionsToStore) {
        const questionText = uq.clarificationQuestion;
        const normQ = normalizeQuestionText(questionText);
        const normSubject = normalizeQuestionText(uq.question || subject);

        // Filter out greetings and pleasantries
        const { isValidClarificationQuestion } = await import('@/lib/clarify/seedQuestions');
        if (!isValidClarificationQuestion(questionText, uq.question || subject || body)) {
          console.log(`[AutoReply Clarification] Skipping non-question / greeting "${questionText}".`);
          continue;
        }

        // If this question or topic was ALREADY answered, NEVER ask again
        if (answeredQuestionNorms.has(normQ) || answeredQuestionNorms.has(normSubject)) {
          console.log(`[AutoReply Clarification] Skipping question "${questionText}": Already answered in knowledge store.`);
          continue;
        }

        // STRICT KNOWLEDGE HUB AUDIT: Never ask questions that already have answers in Knowledge Hub
        const { isQuestionAnsweredInKnowledgeHub } = await import('@/lib/clarify/knowledgeAuditor');
        const check = await isQuestionAnsweredInKnowledgeHub(questionText, allStoreItems);
        if (check.hasAnswer) {
          console.log(`[AutoReply Clarification] Skipping question "${questionText}": Answer verified in Knowledge Hub.`);
          continue;
        }

        // If this question is already pending in Clarifications, do not create duplicate
        if (pendingQuestionNorms.has(normQ)) {
          continue;
        }

        const options = uq.clarificationOptions;
        const clarificationChunk = `PROACTIVE CLARIFICATION NEEDED for ${subject}: ${questionText}`;
        const chunks = chunkText(clarificationChunk, 'clarification', `Email Question: ${subject}`);

        for (const chunk of chunks) {
          await vectorStore.addChunk({
            ...chunk,
            metadata: {
              emailId: activeMsgId,
              threadId: msgData.threadId,
              inReplyToMsgId: activeMessageIdHeader,
              sender: activeSender,
              subject,
              originalBody: body,
              question: questionText,
              options,
              inputType: ('inputType' in uq ? uq.inputType : 'options') || 'options',
              placeholder: 'placeholder' in uq ? uq.placeholder : undefined,
              confidenceScore: ragResult.confidenceScore,
            }
          });
          pendingQuestionNorms.add(normQ);
        }
      }


      results.push({
        emailId: msgInfo.id,
        sender,
        subject,
        confidenceScore: ragResult.confidenceScore,
        replied: false,
        reason: `Questions in email require clarification before replying. Saved ${questionsToStore.length} item(s) to Clarification Center.`,
      });
    }
  }

  return { processedCount: messages.length, repliedCount, enabled: true, results };
}
