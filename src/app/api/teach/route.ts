import { NextResponse } from 'next/server';
import { teachUserFact } from '@/lib/teaching/store';

export async function POST(request: Request) {
  try {
    const { rule, topic } = await request.json();

    if (!rule || typeof rule !== 'string' || rule.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Rule text is required.' },
        { status: 400 }
      );
    }

    const result = await teachUserFact({ rule: rule.trim(), topic });

    return NextResponse.json({
      success: true,
      message: `Successfully taught Krayn AI new rule: "${result.rule}"`,
      syncedCount: result.syncedCount,
      extractedFacts: result.extractedFacts,
    });
  } catch (error: any) {
    console.error('Teaching API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to record user instruction' },
      { status: 500 }
    );
  }
}
