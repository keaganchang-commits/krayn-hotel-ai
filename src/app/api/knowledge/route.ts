import { NextResponse } from 'next/server';
import { vectorStore } from '@/lib/vector/store';

// GET /api/knowledge - List all knowledge items with filtering & search
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'all';
    const search = searchParams.get('search') || '';

    // Run deduplication asynchronously in background without blocking instant read response
    import('@/lib/knowledge/deduplicator')
      .then(m => m.deduplicateKnowledgeHub())
      .catch(e => console.warn('Deduplication on fetch error:', e));

    let items = await vectorStore.listItems(source, search);

    // Knowledge Hub should only contain confirmed knowledge, never open/unanswered clarification questions or audit logs
    items = items.filter(item => {
      if (item.source === 'clarification') return false;
      if (item.metadata?.isAuditLog) return false;
      if (item.title?.startsWith('Audit:')) return false;
      if (item.text?.trim().startsWith('[AUDIT')) return false;
      return true;
    });

    return NextResponse.json({
      success: true,
      count: items.length,
      items,
      _debug: {
        cwd: process.cwd(),
        hasStoreDir: require('fs').existsSync(require('path').join(process.cwd(), '.knowledge_store')),
        hasStoreIndex: require('fs').existsSync(require('path').join(process.cwd(), '.knowledge_store', 'index.json')),
      }
    });
  } catch (error: any) {
    console.error('Knowledge GET error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch knowledge items', stack: error.stack },
      { status: 500 }
    );
  }
}

// DELETE /api/knowledge?id=ITEM_ID - Delete specific knowledge item
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Item ID is required for deletion.' },
        { status: 400 }
      );
    }

    await vectorStore.deleteItem(id);

    return NextResponse.json({
      success: true,
      message: `Successfully deleted knowledge item: ${id}`,
    });
  } catch (error: any) {
    console.error('Knowledge DELETE error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete item' },
      { status: 500 }
    );
  }
}

// PUT /api/knowledge - Edit an existing knowledge item
export async function PUT(request: Request) {
  try {
    const { id, text, title, topic } = await request.json();

    if (!id || !text || typeof text !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Item ID and updated text are required.' },
        { status: 400 }
      );
    }

    await vectorStore.updateItem(id, text.trim(), title?.trim(), topic?.trim());

    return NextResponse.json({
      success: true,
      message: 'Knowledge item updated and vector embedding regenerated successfully.',
    });
  } catch (error: any) {
    console.error('Knowledge PUT error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update item' },
      { status: 500 }
    );
  }
}
