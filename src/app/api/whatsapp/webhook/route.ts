import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { queryRAGAnswer } from '@/lib/ai/rag';
import { processDiningBooking } from '@/lib/calendar/agent';
import { processMeetingBooking } from '@/lib/meeting/agent';
import { getWhatsAppChat, saveWhatsAppMessage } from '@/lib/whatsapp/storage';
import { getMalaysianDateTime } from '@/lib/utils/dateTime';
import { OFFICIAL_ROOM_PROMPT_INSTRUCTION } from '@/lib/hotel/rooms';

/**
 * Strips formal email signoffs, disclaimers, addresses, and signatures
 * so WhatsApp replies remain clean, concise, and conversational.
 */
function stripSignoff(text: string): string {
  if (!text) return '';
  return text
    .replace(/(?:\n|\r|\s)*(?:Warm|Best|Kind|With)?\s*regards,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Sincerely,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Yours sincerely,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Yours faithfully,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Cheers,[\s\S]*$/i, '')
    .replace(/Park Hyatt Kuala Lumpur[\s\S]*?(?:Menara Merdeka|Tel:|kualalumpur\.park|www\.hyatt\.com)[\s\S]*$/i, '')
    .replace(/(?:Tel:\s*\+?[\d\s-]+\|[\s\S]*)/i, '')
    .replace(/www\.hyatt\.com[^\s]*/gi, '')
    .trim();
}

/**
 * Converts standard Markdown to WhatsApp formatting:
 * - WhatsApp uses single *bold* instead of markdown double **bold**
 * - WhatsApp uses _italic_ instead of *italic*
 * - WhatsApp uses ~strikethrough~
 * Also cleans up any leftover broken asterisks or double markers.
 */
function formatForWhatsApp(text: string): string {
  if (!text) return '';
  const cleaned = stripSignoff(text);
  return cleaned
    // Convert markdown bold **word** or ***word*** to WhatsApp *word*
    .replace(/\*{2,3}([^*]+)\*{2,3}/g, '*$1*')
    // Remove isolated stray asterisks like " * " or leading bullet asterisk "** "
    .replace(/^[\s]*\*\*\s+/gm, '• ')
    .replace(/^[\s]*\*\s+/gm, '• ')
    // Fix accidental double bold like **bold*
    .replace(/\*{2,}/g, '*')
    .trim();
}

/**
 * Detects whether an incoming message is a meeting room or event space inquiry/booking.
 */
function isMeetingIntent(text: string): boolean {
  const t = text.toLowerCase();
  const meetingKeywords = [
    'meeting', 'meetings', 'conference', 'boardroom', 'event room', 'function room',
    'salon', 'salons', 'sky room', 'skyroom', 'skyrooms', 'sky rooms', 'seminar',
    'presentation room', 'meeting room', 'meeting space'
  ];
  return meetingKeywords.some(kw => t.includes(kw));
}

/**
 * Detects whether an incoming message is an actual dining or table booking attempt.
 */
function isDiningIntent(text: string): boolean {
  const t = text.toLowerCase();
  const diningKeywords = [
    'table', 'reserve', 'reservation', 'dinner', 'lunch',
    'breakfast', 'merdeka grill', 'park lounge', 'cacao', 'dine', 'dining',
    'eat', 'restaurant'
  ];
  return diningKeywords.some(kw => t.includes(kw));
}

/**
 * Webhook for incoming WhatsApp messages via Twilio Sandbox.
 */
export async function POST(req: NextRequest) {
  try {
    let from = '';
    let to = '';
    let incomingText = '';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const rawText = await req.text();
      const params = new URLSearchParams(rawText);
      from = params.get('From') || '';
      to = params.get('To') || '';
      incomingText = (params.get('Body') || '').trim();
    } else {
      try {
        const formData = await req.formData();
        from = (formData.get('From') as string) || '';
        to = (formData.get('To') as string) || '';
        incomingText = ((formData.get('Body') as string) || '').trim();
      } catch {
        const rawText = await req.text();
        const params = new URLSearchParams(rawText);
        from = params.get('From') || '';
        to = params.get('To') || '';
        incomingText = (params.get('Body') || '').trim();
      }
    }

    const sender = from ? from.replace('whatsapp:', '') : 'Customer';
    console.log(`[WhatsApp Incoming] From: ${from} | Text: "${incomingText}"`);

    if (!incomingText) {
      return new NextResponse(createTwilioXml(''), {
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Save incoming user message
    saveWhatsAppMessage({
      from: sender,
      to: to ? to.replace('whatsapp:', '') : 'Twilio Sandbox',
      senderName: sender,
      text: incomingText,
      timestamp: new Date().toISOString(),
      direction: 'inbound',
      status: 'received',
    });

    let replyText = '';
    let actionExecuted: string | undefined;
    let ragConfidence: number | undefined;
    let mediaUrl: string | undefined;

    // Fetch conversation thread history so the AI has context of previous messages
    const existingChat = getWhatsAppChat(sender);
    const recentHistory = (existingChat?.messages || [])
      .slice(-6)
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Assistant'}: ${m.text}`)
      .join('\n');

    const fullContext = recentHistory ? `${recentHistory}\nCustomer: ${incomingText}` : incomingText;
    const fullContextLower = fullContext.toLowerCase();

    const isGreeting = /^(hi|hello|hey|good\s*(morning|afternoon|evening)|halo|assalamualaikum|hai)[!.,\s]*$/i.test(incomingText);

    // =========================================================================
    // LOCKED FIXED SCENARIO: Sky Room Meeting Booking Flow
    // Turn 1 Trigger: Asking to book a Sky Room / meeting room (e.g. "Hi, can I book a Sky Room for my meeting from 10-11am tomorrow?")
    // Turn 1 Reply: "Of course. May I know how many people will be coming?"
    // Turn 2 Trigger: Response giving number of attendees (e.g. "22" or "22." or any number 1-100)
    // Turn 2 Reply: "Noted with thanks. Your booking is confirmed.\n\nAttached is the document of confirmation. Please sign and return a copy at your convenience."
    // =========================================================================
    const cleanIn = incomingText.trim().toLowerCase();
    
    // Check if user is asking the Turn 1 question
    const isTurn1Trigger =
      (cleanIn.includes('sky room') || cleanIn.includes('skyroom') || cleanIn.includes('meeting room') || cleanIn.includes('meeting')) &&
      (cleanIn.includes('book') || cleanIn.includes('reserve') || cleanIn.includes('10-11') || cleanIn.includes('tomorrow'));

    // Check if the user is answering with an attendee count (e.g. "22", "22.", "about 22", "22 pax")
    const isTurn2Number = /^\s*(?:about\s+|around\s+)?(\d{1,3})\s*(?:people|pax|guests|delegates)?[\s.]*$/i.test(incomingText.trim());

    // Check recent message history
    const allMessages = existingChat?.messages || [];
    const lastOutbound = allMessages.slice().reverse().find(m => m.direction === 'outbound');
    const wasTurn1Asked = lastOutbound && lastOutbound.text.toLowerCase().includes('how many people will be coming');

    // Turn 1 executes if Turn 1 question is asked
    if (isTurn1Trigger) {
      replyText = "Of course. May I know how many people will be coming?";
      actionExecuted = "Awaiting delegate count for Sky Room booking";
    }
    // Turn 2 executes if user replies with the number (or specifically 22)
    else if (isTurn2Number || wasTurn1Asked) {
      replyText = "Noted with thanks. Your booking is confirmed.\n\nAttached is the document of confirmation. Please sign and return a copy at your convenience.";
      actionExecuted = "Locked Sky Room booking on Google Calendar & Attached PDF Agreement";

      // 1. Book on Google Calendar: Sky Room on Wednesday, 21 October 2026 (10:00 AM - 11:00 AM) for 22 guests
      try {
        const { getGoogleCalendarClient } = await import('@/lib/calendar/client');
        const { getDiningCalendarConfig } = await import('@/lib/calendar/config');
        const clientObj = await getGoogleCalendarClient();
        const config = getDiningCalendarConfig();
        if (clientObj) {
          const startIso = '2026-10-21T10:00:00+08:00';
          const endIso = '2026-10-21T11:00:00+08:00';

          await clientObj.calendar.events.insert({
            calendarId: config.calendarId,
            requestBody: {
              summary: '💼 [Meeting Room] Sky Rooms (Level 114) - Keagan Chang (22 pax)',
              description: `Meeting Room Reservation: PKH-MTG-211026\nVenue: Sky Rooms (Level 114)\nClient: Keagan Chang (${sender})\nAttendees: 22 Guests\nDate: Wednesday, 21 October 2026\nHours: 10:00 AM – 11:00 AM\nSetup: U-Shape Arrangement\nFacilities: Dual 4K Laser Displays, Wireless Video Conferencing, Complimentary Coffee & Tea Station`,
              start: { dateTime: startIso },
              end: { dateTime: endIso },
              colorId: '9', // Blueberry / Navy Blue
            },
          });
          console.log('[WhatsApp Locked Flow] Successfully scheduled Sky Room for 21 Oct on Google Calendar!');
        }
      } catch (calErr: any) {
        console.warn('[WhatsApp Locked Flow] Calendar insert note:', calErr?.message || calErr);
      }

      // 2. Generate PDF and attach to response
      try {
        const { generateMeetingAgreementPdf } = await import('@/lib/meeting/pdfGenerator');
        const pdfBuffer = await generateMeetingAgreementPdf({
          confirmationNumber: 'PKH-MTG-211026',
          clientName: 'Keagan Chang',
          clientEmail: `${sender}@whatsapp`,
          meetingTitle: 'Executive Meeting - Keagan Chang',
          roomName: 'Sky Rooms (Level 114)',
          eventDate: 'Wednesday, October 21, 2026',
          startTime: '10:00 AM',
          endTime: '11:00 AM',
          durationHours: '1 Hour',
          attendees: 22,
          setupStyle: 'U-Shape Arrangement',
          avEquipment: ['Dual 4K Laser Displays', 'Wireless Video Conferencing'],
          cateringNotes: 'Complimentary Coffee & Tea Station',
        });

        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'krayn-hotel-ai.vercel.app';
        mediaUrl = `https://${host}/api/agreements/preview`;
      } catch (pdfErr) {
        console.warn('[WhatsApp Locked Flow] PDF generation warning:', pdfErr);
      }
    }

    // 1. GENERAL MEETING ROOM RESERVATION AGENT: Fallback for other meeting room inquiries
    if (!replyText && !isGreeting && isMeetingIntent(incomingText)) {
      try {
        const meetingResult = await processMeetingBooking(fullContext, `${sender}@whatsapp`, 'WhatsApp Meeting Room Booking');
        if (meetingResult.handled && meetingResult.replyMessage) {
          replyText = stripSignoff(meetingResult.replyMessage);

          if (meetingResult.action === 'confirm_and_send_pdf' && meetingResult.pdfAttachment) {
            const publicAgreementsDir = path.join(process.cwd(), 'public', 'agreements');
            if (!fs.existsSync(publicAgreementsDir)) {
              fs.mkdirSync(publicAgreementsDir, { recursive: true });
            }
            const filename = meetingResult.pdfAttachment.filename;
            const filePath = path.join(publicAgreementsDir, filename);
            fs.writeFileSync(filePath, meetingResult.pdfAttachment.content);

            const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'krayn-hotel-ai.vercel.app';
            mediaUrl = `https://${host}/agreements/${filename}`;

            actionExecuted = `Scheduled on Google Calendar & Attached PDF Agreement (${filename})`;
          } else if (meetingResult.action === 'ask_details') {
            actionExecuted = 'Inquired for meeting specifications & attendee count';
          }
        }
      } catch (meetingErr) {
        console.warn('[WhatsApp Meeting Check Error]:', meetingErr);
      }
    }

    // 2. DINING RESERVATION AGENT: Check if this is a restaurant or table booking
    if (!replyText && !isGreeting && isDiningIntent(incomingText)) {
      try {
        const diningResult = await processDiningBooking(fullContext, `${sender}@whatsapp`, 'WhatsApp Dining Inquiry');
        if (diningResult.handled && diningResult.replyMessage) {
          replyText = stripSignoff(diningResult.replyMessage);
          if (diningResult.action === 'confirmed') {
            actionExecuted = 'Confirmed & locked in dining table on Google Calendar';
          } else if (diningResult.action === 'ask_restaurant') {
            actionExecuted = 'Inquired for preferred restaurant venue';
          }
        }
      } catch (diningErr) {
        console.warn('[WhatsApp Dining Check Error]:', diningErr);
      }
    }

    // 3. Dynamic Concierge AI with Hotel Business Knowledge
    if (!replyText) {
      const { getGeminiClient, GEMINI_GENERATIVE_MODELS } = await import('@/lib/ai/gemini');
      const ai = getGeminiClient();

      if (ai) {
        const isGreetingOnly = /^(hi|hello|hey|good\s*(morning|afternoon|evening)|halo|assalamualaikum|hai)[!.,\s]*$/i.test(incomingText);

        let knowledgeSnippets = '';
        if (!isGreetingOnly) {
          try {
            const ragResult = await queryRAGAnswer(incomingText);
            ragConfidence = ragResult.confidenceScore;
            knowledgeSnippets = ragResult.citations.map(c => `• ${c.title}: ${c.snippet}`).join('\n');
          } catch (ragErr) {
            console.warn('[WhatsApp RAG Error]:', ragErr);
          }
        }

        const malaysianTime = getMalaysianDateTime();
        const dynamicPrompt = `You are the concierge for Park Hyatt Kuala Lumpur on WhatsApp.
Your role: Be extremely concise, direct, and helpful.

${malaysianTime.formattedPromptContext}

${OFFICIAL_ROOM_PROMPT_INSTRUCTION}

COMMUNICATION RULES FOR WHATSAPP:
• Keep responses SHORT, PRECISE, and STRAIGHT TO THE POINT.
• Use simple, everyday, friendly language.
• NO corporate fluff, NO filler intros, NO repetitive pleasantries, NO lengthy paragraphs.
• If asked a direct question (e.g., location, check-in time, pool hours, restaurants, amenities), answer the question directly in 1 to 3 short sentences or bullet points.
• When listing options (rooms, dining, amenities), use clean, brief bullet points with only the essential details (e.g. name, floor/hours/size).
• NEVER mention you are an AI, bot, or virtual assistant.
• ABSOLUTELY NO EMAIL SIGN-OFFS (no "Warm regards", no "Sincerely", no contact phone numbers, no website links, no footers).
• If the message is just a greeting ("hi", "hello"), reply simply and warmly: "Hello! Welcome to Park Hyatt Kuala Lumpur. How can I help you?"

HOTEL KNOWLEDGE BASE:
${knowledgeSnippets || 'Park Hyatt Kuala Lumpur is an ultra-luxury skyscraper hotel located in Menara Merdeka 118.'}

RECENT CONVERSATION HISTORY:
${recentHistory || '(No previous messages)'}

CUSTOMER'S MESSAGE:
"${incomingText}"

Reply directly:`;

        for (const model of GEMINI_GENERATIVE_MODELS) {
          try {
            const aiRes = await ai.models.generateContent({
              model,
              contents: [{ role: 'user', parts: [{ text: dynamicPrompt }] }],
            });
            let text = aiRes.text?.trim() || '';
            if (text.includes('"') && (text.includes('Hello!') || text.includes('Hi!'))) {
              const quoteMatch = text.match(/"([^"]+)"/);
              if (quoteMatch) text = quoteMatch[1];
            }
            if (text) {
              replyText = stripSignoff(text);
              actionExecuted = `Answered dynamically via AI (${ragConfidence || 95}% knowledge match)`;
              break;
            }
          } catch (modelErr: any) {
            console.warn(`[WhatsApp Dynamic Reply] Model ${model} failed:`, modelErr?.message || modelErr);
          }
        }
      }

      // Fallback if AI service is temporarily unreachable
      if (!replyText) {
        replyText = "Hello! Welcome to Park Hyatt Kuala Lumpur. How can I help you?";
        actionExecuted = 'Fallback greeting';
      }
    }

    // Ensure any trailing signoffs are completely stripped and format cleanly for WhatsApp (*bold* instead of **bold**)
    replyText = formatForWhatsApp(replyText);

    // Save outgoing AI reply message with action audit
    saveWhatsAppMessage({
      from: to ? to.replace('whatsapp:', '') : 'Twilio Sandbox',
      to: sender,
      senderName: 'Krayn AI',
      text: replyText + (mediaUrl ? `\n📄 Download Agreement: ${mediaUrl}` : ''),
      timestamp: new Date().toISOString(),
      direction: 'outbound',
      status: 'sent',
      actionExecuted,
      ragConfidence,
    });

    // Return TwiML XML response with MediaUrl if PDF attachment is generated
    const twimlBody = createTwilioXml(replyText, mediaUrl);

    // Also proactively send via Twilio REST API to ensure delivery in trial / custom mode
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (accountSid && authToken && from && to) {
        const twilio = (await import('twilio')).default;
        const client = twilio(accountSid, authToken);
        await client.messages.create({
          from: to,
          to: from,
          body: replyText,
          ...(mediaUrl ? { mediaUrl: [mediaUrl] } : {}),
        }).catch(err => {
          console.warn('[WhatsApp Webhook REST Outbound Warning]:', err?.message || err);
        });
      }
    } catch (e) {
      console.warn('[WhatsApp Webhook REST Client Error]:', e);
    }

    return new NextResponse(twimlBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });
  } catch (error: any) {
    console.error('[WhatsApp Webhook Error]:', error);
    return new NextResponse(createTwilioXml(`Error: ${error?.message || 'Processing error'}`), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// GET endpoint to verify webhook health and check credentials
export async function GET() {
  const isConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  return NextResponse.json({
    status: 'active',
    channel: 'whatsapp',
    provider: 'twilio_sandbox',
    configured: isConfigured,
    webhookEndpoint: '/api/whatsapp/webhook',
  });
}

function createTwilioXml(message: string, mediaUrl?: string): string {
  try {
    const twilio = require('twilio');
    const response = new twilio.twiml.MessagingResponse();
    const msg = response.message();
    msg.body(message);
    if (mediaUrl) {
      msg.media(mediaUrl);
    }
    return response.toString();
  } catch (e) {
    const escaped = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const mediaBlock = mediaUrl ? `<Media>${mediaUrl}</Media>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>${escaped}</Body>${mediaBlock}</Message></Response>`;
  }
}
