import { NextResponse } from 'next/server';
import { clearAllKnowledgeData } from '@/lib/gmail/sync_filter';

export async function POST(request: Request) {
  try {
    await clearAllKnowledgeData();
    return NextResponse.json({
      success: true,
      message: 'All past knowledge has been deleted. Krayn AI will now only learn from emails arriving from this moment forward.',
    });
  } catch (error: any) {
    console.error('Reset API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to reset knowledge' },
      { status: 500 }
    );
  }
}
