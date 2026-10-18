import { getValidAccessToken } from './auth';

export interface DetailedEmail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body?: string;
  unread: boolean;
  labels: string[];
}

/**
 * Extract body content from Gmail payload
 */
function extractBody(payload: any): string {
  if (!payload) return '';

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

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

  if (payload.parts) {
    const text = findTextPart(payload.parts);
    if (text) return text;
  }

  return payload.snippet || '';
}

// Short-lived in-memory cache for fast tab switching (15s TTL)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const inboxCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 15000; // 15 seconds

let cachedTotalMessages: { count: number; timestamp: number } | null = null;

export async function getGmailInboxMessages(
  maxResults: number = 15,
  pageToken?: string,
  query: string = 'in:inbox'
): Promise<{
  emails: DetailedEmail[];
  totalMessages: number;
  nextPageToken?: string;
}> {
  const cacheKey = `${query}_${maxResults}_${pageToken || 'first'}`;
  const now = Date.now();
  const cached = inboxCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return { emails: [], totalMessages: 0 };
  }

  let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`;
  if (pageToken) {
    listUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
  }

  // Profile call only needed occasionally
  let totalMessagesPromise: Promise<number>;
  if (cachedTotalMessages && now - cachedTotalMessages.timestamp < 60000) {
    totalMessagesPromise = Promise.resolve(cachedTotalMessages.count);
  } else {
    totalMessagesPromise = fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(res => res.json())
      .then(p => {
        const cnt = p.messagesTotal || 0;
        cachedTotalMessages = { count: cnt, timestamp: Date.now() };
        return cnt;
      })
      .catch(() => cachedTotalMessages?.count || 0);
  }

  const [totalMessages, listRes] = await Promise.all([
    totalMessagesPromise,
    fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ]);

  if (!listRes.ok) {
    throw new Error(`Failed to list Gmail inbox messages: ${listRes.statusText}`);
  }

  const listData = await listRes.json();
  const messages = listData.messages || [];
  const nextPageToken = listData.nextPageToken;

  const emailPromises = messages.map(async (msg: { id: string }) => {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!msgRes.ok) return null;

      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      const labelIds = msgData.labelIds || [];

      const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
      const sender = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '(Unknown Sender)';
      const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();
      const snippet = msgData.snippet || '';
      const unread = labelIds.includes('UNREAD');

      return {
        id: msg.id,
        threadId: msgData.threadId || msg.id,
        subject,
        sender,
        date,
        snippet,
        body: '', // Body fetched on-demand when clicked
        unread,
        labels: labelIds,
      } as DetailedEmail;
    } catch (e) {
      return null;
    }
  });

  const detailedResults = await Promise.all(emailPromises);
  const emails = detailedResults.filter((e): e is DetailedEmail => e !== null);

  const result = { emails, totalMessages, nextPageToken };
  inboxCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return result;
}

export interface DetailedDraft {
  id: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
}

const draftsCache = new Map<string, CacheEntry<any>>();

export async function getGmailDrafts(
  maxResults: number = 15,
  pageToken?: string
): Promise<{
  drafts: DetailedDraft[];
  nextPageToken?: string;
}> {
  const cacheKey = `drafts_${maxResults}_${pageToken || 'first'}`;
  const now = Date.now();
  const cached = draftsCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return { drafts: [] };
  }

  let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=${maxResults}`;
  if (pageToken) {
    listUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
  }

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    throw new Error(`Failed to list Gmail drafts: ${listRes.statusText}`);
  }

  const listData = await listRes.json();
  const draftsList = listData.drafts || [];
  const nextPageToken = listData.nextPageToken;

  const draftPromises = draftsList.map(async (draftItem: { id: string }) => {
    try {
      const draftRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftItem.id}?format=metadata`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!draftRes.ok) return null;

      const draftDetail = await draftRes.json();
      const msg = draftDetail.message || {};
      const headers = msg.payload?.headers || [];

      const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(Draft with no subject)';
      const to = headers.find((h: any) => h.name.toLowerCase() === 'to')?.value || '(No Recipient)';
      const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();
      const snippet = msg.snippet || '';

      return {
        id: draftItem.id,
        messageId: msg.id || draftItem.id,
        threadId: msg.threadId || '',
        subject,
        to,
        date,
        snippet,
        body: '', // Body fetched when editing or opening
      } as DetailedDraft;
    } catch (e) {
      return null;
    }
  });

  const detailedResults = await Promise.all(draftPromises);
  const drafts = detailedResults.filter((d): d is DetailedDraft => d !== null);

  const result = { drafts, nextPageToken };
  draftsCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return result;
}
