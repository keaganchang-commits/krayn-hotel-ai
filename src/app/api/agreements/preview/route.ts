import { NextResponse } from 'next/server';
import { generateMeetingAgreementPdf } from '@/lib/meeting/pdfGenerator';

export async function GET() {
  try {
    const pdfBuffer = await generateMeetingAgreementPdf({
      confirmationNumber: 'PKH-MTG-221026',
      clientName: 'Keagan Chang',
      clientEmail: 'keaganchang@gmail.com',
      meetingTitle: 'Executive Business Conference - Keagan Chang',
      roomName: 'Sky Rooms (Level 114)',
      eventDate: 'Thursday, October 22, 2026',
      startTime: '10:00 AM',
      endTime: '12:00 PM',
      durationHours: '2 Hours',
      attendees: 22,
      setupStyle: 'U-Shape Arrangement',
      avEquipment: ['Dual 4K Laser Displays', 'Wireless Video Conferencing'],
      cateringNotes: 'Complimentary Coffee & Tea Station',
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Park_Hyatt_Meeting_Agreement_PKH-MTG-221026.pdf"',
      },
    });
  } catch (error: any) {
    console.error('Error generating preview PDF:', error);
    return NextResponse.json({ error: 'Failed to generate PDF preview' }, { status: 500 });
  }
}
