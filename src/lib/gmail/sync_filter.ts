import fs from 'fs';
import path from 'path';

const LAST_SYNC_FILE = path.join(process.cwd(), '.last_sync_timestamp.json');

/**
 * Get the timestamp string of the last Gmail sync operation
 */
export function getLastSyncTimestamp(): number {
  if (fs.existsSync(LAST_SYNC_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LAST_SYNC_FILE, 'utf8'));
      return data.lastSyncTime || Math.floor(Date.now() / 1000);
    } catch (e) {
      // ignore
    }
  }

  // Default to current time so old emails are NEVER indexed
  const nowInSeconds = Math.floor(Date.now() / 1000);
  saveLastSyncTimestamp(nowInSeconds);
  return nowInSeconds;
}

/**
 * Update the timestamp of the last sync operation
 */
export function saveLastSyncTimestamp(timeInSeconds: number = Math.floor(Date.now() / 1000)) {
  fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ lastSyncTime: timeInSeconds }, null, 2));
}

import { vectorStore } from '../vector/store';

/**
 * Reset knowledge database completely and set sync cutoff to now
 */
export async function clearAllKnowledgeData() {
  // Clear all items via vector store safely
  await vectorStore.clearSource('all');

  const storePath = path.join(process.cwd(), '.knowledge_store');
  if (fs.existsSync(storePath)) {
    try {
      fs.rmSync(storePath, { recursive: true, force: true });
    } catch (e) {
      console.warn('Could not remove .knowledge_store directory directly:', e);
    }
  }
  saveLastSyncTimestamp(Math.floor(Date.now() / 1000));
}
