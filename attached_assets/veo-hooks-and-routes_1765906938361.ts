// React Hook for Veo Video Generation
// Save as: /hooks/useVeoVideo.ts

import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseVeoVideoOptions {
  pollInterval?: number;
  maxWaitTime?: number;
  autoDownload?: boolean;
  onProgress?: (progress: number) => void;
  onError?: (error: Error) => void;
  onComplete?: (videoUrl: string) => void;
}

export interface VeoVideoState {
  isGenerating: boolean;
  isDownloading: boolean;
  progress: number;
  status: string | null;
  videoUrl: string | null;
  videoBlob: Blob | null;
  error: string | null;
  jobName: string | null;
}

export function useVeoVideo(options: UseVeoVideoOptions = {}) {
  const {
    pollInterval = 3000,
    maxWaitTime = 300000,
    autoDownload = false,
    onProgress,
    onError,
    onComplete,
  } = options;

  const [state, setState] = useState<VeoVideoState>({
    isGenerating: false,
    isDownloading: false,
    progress: 0,
    status: null,
    videoUrl: null,
    videoBlob: null,
    error: null,
    jobName: null,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Poll for job status
  const pollJobStatus = useCallback(async (jobName: string) => {
    try {
      const response = await fetch(`/api/veo/status?jobName=${encodeURIComponent(jobName)}`);
      
      if (!response.ok) {
        throw new Error('Failed to check status');
      }

      const data = await response.json();
      
      // Update state
      setState(prev => ({
        ...prev,
        status: data.status,
        progress: data.progress || prev.progress,
        videoUrl: data.videoUrl || prev.videoUrl,
        error: data.error || null,
      }));

      // Call progress callback
      if (onProgress && data.progress) {
        onProgress(data.progress);
      }

      // Handle completion
      if (data.status === 'SUCCEEDED' && data.videoUrl) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        setState(prev => ({
          ...prev,
          isGenerating: false,
          progress: 100,
        }));

        if (onComplete) {
          onComplete(data.videoUrl);
        }

        if (autoDownload) {
          await downloadVideo(data.videoUrl);
        }
        
        return true; // Job completed
      }

      // Handle failure
      if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        const error = new Error(data.error || `Job ${data.status}`);
        
        setState(prev => ({
          ...prev,
          isGenerating: false,
          error: error.message,
        }));

        if (onError) {
          onError(error);
        }
        
        return true; // Job completed (with error)
      }

      // Check timeout
      if (Date.now() - startTimeRef.current > maxWaitTime) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        const error = new Error('Generation timeout');
        
        setState(prev => ({
          ...prev,
          isGenerating: false,
          error: error.message,
        }));

        if (onError) {
          onError(error);
        }
        
        return true; // Job timed out
      }

      return false; // Job still processing
      
    } catch (error: any) {
      console.error('Status check failed:', error);
      
      // Don't stop polling on transient errors
      return false;
    }
  }, [autoDownload, maxWaitTime, onComplete, onError, onProgress]);

  // Generate video
  const generateVideo = useCallback(async (
    prompt: string,
    options?: {
      duration?: number;
      aspectRatio?: '16:9' | '9:16' | '1:1';
      resolution?: '720p' | '1080p' | '4k';
      style?: string;
    }
  ) => {
    // Reset state
    setState({
      isGenerating: true,
      isDownloading: false,
      progress: 0,
      status: 'STARTING',
      videoUrl: null,
      videoBlob: null,
      error: null,
      jobName: null,
    });

    startTimeRef.current = Date.now();

    try {
      // Call generation API
      const response = await fetch('/api/veo/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          ...options,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Generation failed');
      }

      const data = await response.json();
      
      setState(prev => ({
        ...prev,
        jobName: data.jobName,
        status: data.status,
      }));

      // Start polling
      pollIntervalRef.current = setInterval(() => {
        pollJobStatus(data.jobName);
      }, pollInterval);

      // Initial status check
      await pollJobStatus(data.jobName);
      
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: error.message,
      }));

      if (onError) {
        onError(error);
      }
    }
  }, [pollInterval, pollJobStatus, onError]);

  // Download video
  const downloadVideo = useCallback(async (videoUrl?: string) => {
    const url = videoUrl || state.videoUrl;
    
    if (!url) {
      setState(prev => ({
        ...prev,
        error: 'No video URL available',
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      isDownloading: true,
      error: null,
    }));

    try {
      const response = await fetch(`/api/veo/download?videoUrl=${encodeURIComponent(url)}`);
      
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      
      setState(prev => ({
        ...prev,
        isDownloading: false,
        videoBlob: blob,
      }));

      // Trigger browser download
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `veo-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
      
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isDownloading: false,
        error: error.message,
      }));

      if (onError) {
        onError(error);
      }
    }
  }, [state.videoUrl, onError]);

  // Cancel generation
  const cancelGeneration = useCallback(async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (state.jobName) {
      try {
        await fetch(`/api/veo/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jobName: state.jobName,
          }),
        });
      } catch (error) {
        console.error('Failed to cancel job:', error);
      }
    }

    setState(prev => ({
      ...prev,
      isGenerating: false,
      status: 'CANCELLED',
    }));
  }, [state.jobName]);

  // Reset state
  const reset = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setState({
      isGenerating: false,
      isDownloading: false,
      progress: 0,
      status: null,
      videoUrl: null,
      videoBlob: null,
      error: null,
      jobName: null,
    });
  }, []);

  return {
    state,
    generateVideo,
    downloadVideo,
    cancelGeneration,
    reset,
  };
}

// ============================================
// API Route: Generate Video
// Save as: /app/api/veo/generate/route.ts
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getVeoClient } from '@/lib/veo-complete-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request
    if (!body.prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Get client
    const client = getVeoClient();
    
    // Generate video
    const job = await client.generateVideo({
      prompt: body.prompt,
      duration: body.duration || 4,
      aspectRatio: body.aspectRatio || '16:9',
      resolution: body.resolution || '1080p',
      style: body.style,
    });

    return NextResponse.json({
      success: true,
      jobName: job.name,
      status: job.state,
    });
    
  } catch (error: any) {
    console.error('Generation error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to generate video',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// ============================================
// API Route: Check Status
// Save as: /app/api/veo/status/route.ts
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getVeoClient } from '@/lib/veo-complete-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobName = searchParams.get('jobName');
    
    if (!jobName) {
      return NextResponse.json(
        { error: 'Job name is required' },
        { status: 400 }
      );
    }

    // Get client
    const client = getVeoClient();
    
    // Check status
    const job = await client.getJobStatus(jobName);
    
    // Calculate progress
    let progress = 0;
    if (job.metadata?.progressPercent) {
      progress = job.metadata.progressPercent;
    } else if (job.state === 'PROCESSING') {
      progress = 50;
    } else if (job.state === 'SUCCEEDED') {
      progress = 100;
    }

    // Extract video URL
    let videoUrl = null;
    if (job.response?.uri) {
      videoUrl = job.response.uri;
    } else if (job.response && typeof job.response === 'object') {
      videoUrl = (job.response as any).videoUrl || (job.response as any).url;
    }

    return NextResponse.json({
      success: true,
      status: job.state,
      progress,
      videoUrl,
      error: job.error?.message,
    });
    
  } catch (error: any) {
    console.error('Status check error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to check status',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// ============================================
// API Route: Download Video
// Save as: /app/api/veo/download/route.ts
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getVeoClient } from '@/lib/veo-complete-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoUrl = searchParams.get('videoUrl');
    
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 }
      );
    }

    // Get client
    const client = getVeoClient();
    
    // Download video
    const videoBuffer = await client.downloadVideo(videoUrl);
    
    // Return video file
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="veo-video-${Date.now()}.mp4"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
    
  } catch (error: any) {
    console.error('Download error:', error);
    
    // Try direct proxy download as fallback
    try {
      const response = await fetch(searchParams.get('videoUrl')!);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="veo-video-${Date.now()}.mp4"`,
          },
        });
      }
    } catch (proxyError) {
      console.error('Proxy download failed:', proxyError);
    }
    
    return NextResponse.json(
      {
        error: 'Failed to download video',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// ============================================
// API Route: Cancel Job
// Save as: /app/api/veo/cancel/route.ts
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getVeoClient } from '@/lib/veo-complete-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.jobName) {
      return NextResponse.json(
        { error: 'Job name is required' },
        { status: 400 }
      );
    }

    // Get client
    const client = getVeoClient();
    
    // Cancel job
    await client.cancelJob(body.jobName);

    return NextResponse.json({
      success: true,
      message: 'Job cancelled',
    });
    
  } catch (error: any) {
    console.error('Cancel error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to cancel job',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
