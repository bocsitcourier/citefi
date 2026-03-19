import { NextRequest, NextResponse } from 'next/server';
import { testConnection } from '@/lib/google-drive';
import { requireAdmin } from '@/lib/api/auth';

export async function GET(request: NextRequest) {
  try {
    // CRITICAL: Require admin authentication
    await requireAdmin(request);
    
    const isConnected = await testConnection();
    
    if (isConnected) {
      return NextResponse.json({
        success: true,
        message: 'Google Drive connection successful! Podcasts will automatically backup to your folder.',
      });
    } else {
      return NextResponse.json({
        success: false,
        message: 'Google Drive connection failed. Check console logs for details.',
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[Google Drive Test] Error:', error);
    return NextResponse.json({
      success: false,
      message: 'Google Drive test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
