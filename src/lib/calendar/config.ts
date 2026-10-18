import fs from 'fs';
import path from 'path';

const CALENDAR_CONFIG_FILE = path.join(process.cwd(), '.calendar_config.json');

export interface DiningCalendarConfig {
  enabled: boolean;
  calendarId: string; // e.g. "primary" or "dining@yourdomain.com" or a dedicated calendar ID
  outletName: string; // e.g. "Merdeka Grill - All Day Dining"
  totalCapacity: number; // 100 guests total
  defaultPartySize: number; // 2 guests per table default
  turnDurationMinutes: number; // 90 or 120 minutes per reservation
  serviceDays: number[]; // 0-6 (7 days a week: [0, 1, 2, 3, 4, 5, 6])
  openingTime: string; // "07:00"
  closingTime: string; // "23:00"
  maxCoversPerSlot: number; // pacing cap per 30-min window (e.g. 20 covers)
  serviceAccountKeyPath?: string; // path to service-account.json if present
  autoBookConfidenceThreshold: number; // 85%
}

export function getDefaultCalendarConfig(): DiningCalendarConfig {
  return {
    enabled: true,
    calendarId: 'primary',
    outletName: 'Merdeka Grill - All Day Dining',
    totalCapacity: 100, // 100 guests total
    defaultPartySize: 2, // 2 per table
    turnDurationMinutes: 90,
    serviceDays: [0, 1, 2, 3, 4, 5, 6], // 7 days a week
    openingTime: '07:00',
    closingTime: '23:00',
    maxCoversPerSlot: 20,
    serviceAccountKeyPath: 'service-account.json',
    autoBookConfidenceThreshold: 85,
  };
}

export function getDiningCalendarConfig(): DiningCalendarConfig {
  const defaults = getDefaultCalendarConfig();
  if (fs.existsSync(CALENDAR_CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_FILE, 'utf8'));
      return {
        ...defaults,
        ...data,
      };
    } catch (e) {
      console.warn('Failed to parse .calendar_config.json, using defaults:', e);
    }
  }

  try {
    fs.writeFileSync(CALENDAR_CONFIG_FILE, JSON.stringify(defaults, null, 2), 'utf8');
  } catch (err) {
    // ignore write error
  }
  return defaults;
}

export function saveDiningCalendarConfig(config: Partial<DiningCalendarConfig>): DiningCalendarConfig {
  const defaults = getDefaultCalendarConfig();
  let existing = defaults;
  if (fs.existsSync(CALENDAR_CONFIG_FILE)) {
    try {
      existing = { ...defaults, ...JSON.parse(fs.readFileSync(CALENDAR_CONFIG_FILE, 'utf8')) };
    } catch {}
  }
  const merged: DiningCalendarConfig = {
    ...existing,
    ...config,
  };
  fs.writeFileSync(CALENDAR_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
