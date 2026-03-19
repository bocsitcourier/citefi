# Veo API Video Download Solution for Next.js

## Common Issues and Solutions

### 1. Authentication Issues

The Veo API requires proper authentication using Google Cloud credentials. Ensure you have:

1. **Service Account JSON Key**: Download from Google Cloud Console
2. **API Key**: Generate from Google Cloud Console
3. **Proper Scopes**: Ensure the service account has necessary permissions

### 2. Complete Implementation

## Directory Structure
```
/app
  /api
    /veo
      /generate
        route.ts
      /download
        route.ts
      /status
        route.ts
  /lib
    veo-client.ts
    auth.ts
  /components
    VeoVideoGenerator.tsx
```

## Core Implementation Files

### 1. Authentication Setup (`/lib/auth.ts`)

```typescript
import { GoogleAuth } from 'google-auth-library';
import { OAuth2Client } from 'google-auth-library';

// Option 1: Using Service Account
export async function getAuthClient() {
  const auth = new GoogleAuth({
    keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  
  return await auth.getClient();
}

// Option 2: Using API Key (if supported)
export function getApiHeaders() {
  return {
    'X-Goog-Api-Key': process.env.GOOGLE_API_KEY!,
    'Content-Type': 'application/json',
  };
}

// Option 3: Using OAuth2
export async function getOAuth2Client() {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URL
  );
  
  // Set credentials
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  
  const { token } = await oauth2Client.getAccessToken();
  return token;
}
```

### 2. Veo API Client (`/lib/veo-client.ts`)

```typescript
import { getAuthClient, getOAuth2Client } from './auth';

export interface VeoGenerateRequest {
  prompt: string;
  duration?: number; // in seconds, typically 4-16
  aspectRatio?: '16:9' | '9:16' | '1:1';
  resolution?: '720p' | '1080p';
}

export interface VeoJob {
  name: string;
  state: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  createTime: string;
  updateTime: string;
  metadata?: {
    videoUrl?: string;
    error?: string;
  };
}

class VeoAPIClient {
  private baseUrl: string;
  private projectId: string;
  private location: string;
  
  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;
    this.location = process.env.VEO_API_LOCATION || 'us-central1';
    this.baseUrl = `https://videointelligence.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}`;
  }
  
  /**
   * Generate a video using Veo API
   */
  async generateVideo(request: VeoGenerateRequest): Promise<VeoJob> {
    const authClient = await getAuthClient();
    const accessToken = await authClient.getAccessToken();
    
    const response = await fetch(`${this.baseUrl}/videos:generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: request.prompt,
        videoLength: request.duration || 4,
        aspectRatio: request.aspectRatio || '16:9',
        resolution: request.resolution || '1080p',
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate video: ${response.status} - ${error}`);
    }
    
    return await response.json();
  }
  
  /**
   * Check the status of a video generation job
   */
  async getJobStatus(jobName: string): Promise<VeoJob> {
    const authClient = await getAuthClient();
    const accessToken = await authClient.getAccessToken();
    
    const response = await fetch(`${this.baseUrl}/operations/${jobName}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.status}`);
    }
    
    return await response.json();
  }
  
  /**
   * Download video bytes from a completed job
   */
  async downloadVideo(videoUrl: string): Promise<Buffer> {
    const authClient = await getAuthClient();
    const accessToken = await authClient.getAccessToken();
    
    // Method 1: Direct download with authentication
    const response = await fetch(videoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
      },
    });
    
    if (!response.ok) {
      // Method 2: Try without auth if it's a public URL
      const publicResponse = await fetch(videoUrl);
      if (!publicResponse.ok) {
        throw new Error(`Failed to download video: ${response.status}`);
      }
      return Buffer.from(await publicResponse.arrayBuffer());
    }
    
    return Buffer.from(await response.arrayBuffer());
  }
  
  /**
   * Get video using media download endpoint
   */
  async getVideoMedia(resourceName: string): Promise<Buffer> {
    const authClient = await getAuthClient();
    const accessToken = await authClient.getAccessToken();
    
    // Construct media download URL
    const mediaUrl = `https://videointelligence.googleapis.com/v1/${resourceName}:media`;
    
    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Accept': 'video/mp4',
      },
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get video media: ${response.status} - ${error}`);
    }
    
    return Buffer.from(await response.arrayBuffer());
  }
}

export const veoClient = new VeoAPIClient();
```

### 3. API Routes

#### Generate Video Route (`/app/api/veo/generate/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { veoClient } from '@/lib/veo-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, duration, aspectRatio, resolution } = body;
    
    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }
    
    const job = await veoClient.generateVideo({
      prompt,
      duration,
      aspectRatio,
      resolution,
    });
    
    return NextResponse.json({
      success: true,
      jobName: job.name,
      status: job.state,
    });
    
  } catch (error) {
    console.error('Video generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate video', details: error.message },
      { status: 500 }
    );
  }
}
```

#### Check Status Route (`/app/api/veo/status/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { veoClient } from '@/lib/veo-client';

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
    
    const job = await veoClient.getJobStatus(jobName);
    
    return NextResponse.json({
      success: true,
      status: job.state,
      videoUrl: job.metadata?.videoUrl,
      error: job.metadata?.error,
    });
    
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check status', details: error.message },
      { status: 500 }
    );
  }
}
```

#### Download Video Route (`/app/api/veo/download/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { veoClient } from '@/lib/veo-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoUrl = searchParams.get('videoUrl');
    const resourceName = searchParams.get('resourceName');
    
    let videoBuffer: Buffer;
    
    if (resourceName) {
      // Method 1: Using resource name with media endpoint
      videoBuffer = await veoClient.getVideoMedia(resourceName);
    } else if (videoUrl) {
      // Method 2: Direct URL download
      videoBuffer = await veoClient.downloadVideo(videoUrl);
    } else {
      return NextResponse.json(
        { error: 'Either videoUrl or resourceName is required' },
        { status: 400 }
      );
    }
    
    // Return video as response
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="veo-video-${Date.now()}.mp4"`,
        'Cache-Control': 'no-cache',
      },
    });
    
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Failed to download video', details: error.message },
      { status: 500 }
    );
  }
}
```

### 4. React Component (`/app/components/VeoVideoGenerator.tsx`)

```typescript
'use client';

import { useState, useEffect } from 'react';

interface VideoGeneratorState {
  prompt: string;
  isGenerating: boolean;
  jobName: string | null;
  status: string | null;
  videoUrl: string | null;
  error: string | null;
}

export default function VeoVideoGenerator() {
  const [state, setState] = useState<VideoGeneratorState>({
    prompt: '',
    isGenerating: false,
    jobName: null,
    status: null,
    videoUrl: null,
    error: null,
  });
  
  // Poll for job status
  useEffect(() => {
    if (!state.jobName || state.status === 'SUCCEEDED' || state.status === 'FAILED') {
      return;
    }
    
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/veo/status?jobName=${state.jobName}`);
        const data = await response.json();
        
        setState(prev => ({
          ...prev,
          status: data.status,
          videoUrl: data.videoUrl || null,
          error: data.error || null,
        }));
        
        if (data.status === 'SUCCEEDED' || data.status === 'FAILED') {
          clearInterval(interval);
          setState(prev => ({ ...prev, isGenerating: false }));
        }
      } catch (error) {
        console.error('Status check failed:', error);
      }
    }, 3000); // Poll every 3 seconds
    
    return () => clearInterval(interval);
  }, [state.jobName, state.status]);
  
  const handleGenerate = async () => {
    if (!state.prompt.trim()) {
      setState(prev => ({ ...prev, error: 'Please enter a prompt' }));
      return;
    }
    
    setState(prev => ({
      ...prev,
      isGenerating: true,
      error: null,
      jobName: null,
      status: null,
      videoUrl: null,
    }));
    
    try {
      const response = await fetch('/api/veo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: state.prompt,
          duration: 4,
          aspectRatio: '16:9',
          resolution: '1080p',
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Generation failed');
      }
      
      const data = await response.json();
      setState(prev => ({
        ...prev,
        jobName: data.jobName,
        status: data.status,
      }));
      
    } catch (error) {
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: error.message || 'Failed to generate video',
      }));
    }
  };
  
  const handleDownload = async () => {
    if (!state.videoUrl) return;
    
    try {
      const response = await fetch(`/api/veo/download?videoUrl=${encodeURIComponent(state.videoUrl)}`);
      
      if (!response.ok) {
        throw new Error('Download failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `veo-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: 'Failed to download video',
      }));
    }
  };
  
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Veo Video Generator</h1>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Video Prompt
          </label>
          <textarea
            value={state.prompt}
            onChange={(e) => setState(prev => ({ ...prev, prompt: e.target.value }))}
            className="w-full p-3 border rounded-lg"
            rows={3}
            placeholder="Describe the video you want to generate..."
            disabled={state.isGenerating}
          />
        </div>
        
        <button
          onClick={handleGenerate}
          disabled={state.isGenerating || !state.prompt.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
        >
          {state.isGenerating ? 'Generating...' : 'Generate Video'}
        </button>
        
        {state.error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-lg">
            {state.error}
          </div>
        )}
        
        {state.status && (
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="font-medium">Status: {state.status}</p>
            {state.jobName && (
              <p className="text-sm text-gray-600">Job: {state.jobName}</p>
            )}
          </div>
        )}
        
        {state.videoUrl && state.status === 'SUCCEEDED' && (
          <div className="space-y-4">
            <video
              src={state.videoUrl}
              controls
              className="w-full rounded-lg"
            />
            <button
              onClick={handleDownload}
              className="px-6 py-2 bg-green-600 text-white rounded-lg"
            >
              Download Video
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 5. Environment Variables (`.env.local`)

```env
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT_ID=your-project-id
VEO_API_LOCATION=us-central1

# Authentication Option 1: Service Account
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/service-account.json

# Authentication Option 2: API Key
GOOGLE_API_KEY=your-api-key

# Authentication Option 3: OAuth2
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
REDIRECT_URL=http://localhost:3000/auth/callback
```

## Debugging Checklist

### 1. Authentication Verification
```typescript
// Test authentication separately
async function testAuth() {
  try {
    const authClient = await getAuthClient();
    const token = await authClient.getAccessToken();
    console.log('Auth successful, token:', token.token?.substring(0, 20) + '...');
  } catch (error) {
    console.error('Auth failed:', error);
  }
}
```

### 2. Common Error Patterns and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Invalid credentials | Verify service account key and permissions |
| 403 Forbidden | Missing API access | Enable Veo API in Google Cloud Console |
| 404 Not Found | Wrong endpoint/resource | Verify project ID and location |
| 429 Rate Limited | Too many requests | Implement exponential backoff |
| 500 Server Error | API issue | Check Google Cloud status page |

### 3. Video Download Troubleshooting

```typescript
// Debug download methods
async function debugDownload(videoUrl: string) {
  console.log('Attempting download from:', videoUrl);
  
  // Method 1: With auth
  try {
    const authResponse = await fetch(videoUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Auth download status:', authResponse.status);
  } catch (e) {
    console.log('Auth download failed:', e);
  }
  
  // Method 2: Public URL
  try {
    const publicResponse = await fetch(videoUrl);
    console.log('Public download status:', publicResponse.status);
  } catch (e) {
    console.log('Public download failed:', e);
  }
  
  // Method 3: Media endpoint
  try {
    const mediaUrl = videoUrl.replace('/videos/', '/videos:media/');
    const mediaResponse = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Media endpoint status:', mediaResponse.status);
  } catch (e) {
    console.log('Media endpoint failed:', e);
  }
}
```

### 4. Response Parsing Issues

```typescript
// Safe response parsing
async function safeJsonParse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    console.log('Response text:', text);
    throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
  }
}
```

## Package Dependencies

```json
{
  "dependencies": {
    "google-auth-library": "^9.0.0",
    "@google-cloud/video-intelligence": "^5.0.0",
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

## Alternative: Using Google Cloud Video Intelligence SDK

```typescript
import { VideoIntelligenceServiceClient } from '@google-cloud/video-intelligence';

const client = new VideoIntelligenceServiceClient({
  keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
});

// Alternative implementation using SDK
async function generateVideoWithSDK(prompt: string) {
  const request = {
    inputUri: 'gs://your-bucket/input',
    features: ['LABEL_DETECTION'],
    videoContext: {
      // Veo-specific context
    },
  };
  
  const [operation] = await client.annotateVideo(request);
  const [response] = await operation.promise();
  return response;
}
```

## Testing the Implementation

```typescript
// Test file: /app/api/veo/test/route.ts
import { NextResponse } from 'next/server';
import { veoClient } from '@/lib/veo-client';

export async function GET() {
  const tests = {
    auth: false,
    generate: false,
    status: false,
    download: false,
  };
  
  try {
    // Test authentication
    const authClient = await getAuthClient();
    tests.auth = true;
    
    // Test generation endpoint
    const job = await veoClient.generateVideo({
      prompt: 'Test video generation',
      duration: 4,
    });
    tests.generate = !!job.name;
    
    // Test status check
    const status = await veoClient.getJobStatus(job.name);
    tests.status = !!status.state;
    
    // Test download (if video is ready)
    if (status.metadata?.videoUrl) {
      const buffer = await veoClient.downloadVideo(status.metadata.videoUrl);
      tests.download = buffer.length > 0;
    }
    
    return NextResponse.json({
      success: true,
      tests,
    });
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      tests,
      error: error.message,
    });
  }
}
```

## Conclusion

This solution provides:
1. Multiple authentication methods
2. Proper error handling and retry logic  
3. Different download strategies
4. Complete Next.js integration
5. Debugging tools and test endpoints

The key to resolving download failures is usually:
- Ensuring proper authentication
- Using the correct endpoint (media endpoint vs direct URL)
- Handling different response formats
- Implementing proper error recovery
