import { NextRequest, NextResponse } from 'next/server';
import { testConnection } from '@/lib/publishing';
import { requireTeamMember } from '@/lib/api/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;

    const connectionId = parseInt(id, 10);
    if (isNaN(connectionId)) {
      return NextResponse.json({ error: 'Invalid connection ID' }, { status: 400 });
    }

    const result = await testConnection(connectionId, teamId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Connection test successful - receiver is online',
      });
    }

    return NextResponse.json({
      success: false,
      error: result.error,
    }, { status: 400 });
  } catch (error: any) {
    console.error('Error testing connection:', error);
    return NextResponse.json(
      { error: 'Failed to test connection' },
      { status: error?.statusCode || 500 }
    );
  }
}
