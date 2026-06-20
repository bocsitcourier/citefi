import { NextRequest, NextResponse } from 'next/server';
import { 
  getConnectionById, 
  deleteConnection,
  testConnection
} from '@/lib/publishing';
import { requireTeamMember } from '@/lib/api/auth';

export async function GET(
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

    const connection = await getConnectionById(connectionId, teamId);
    
    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...connection,
        apiKeyHash: undefined,
      },
    });
  } catch (error: any) {
    console.error('Error fetching connection:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connection' },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function DELETE(
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

    await deleteConnection(connectionId, teamId);

    return NextResponse.json({
      success: true,
      message: 'Connection deleted',
    });
  } catch (error: any) {
    console.error('Error deleting connection:', error);
    return NextResponse.json(
      { error: 'Failed to delete connection' },
      { status: error?.statusCode || 500 }
    );
  }
}
