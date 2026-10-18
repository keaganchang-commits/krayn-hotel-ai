import { NextResponse } from 'next/server';
import { getValidAccessToken } from '@/lib/gmail/auth';

function extractBody(payload: any): { plainText: string; html: string } {
  if (!payload) return { plainText: '', html: '' };

  const findHtmlPart = (parts: any[]): string | null => {
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.parts) {
        const found = findHtmlPart(part.parts);
        if (found) return found;
      }
    }
    return null;
  };

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

  let plainText = '';
  let html = '';

  if (payload.body?.data) {
    if (payload.mimeType === 'text/html') {
      html = Buffer.from(payload.body.data, 'base64').toString('utf8');
    } else {
      plainText = Buffer.from(payload.body.data, 'base64').toString('utf8');
    }
  }

  if (payload.parts) {
    const foundText = findTextPart(payload.parts);
    if (foundText) plainText = foundText;
    const foundHtml = findHtmlPart(payload.parts);
    if (foundHtml) html = foundHtml;
  }

  if (!plainText) plainText = payload.snippet || '';

  return { plainText, html };
}

// GET /api/gmail/message?id=MESSAGE_ID - Fetches full email body on-demand
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Message ID is required' }, { status: 400 });
    }

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Not authenticated with Gmail' }, { status: 401 });
    }

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!msgRes.ok) {
      return NextResponse.json(
        { success: false, error: `Gmail error: ${msgRes.statusText}` },
        { status: msgRes.status }
      );
    }

    const msgData = await msgRes.json();
    const { plainText, html } = extractBody(msgData.payload);

    return NextResponse.json({
      success: true,
      id,
      body: plainText,
      html,
    });
  } catch (error: any) {
    console.error('Fetch single message error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
