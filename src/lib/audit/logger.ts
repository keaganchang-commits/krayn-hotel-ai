import fs from 'fs';
import path from 'path';

export type AuditLogCategory = 'learning' | 'reply' | 'clarification' | 'dining' | 'system';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: AuditLogCategory;
  action: string;
  title: string;
  details: string;
  metadata?: Record<string, any>;
}

const AUDIT_LOG_FILE = path.join(process.cwd(), '.audit_logs.json');
const MAX_LOGS = 500;

function readLogsFromFile(): AuditLogEntry[] {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
    const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[AuditLogger] Error reading audit logs:', err);
    return [];
  }
}

function writeLogsToFile(logs: AuditLogEntry[]) {
  try {
    fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(logs.slice(0, MAX_LOGS), null, 2), 'utf8');
  } catch (err) {
    console.error('[AuditLogger] Error writing audit logs:', err);
  }
}

/**
 * Record an action or learning event in the audit log
 */
export async function logAuditEvent(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<AuditLogEntry> {
  const fullEntry: AuditLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const logs = readLogsFromFile();
  logs.unshift(fullEntry);
  writeLogsToFile(logs);

  return fullEntry;
}

/**
 * Get all audit logs with optional filtering
 */
export function getAuditLogs(options?: {
  category?: AuditLogCategory | 'all';
  search?: string;
  limit?: number;
}): AuditLogEntry[] {
  let logs = readLogsFromFile();

  if (options?.category && options.category !== 'all') {
    logs = logs.filter(l => l.category === options.category);
  }

  if (options?.search) {
    const s = options.search.toLowerCase();
    logs = logs.filter(l =>
      l.title.toLowerCase().includes(s) ||
      l.details.toLowerCase().includes(s) ||
      l.action.toLowerCase().includes(s)
    );
  }

  if (options?.limit && options.limit > 0) {
    logs = logs.slice(0, options.limit);
  }

  return logs;
}
