/**
 * Malaysian Timezone Utilities (Asia/Kuala_Lumpur, UTC+8)
 * Ensures all AI agents (Concierge, Email, WhatsApp, Dining, Meeting, RAG)
 * have 100% accurate situational awareness of the current Malaysian local date and time.
 */

export interface MalaysianDateTimeContext {
  timeZone: string;
  iso: string;
  dateStr: string;
  timeStr: string;
  dayOfWeek: string;
  year: number;
  month: string;
  day: number;
  hour: number;
  minute: number;
  formattedPromptContext: string;
}

export function getMalaysianDateTime(now: Date = new Date()): MalaysianDateTimeContext {
  const timeZone = 'Asia/Kuala_Lumpur';

  const dateStr = now.toLocaleDateString('en-MY', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeStr = now.toLocaleTimeString('en-MY', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const dayOfWeek = now.toLocaleDateString('en-MY', { timeZone, weekday: 'long' });
  const year = parseInt(now.toLocaleDateString('en-MY', { timeZone, year: 'numeric' }), 10);
  const month = now.toLocaleDateString('en-MY', { timeZone, month: 'long' });
  const day = parseInt(now.toLocaleDateString('en-MY', { timeZone, day: 'numeric' }), 10);

  // Parse hour and minute in 24h format for comparison
  const hour24 = parseInt(now.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', hour12: false }), 10);
  const minute = parseInt(now.toLocaleTimeString('en-GB', { timeZone, minute: '2-digit', hour12: false }), 10);

  const formattedPromptContext = `CURRENT DATE & TIME (MALAYSIA / KUALA LUMPUR, UTC+8):
• Current Date: ${dateStr}
• Current Time: ${timeStr} (MYT, Asia/Kuala_Lumpur)
• Day of Week: ${dayOfWeek}
Use this exact date, day, and time as your real-time grounding whenever answering questions about opening hours, availability today/tomorrow, checkout, breakfast, current time, or dates.`;

  return {
    timeZone,
    iso: now.toISOString(),
    dateStr,
    timeStr,
    dayOfWeek,
    year,
    month,
    day,
    hour: hour24,
    minute,
    formattedPromptContext,
  };
}
