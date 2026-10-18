import { NextResponse } from 'next/server';
import { syncGmailEmails } from '@/lib/gmail/sync';

export async function POST(request: Request) {
  try {
    const { maxResults = 5 } = await request.json().catch(() => ({}));
    const result = await syncGmailEmails(maxResults);

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${result.syncedCount} email passages.`,
      emails: result.emails,
    });
  } catch (error: any) {
    console.error('Gmail sync API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to sync Gmail emails' },
      { status: 500 }
    );
  }
}
