import { NextResponse } from 'next/server';
import { getDiningCalendarConfig, saveDiningCalendarConfig } from '@/lib/calendar/config';
import { getGoogleCalendarClient } from '@/lib/calendar/client';

export async function GET() {
  try {
    const config = getDiningCalendarConfig();
    const clientObj = await getGoogleCalendarClient();

    let calendarConnected = false;
    let authType: string = 'none';
    let calendarName = config.calendarId;

    if (clientObj) {
      try {
        const calInfo = await clientObj.calendar.calendars.get({
          calendarId: config.calendarId,
        });
        calendarConnected = true;
        authType = clientObj.authType;
        calendarName = calInfo.data.summary || config.calendarId;
      } catch (err: any) {
        console.warn('Google Calendar test query warning:', err.message);
        calendarConnected = false;
      }
    }

    return NextResponse.json({
      success: true,
      config,
      status: {
        calendarConnected,
        authType,
        calendarName,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const updated = saveDiningCalendarConfig(body);
    return NextResponse.json({
      success: true,
      config: updated,
      message: 'Dining and Google Calendar settings updated successfully.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
