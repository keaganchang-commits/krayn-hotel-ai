import { NextRequest, NextResponse } from 'next/server';
import { listWhatsAppChats, markWhatsAppChatAsRead, saveWhatsAppMessage } from '@/lib/whatsapp/storage';
import twilio from 'twilio';

export async function GET() {
  try {
    const chats = listWhatsAppChats();
    const isConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);

    return NextResponse.json({
      success: true,
      configured: isConfigured,
      twilioNumber: process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886',
      chats,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST: Send outbound manual message from dashboard OR mark chat as read
export async function POST(req: NextRequest) {
  try {
    const { action, to, text } = await req.json();

    if (action === 'mark_read') {
      markWhatsAppChatAsRead(to);
      return NextResponse.json({ success: true });
    }

    if (action === 'send') {
      if (!to || !text) {
        return NextResponse.json({ success: false, error: 'Recipient and text are required.' }, { status: 400 });
      }

      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

      if (accountSid && authToken) {
        const client = twilio(accountSid, authToken);
        const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
        await client.messages.create({
          from: fromNumber,
          to: formattedTo,
          body: text,
        });
      }

      saveWhatsAppMessage({
        from: fromNumber.replace('whatsapp:', ''),
        to: to.replace('whatsapp:', ''),
        senderName: 'You (Staff)',
        text,
        timestamp: new Date().toISOString(),
        direction: 'outbound',
        status: 'sent',
        actionExecuted: 'Manual message sent by staff',
      });

      return NextResponse.json({ success: true, message: 'Message sent successfully.' });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('WhatsApp API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
