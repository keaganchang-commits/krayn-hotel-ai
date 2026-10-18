import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { checkDiningAvailability, createCalendarReservation } from './reservations';
import { getDiningCalendarConfig } from './config';
import { getMalaysianDateTime } from '../utils/dateTime';

export interface BookingExtraction {
  isBookingRequest: boolean;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  partySize?: number;
  dateTimeStr?: string; // ISO string if parsed
  restaurantName?: string; // e.g. "Merdeka Grill", "Park Lounge", "Cacao"
  specialRequests?: string;
  seatingArea?: string;
  isAmbiguous: boolean;
  missingFields: string[];
}

export interface BookingResolution {
  handled: boolean;
  action: 'confirmed' | 'ask_restaurant' | 'clarify_capacity' | 'clarify_details' | 'not_booking';
  replyMessage?: string;
  reservation?: any;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
}

/**
 * Extracts dining reservation details from an incoming email message using Gemini.
 */
export async function parseBookingRequest(
  emailText: string,
  senderEmail: string,
  subject: string
): Promise<BookingExtraction> {
  const ai = getGeminiClient();
  const config = getDiningCalendarConfig();

  if (!ai) {
    return {
      isBookingRequest: false,
      isAmbiguous: false,
      missingFields: [],
    };
  }

  // Positive dining keyword check: Only run AI extraction if the message explicitly mentions dining or tables
  const lowerText = (emailText + ' ' + subject).toLowerCase();
  const hasExplicitDiningKeyword =
    lowerText.includes('dine') ||
    lowerText.includes('dining') ||
    lowerText.includes('restaurant') ||
    lowerText.includes('table') ||
    lowerText.includes('lunch') ||
    lowerText.includes('dinner') ||
    lowerText.includes('breakfast') ||
    lowerText.includes('merdeka grill') ||
    lowerText.includes('park lounge') ||
    lowerText.includes('cacao') ||
    lowerText.includes('menu') ||
    lowerText.includes('eat') ||
    lowerText.includes('food');

  // If this email is NOT about dining or restaurants, exit immediately! Zero AI overhead.
  if (!hasExplicitDiningKeyword) {
    return {
      isBookingRequest: false,
      isAmbiguous: false,
      missingFields: [],
    };
  }

  const malaysianTime = getMalaysianDateTime();
  const currentDate = malaysianTime.dateStr;
  const currentTime = malaysianTime.timeStr;

  const prompt = `You are the dining reservation coordinator for Park Hyatt Kuala Lumpur.
Available dining venues:
1. Merdeka Grill (Premium meats, seafood, all-day dining)
2. Park Lounge (Afternoon tea, specialty coffee, and light bites)
3. Cacao (Artisanal chocolates, cocktails, and desserts)

CURRENT DATE & TIME (MALAYSIA / KUALA LUMPUR, UTC+8):
• Today's Date: ${currentDate} (${malaysianTime.dayOfWeek})
• Current Time: ${currentTime} (MYT)
• ISO Reference: ${malaysianTime.iso}

Capacity parameters: 100 total guests across the dining area, typically 2 guests per table. Open 7 days a week, 07:00 to 23:00.

Analyze this incoming email from ${senderEmail} with subject "${subject}":
"""
${emailText}
"""

Determine if this email is attempting to make, modify, or inquire about making a dining or table reservation. If YES, set "isBookingRequest": true.
Note on Date & Time:
- If a time is specified (e.g. "6pm", "18:00") but no specific date is mentioned, assume TODAY (${malaysianTime.dateStr}) if that time is still in the future today, or tomorrow if the time has already passed.
- If party size (e.g. "2ppl", "2 pax", "for 2") is provided, extract partySize: 2.
- Only mark "isAmbiguous": true if NEITHER date nor time can be reasonably inferred.

Extract the details into this exact JSON format:
{
  "isBookingRequest": boolean,
  "restaurantName": string or null (e.g. "Merdeka Grill", "Park Lounge", or "Cacao" if specified or implied; otherwise null),
  "guestName": string or null (the name of the person reserving, or fallback to sender's name if inferred),
  "guestPhone": string or null,
  "partySize": number or null (e.g. 2, 4),
  "dateTimeStr": string or null (an ISO-8601 string representing the exact requested date and time),
  "specialRequests": string or null (e.g. anniversary, high chair, dietary allergies),
  "seatingArea": string or null (e.g. "window", "outdoor", "booth"),
  "isAmbiguous": boolean,
  "missingFields": string[]
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
      console.log('[Dining Agent] Extraction from email:', JSON.stringify(parsed));
      
      const missing = Array.isArray(parsed.missingFields) ? parsed.missingFields : [];
      // If restaurant, party size, and dateTimeStr are all present, it is NOT ambiguous!
      const hasCoreDetails = !!parsed.restaurantName && !!parsed.dateTimeStr && !!parsed.partySize;
      const isAmbiguous = hasCoreDetails ? false : (!!parsed.isAmbiguous || missing.length > 0);

      return {
        isBookingRequest: !!parsed.isBookingRequest,
        restaurantName: parsed.restaurantName || undefined,
        guestName: parsed.guestName || undefined,
        guestEmail: senderEmail,
        guestPhone: parsed.guestPhone || undefined,
        partySize: parsed.partySize || undefined,
        dateTimeStr: parsed.dateTimeStr || undefined,
        specialRequests: parsed.specialRequests || undefined,
        seatingArea: parsed.seatingArea || undefined,
        isAmbiguous,
        missingFields: hasCoreDetails ? [] : missing,
      };
    } catch (err: any) {
      console.warn('[Dining Agent] Extraction attempt error:', err?.message || err);
      // try next model
    }
  }

  return {
    isBookingRequest: false,
    isAmbiguous: false,
    missingFields: [],
  };
}

/**
 * Autonomously resolves a dining reservation request:
 * 1. If customer asks for reservation without specifying WHICH restaurant -> Asks them to pick between Merdeka Grill, Park Lounge, or Cacao!
 * 2. If restaurant is specified and table is available -> Creates Google Calendar booking (same shared calendar) and generates in-thread confirmation.
 * 3. If slot is full or request is ambiguous -> Formulates a Clarification for the manager/staff.
 */
export async function processDiningBooking(
  emailText: string,
  senderEmail: string,
  subject: string
): Promise<BookingResolution> {
  const config = getDiningCalendarConfig();
  if (!config.enabled) {
    return { handled: false, action: 'not_booking' };
  }

  const extraction = await parseBookingRequest(emailText, senderEmail, subject);

  if (!extraction.isBookingRequest) {
    return { handled: false, action: 'not_booking' };
  }

  const rawName = extraction.guestName?.trim();
  const isValidName = rawName && !rawName.includes('@') && !/^\+?\d+$/.test(rawName);
  const guestName = isValidName ? rawName : 'Guest';

  // 1. If customer has not picked which restaurant, prompt them with all essential booking questions and menu details!
  if (!extraction.restaurantName) {
    const askReply = `Dear ${guestName},

Thank you for contacting Park Hyatt Kuala Lumpur. We would be delighted to arrange a table for you!

To help us reserve the best table, could you please confirm:
• Preferred Restaurant: Merdeka Grill (Grill & Steaks), Park Lounge (Afternoon Tea & Cocktails), or Cacao (Artisanal Chocolate & Desserts)?
• Date & Preferred Time?
• Number of Guests?
• Any seating preference or dietary needs?

Simply reply with your details and we will secure your reservation!`;

    return {
      handled: true,
      action: 'ask_restaurant',
      replyMessage: askReply,
    };
  }

  const chosenRestaurant = extraction.restaurantName;

  // 2. If restaurant is known but essential details (time, date, party size) are still missing, ask the customer directly!
  if (extraction.isAmbiguous || !extraction.dateTimeStr || !extraction.partySize) {
    const askDetailsReply = `Dear ${guestName},

Thank you for choosing ${chosenRestaurant} at Park Hyatt Kuala Lumpur!

We would be delighted to reserve your table. Could you please confirm:
• Preferred Date and Time?
• Number of Guests?
• Any special seating preference or dietary requirements?

Once you reply with these details, we will immediately secure your table!`;

    return {
      handled: true,
      action: 'ask_restaurant',
      replyMessage: askDetailsReply,
    };
  }

  const targetDate = new Date(extraction.dateTimeStr);
  const partySize = extraction.partySize || config.defaultPartySize;

  // 3. Check Capacity & Operating Rules on Google Calendar
  const availability = await checkDiningAvailability(targetDate, partySize);

  if (!availability.available) {
    // Room is full or closed
    return {
      handled: true,
      action: 'clarify_capacity',
      clarificationQuestion: `Dining reservation request for ${guestName} (${partySize} pax) at ${chosenRestaurant} on ${targetDate.toLocaleDateString()} at ${targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} cannot be auto-booked: ${availability.reason}`,
      clarificationOptions: [
        'Offer alternative time (+1 hour)',
        'Place on Priority Waitlist',
        'Politely decline: Fully Booked',
      ],
    };
  }

  // 4. Autonomous Booking: Create Google Calendar Event on the centralized dining calendar!
  const reservation = await createCalendarReservation({
    guestName,
    guestEmail: senderEmail,
    guestPhone: extraction.guestPhone,
    partySize,
    dateTime: targetDate,
    restaurantName: chosenRestaurant,
    specialRequests: extraction.specialRequests,
    seatingArea: extraction.seatingArea,
  });

  const formattedDate = targetDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = targetDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const replyMessage = `Dear ${guestName},

We are delighted to confirm your dining reservation at ${chosenRestaurant}.

Reservation Details:
• Venue: ${chosenRestaurant}
• Date: ${formattedDate}
• Time: ${formattedTime}
• Party Size: ${partySize} guests
${extraction.specialRequests ? `• Special Notes: ${extraction.specialRequests}\n` : ''}
Your table is confirmed on our central dining calendar. If you need to make any adjustments or have dietary requests, simply reply to this email.

We look forward to welcoming you!`;

  return {
    handled: true,
    action: 'confirmed',
    replyMessage,
    reservation,
  };
}
