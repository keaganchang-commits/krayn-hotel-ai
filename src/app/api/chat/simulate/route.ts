import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { vectorStore } from '@/lib/vector/store';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { processDiningBooking } from '@/lib/calendar/agent';
import { processMeetingBooking } from '@/lib/meeting/agent';
import { queryRAGAnswer } from '@/lib/ai/rag';
import { listBusinessAssets } from '@/lib/assets/storage';
import { inferClarificationInputType, isValidClarificationQuestion } from '@/lib/clarify/seedQuestions';
import { getMalaysianDateTime } from '@/lib/utils/dateTime';
import { OFFICIAL_ROOM_PROMPT_INSTRUCTION } from '@/lib/hotel/rooms';

// Strips formal signoffs for WhatsApp
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

function isMeetingIntent(text: string): boolean {
  const t = text.toLowerCase();
  // If user is inquiring about guest bedrooms, staying, sleeping, rates for stay
  const isGuestStay = /\b(bedroom|bedrooms|guest room|guest rooms|suite|suites|king room|twin room|deluxe room|room rate|room rates|room price|room prices|stay|check-in|check in|checkout|check out|night|nights|accommodat)\b/i.test(t);
  if (isGuestStay) return false;

  const meetingKeywords = [
    'meeting', 'meetings', 'conference', 'boardroom', 'event room', 'function room',
    'executive salon', 'sky room', 'skyroom', 'seminar',
    'presentation room', 'meeting room', 'meeting space'
  ];
  return meetingKeywords.some(kw => t.includes(kw));
}

function isDiningIntent(text: string): boolean {
  const t = text.toLowerCase();
  const diningKeywords = [
    'table', 'reserve', 'reservation', 'dinner', 'lunch',
    'breakfast', 'merdeka grill', 'park lounge', 'cacao', 'dine', 'dining',
    'eat', 'restaurant'
  ];
  return diningKeywords.some(kw => t.includes(kw));
}

export async function POST(request: Request) {
  try {
    const {
      channel = 'whatsapp',
      message,
      senderName = 'Guest',
      senderEmail = 'guest@example.com',
      senderPhone = '+60123456789',
      subject = 'General Inquiry',
      history = []
    } = await request.json();

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Message text is required.' },
        { status: 400 }
      );
    }

    const trimmedMessage = message.trim();
    const isWhatsApp = channel === 'whatsapp';

    // ----------------------------------------------------
    // WHATSAPP CHANNEL SIMULATION
    // (Matches exact production logic from /api/whatsapp/webhook)
    // ----------------------------------------------------
    if (isWhatsApp) {
      let replyText = '';
      let actionExecuted: string | undefined;
      let ragConfidence = 95;
      let mediaUrl: string | undefined;
      let mediaFilename: string | undefined;

      const recentHistoryStr = (history || [])
        .slice(-6)
        .map((m: any) => `${m.sender === 'user' ? 'Customer' : 'Assistant'}: ${m.text}`)
        .join('\n');

      const fullContext = recentHistoryStr
        ? `${recentHistoryStr}\nCustomer: ${trimmedMessage}`
        : trimmedMessage;
      const fullContextLower = fullContext.toLowerCase();

      const isGreeting = /^(hi|hello|hey|good\s*(morning|afternoon|evening)|halo|assalamualaikum|hai)[!.,\s]*$/i.test(trimmedMessage);

      // 1. WhatsApp Meeting Room Agent (only if incoming user message has meeting intent, not on simple greetings)
      if (!isGreeting && isMeetingIntent(trimmedMessage)) {
        try {
          const meetingResult = await processMeetingBooking(
            fullContext,
            `${senderPhone}@whatsapp`,
            'WhatsApp Meeting Room Booking'
          );
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

              mediaUrl = `/agreements/${filename}`;
              mediaFilename = filename;
              actionExecuted = `Scheduled on Google Calendar & Attached PDF Agreement (${filename})`;
            } else if (meetingResult.action === 'ask_details') {
              actionExecuted = 'Inquired for meeting specifications & attendee count';
            }
          }
        } catch (mErr) {
          console.warn('[WhatsApp Sim Meeting Error]:', mErr);
        }
      }

      // 2. WhatsApp Dining Reservation Agent (only if incoming user message has dining intent, not on simple greetings)
      if (!replyText && !isGreeting && isDiningIntent(trimmedMessage)) {
        try {
          const diningResult = await processDiningBooking(
            fullContext,
            `${senderPhone}@whatsapp`,
            'WhatsApp Dining Inquiry'
          );
          if (diningResult.handled && diningResult.replyMessage) {
            replyText = stripSignoff(diningResult.replyMessage);
            if (diningResult.action === 'confirmed') {
              actionExecuted = 'Confirmed & locked in dining table on Google Calendar';
            } else if (diningResult.action === 'ask_restaurant') {
              actionExecuted = 'Inquired for preferred restaurant venue';
            }
          }
        } catch (dErr) {
          console.warn('[WhatsApp Sim Dining Error]:', dErr);
        }
      }

      // 3. WhatsApp Concierge AI with Hotel Knowledge
      if (!replyText) {
        const ai = getGeminiClient();
        const isGreetingOnly = /^(hi|hello|hey|good\s*(morning|afternoon|evening)|halo|assalamualaikum|hai)[!.,\s]*$/i.test(trimmedMessage);

        let knowledgeSnippets = '';
        let citations: any[] = [];
        if (!isGreetingOnly) {
          try {
            const ragResult = await queryRAGAnswer(trimmedMessage);
            ragConfidence = ragResult.confidenceScore;
            citations = ragResult.citations || [];
            knowledgeSnippets = citations.map(c => `• ${c.title}: ${c.snippet}`).join('\n');
          } catch (ragErr) {
            console.warn('[WhatsApp Sim RAG Error]:', ragErr);
          }
        }

        if (ai) {
          const malaysianTime = getMalaysianDateTime();
          const dynamicPrompt = `You represent Park Hyatt Kuala Lumpur directly on WhatsApp.
Your role: Be helpful, concise, and structured.

${malaysianTime.formattedPromptContext}

${OFFICIAL_ROOM_PROMPT_INSTRUCTION}

TONE & STYLE RULES:
• Never refer to yourself as an AI, bot, agent, or autonomous assistant.
• Never ask "How can I assist you with dining, rooms, food, etc.". Simply say "How can I help you?".
• Use clean, everyday language.
• Keep it concise and neatly structured. Avoid lengthy filler, conversational preamble, or generic sign-offs.
• When presenting rooms, suites, or dining options: list the categories cleanly and concisely with their key specification (e.g. size/view) in a brief bulleted format without long descriptive paragraphs.
• ABSOLUTELY NO EMAIL SIGN-OFFS, NO signatures, NO address, NO phone numbers, NO websites.

BUSINESS KNOWLEDGE:
${knowledgeSnippets || 'No specific document snippet needed.'}

RECENT CONVERSATION HISTORY:
${recentHistoryStr || '(No previous messages)'}

CUSTOMER'S LATEST MESSAGE:
"${trimmedMessage}"

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
                actionExecuted = `Answered via AI Concierge (${ragConfidence}% knowledge match)`;
                break;
              }
            } catch (mErr) {
              // fallback to next model
            }
          }
        }

        if (!replyText) {
          replyText = "Hello! Welcome to Park Hyatt Kuala Lumpur. How can I help you?";
          actionExecuted = 'Standard concierge greeting';
        }

        return NextResponse.json({
          success: true,
          channel: 'whatsapp',
          replyText,
          actionExecuted,
          ragConfidence,
          mediaUrl,
          mediaFilename,
          citations,
          status: 'answered'
        });
      }

      return NextResponse.json({
        success: true,
        channel: 'whatsapp',
        replyText,
        actionExecuted,
        ragConfidence: 100,
        mediaUrl,
        mediaFilename,
        citations: [],
        status: 'answered'
      });
    }

    // ----------------------------------------------------
    // EMAIL CHANNEL SIMULATION
    // (Matches exact production logic from /api/gmail/autoreply & /api/ai/draft)
    // ----------------------------------------------------
    const emailSubject = subject || 'Inquiry regarding Park Hyatt Kuala Lumpur';
    let emailReplyBody = '';
    let emailReplySubject = emailSubject.startsWith('Re:') ? emailSubject : `Re: ${emailSubject}`;
    let actionExecuted: string | undefined;
    let confidenceScore = 90;
    let attachedAssets: any[] = [];
    let isUncertain = false;
    let queuedToClarifications = false;
    let clarificationQuestion = '';
    let citations: any[] = [];

    const rawSender = senderName?.trim();
    const isValidSenderName = rawSender && !rawSender.includes('@') && !/^\+?\d+$/.test(rawSender);
    const guestGreetingName = isValidSenderName ? rawSender : 'Guest';

    // 1. Meeting Room Check for Email (only if meeting intent detected, NOT for guest room/stay inquiries)
    if (isMeetingIntent(trimmedMessage) || isMeetingIntent(emailSubject)) {
      try {
        const meetingResult = await processMeetingBooking(trimmedMessage, senderEmail, emailSubject);
        if (meetingResult.handled && meetingResult.replyMessage) {
          emailReplyBody = meetingResult.replyMessage;
          if (meetingResult.pdfAttachment) {
            const publicAgreementsDir = path.join(process.cwd(), 'public', 'agreements');
            if (!fs.existsSync(publicAgreementsDir)) {
              fs.mkdirSync(publicAgreementsDir, { recursive: true });
            }
            const filename = meetingResult.pdfAttachment.filename;
            const filePath = path.join(publicAgreementsDir, filename);
            fs.writeFileSync(filePath, meetingResult.pdfAttachment.content);

            attachedAssets.push({
              id: 'agreement_pdf',
              name: filename,
              filename,
              mimeType: 'application/pdf',
              url: `/agreements/${filename}`
            });
            actionExecuted = `Drafted formal meeting confirmation, scheduled on calendar & attached PDF Agreement (${filename})`;
          } else {
            actionExecuted = 'Requested meeting specifications & event requirements';
          }
          confidenceScore = 100;
        }
      } catch (mErr) {
        console.warn('[Email Sim Meeting Check Error]:', mErr);
      }
    }

    // 2. Dining Check for Email
    if (!emailReplyBody) {
      try {
        const diningResult = await processDiningBooking(trimmedMessage, senderEmail, emailSubject);
        if (diningResult.handled && diningResult.replyMessage) {
          emailReplyBody = diningResult.replyMessage;
          if (diningResult.action === 'confirmed') {
            actionExecuted = 'Confirmed table & scheduled on Google Calendar';
          } else if (diningResult.action === 'ask_restaurant') {
            actionExecuted = 'Clarifying restaurant venue with guest';
          }
          confidenceScore = 100;
        }
      } catch (dErr) {
        console.warn('[Email Sim Dining Check Error]:', dErr);
      }
    }

    // 3. Multi-Question RAG Pipeline for Email
    if (!emailReplyBody) {
      const ragResult = await queryRAGAnswer(trimmedMessage);
      confidenceScore = ragResult.confidenceScore;
      citations = ragResult.citations || [];

      // Check attached assets
      if (ragResult.attachedAssetIds && ragResult.attachedAssetIds.length > 0) {
        const allAssets = listBusinessAssets();
        for (const assetId of ragResult.attachedAssetIds) {
          const match = allAssets.find(a => a.id === assetId);
          if (match) {
            attachedAssets.push({
              id: match.id,
              name: match.name,
              filename: match.filename,
              mimeType: match.mimeType,
              url: `/api/assets/file?id=${encodeURIComponent(match.id)}`
            });
          }
        }
      }

      if (ragResult.isUncertain || confidenceScore < 80 || !ragResult.allQuestionsAnswered) {
        clarificationQuestion = ragResult.clarificationQuestion || trimmedMessage;
        const isLegitQuestion = isValidClarificationQuestion(clarificationQuestion, trimmedMessage);

        if (isLegitQuestion) {
          isUncertain = true;
          queuedToClarifications = true;

          // Route to clarifications hub
          const inferred = inferClarificationInputType(clarificationQuestion, 'options');
          await vectorStore.addChunk({
            text: `PROACTIVE CLARIFICATION NEEDED for email inquiry: ${clarificationQuestion}`,
            source: 'clarification',
            title: 'Email Customer Inquiry',
            timestamp: new Date().toISOString(),
            metadata: {
              question: clarificationQuestion,
              options: ragResult.clarificationOptions || ['Confirm policy', 'Not applicable'],
              inputType: inferred.inputType || 'options',
              priorityScore: 92,
              sourceType: 'email_simulation',
              originalCustomerQuery: trimmedMessage,
            },
          });

          const SIGN_OFF = `Warm regards,\nPark Hyatt Kuala Lumpur\nMenara Merdeka Maybank, 50118 Kuala Lumpur\nTel: +60 3 2333 1234 | kualalumpur.park@hyatt.com\nwww.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur`;
          emailReplyBody = `Dear ${guestGreetingName},\n\nThank you for reaching out to Park Hyatt Kuala Lumpur.\n\nWe have received your inquiry regarding this request and our guest relations team is confirming the exact arrangements for you. We will follow up with full details shortly.\n\nPlease let us know if you have any additional preferences in the meantime.\n\n${SIGN_OFF}`;
          actionExecuted = 'Confidence below autonomous threshold (<80%) — Routed question to Clarifications Hub';
        } else {
          // It is a greeting or general pleasantry — do not route to clarifications!
          isUncertain = false;
          queuedToClarifications = false;
          const SIGN_OFF = `Warm regards,\nPark Hyatt Kuala Lumpur\nMenara Merdeka Maybank, 50118 Kuala Lumpur\nTel: +60 3 2333 1234 | kualalumpur.park@hyatt.com\nwww.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur`;
          emailReplyBody = `Dear ${guestGreetingName},\n\nThank you for reaching out to Park Hyatt Kuala Lumpur. How can I help you?\n\n${SIGN_OFF}`;
          actionExecuted = 'Welcomed guest warmly via email';
        }
      } else {
        emailReplyBody = ragResult.answer;
        actionExecuted = `Autonomous email reply approved & generated (${confidenceScore}% confidence)`;
      }
    }

    return NextResponse.json({
      success: true,
      channel: 'email',
      subject: emailReplySubject,
      replyText: emailReplyBody,
      actionExecuted,
      confidenceScore,
      attachedAssets,
      isUncertain,
      queuedToClarifications,
      clarificationQuestion,
      citations,
      status: isUncertain ? 'unanswered' : 'answered'
    });
  } catch (error: any) {
    console.error('[Simulate API Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Simulation error' },
      { status: 500 }
    );
  }
}
