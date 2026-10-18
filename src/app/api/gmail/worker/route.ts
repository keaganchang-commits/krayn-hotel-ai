import { NextResponse } from 'next/server';
import { startGmailAutoReplyWorker, stopGmailAutoReplyWorker, isAutoReplyWorkerActive } from '@/lib/gmail/worker';

// GET /api/gmail/worker - Check active status
export async function GET() {
  const active = isAutoReplyWorkerActive();
  return NextResponse.json({
    active,
    message: active
      ? 'Legacy polling worker is running.'
      : 'Polling worker is stopped (Event-driven Webhook mode is primary).',
  });
}

// POST /api/gmail/worker - Enable/disable real-time background worker
export async function POST(request: Request) {
  try {
    const { enable = true, intervalMs = 30000 } = await request.json().catch(() => ({}));

    if (enable) {
      startGmailAutoReplyWorker(intervalMs);
    } else {
      stopGmailAutoReplyWorker();
    }

    return NextResponse.json({
      active: isAutoReplyWorkerActive(),
      message: enable
        ? `Real-time auto-reply worker started (scanning every ${intervalMs / 1000}s).`
        : 'Real-time auto-reply worker stopped.',
    });
  } catch (error: any) {
    console.error('Worker API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Worker control error' },
      { status: 500 }
    );
  }
}
