import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { 
  getConnectionsForTeam, 
  createConnection 
} from '@/lib/publishing';
import { requireTeamMember } from '@/lib/api/auth';

const createConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  channel: z.enum(['website', 'facebook', 'linkedin', 'tiktok']),
  baseUrl: z.string().url().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const connections = await getConnectionsForTeam(teamId);
    
    const safeConnections = connections.map(conn => ({
      ...conn,
      apiKeyHash: undefined,
    }));

    return NextResponse.json({ 
      success: true, 
      data: safeConnections 
    });
  } catch (error) {
    console.error('Error fetching connections:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connections' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const parsed = createConnectionSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { name, channel, baseUrl } = parsed.data;

    if (channel === 'website' && !baseUrl) {
      return NextResponse.json(
        { error: 'Base URL is required for website connections' },
        { status: 400 }
      );
    }

    const { connection, apiKey } = await createConnection(teamId, {
      name,
      channel,
      baseUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        connection: {
          ...connection,
          apiKeyHash: undefined,
        },
        apiKey,
      },
      message: apiKey 
        ? 'Connection created. Save the API key - it will only be shown once!'
        : 'Connection created',
    });
  } catch (error) {
    console.error('Error creating connection:', error);
    return NextResponse.json(
      { error: 'Failed to create connection' },
      { status: 500 }
    );
  }
}
