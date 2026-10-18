import { NextResponse } from 'next/server';
import { sendManualEmail } from '@/lib/gmail/send';

export async function POST(request: Request) {
  try {
    const { to, subject, body, threadId, inReplyToMsgId } = await request.json();

    if (!to || !subject || !body) {
      return NextResponse.json(
        { success: false, error: 'Recipient (to), subject, and body are required.' },
        { status: 400 }
      );
    }

    const result = await sendManualEmail({
      to,
      subject,
      body,
      threadId,
      inReplyToMsgId,
    });

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      message: 'Email sent successfully via Gmail!',
    });
  } catch (error: any) {
    console.error('Failed to send manual email:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}
