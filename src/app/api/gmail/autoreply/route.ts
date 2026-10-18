import { NextResponse } from 'next/server';
import { processAutoReplies } from '@/lib/gmail/autoreply';
import { getAutoReplyConfig, setAutoReplyState } from '@/lib/gmail/autoreply_config';

// GET /api/gmail/autoreply - Get current Auto-Reply status & configuration
export async function GET() {
  try {
    const config = getAutoReplyConfig();
    return NextResponse.json({
      success: true,
      enabled: config.enabled,
      enabledAt: config.enabledAt,
      turboModeUntil: config.turboModeUntil || null,
      isTurboActive: !!(config.turboModeUntil && config.turboModeUntil > Date.now()),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to get auto-reply status' },
      { status: 500 }
    );
  }
}

// PUT /api/gmail/autoreply - Toggle Auto-Reply state ON/OFF or Turbo Mode ON/OFF
export async function PUT(request: Request) {
  try {
    let body: any = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    const { setTurboMode } = await import('@/lib/gmail/autoreply_config');

    // Turbo Mode toggle
    const isTurboBool = typeof body.turbo === 'boolean' ? body.turbo : (body.turbo === 'true' ? true : (body.turbo === 'false' ? false : undefined));
    if (typeof isTurboBool === 'boolean') {
      const updatedConfig = setTurboMode(isTurboBool, Number(body.durationMinutes) || 30);
      try {
        const { triggerWorkerNow } = await import('@/lib/gmail/worker');
        triggerWorkerNow();
      } catch {}
      return NextResponse.json({
        success: true,
        enabled: updatedConfig.enabled,
        enabledAt: updatedConfig.enabledAt,
        turboModeUntil: updatedConfig.turboModeUntil,
        isTurboActive: !!(updatedConfig.turboModeUntil && updatedConfig.turboModeUntil > Date.now()),
        message: isTurboBool
          ? '⚡ Demo Turbo Mode Activated (Scanning every 3s for the next 30 minutes)!'
          : 'Demo Turbo Mode Deactivated. Standard background interval restored.',
      });
    }

    const { enabled } = body;
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Parameter "enabled" or "turbo" (boolean) is required.' },
        { status: 400 }
      );
    }

    const updatedConfig = setAutoReplyState(enabled);

    return NextResponse.json({
      success: true,
      enabled: updatedConfig.enabled,
      enabledAt: updatedConfig.enabledAt,
      turboModeUntil: updatedConfig.turboModeUntil || null,
      isTurboActive: !!(updatedConfig.turboModeUntil && updatedConfig.turboModeUntil > Date.now()),
      message: updatedConfig.enabled
        ? 'Auto-Reply activated! Krayn AI will strictly reply ONLY to new emails received from now on.'
        : 'Auto-Reply paused. Krayn AI will not send automatic email responses.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update auto-reply status' },
      { status: 500 }
    );
  }
}

// POST /api/gmail/autoreply - Process automatic replies for incoming emails
export async function POST(request: Request) {
  try {
    const { maxResults = 10 } = await request.json().catch(() => ({}));
    const result = await processAutoReplies(maxResults);

    return NextResponse.json({
      success: true,
      enabled: result.enabled,
      message: result.enabled
        ? `Processed ${result.processedCount} new emails. Sent ${result.repliedCount} automated replies.`
        : 'Auto-Reply is currently OFF. No replies sent.',
      repliedCount: result.repliedCount,
      results: result.results,
    });
  } catch (error: any) {
    console.error('Auto-reply API error:', error?.stack || error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process automatic replies' },
      { status: 500 }
    );
  }
}
