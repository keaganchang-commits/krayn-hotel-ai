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
    // Strip common signoff phrases and everything that follows them
    .replace(/(?:\n|\r|\s)*(?:Warm|Best|Kind|With)?\s*regards,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Sincerely,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Yours sincerely,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Yours faithfully,[\s\S]*$/i, '')
    .replace(/(?:\n|\r|\s)*Cheers,[\s\S]*$/i, '')
    // Strip Park Hyatt footer block if present
    .replace(/Park Hyatt Kuala Lumpur[\s\S]*?(?:Menara Merdeka|Tel:|kualalumpur\.park|www\.hyatt\.com)[\s\S]*$/i, '')
    .replace(/(?:Tel:\s*\+?[\d\s-]+\|[\s\S]*)/i, '')
    .replace(/www\.hyatt\.com[^\s]*/gi, '')
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

    // 1. MEETING ROOM RESERVATION AGENT: Check if this is a meeting room inquiry or booking
    if (!isGreeting && isMeetingIntent(incomingText)) {
      try {
        const meetingResult = await processMeetingBooking(fullContext, `${sender}@whatsapp`, 'WhatsApp Meeting Room Booking');
        if (meetingResult.handled && meetingResult.replyMessage) {
          replyText = stripSignoff(meetingResult.replyMessage);

          if (meetingResult.action === 'confirm_and_send_pdf' && meetingResult.pdfAttachment) {
            // Save PDF to public directory so Twilio can send it directly to WhatsApp as media
            const publicAgreementsDir = path.join(process.cwd(), 'public', 'agreements');
            if (!fs.existsSync(publicAgreementsDir)) {
              fs.mkdirSync(publicAgreementsDir, { recursive: true });
            }
            const filename = meetingResult.pdfAttachment.filename;
            const filePath = path.join(publicAgreementsDir, filename);
            fs.writeFileSync(filePath, meetingResult.pdfAttachment.content);

            // Public URL for Twilio WhatsApp media delivery (matches current host/tunnel dynamically)
            const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'tomato-contest-creations-dash.trycloudflare.com';
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
Your role: Be helpful, concise, and structured.

${malaysianTime.formattedPromptContext}

${OFFICIAL_ROOM_PROMPT_INSTRUCTION}

TONE & STYLE RULES:
• Use clean, everyday language.
• Keep it concise and neatly structured. Avoid lengthy filler, conversational preamble, or generic sign-offs.
• When presenting rooms, suites, or dining options: list the categories cleanly and concisely with their key specification (e.g. size/view) in a brief bulleted format without long descriptive paragraphs.
• ABSOLUTELY NO EMAIL SIGN-OFFS, NO signatures, NO address, NO phone numbers, NO websites.

BUSINESS KNOWLEDGE:
${knowledgeSnippets || 'No specific document snippet needed.'}

RECENT CONVERSATION HISTORY:
${recentHistory || '(No previous messages)'}

CUSTOMER'S LATEST MESSAGE:
"${incomingText}"

Instructions:
1. If greeting, respond warmly and ask directly how to help.
2. If asking about rooms, suites, dining, or amenities, list the options concisely and comprehensively using clean bullet points.
3. Keep the overall reply compact and easy to read on mobile.

Reply directly to the customer:`;

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

    // Ensure any trailing signoffs are completely stripped
    replyText = stripSignoff(replyText);

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
    return new NextResponse(twimlBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
      },
    });
  } catch (error: any) {
    console.error('[WhatsApp Webhook Error]:', error);
    return new NextResponse(createTwilioXml('Sorry, we encountered an issue processing your request.'), {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
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
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const mediaBlock = mediaUrl ? `\n    <Media>${mediaUrl}</Media>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>
    <Body>${escaped}</Body>${mediaBlock}
  </Message>
</Response>`;
}
