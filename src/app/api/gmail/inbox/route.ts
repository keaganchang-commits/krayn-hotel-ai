import { NextResponse } from 'next/server';
import { getGmailInboxMessages } from '@/lib/gmail/inbox';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const maxResults = parseInt(searchParams.get('maxResults') || '25', 10);
    const pageToken = searchParams.get('pageToken') || undefined;
    const query = searchParams.get('q') || 'in:inbox';

    const result = await getGmailInboxMessages(maxResults, pageToken, query);

    return NextResponse.json({
      success: true,
      emails: result.emails,
      totalMessages: result.totalMessages,
      nextPageToken: result.nextPageToken,
    });
  } catch (error: any) {
    console.error('Gmail inbox API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch Gmail inbox' },
      { status: 500 }
    );
  }
}
