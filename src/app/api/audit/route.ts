import { NextResponse } from 'next/server';
import { getAuditLogs, AuditLogCategory } from '@/lib/audit/logger';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = (searchParams.get('category') || 'all') as AuditLogCategory | 'all';
    const search = searchParams.get('search') || '';
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const logs = getAuditLogs({
      category,
      search,
      limit,
    });

    return NextResponse.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
