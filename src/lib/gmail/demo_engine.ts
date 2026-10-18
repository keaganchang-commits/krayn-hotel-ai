import fs from 'fs';
import path from 'path';

export interface DemoTurn {
  step: number;
  name: string;
  matchSubjectKeywords: string[];
  matchBodyKeywords: string[];
  replySubject?: string;
  replyBody: string;
  triggerCalendarBooking?: boolean;
  attachPdfAgreement?: boolean;
}

export interface DemoScenario {
  id: string;
  name: string;
  turns: DemoTurn[];
}

export interface DemoScriptMatchResult {
  matched: boolean;
  step?: number;
  replySubject?: string;
  replyBody?: string;
  attachPdf?: boolean;
  triggerCalendar?: boolean;
}

const SCENARIOS_FILE = path.join(process.cwd(), 'data', 'demo_scenarios.json');
const THREAD_STATE_FILE = path.join(process.cwd(), 'data', 'demo_thread_state.json');

function ensureFiles() {
  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(THREAD_STATE_FILE)) {
    fs.writeFileSync(THREAD_STATE_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

export function loadDemoScenarios(): DemoScenario[] {
  ensureFiles();
  try {
    const raw = fs.readFileSync(SCENARIOS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data.scenarios || [];
  } catch (err) {
    console.error('[Demo Engine] Error loading demo_scenarios.json:', err);
    return [];
  }
}

function getThreadStep(threadKey: string): number {
  ensureFiles();
  try {
    const raw = fs.readFileSync(THREAD_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    return state[threadKey]?.step || 0;
  } catch {
    return 0;
  }
}

function updateThreadStep(threadKey: string, step: number) {
  ensureFiles();
  try {
    const raw = fs.readFileSync(THREAD_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    state[threadKey] = { step, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(THREAD_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[Demo Engine] Error updating thread state:', err);
  }
}

/**
 * Checks if incoming email matches a scripted demo scenario turn.
 * If matched, returns the exact crafted reply immediately.
 */
export function matchDemoScript(
  subject: string,
  bodyText: string,
  threadId?: string,
  senderEmail?: string
): DemoScriptMatchResult {
  const scenarios = loadDemoScenarios();
  const threadKey = threadId || senderEmail || 'default_thread';
  const currentStep = getThreadStep(threadKey);

  // If thread already finished step 2, lock it from further auto-replies
  if (currentStep >= 2) {
    return { matched: false };
  }

  // If thread is currently at Step 1 (meaning Step 1 reply was already sent to customer),
  // ANY reply sent by the customer in this thread immediately triggers Step 2!
  if (currentStep === 1) {
    const scenario = scenarios.find(s => s.id === 'meeting_room_journey') || scenarios[0];
    const turn2 = scenario?.turns.find(t => t.step === 2);
    if (turn2) {
      updateThreadStep(threadKey, 2);
      console.log(`[Demo Script Engine] MATCHED Step 2 (Follow-up in thread ${threadKey}) regardless of text sent.`);
      return {
        matched: true,
        step: 2,
        replySubject: turn2.replySubject || (subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`),
        replyBody: turn2.replyBody,
        attachPdf: turn2.attachPdfAgreement,
        triggerCalendar: turn2.triggerCalendarBooking,
      };
    }
  }

  // Otherwise, evaluate Step 1 or keyword fallback
  const cleanSubject = (subject || '').toLowerCase();
  const cleanBody = (bodyText || '').toLowerCase();

  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      const subjectMatches = turn.matchSubjectKeywords.some(kw => cleanSubject.includes(kw.toLowerCase()));
      const bodyMatches = turn.matchBodyKeywords.some(kw => cleanBody.includes(kw.toLowerCase()));

      let isMatch = false;
      if (turn.step === 1) {
        if (bodyMatches || (subjectMatches && (cleanBody.includes('enquire') || cleanBody.includes('meeting')))) {
          isMatch = true;
        }
      } else if (turn.step === 2) {
        // Fallback: If sent in a separate thread but has 30 oct or 22 pax keywords
        const matchesOct30 = cleanBody.includes('30 october') || cleanBody.includes('30 oct');
        const matchesPax = cleanBody.includes('22') || cleanBody.includes('people') || cleanBody.includes('pax');
        const matchesSetup = cleanBody.includes('u-shape') || cleanBody.includes('ushape');
        if (matchesOct30 && (matchesPax || matchesSetup)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        updateThreadStep(threadKey, turn.step);
        console.log(`[Demo Script Engine] MATCHED Step ${turn.step} ("${turn.name}") for thread ${threadKey}`);

        return {
          matched: true,
          step: turn.step,
          replySubject: turn.replySubject || `Re: ${subject}`,
          replyBody: turn.replyBody,
          attachPdf: turn.attachPdfAgreement,
          triggerCalendar: turn.triggerCalendarBooking,
        };
      }
    }
  }

  return { matched: false };
}
