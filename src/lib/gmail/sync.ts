import { getValidAccessToken } from './auth';
import { vectorStore } from '../vector/store';
import { chunkText } from '../vector/chunker';
import { getLastSyncTimestamp, saveLastSyncTimestamp } from './sync_filter';
import { extractKnowledgeFacts } from '../ai/extractor';

export interface EmailMetadata {
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  userReplyText?: string;
}

/**
 * Fetch NEW email threads arriving FROM NOW ON (`after:timestamp`)
 * STRICT CONDITION: ONLY learn from threads where the USER HAS REPLIED!
 */
export async function syncGmailEmails(maxResults: number = 15): Promise<{
  syncedCount: number;
  emails: EmailMetadata[];
}> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    console.warn('No valid access token available for Gmail API. Skipping sync.');
    return { syncedCount: 0, emails: [] };
  }

  // Query Gmail for threads. If no timestamp exists, query recent threads.
  let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${maxResults}`;
  const afterTimestamp = getLastSyncTimestamp();
  if (afterTimestamp > 0) {
    // Look back up to 30 days or after last sync to ensure recently replied threads are captured
    const lookbackTimestamp = Math.max(0, afterTimestamp - (30 * 24 * 60 * 60));
    listUrl += `&q=${encodeURIComponent(`after:${lookbackTimestamp}`)}`;
  }

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    throw new Error(`Gmail API thread list failed: ${listRes.statusText}`);
  }

  const listData = await listRes.json();
  const threads = listData.threads || [];
  const syncedEmails: EmailMetadata[] = [];
  let chunksIndexed = 0;

  // Process each thread
  for (const threadInfo of threads) {
    const threadRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadInfo.id}?format=full`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!threadRes.ok) continue;

    const threadData = await threadRes.json();
    const messages = threadData.messages || [];

    // STRICT RULE: Thread MUST have at least 2 messages AND one message must be sent by user ('SENT' label or user sender)
    // Find the message sent by the user (either having 'SENT' label or not being the first received message)
    let userReplyMsg = messages.find((m: any) => {
      const labels = m.labelIds || [];
      return labels.includes('SENT');
    });

    if (!userReplyMsg && messages.length >= 2) {
      // Fallback: take the last message in the thread as the user reply
      userReplyMsg = messages[messages.length - 1];
    }

    // IF NO USER REPLY EXISTS IN THREAD OR THREAD HAS <2 MESSAGES -> IGNORE
    if (!userReplyMsg || messages.length < 2) {
      console.log(`[Sync Filter] Skipping thread ${threadInfo.id}: No user reply found.`);
      continue;
    }

    // Helper function to extract plain text body from a message payload
    const extractBody = (msg: any): string => {
      if (!msg || !msg.payload) return msg?.snippet || '';
      
      // If root payload has body data
      if (msg.payload.body?.data) {
        return Buffer.from(msg.payload.body.data, 'base64').toString('utf8');
      }

      // If payload has parts, search recursively
      const findTextPart = (parts: any[]): string | null => {
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf8');
          }
          if (part.parts) {
            const found = findTextPart(part.parts);
            if (found) return found;
          }
        }
        return null;
      };

      if (msg.payload.parts) {
        const text = findTextPart(msg.payload.parts);
        if (text) return text;
      }

      return msg.snippet || '';
    };

    // Extract incoming email body & reply body
    const firstMsg = messages[0];
    const firstHeaders = firstMsg.payload?.headers || [];
    const subject = firstHeaders.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
    const sender = firstHeaders.find((h: any) => h.name.toLowerCase() === 'from')?.value || '(Unknown Sender)';
    const date = firstHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

    const incomingBody = extractBody(firstMsg);
    const replyBody = extractBody(userReplyMsg);

    const emailMeta: EmailMetadata = {
      id: firstMsg.id,
      subject,
      sender,
      date,
      snippet: firstMsg.snippet,
      userReplyText: replyBody,
    };
    syncedEmails.push(emailMeta);

    // Extract straightforward facts from email thread pair using Gemini AI
    const combinedContent = `INCOMING EMAIL:\nFrom: ${sender}\nSubject: ${subject}\nDate: ${date}\n\nContent:\n${incomingBody}\n\nUSER SENT REPLY (GROUND TRUTH):\n${replyBody}`;

    const { facts, writingStyle } = await extractKnowledgeFacts(combinedContent, 'gmail', `Replied Thread: ${subject}`);

    // Fetch existing knowledge items to enable deduplication and cumulative style evolution
    const existingItems = await vectorStore.listItems();

    // 1. SMART FACTUAL KNOWLEDGE UPSERT (NO DUPLICATES)
    const { normalizeKey, areDetailsRedundantOrSubsumed, getRicherDetail } = await import('../knowledge/deduplicator');

    for (const fact of facts) {
      const normNewTopic = normalizeKey(fact.topic);
      const newDetail = fact.detail.trim();

      // Check if this topic or a very close variant already exists in Knowledge
      const matchingItem = existingItems.find(item => {
        if (item.source === 'clarification') return false;
        const existingTopic = (item.metadata?.topic as string) || item.title || '';
        return normalizeKey(existingTopic) === normNewTopic;
      });

      if (matchingItem) {
        const existingDetail = String(matchingItem.metadata?.detail || matchingItem.text.replace(/^[^:]+:\s*/, '')).trim();

        // If redundant or duplicate, evaluate if new information is richer
        if (areDetailsRedundantOrSubsumed(existingDetail, newDetail)) {
          const richer = getRicherDetail(existingDetail, newDetail);
          if (richer !== existingDetail) {
            // Update the existing item with richer detail
            const updatedChunkText = `${matchingItem.title}: ${richer}`;
            await vectorStore.updateItem(matchingItem.id, updatedChunkText, matchingItem.title, matchingItem.title);

            // Audit log: Enrich existing fact
            try {
              const { logAuditEvent } = await import('@/lib/audit/logger');
              await logAuditEvent({
                category: 'learning',
                action: 'Fact Enriched in Knowledge',
                title: matchingItem.title,
                details: `Updated existing topic with richer detail: "${richer}" (from human reply to ${sender}).`,
                metadata: {
                  threadId: threadInfo.id,
                  sender,
                  subject,
                  topic: matchingItem.title,
                  detail: richer,
                  isUpdate: true,
                },
              });
            } catch {}
          } else {
            console.log(`[Sync] Fact "${fact.topic}" is already covered in Knowledge. Skipping duplicate.`);
          }
          continue;
        }
      }

      // If not matching or not subsumed, insert directly as a brand new fact
      const chunkText = `${fact.topic}: ${fact.detail}`;
      await vectorStore.addChunk({
        text: chunkText,
        source: 'gmail',
        title: fact.topic,
        timestamp: new Date().toISOString(),
        metadata: {
          threadId: threadInfo.id,
          sender,
          subject,
          date,
          topic: fact.topic,
          detail: fact.detail,
          hasUserReply: true,
          priority: 'high',
        },
      });
      chunksIndexed++;

      // Record in Audit Log
      try {
        const { logAuditEvent } = await import('@/lib/audit/logger');
        await logAuditEvent({
          category: 'learning',
          action: 'Fact Learned from Email Reply',
          title: fact.topic,
          details: `Learned: "${fact.detail}" from human response to ${sender} regarding "${subject}".`,
          metadata: {
            threadId: threadInfo.id,
            sender,
            subject,
            topic: fact.topic,
            detail: fact.detail,
          },
        });
      } catch (logErr) {
        // Continue silently
      }
    }

    // 2. CUMULATIVE WRITING STYLE PROFILE EVOLUTION (BACKGROUND)
    if (writingStyle && (writingStyle.tone || writingStyle.greetingPattern || writingStyle.signOffPattern)) {
      // Find any existing cumulative style profile chunk
      const existingStyleItem = existingItems.find(
        i => (i.metadata as any)?.type === 'writing_style' || i.title === 'Learned Brand Voice & Writing Style'
      );

      let mergedStyle = { ...writingStyle };

      if (existingStyleItem && existingStyleItem.metadata?.writingStyle) {
        const prev = existingStyleItem.metadata.writingStyle as any;
        
        // Accumulate distinct phrasing habits
        const combinedPhrases = Array.from(new Set([
          ...(Array.isArray(prev.keyPhrasingHabits) ? prev.keyPhrasingHabits : []),
          ...(writingStyle.keyPhrasingHabits || []),
        ])).slice(0, 15); // keep top 15 punchy recurring phrases

        mergedStyle = {
          tone: writingStyle.tone || prev.tone || 'Warm, polished, concise, hospitable',
          greetingPattern: writingStyle.greetingPattern || prev.greetingPattern || 'Dear Guest,',
          signOffPattern: writingStyle.signOffPattern || prev.signOffPattern || 'Warm regards,',
          signatureBlock: writingStyle.signatureBlock || prev.signatureBlock,
          sentenceLength: writingStyle.sentenceLength || prev.sentenceLength || 'balanced',
          keyPhrasingHabits: combinedPhrases,
        };

        const updatedStyleSummary = `Brand Tone: ${mergedStyle.tone}\nGreeting Pattern: ${mergedStyle.greetingPattern}\nSign-off Pattern: ${mergedStyle.signOffPattern}${mergedStyle.signatureBlock ? `\nSignature Block: ${mergedStyle.signatureBlock}` : ''}\nSentence Rhythm: ${mergedStyle.sentenceLength}\nKey Phrasing Habits: ${mergedStyle.keyPhrasingHabits.join(', ')}`;

        await vectorStore.updateItem(
          existingStyleItem.id,
          updatedStyleSummary,
          'Learned Brand Voice & Writing Style',
          'Writing Style'
        );

        try {
          const { logAuditEvent } = await import('@/lib/audit/logger');
          await logAuditEvent({
            category: 'learning',
            action: 'Writing Style Refined',
            title: `Brand Voice Profile Updated (${mergedStyle.tone})`,
            details: `Cumulative update: tone "${mergedStyle.tone}", greeting "${mergedStyle.greetingPattern}", ${mergedStyle.keyPhrasingHabits.length} phrasing habits tracked.`,
            metadata: {
              threadId: threadInfo.id,
              subject,
              writingStyle: mergedStyle,
            },
          });
        } catch {}
      } else {
        // Create initial cumulative writing style profile
        const styleSummary = `Brand Tone: ${writingStyle.tone || 'Professional & Warm'}\nGreeting Pattern: ${writingStyle.greetingPattern || 'Dear Guest,'}\nSign-off Pattern: ${writingStyle.signOffPattern || 'Warm regards,'}${writingStyle.signatureBlock ? `\nSignature Block: ${writingStyle.signatureBlock}` : ''}\nSentence Rhythm: ${writingStyle.sentenceLength || 'balanced'}\nKey Phrasing Habits: ${writingStyle.keyPhrasingHabits?.join(', ') || 'N/A'}`;

        await vectorStore.addChunk({
          text: styleSummary,
          source: 'user_teaching',
          title: 'Learned Brand Voice & Writing Style',
          timestamp: new Date().toISOString(),
          metadata: {
            type: 'writing_style',
            threadId: threadInfo.id,
            sender,
            subject,
            writingStyle,
            priority: 'high',
          },
        });
        chunksIndexed++;

        try {
          const { logAuditEvent } = await import('@/lib/audit/logger');
          await logAuditEvent({
            category: 'learning',
            action: 'Writing Style Learned',
            title: `Brand Voice Profile: ${writingStyle.tone || 'Polished'}`,
            details: `Learned author voice: tone "${writingStyle.tone}", greeting "${writingStyle.greetingPattern}", sign-off "${writingStyle.signOffPattern}".`,
            metadata: {
              threadId: threadInfo.id,
              subject,
              writingStyle,
            },
          });
        } catch {}
      }
    }
  }

  // Update sync timestamp
  saveLastSyncTimestamp(Math.floor(Date.now() / 1000));

  return { syncedCount: chunksIndexed, emails: syncedEmails };
}

