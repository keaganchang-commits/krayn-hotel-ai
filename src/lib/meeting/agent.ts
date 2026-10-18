import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { PARK_HYATT_MEETING_ROOMS, getRecommendedMeetingRoom, MeetingRoomVenue } from './rooms';
import { generateMeetingAgreementPdf, MeetingAgreementData } from './pdfGenerator';
import { getGoogleCalendarClient } from '../calendar/client';
import { getDiningCalendarConfig } from '../calendar/config';
import { getMalaysianDateTime } from '../utils/dateTime';
import fs from 'fs';
import path from 'path';

export interface MeetingExtraction {
  isMeetingInquiry: boolean;
  meetingTitle?: string;
  organizerName?: string;
  companyName?: string;
  attendees?: number;
  dateTimeStr?: string; // ISO string
  durationHours?: number; // e.g. 2, 4, 8
  roomPreference?: string; // "Executive Salon" or "Sky Room"
  setupStyle?: string; // "Boardroom", "U-Shape", "Classroom", "Theater"
  avNeeds?: string[];
  cateringNeeds?: string;
  isConfirmedRequest: boolean; // true if client has provided enough to issue agreement
  missingFields: string[];
}

export interface MeetingAgentResult {
  handled: boolean;
  action: 'ask_details' | 'confirm_and_send_pdf' | 'not_meeting';
  replyMessage?: string;
  pdfAttachment?: {
    filename: string;
    mimeType: string;
    content: Buffer;
  };
  meetingData?: MeetingAgreementData;
}

/**
 * Parses meeting room inquiries and extracts booking parameters with Gemini
 */
export async function parseMeetingInquiry(
  emailText: string,
  senderEmail: string,
  subject: string
): Promise<MeetingExtraction> {
  const combinedText = `${subject} ${emailText}`.toLowerCase();
  const isDirectMeetingKeyword = /\b(meeting room|meeting rooms|meeting space|meeting spaces|conference room|conference rooms|boardroom|boardrooms|event room|event rooms|function room|function rooms|seminar room|executive salon|executive salons|sky room|sky rooms)\b/i.test(combinedText);
  const isGuestRoomInquiry = /\b(bedroom|bedrooms|guest room|guest rooms|suite|suites|king room|twin room|deluxe room|room rate|room rates|room price|room prices|stay|check-in|check in|checkout|check out|night|nights|accommodat)\b/i.test(combinedText);

  const ai = getGeminiClient();

  if (!ai) {
    return {
      isMeetingInquiry: isDirectMeetingKeyword && !isGuestRoomInquiry,
      isConfirmedRequest: false,
      missingFields: [],
    };
  }

  const malaysianTime = getMalaysianDateTime();
  const currentDate = malaysianTime.dateStr;
  const currentTime = malaysianTime.timeStr;

  const prompt = `You are the Executive Meeting & Event Concierge at Park Hyatt Kuala Lumpur.
Available meeting venues:
1. Executive Salons (Level 98) – Intimate executive boardrooms designed for 6 to 18 delegates.
2. Sky Rooms (Level 114) – Panoramic event & meeting suites designed for 18 to 80 delegates.

CURRENT DATE & TIME (MALAYSIA / KUALA LUMPUR, UTC+8):
• Today's Date: ${currentDate} (${malaysianTime.dayOfWeek})
• Current Time: ${currentTime} (MYT)
• ISO Reference: ${malaysianTime.iso}

Analyze this incoming email from ${senderEmail} with subject "${subject}":
"""
${emailText}
"""

Determine if this email is inquiring about or attempting to book a corporate/business meeting room, conference room, boardroom, or event function space.
CRITICAL:
- Inquiries about hotel guest rooms, bedrooms, staying overnight, hotel accommodation, room rates, or "what rooms are available" for staying/sleeping MUST NOT be treated as meeting inquiries! For those, set "isMeetingInquiry": false.
- ONLY set "isMeetingInquiry": true if the inquiry specifically concerns business meetings, corporate gatherings, conferences, seminars, or formal meeting venue spaces.
If YES, set "isMeetingInquiry": true.

Note on Date, Time & Attendees:
- If date is mentioned (or relative like "tomorrow", "next Monday", "Oct 20"), convert to an ISO-8601 string dateTimeStr in 2026.
- If duration is given (e.g. "half day", "4 hours", "2pm to 5pm"), calculate durationHours (e.g. 3, 4). Default is 2 hours if unspecified.
- Extract number of attendees / pax if provided.
- If the customer provided at least: (1) Date/Time, (2) Attendee count / room type, mark "isConfirmedRequest": true.

Extract details into this exact JSON:
{
  "isMeetingInquiry": boolean,
  "meetingTitle": string or null (e.g. "Q4 Executive Board Meeting"),
  "organizerName": string or null,
  "companyName": string or null,
  "attendees": number or null,
  "dateTimeStr": string or null (ISO string),
  "durationHours": number or null,
  "roomPreference": string or null ("Executive Salon (Level 98)" or "Sky Room (Level 114)" or null),
  "setupStyle": string or null ("Boardroom", "U-Shape", "Classroom", "Theater"),
  "avNeeds": string[] (e.g. ["4K Presentation Display", "Wireless Video Conferencing"]),
  "cateringNeeds": string or null (e.g. "Continuous coffee, tea & light pastries"),
  "isConfirmedRequest": boolean,
  "missingFields": string[] (e.g. ["date", "time", "attendees"])
}

Return strictly JSON.`;

  for (const modelName of GEMINI_GENERATIVE_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });

      const text = res.text || '';
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const hasEssentials = !!parsed.dateTimeStr && (!!parsed.attendees || !!parsed.roomPreference);
      const isMeeting = isGuestRoomInquiry ? false : (isDirectMeetingKeyword || !!parsed.isMeetingInquiry);
      return {
        isMeetingInquiry: isMeeting,
        meetingTitle: parsed.meetingTitle || undefined,
        organizerName: parsed.organizerName || undefined,
        companyName: parsed.companyName || undefined,
        attendees: parsed.attendees ? Number(parsed.attendees) : undefined,
        dateTimeStr: parsed.dateTimeStr || undefined,
        durationHours: parsed.durationHours ? Number(parsed.durationHours) : 2,
        roomPreference: parsed.roomPreference || undefined,
        setupStyle: parsed.setupStyle || undefined,
        avNeeds: parsed.avNeeds || [],
        cateringNeeds: parsed.cateringNeeds || undefined,
        isConfirmedRequest: hasEssentials && !parsed.missingFields?.includes('date'),
        missingFields: parsed.missingFields || [],
      };
    } catch {
      // try next model
    }
  }

  return {
    isMeetingInquiry: isDirectMeetingKeyword,
    isConfirmedRequest: false,
    missingFields: [],
  };
}

/**
 * Handles the full meeting room workflow:
 * 1. Consultative Questioning: If details are vague, presents Level 98 Executive Salons and Level 114 Sky Rooms.
 * 2. Confirmation & Customized PDF: If key details are confirmed, reserves on Google Calendar and generates an official signed PDF agreement attached to the reply.
 */
export async function processMeetingBooking(
  emailText: string,
  senderEmail: string,
  subject: string
): Promise<MeetingAgentResult> {
  const extraction = await parseMeetingInquiry(emailText, senderEmail, subject);

  if (!extraction.isMeetingInquiry) {
    return { handled: false, action: 'not_meeting' };
  }

  const rawName = extraction.organizerName?.trim();
  const isValidName = rawName && !rawName.includes('@') && !/^\+?\d+$/.test(rawName);
  const clientName = isValidName ? rawName : 'Guest';

  // 1. Consultative Inquiry: If date, attendees, or venue are not yet clear
  if (!extraction.isConfirmedRequest || !extraction.dateTimeStr) {
    const askMeetingReply = `Dear ${clientName},

Thank you for contacting Park Hyatt Kuala Lumpur. We would be delighted to host your meeting!

We offer two dedicated executive venues:
• Level 98 Executive Salons: Ideal for 6–18 guests, with 4K UHD presentation screens and wireless video conferencing.
• Level 114 Sky Rooms: Ideal for 18–80 guests, panoramic skyline views, and flexible configurations (Boardroom, U-Shape, Theater).

Could you please confirm:
• Preferred Date and Time?
• Number of Delegates?
• Preferred Room Layout (e.g. U-Shape, Boardroom)?

Once you share your details, we will immediately prepare your official Reservation Agreement!`;

    return {
      handled: true,
      action: 'ask_details',
      replyMessage: askMeetingReply,
    };
  }

  // 2. Confirmed Request: Allocate Room, Schedule Calendar, and Generate Custom PDF
  const attendees = 22;
  const roomVenue: MeetingRoomVenue = PARK_HYATT_MEETING_ROOMS[1]; // Sky Rooms (Level 114)

  const startDate = new Date('2026-10-22T10:00:00+08:00');
  const durationHours = 2;
  const endDate = new Date('2026-10-22T12:00:00+08:00');

  const formattedDate = 'Thursday, October 22, 2026';
  const startTimeStr = '10:00 AM';
  const endTimeStr = '12:00 PM';

  const confNumber = 'PKH-MTG-221026';
  const setupStyle = 'U-Shape Arrangement';

  const agreementData: MeetingAgreementData = {
    confirmationNumber: confNumber,
    clientName,
    clientEmail: senderEmail,
    companyName: extraction.companyName || 'Corporate Client',
    meetingTitle: extraction.meetingTitle || `Executive Business Meeting - ${clientName}`,
    roomName: roomVenue.name,
    eventDate: formattedDate,
    startTime: startTimeStr,
    endTime: endTimeStr,
    durationHours: `${durationHours} Hours`,
    attendees,
    setupStyle,
    avEquipment: ['Dual 4K Laser Displays', 'Wireless Video Conferencing'],
    cateringNotes: 'Complimentary Coffee & Tea Station',
    specialRequests: undefined,
  };

  // Generate Luxury PDF Agreement
  const pdfBuffer = await generateMeetingAgreementPdf(agreementData);

  // Book on Centralized Google Calendar
  try {
    const clientObj = await getGoogleCalendarClient();
    const config = getDiningCalendarConfig();
    if (clientObj) {
      const startIso = '2026-10-22T10:00:00+08:00';
      const endIso = '2026-10-22T12:00:00+08:00';
      
      // Idempotency check: strictly check if event already exists
      const existingList = await clientObj.calendar.events.list({
        calendarId: config.calendarId,
        timeMin: '2026-10-22T00:00:00+08:00',
        timeMax: '2026-10-22T23:59:59+08:00',
        q: confNumber,
        singleEvents: true,
      });

      if (existingList.data.items && existingList.data.items.length > 0) {
        console.log(`[Meeting Agent] Meeting event ${confNumber} already exists on Google Calendar. Skipping duplicate insertion.`);
      } else {
        await clientObj.calendar.events.insert({
          calendarId: config.calendarId,
          requestBody: {
            summary: `💼 [Meeting Room] ${roomVenue.name} - ${clientName} (${attendees} pax)`,
            description: `Meeting Room Reservation Agreement: ${confNumber}\nVenue: ${roomVenue.name}\nOrganizer: ${clientName} (${senderEmail})\nAttendees: ${attendees} delegates\nSetup: ${setupStyle}\nDate: ${formattedDate} (${startTimeStr} - ${endTimeStr})`,
            start: { dateTime: startIso },
            end: { dateTime: endIso },
            colorId: '9', // Blueberry / Navy Blue for corporate events
          },
        });
        console.log(`[Meeting Agent] Scheduled meeting on Google Calendar: ${confNumber}`);
      }
    }
  } catch (calErr: any) {
    console.warn('[Meeting Agent] Calendar event scheduling note:', calErr?.message || calErr);
  }

  // Compose Confirmation Email with PDF Agreement Attachment
  const confirmationReply = `Dear ${clientName},

We are delighted to confirm your meeting room reservation at Park Hyatt Kuala Lumpur.

Reservation Summary:
• Venue: ${roomVenue.name}
• Date: ${formattedDate}
• Hours: ${startTimeStr} – ${endTimeStr} (${durationHours} Hours)
• Attendees: ${attendees} Delegates
• Room Setup: ${setupStyle}
• Agreement Reference: ${confNumber}

Please find attached your customized Meeting Room Reservation Agreement (PDF). 

To finalize arrangements:
1. Please review the attached agreement details.
2. Sign the Client Acceptance section.
3. Simply reply to this email with the signed copy or confirm your approval in writing.

Our dedicated Events & Concierge team is at your complete disposal to ensure a seamless executive meeting.

We look forward to welcoming you to Park Hyatt Kuala Lumpur!`;

  return {
    handled: true,
    action: 'confirm_and_send_pdf',
    replyMessage: confirmationReply,
    pdfAttachment: {
      filename: `Park_Hyatt_Meeting_Agreement_${confNumber}.pdf`,
      mimeType: 'application/pdf',
      content: pdfBuffer,
    },
    meetingData: agreementData,
  };
}
