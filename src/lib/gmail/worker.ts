import { processAutoReplies } from './autoreply';
import { syncGmailEmails } from './sync';
import { getAutoReplyConfig } from './autoreply_config';
import { runBackgroundClarificationPreGenerator } from '@/lib/clarify/pregenerator';

let isWorkerRunning = false;
let isProcessingIteration = false;
let timeoutHandle: NodeJS.Timeout | null = null;
let rateLimitBackoffUntil = 0;

/**
 * Worker execution loop supporting dynamic interval (3s in Turbo Mode, 20s normally)
 */
async function runWorkerIteration() {
  if (!isWorkerRunning) return;

  const config = getAutoReplyConfig();
  const now = Date.now();
  const isTurboActive = !!(config.turboModeUntil && config.turboModeUntil > now);
  // Default polling interval is 2.5s (2500ms) for fast responses
  const nextIntervalMs = isTurboActive ? 1500 : 2500;

  if (!isProcessingIteration && now >= rateLimitBackoffUntil) {
    isProcessingIteration = true;
    const cycleStart = Date.now();
    try {
      if (config.enabled) {
        const result = await processAutoReplies(isTurboActive ? 2 : 5);
        if (result.repliedCount > 0) {
          console.log(`[AutoReply Worker] AUTOMATICALLY REPLIED to ${result.repliedCount} incoming emails! (Took ${Date.now() - cycleStart}ms)`);
        }
      } else {
        const syncResult = await syncGmailEmails(3).catch(() => ({ syncedCount: 0 }));
        if (syncResult && syncResult.syncedCount > 0) {
          console.log(`[Email Learning Worker] Learned ${syncResult.syncedCount} new facts from human email replies.`);
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('Forbidden') || err?.message?.includes('403')) {
        rateLimitBackoffUntil = Date.now() + 45000; // Pause for 45 seconds on rate limit
        console.warn('[AutoReply Worker] Gmail API rate limit / 403 detected. Pausing background worker for 45s.');
      } else {
        console.error('[AutoReply Worker] Error during background scan:', err);
      }
    } finally {
      isProcessingIteration = false;
    }
  }

  // Schedule next iteration dynamically
  if (isWorkerRunning) {
    timeoutHandle = setTimeout(runWorkerIteration, nextIntervalMs);
  }
}

/**
 * Start active background polling worker with dynamic adaptive intervals
 */
export function startGmailAutoReplyWorker(intervalMs?: number) {
  if (isWorkerRunning) {
    console.log('[AutoReply Worker] Background worker is already active.');
    return;
  }

  isWorkerRunning = true;
  console.log('[AutoReply Worker] Background Worker Started with Turbo Polling Capability.');

  // Run initial pre-generation immediately on boot
  runBackgroundClarificationPreGenerator().catch(() => {});

  // Start iteration loop
  runWorkerIteration();
}

/**
 * Stop background polling worker
 */
export function stopGmailAutoReplyWorker() {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  isWorkerRunning = false;
  console.log('[AutoReply Worker] Background worker stopped.');
}

export function isAutoReplyWorkerActive(): boolean {
  return isWorkerRunning;
}

/**
 * Instantly triggers an iteration without waiting for the current timer to expire
 */
export function triggerWorkerNow() {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  if (isWorkerRunning) {
    runWorkerIteration();
  } else {
    startGmailAutoReplyWorker();
  }
}
