import { NextResponse } from 'next/server';
import { processAutoReplies } from '@/lib/gmail/autoreply';
import { syncGmailEmails } from '@/lib/gmail/sync';
import { getAutoReplyConfig } from '@/lib/gmail/autoreply_config';

/**
 * POST /api/gmail/webhook
 * Receives real-time push notifications from Google Cloud Pub/Sub.
 * When a new email arrives in Gmail, Google sends an instant HTTP POST to this endpoint.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    // Pub/Sub payload format: { message: { data: base64String, messageId: string, publishTime: string } }
    if (body?.message?.data) {
      const decodedData = Buffer.from(body.message.data, 'base64').toString('utf8');
      try {
        const parsed = JSON.parse(decodedData);
        console.log(`[Gmail Webhook Push] Notification received for email: ${parsed.emailAddress}, historyId: ${parsed.historyId}`);
      } catch {
        console.log(`[Gmail Webhook Push] Notification received: ${decodedData}`);
      }
    }

    const config = getAutoReplyConfig();

    if (config.enabled) {
      // Auto-reply is active: immediately evaluate incoming messages and reply if confident
      const replyResult = await processAutoReplies(5);
      if (replyResult.repliedCount > 0) {
        console.log(`[Gmail Webhook] Automatically replied to ${replyResult.repliedCount} incoming email(s).`);
      }
    } else {
      // Auto-reply is OFF: sync and learn from any newly sent human replies
      const syncResult = await syncGmailEmails(5);
      if (syncResult.syncedCount > 0) {
        console.log(`[Gmail Webhook] Learned ${syncResult.syncedCount} new facts from human email replies.`);
      }
    }

    // Must return 200/204 to acknowledge receipt to Google Pub/Sub
    return NextResponse.json({ success: true, received: true });
  } catch (error: any) {
    console.error('[Gmail Webhook Error]:', error);
    // Still acknowledge with 200 so Pub/Sub doesn't storm retries on business logic error
    return NextResponse.json({ success: false, error: error.message }, { status: 200 });
  }
}

/**
 * GET /api/gmail/webhook
 * Health check endpoint for Pub/Sub subscription verification
 */
export async function GET() {
  return NextResponse.json({
    status: 'ready',
    message: 'Gmail Pub/Sub Webhook receiver is operational.',
  });
}
