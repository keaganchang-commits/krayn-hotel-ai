import { getValidAccessToken } from './auth';
import { getAutoReplyConfig } from './autoreply_config';
import fs from 'fs';
import path from 'path';

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer | string; // Buffer or path or base64 string
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyToMsgId?: string;
  attachments?: EmailAttachment[];
}

export const DEFAULT_HOTEL_SIGNOFF = `Warm regards,
Park Hyatt Kuala Lumpur
Menara Merdeka Maybank, 50118 Kuala Lumpur
Tel: +60 3 2333 1234 | kualalumpur.park@hyatt.com
www.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur`;

/**
 * Converts a text body into an Apple-style responsive, clean HTML email with signature styling
 */
function formatEmailToHtml(text: string): { html: string; fullPlainText: string } {
  // Check if text has sign-off markers
  const signOffPatterns = [
    'Warm regards,',
    'Best regards,',
    'Kind regards,',
    'Sincerely,',
    'Regards,'
  ];

  let bodyPart = text;
  let signOffPart = '';

  for (const pattern of signOffPatterns) {
    const idx = text.lastIndexOf(pattern);
    if (idx !== -1) {
      bodyPart = text.substring(0, idx).trim();
      signOffPart = text.substring(idx).trim();
      break;
    }
  }

  // Always enforce the official Park Hyatt sign-off
  const greeting = 'Warm regards,';
  const orgName = 'Park Hyatt Kuala Lumpur';
  const address = 'Menara Merdeka Maybank, 50118 Kuala Lumpur';
  const contacts = 'Tel: +60 3 2333 1234 | kualalumpur.park@hyatt.com';
  const website = 'www.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur';

  const fullPlainText = `${bodyPart}\n\n${greeting}\n${orgName}\n${address}\n${contacts}\n${website}`;

  // Convert plain text newlines into paragraphs / breaks
  const formattedBody = bodyPart
    .split(/\n\n+/)
    .map(para => `<p style="margin: 0 0 16px 0; line-height: 1.6; color: #1c1c1e; font-size: 15px; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  // Read logo base64 if available
  let logoHtml = '';
  const logoPath = path.join(process.cwd(), 'public', 'park-hyatt-logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      const logoBase64 = fs.readFileSync(logoPath).toString('base64');
      logoHtml = `<div style="margin-bottom: 14px;">
        <img src="data:image/png;base64,${logoBase64}" alt="Park Hyatt Kuala Lumpur" style="display: block; max-width: 220px; width: 100%; height: auto; border: 0;" />
      </div>`;
    } catch (err) {
      console.warn('Failed to read logo image for email signature:', err);
    }
  }

  let formattedSignOff = `
    <div style="margin-top: 28px; padding-top: 18px; border-top: 1px solid #e5e5ea; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <p style="margin: 0 0 14px 0; font-size: 14px; font-weight: 500; color: #1c1c1e; line-height: 1.5;">${greeting}</p>
      ${logoHtml}
      ${orgName ? `<p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #111827; letter-spacing: -0.01em;">${orgName}</p>` : ''}
      ${address ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #636366; line-height: 1.4;">${address}</p>` : ''}
      ${contacts ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #636366; line-height: 1.4;">${contacts.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color: #0071e3; text-decoration: none;">$1</a>')}</p>` : ''}
      ${website ? `<p style="margin: 4px 0 0 0; font-size: 13px;"><a href="${website.startsWith('http') ? website : `https://${website}`}" style="color: #0071e3; text-decoration: none; font-weight: 500;">${website.replace(/^https?:\/\//, '')}</a></p>` : ''}
    </div>
  `;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #ffffff; color: #1c1c1e; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
    ${formattedBody}
    ${formattedSignOff}
  </div>
</body>
</html>`;

  return { html, fullPlainText };
}

/**
 * Builds RFC 2822 MIME raw email, supporting multipart/alternative (HTML + Plain Text) and multipart/mixed attachments
 */
function buildRawMimeEmail(
  to: string,
  subject: string,
  body: string,
  inReplyToMsgId?: string,
  attachments?: EmailAttachment[],
  references?: string[]
): string {
  const { html: htmlBody, fullPlainText } = formatEmailToHtml(body);
  const altBoundary = `==_AltBoundary_${Date.now()}_${Math.random().toString(36).substring(2, 8)}==`;

  const referencesHeader = Array.isArray(references) && references.length > 0
    ? references.join(' ')
    : (inReplyToMsgId || undefined);

  if (!attachments || attachments.length === 0) {
    let emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ];

    if (inReplyToMsgId) {
      emailLines.push(`In-Reply-To: ${inReplyToMsgId}`);
    }
    if (referencesHeader) {
      emailLines.push(`References: ${referencesHeader}`);
    }

    emailLines.push('');
    // Plain text part
    emailLines.push(`--${altBoundary}`);
    emailLines.push(`Content-Type: text/plain; charset=utf-8`);
    emailLines.push(`Content-Transfer-Encoding: 7bit`);
    emailLines.push('');
    emailLines.push(fullPlainText);
    emailLines.push('');

    // HTML part
    emailLines.push(`--${altBoundary}`);
    emailLines.push(`Content-Type: text/html; charset=utf-8`);
    emailLines.push(`Content-Transfer-Encoding: 7bit`);
    emailLines.push('');
    emailLines.push(htmlBody);
    emailLines.push('');
    emailLines.push(`--${altBoundary}--`);
    emailLines.push('');

    const raw = emailLines.join('\r\n');
    return Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // Multipart/mixed MIME when attachments are present
  const mixedBoundary = `==_MixedBoundary_${Date.now()}_${Math.random().toString(36).substring(2, 8)}==`;

  let headerLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ];

  if (inReplyToMsgId) {
    headerLines.push(`In-Reply-To: ${inReplyToMsgId}`);
  }
  if (referencesHeader) {
    headerLines.push(`References: ${referencesHeader}`);
  }

  let parts: string[] = [headerLines.join('\r\n'), ''];

  // 1. Alternative part (Text + HTML)
  parts.push(`--${mixedBoundary}`);
  parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  parts.push('');

  parts.push(`--${altBoundary}`);
  parts.push(`Content-Type: text/plain; charset=utf-8`);
  parts.push(`Content-Transfer-Encoding: 7bit`);
  parts.push('');
  parts.push(fullPlainText);
  parts.push('');

  parts.push(`--${altBoundary}`);
  parts.push(`Content-Type: text/html; charset=utf-8`);
  parts.push(`Content-Transfer-Encoding: 7bit`);
  parts.push('');
  parts.push(htmlBody);
  parts.push('');
  parts.push(`--${altBoundary}--`);
  parts.push('');

  // 2. Attachments
  for (const att of attachments) {
    let fileBuffer: Buffer;
    if (Buffer.isBuffer(att.content)) {
      fileBuffer = att.content;
    } else if (typeof att.content === 'string' && fs.existsSync(att.content)) {
      fileBuffer = fs.readFileSync(att.content);
    } else if (typeof att.content === 'string') {
      fileBuffer = Buffer.from(att.content, 'base64');
    } else {
      continue;
    }

    const base64Data = fileBuffer.toString('base64');
    const sanitizedFilename = path.basename(att.filename || 'attachment');

    parts.push(`--${mixedBoundary}`);
    parts.push(`Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${sanitizedFilename}"`);
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push(`Content-Disposition: attachment; filename="${sanitizedFilename}"`);
    parts.push('');
    parts.push(base64Data);
  }

  parts.push(`--${mixedBoundary}--`);
  parts.push('');

  const fullMime = parts.join('\r\n');
  return Buffer.from(fullMime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send an email reply directly via Gmail API in the exact same email thread.
 */
export async function sendGmailReply(payload: SendEmailPayload): Promise<{
  success: boolean;
  messageId?: string;
}> {
  const config = getAutoReplyConfig();

  if (!config.enabled) {
    console.warn('[Gmail Send Safeguard] Auto-Reply is turned OFF. Email sending blocked.');
    throw new Error('Auto-Reply is currently OFF. Outgoing email blocked.');
  }

  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error('No valid access token available to send Gmail reply.');
  }

  let resolvedSubject = payload.subject;
  let resolvedInReplyTo = payload.inReplyToMsgId;
  const referencesList: string[] = [];
  if (resolvedInReplyTo) {
    referencesList.push(resolvedInReplyTo);
  }

  // If a threadId is provided, inspect the thread in Gmail to ensure perfect in-thread matching:
  // 1. Thread's exact original Subject (with standard "Re: " prefix)
  // 2. The latest message's Message-ID for In-Reply-To
  // 3. Complete References header chain
  if (payload.threadId) {
    try {
      const threadRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${payload.threadId}?format=metadata`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (threadRes.ok) {
        const threadData = await threadRes.json();
        const messages = threadData.messages || [];
        if (messages.length > 0) {
          // Find root message for original subject
          const firstMsg = messages[0];
          const origSubHeader = firstMsg?.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'subject')?.value;
          if (origSubHeader) {
            resolvedSubject = origSubHeader.startsWith('Re:') ? origSubHeader : `Re: ${origSubHeader}`;
          }

          // Build references chain from existing messages in thread
          for (const m of messages) {
            const mId = m.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'message-id')?.value;
            if (mId && !referencesList.includes(mId)) {
              referencesList.push(mId);
            }
          }

          // DUPLICATE SAFEGUARD: If the latest message in this thread was already sent by us ('SENT' label),
          // block sending duplicate replies back-to-back within a short window!
          const latestMessageInThread = messages[messages.length - 1];
          const latestLabels: string[] = latestMessageInThread?.labelIds || [];
          if (latestLabels.includes('SENT')) {
            console.warn(`[sendGmailReply Safeguard] Thread ${payload.threadId} already has a SENT message as its latest message. Blocking duplicate back-to-back reply.`);
            return { success: false, messageId: latestMessageInThread.id };
          }

          // If no specific inReplyToMsgId was passed, reply to the latest message in the thread
          if (!resolvedInReplyTo && referencesList.length > 0) {
            resolvedInReplyTo = referencesList[referencesList.length - 1];
          }
        }
      }
    } catch (threadErr) {
      console.warn('[sendGmailReply] Error resolving thread metadata:', threadErr);
    }
  }

  // Clean and normalize subject line
  if (!resolvedSubject.startsWith('Re:')) {
    resolvedSubject = `Re: ${resolvedSubject}`;
  }

  const base64EncodedEmail = buildRawMimeEmail(
    payload.to,
    resolvedSubject,
    payload.body,
    resolvedInReplyTo,
    payload.attachments,
    referencesList
  );

  const requestBody: Record<string, any> = {
    raw: base64EncodedEmail,
  };

  if (payload.threadId) {
    requestBody.threadId = payload.threadId;
  }

  let sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  // If rate limited (403), retry once after a short wait
  if (sendRes.status === 403) {
    const firstErr = await sendRes.text().catch(() => '');
    console.warn('[Gmail API] 403 rate limit on send. Retrying once in 5 seconds...', firstErr.slice(0, 150));
    await new Promise(r => setTimeout(r, 5000));
    sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  }

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    throw new Error(`Gmail API send failed (${sendRes.status}): ${errText}`);
  }

  const sendData = await sendRes.json();

  // Once an email/thread has been responded to, mark it as READ in Gmail
  if (payload.threadId) {
    try {
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${payload.threadId}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          removeLabelIds: ['UNREAD'],
        }),
      });
      console.log(`[Gmail Thread] Marked thread ${payload.threadId} as READ after responding.`);
    } catch (readErr) {
      console.warn(`[Gmail Thread] Could not mark thread ${payload.threadId} as read:`, readErr);
    }
  }

  return { success: true, messageId: sendData.id };
}

/**
 * Send an email manually directly via Gmail API.
 */
export async function sendManualEmail(payload: SendEmailPayload): Promise<{
  success: boolean;
  messageId?: string;
}> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error('No valid access token available to send Gmail email.');
  }

  const base64EncodedEmail = buildRawMimeEmail(
    payload.to,
    payload.subject,
    payload.body,
    payload.inReplyToMsgId,
    payload.attachments
  );

  const requestBody: Record<string, any> = {
    raw: base64EncodedEmail,
  };

  if (payload.threadId) {
    requestBody.threadId = payload.threadId;
  }

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    throw new Error(`Gmail API send failed (${sendRes.status}): ${errText}`);
  }

  const sendData = await sendRes.json();

  // Once responded to, mark thread as READ in Gmail
  if (payload.threadId) {
    try {
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${payload.threadId}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          removeLabelIds: ['UNREAD'],
        }),
      });
      console.log(`[Gmail Thread] Marked thread ${payload.threadId} as READ after manual reply.`);
    } catch (readErr) {
      console.warn(`[Gmail Thread] Could not mark thread ${payload.threadId} as read:`, readErr);
    }
  }

  return { success: true, messageId: sendData.id };
}

/**
 * Save or update a draft directly via Gmail API drafts endpoint.
 */
export async function createGmailDraft(payload: SendEmailPayload): Promise<{
  success: boolean;
  draftId?: string;
}> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error('No valid access token available to create Gmail draft.');
  }

  const subjectHeader = payload.subject || '(No Subject)';
  const base64EncodedEmail = buildRawMimeEmail(
    payload.to,
    subjectHeader,
    payload.body,
    payload.inReplyToMsgId,
    payload.attachments
  );

  const messageObj: Record<string, any> = {
    raw: base64EncodedEmail,
  };

  if (payload.threadId) {
    messageObj.threadId = payload.threadId;
  }

  const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: messageObj }),
  });

  if (!draftRes.ok) {
    const errText = await draftRes.text();
    throw new Error(`Gmail API draft creation failed (${draftRes.status}): ${errText}`);
  }

  const draftData = await draftRes.json();
  return { success: true, draftId: draftData.id };
}

/**
 * Delete a draft directly via Gmail API.
 */
export async function deleteGmailDraft(draftId: string): Promise<{ success: boolean }> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error('No valid access token available to delete Gmail draft.');
  }

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Gmail API delete draft failed (${res.status}): ${errText}`);
  }

  return { success: true };
}
