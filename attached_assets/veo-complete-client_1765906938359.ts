// Complete Veo API Client Implementation for Next.js
// Save as: /lib/veo-complete-client.ts

import { GoogleAuth, OAuth2Client } from 'google-auth-library';

// ============================================
// Types and Interfaces
// ============================================

export interface VeoConfig {
  projectId: string;
  location: string;
  authMethod: 'service-account' | 'oauth2' | 'api-key';
}

export interface VeoGenerateRequest {
  prompt: string;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3';
  resolution?: '720p' | '1080p' | '4k';
  style?: string;
  seed?: number;
}

export interface VeoJob {
  name: string;
  state: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  createTime: string;
  updateTime: string;
  done: boolean;
  error?: {
    code: number;
    message: string;
    details: any[];
  };
  response?: {
    name: string;
    uri: string;
    state: string;
  };
  metadata?: {
    '@type': string;
    progressPercent?: number;
    startTime?: string;
    updateTime?: string;
  };
}

export interface VeoVideo {
  name: string;
  uri: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  createTime: string;
}

// ============================================
// Authentication Manager
// ============================================

class AuthManager {
  private googleAuth?: GoogleAuth;
  private oauth2Client?: OAuth2Client;
  private apiKey?: string;
  private cachedToken?: { token: string; expiry: number };

  constructor(private config: VeoConfig) {
    this.initializeAuth();
  }

  private initializeAuth() {
    switch (this.config.authMethod) {
      case 'service-account':
        this.googleAuth = new GoogleAuth({
          keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        break;
      
      case 'oauth2':
        this.oauth2Client = new OAuth2Client(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.REDIRECT_URL
        );
        if (process.env.GOOGLE_REFRESH_TOKEN) {
          this.oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
          });
        }
        break;
      
      case 'api-key':
        this.apiKey = process.env.GOOGLE_API_KEY;
        break;
    }
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.config.authMethod === 'api-key' && this.apiKey) {
      return {
        'X-Goog-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      };
    }

    // Check cached token
    if (this.cachedToken && this.cachedToken.expiry > Date.now()) {
      return {
        'Authorization': `Bearer ${this.cachedToken.token}`,
        'Content-Type': 'application/json',
      };
    }

    // Get new token
    let token: string | null = null;
    let expiry = Date.now() + 3600000; // 1 hour default

    if (this.googleAuth) {
      const client = await this.googleAuth.getClient();
      const accessToken = await client.getAccessToken();
      token = accessToken.token;
      if (accessToken.res?.data?.expiry_date) {
        expiry = accessToken.res.data.expiry_date;
      }
    } else if (this.oauth2Client) {
      const { token: accessToken } = await this.oauth2Client.getAccessToken();
      token = accessToken;
    }

    if (!token) {
      throw new Error('Failed to obtain authentication token');
    }

    // Cache token
    this.cachedToken = { token, expiry };

    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
}

// ============================================
// Main Veo API Client
// ============================================

export class VeoAPIClient {
  private authManager: AuthManager;
  private baseUrl: string;
  private config: VeoConfig;

  constructor(config?: Partial<VeoConfig>) {
    this.config = {
      projectId: config?.projectId || process.env.GOOGLE_CLOUD_PROJECT_ID || '',
      location: config?.location || process.env.VEO_API_LOCATION || 'us-central1',
      authMethod: config?.authMethod || 'service-account',
    };

    this.authManager = new AuthManager(this.config);
    
    // Veo API base URL
    this.baseUrl = `https://aiplatform.googleapis.com/v1/projects/${this.config.projectId}/locations/${this.config.location}`;
  }

  /**
   * Generate a video using Veo API
   */
  async generateVideo(request: VeoGenerateRequest): Promise<VeoJob> {
    const headers = await this.authManager.getAuthHeaders();
    
    const payload = {
      instances: [{
        prompt: request.prompt,
      }],
      parameters: {
        sampleCount: 1,
        duration: request.duration || 4,
        aspectRatio: request.aspectRatio || '16:9',
        resolution: request.resolution || '1080p',
        ...(request.style && { style: request.style }),
        ...(request.seed && { seed: request.seed }),
      },
    };

    const response = await fetch(
      `${this.baseUrl}/publishers/google/models/veo:predict`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Generation failed:', errorText);
      throw new Error(`Failed to generate video: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // The response contains the operation name
    if (result.name) {
      return this.parseOperationResponse(result);
    }
    
    // Alternative response format
    if (result.predictions && result.predictions[0]) {
      return {
        name: result.predictions[0].name || `operation-${Date.now()}`,
        state: 'PROCESSING',
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        done: false,
        response: result.predictions[0],
      };
    }

    throw new Error('Unexpected response format from Veo API');
  }

  /**
   * Get the status of a video generation job
   */
  async getJobStatus(operationName: string): Promise<VeoJob> {
    const headers = await this.authManager.getAuthHeaders();
    
    // Handle both full paths and operation IDs
    const operationPath = operationName.startsWith('projects/')
      ? operationName
      : `projects/${this.config.projectId}/locations/${this.config.location}/operations/${operationName}`;

    const response = await fetch(
      `https://aiplatform.googleapis.com/v1/${operationPath}`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get job status: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return this.parseOperationResponse(result);
  }

  /**
   * Parse operation response to standard format
   */
  private parseOperationResponse(response: any): VeoJob {
    return {
      name: response.name,
      state: this.mapOperationState(response),
      createTime: response.metadata?.startTime || response.createTime || new Date().toISOString(),
      updateTime: response.metadata?.updateTime || response.updateTime || new Date().toISOString(),
      done: response.done || false,
      error: response.error,
      response: response.response,
      metadata: response.metadata,
    };
  }

  /**
   * Map operation state to standard state
   */
  private mapOperationState(operation: any): VeoJob['state'] {
    if (operation.done) {
      if (operation.error) return 'FAILED';
      return 'SUCCEEDED';
    }
    if (operation.metadata?.state) {
      const state = operation.metadata.state.toUpperCase();
      if (state === 'RUNNING' || state === 'IN_PROGRESS') return 'PROCESSING';
      return state as VeoJob['state'];
    }
    return 'PROCESSING';
  }

  /**
   * Download video bytes - Multiple strategies
   */
  async downloadVideo(videoUrl: string): Promise<Buffer> {
    const headers = await this.authManager.getAuthHeaders();
    
    // Strategy 1: Direct download with auth
    try {
      const response = await fetch(videoUrl, { headers });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch (error) {
      console.log('Strategy 1 failed:', error);
    }

    // Strategy 2: Public URL without auth
    try {
      const response = await fetch(videoUrl);
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch (error) {
      console.log('Strategy 2 failed:', error);
    }

    // Strategy 3: Media endpoint
    try {
      const mediaUrl = this.convertToMediaEndpoint(videoUrl);
      const response = await fetch(mediaUrl, {
        headers: {
          ...headers,
          'Accept': 'video/mp4',
        },
      });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch (error) {
      console.log('Strategy 3 failed:', error);
    }

    // Strategy 4: GCS signed URL
    if (videoUrl.includes('storage.googleapis.com') || videoUrl.includes('gs://')) {
      try {
        const signedUrl = await this.getSignedUrl(videoUrl);
        const response = await fetch(signedUrl);
        if (response.ok) {
          return Buffer.from(await response.arrayBuffer());
        }
      } catch (error) {
        console.log('Strategy 4 failed:', error);
      }
    }

    throw new Error('All download strategies failed');
  }

  /**
   * Convert URL to media endpoint
   */
  private convertToMediaEndpoint(url: string): string {
    // Convert various URL formats to media endpoint
    if (url.includes('/v1/')) {
      return url.replace(/\/videos\/([^\/]+)/, '/videos/$1:media');
    }
    return url;
  }

  /**
   * Get signed URL for GCS objects
   */
  private async getSignedUrl(gsUrl: string): Promise<string> {
    const headers = await this.authManager.getAuthHeaders();
    
    // Extract bucket and object from gs:// URL
    const match = gsUrl.match(/gs:\/\/([^\/]+)\/(.+)/);
    if (!match) return gsUrl;
    
    const [, bucket, object] = match;
    
    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`,
      { headers }
    );
    
    if (response.ok) {
      return response.url;
    }
    
    return gsUrl;
  }

  /**
   * Wait for video completion with polling
   */
  async waitForCompletion(
    operationName: string,
    options: {
      pollInterval?: number;
      maxWaitTime?: number;
      onProgress?: (job: VeoJob) => void;
    } = {}
  ): Promise<VeoJob> {
    const {
      pollInterval = 3000,
      maxWaitTime = 300000, // 5 minutes
      onProgress,
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const job = await this.getJobStatus(operationName);
      
      if (onProgress) {
        onProgress(job);
      }

      if (job.state === 'SUCCEEDED') {
        return job;
      }

      if (job.state === 'FAILED' || job.state === 'CANCELLED') {
        throw new Error(`Job ${job.state}: ${job.error?.message || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Timeout waiting for video completion');
  }

  /**
   * Cancel a running job
   */
  async cancelJob(operationName: string): Promise<void> {
    const headers = await this.authManager.getAuthHeaders();
    
    const operationPath = operationName.startsWith('projects/')
      ? operationName
      : `projects/${this.config.projectId}/locations/${this.config.location}/operations/${operationName}`;

    const response = await fetch(
      `https://aiplatform.googleapis.com/v1/${operationPath}:cancel`,
      {
        method: 'POST',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel job: ${response.status} - ${errorText}`);
    }
  }

  /**
   * List recent operations
   */
  async listOperations(filter?: string): Promise<VeoJob[]> {
    const headers = await this.authManager.getAuthHeaders();
    
    const params = new URLSearchParams();
    if (filter) {
      params.append('filter', filter);
    }
    params.append('pageSize', '10');

    const response = await fetch(
      `${this.baseUrl}/operations?${params}`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list operations: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return (result.operations || []).map((op: any) => this.parseOperationResponse(op));
  }
}

// ============================================
// Singleton Export
// ============================================

let clientInstance: VeoAPIClient | null = null;

export function getVeoClient(config?: Partial<VeoConfig>): VeoAPIClient {
  if (!clientInstance) {
    clientInstance = new VeoAPIClient(config);
  }
  return clientInstance;
}

// ============================================
// Utility Functions
// ============================================

export async function testVeoConnection(): Promise<{
  auth: boolean;
  api: boolean;
  error?: string;
}> {
  try {
    const client = getVeoClient();
    
    // Test auth
    const authManager = new AuthManager({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || '',
      location: 'us-central1',
      authMethod: 'service-account',
    });
    
    const headers = await authManager.getAuthHeaders();
    const hasAuth = !!headers['Authorization'] || !!headers['X-Goog-Api-Key'];
    
    // Test API endpoint
    const operations = await client.listOperations();
    
    return {
      auth: hasAuth,
      api: true,
    };
  } catch (error: any) {
    return {
      auth: false,
      api: false,
      error: error.message,
    };
  }
}

// Export default instance
export default getVeoClient();
