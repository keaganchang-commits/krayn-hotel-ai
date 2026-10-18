import { NextResponse } from 'next/server';
import { getGmailDrafts } from '@/lib/gmail/inbox';
import { createGmailDraft, deleteGmailDraft } from '@/lib/gmail/send';

// GET /api/gmail/drafts - Fetch list of drafts from Gmail
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const maxResults = parseInt(searchParams.get('maxResults') || '25', 10);
    const pageToken = searchParams.get('pageToken') || undefined;

    const result = await getGmailDrafts(maxResults, pageToken);

    return NextResponse.json({
      success: true,
      drafts: result.drafts,
      nextPageToken: result.nextPageToken,
    });
  } catch (error: any) {
    console.error('Gmail drafts GET API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch Gmail drafts' },
      { status: 500 }
    );
  }
}

// POST /api/gmail/drafts - Create or save a draft to Gmail
export async function POST(request: Request) {
  try {
    const { to, subject, body, threadId, inReplyToMsgId } = await request.json();

    const result = await createGmailDraft({
      to: to || '',
      subject: subject || '',
      body: body || '',
      threadId,
      inReplyToMsgId,
    });

    return NextResponse.json({
      success: true,
      draftId: result.draftId,
      message: 'Draft saved successfully to Gmail.',
    });
  } catch (error: any) {
    console.error('Gmail drafts POST API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save draft' },
      { status: 500 }
    );
  }
}

// DELETE /api/gmail/drafts?id=... - Delete a draft
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const draftId = searchParams.get('id');

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: 'Draft ID is required' },
        { status: 400 }
      );
    }

    await deleteGmailDraft(draftId);

    return NextResponse.json({
      success: true,
      message: 'Draft deleted successfully.',
    });
  } catch (error: any) {
    console.error('Gmail drafts DELETE API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete draft' },
      { status: 500 }
    );
  }
}
