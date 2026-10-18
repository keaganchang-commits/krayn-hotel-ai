import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/lib/audit/logger';

export interface CopilotActionPayload {
  scenarioId: string;
  callerName: string;
  actionType: 'calendar_and_proposal' | 'housekeeping_and_crib' | 'dining_and_allergy' | 'spa_booking';
  details: Record<string, any>;
}

export async function POST(request: Request) {
  try {
    const payload: CopilotActionPayload = await request.json();
    const { scenarioId, callerName, actionType, details } = payload;

    const timestamp = new Date().toISOString();
    let actionSummary = '';
    let executedTasks: string[] = [];

    if (actionType === 'spa_booking') {
      actionSummary = `Park Hyatt Spa appointment confirmed for ${callerName}. 60-min Deep Tissue Massage reserved for tomorrow at 3:00 PM (Treatment Suite 4). Folio billed to Suite #${details.roomNumber || '1802'}.`;
      executedTasks = [
        `Spa POS Booking: 60-min Deep Tissue Treatment reserved for 3:00 PM tomorrow`,
        `Assigned Therapist: Senior Spa Therapist (Treatment Suite 4)`,
        `Room Folio Charge Tagged: Suite #${details.roomNumber || '1802'} (RM ${details.price || '480'} + 8% SST)`,
        `Dispatched WhatsApp Spa Booking Confirmation to ${details.phone}`,
        `Calendar Invite & Treatment Preparation Guide dispatched`,
      ];
    } else if (actionType === 'calendar_and_proposal') {
      actionSummary = `Tentative hold booked on Google Calendar for ${details.pax} pax in ${details.venue}. Customized PDF Banquet Proposal sent via WhatsApp & Email to ${callerName}.`;
      executedTasks = [
        `Google Calendar Hold: ${details.venue} (${details.date}, 12:00 PM - 3:30 PM)`,
        `Generated Proposal PDF: ${details.pax} pax × RM ${details.ratePerPax} = RM ${details.totalAmount}`,
        `Dispatched WhatsApp confirmation to ${details.phone}`,
        `Floor plan & Halal banquet set menu attached`,
      ];
    } else if (actionType === 'housekeeping_and_crib') {
      actionSummary = `Baby crib dispatch order routed to Housekeeping for ${callerName}. 2:00 PM late check-out flagged on reservation folio.`;
      executedTasks = [
        `Housekeeping Work Order #HK-8821: Deliver & sanitize complimentary wooden crib to suite`,
        `Reservation Folio Updated: Late check-out requested (2:00 PM target)`,
        `Guest Profile Updated: Baby preference logged for future check-ins`,
        `Confirmation SMS sent to ${details.phone}`,
      ];
    } else if (actionType === 'dining_and_allergy') {
      actionSummary = `Table 14 (Window) confirmed at The Dining Room for ${details.pax} pax on ${details.date}. Executive Chef alerted to severe tree nut allergy.`;
      executedTasks = [
        `Dining Reservation Created: The Dining Room, Table 14 (${details.time})`,
        `Kitchen POS Dietary Tag: SEVERE TREE NUT ALLERGY (Pecan & Walnut)`,
        `Host Stand VIP Alert: Escort upon arrival`,
        `Digital calendar invite sent to ${details.email}`,
      ];
    }

    // Persist to Activity & Audit Logs
    try {
      await logAuditEvent({
        category: 'reply',
        action: 'Autonomous Copilot Execution',
        title: `Live Call Action: ${callerName}`,
        details: actionSummary,
        metadata: {
          scenarioId,
          callerName,
          actionType,
          executedTasks,
          details,
          source: 'live_call_copilot',
        },
      });
    } catch (auditErr) {
      console.warn('Audit log write error:', auditErr);
    }

    return NextResponse.json({
      success: true,
      timestamp,
      summary: actionSummary,
      executedTasks,
    });
  } catch (error: any) {
    console.error('Copilot action error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Action dispatch failed' },
      { status: 500 }
    );
  }
}
