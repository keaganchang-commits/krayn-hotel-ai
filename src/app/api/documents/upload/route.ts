import { NextResponse } from 'next/server';
import { processPdfDocument } from '@/lib/documents/pdf';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No PDF file provided.' },
        { status: 400 }
      );
    }

    if (!file.name.endsWith('.pdf')) {
      return NextResponse.json(
        { success: false, error: 'File must be a .pdf document.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await processPdfDocument(buffer, file.name);

    // Trigger background clarification pregenerator to immediately weave newly learned facts into follow-up questions
    import('@/lib/clarify/pregenerator')
      .then(m => m.runBackgroundClarificationPreGenerator())
      .catch(e => console.warn('Pregenerator trigger after PDF upload error:', e));

    return NextResponse.json({
      success: true,
      message: `Indexed ${result.syncedCount} rules from ${result.title} & generated clarification questions.`,
      syncedCount: result.syncedCount,
      fileName: result.title,
    });
  } catch (error: any) {
    console.error('PDF upload API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process PDF file' },
      { status: 500 }
    );
  }
}
