// Complete Veo Video Generator Component
// Save as: /app/components/VeoVideoGenerator.tsx

'use client';

import React from 'react';
import { useVeoVideo } from '@/hooks/useVeoVideo';

export default function VeoVideoGenerator() {
  const [prompt, setPrompt] = React.useState('');
  const [duration, setDuration] = React.useState(4);
  const [aspectRatio, setAspectRatio] = React.useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = React.useState<'720p' | '1080p'>('1080p');

  const {
    state,
    generateVideo,
    downloadVideo,
    cancelGeneration,
    reset,
  } = useVeoVideo({
    autoDownload: false,
    onProgress: (progress) => {
      console.log(`Generation progress: ${progress}%`);
    },
    onComplete: (videoUrl) => {
      console.log('Video completed:', videoUrl);
    },
    onError: (error) => {
      console.error('Generation error:', error);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    await generateVideo(prompt, {
      duration,
      aspectRatio,
      resolution,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Veo Video Generator
        </h1>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Video Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                placeholder="Describe the video you want to create..."
                disabled={state.isGenerating}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Duration (seconds)
                </label>
                <input
                  type="number"
                  min="2"
                  max="16"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={state.isGenerating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Aspect Ratio
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as any)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={state.isGenerating}
                >
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="9:16">9:16 (Portrait)</option>
                  <option value="1:1">1:1 (Square)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Resolution
                </label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as any)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={state.isGenerating}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={state.isGenerating || !prompt.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {state.isGenerating ? 'Generating...' : 'Generate Video'}
              </button>

              {state.isGenerating && (
                <button
                  type="button"
                  onClick={cancelGeneration}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  Cancel
                </button>
              )}

              {(state.error || state.videoUrl) && (
                <button
                  type="button"
                  onClick={reset}
                  className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
                >
                  Reset
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Status Display */}
        {state.status && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Generation Status</h2>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Status:</span>
                <span className={`font-medium ${
                  state.status === 'SUCCEEDED' ? 'text-green-600' :
                  state.status === 'FAILED' ? 'text-red-600' :
                  'text-yellow-600'
                }`}>
                  {state.status}
                </span>
              </div>

              {state.progress > 0 && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-600">Progress:</span>
                    <span className="font-medium">{state.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${state.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {state.jobName && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Job ID:</span>
                  <span className="font-mono text-sm">{state.jobName.split('/').pop()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Display */}
        {state.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h3 className="text-red-800 font-semibold mb-1">Error</h3>
            <p className="text-red-600">{state.error}</p>
          </div>
        )}

        {/* Video Player */}
        {state.videoUrl && state.status === 'SUCCEEDED' && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold mb-4">Generated Video</h2>
            
            <video
              src={state.videoUrl}
              controls
              className="w-full rounded-lg mb-4"
              poster="/api/placeholder/800/450"
            />

            <button
              onClick={() => downloadVideo()}
              disabled={state.isDownloading}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
            >
              {state.isDownloading ? 'Downloading...' : 'Download Video'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Testing Utilities
// Save as: /lib/veo-test-utils.ts
// ============================================

import { VeoAPIClient, testVeoConnection } from './veo-complete-client';

/**
 * Comprehensive test suite for Veo API
 */
export class VeoTestSuite {
  private client: VeoAPIClient;
  private testResults: Map<string, boolean> = new Map();

  constructor(client: VeoAPIClient) {
    this.client = client;
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<{
    passed: number;
    failed: number;
    results: Record<string, boolean>;
    errors: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};

    // Test 1: Connection
    try {
      const connectionTest = await testVeoConnection();
      this.testResults.set('connection', connectionTest.auth && connectionTest.api);
      if (!connectionTest.auth || !connectionTest.api) {
        errors.connection = connectionTest.error || 'Connection failed';
      }
    } catch (error: any) {
      this.testResults.set('connection', false);
      errors.connection = error.message;
    }

    // Test 2: List Operations
    try {
      const operations = await this.client.listOperations();
      this.testResults.set('listOperations', true);
    } catch (error: any) {
      this.testResults.set('listOperations', false);
      errors.listOperations = error.message;
    }

    // Test 3: Generate Video (small test)
    try {
      const job = await this.client.generateVideo({
        prompt: 'A simple 2-second test video of a bouncing ball',
        duration: 2,
      });
      this.testResults.set('generateVideo', !!job.name);
      
      // Test 4: Check Status
      if (job.name) {
        const status = await this.client.getJobStatus(job.name);
        this.testResults.set('checkStatus', !!status.state);

        // Optional: Cancel the test job
        try {
          await this.client.cancelJob(job.name);
        } catch (e) {
          // Ignore cancel errors
        }
      }
    } catch (error: any) {
      this.testResults.set('generateVideo', false);
      errors.generateVideo = error.message;
    }

    // Calculate results
    const results = Object.fromEntries(this.testResults);
    const passed = Array.from(this.testResults.values()).filter(v => v).length;
    const failed = this.testResults.size - passed;

    return {
      passed,
      failed,
      results,
      errors,
    };
  }

  /**
   * Test authentication methods
   */
  async testAuthentication(): Promise<{
    serviceAccount: boolean;
    oauth2: boolean;
    apiKey: boolean;
  }> {
    const results = {
      serviceAccount: false,
      oauth2: false,
      apiKey: false,
    };

    // Test service account
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
      try {
        const client = new VeoAPIClient({ authMethod: 'service-account' });
        await client.listOperations();
        results.serviceAccount = true;
      } catch (e) {
        console.error('Service account auth failed:', e);
      }
    }

    // Test OAuth2
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN) {
      try {
        const client = new VeoAPIClient({ authMethod: 'oauth2' });
        await client.listOperations();
        results.oauth2 = true;
      } catch (e) {
        console.error('OAuth2 auth failed:', e);
      }
    }

    // Test API Key
    if (process.env.GOOGLE_API_KEY) {
      try {
        const client = new VeoAPIClient({ authMethod: 'api-key' });
        await client.listOperations();
        results.apiKey = true;
      } catch (e) {
        console.error('API key auth failed:', e);
      }
    }

    return results;
  }

  /**
   * Test download strategies
   */
  async testDownloadStrategies(videoUrl: string): Promise<{
    directAuth: boolean;
    publicUrl: boolean;
    mediaEndpoint: boolean;
    gcsSignedUrl: boolean;
  }> {
    const results = {
      directAuth: false,
      publicUrl: false,
      mediaEndpoint: false,
      gcsSignedUrl: false,
    };

    // Implementation would test each download method
    // This is a placeholder for the actual implementation
    
    return results;
  }
}

// ============================================
// API Test Endpoint
// Save as: /app/api/veo/test/route.ts
// ============================================

import { NextResponse } from 'next/server';
import { VeoTestSuite } from '@/lib/veo-test-utils';
import { getVeoClient } from '@/lib/veo-complete-client';

export async function GET() {
  try {
    const client = getVeoClient();
    const testSuite = new VeoTestSuite(client);
    
    // Run all tests
    const results = await testSuite.runAllTests();
    
    // Test authentication methods
    const authResults = await testSuite.testAuthentication();
    
    return NextResponse.json({
      success: results.failed === 0,
      tests: {
        ...results,
        authentication: authResults,
      },
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

// ============================================
// Debug Panel Component
// Save as: /app/components/VeoDebugPanel.tsx
// ============================================

'use client';

import React, { useState } from 'react';

interface TestResult {
  success: boolean;
  tests: {
    passed: number;
    failed: number;
    results: Record<string, boolean>;
    errors: Record<string, string>;
    authentication: {
      serviceAccount: boolean;
      oauth2: boolean;
      apiKey: boolean;
    };
  };
  timestamp: string;
}

export default function VeoDebugPanel() {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runTests = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/veo/test');
      const data = await response.json();
      setTestResult(data);
    } catch (error) {
      console.error('Test failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 text-white p-6 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Veo API Debug Panel</h2>
      
      <button
        onClick={runTests}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 mb-4"
      >
        {loading ? 'Running Tests...' : 'Run Diagnostic Tests'}
      </button>

      {testResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-sm text-gray-400">Passed</div>
              <div className="text-2xl font-bold text-green-400">
                {testResult.tests.passed}
              </div>
            </div>
            <div className="bg-gray-800 p-3 rounded">
              <div className="text-sm text-gray-400">Failed</div>
              <div className="text-2xl font-bold text-red-400">
                {testResult.tests.failed}
              </div>
            </div>
          </div>

          <div className="bg-gray-800 p-4 rounded">
            <h3 className="font-semibold mb-2">Test Results</h3>
            <div className="space-y-1">
              {Object.entries(testResult.tests.results).map(([test, passed]) => (
                <div key={test} className="flex justify-between">
                  <span>{test}</span>
                  <span className={passed ? 'text-green-400' : 'text-red-400'}>
                    {passed ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {Object.keys(testResult.tests.errors).length > 0 && (
            <div className="bg-red-900/20 border border-red-500 p-4 rounded">
              <h3 className="font-semibold mb-2 text-red-400">Errors</h3>
              <div className="space-y-2 text-sm">
                {Object.entries(testResult.tests.errors).map(([test, error]) => (
                  <div key={test}>
                    <span className="font-medium">{test}:</span> {error}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-800 p-4 rounded">
            <h3 className="font-semibold mb-2">Authentication Methods</h3>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Service Account</span>
                <span className={testResult.tests.authentication.serviceAccount ? 'text-green-400' : 'text-red-400'}>
                  {testResult.tests.authentication.serviceAccount ? '✓' : '✗'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>OAuth2</span>
                <span className={testResult.tests.authentication.oauth2 ? 'text-green-400' : 'text-red-400'}>
                  {testResult.tests.authentication.oauth2 ? '✓' : '✗'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>API Key</span>
                <span className={testResult.tests.authentication.apiKey ? 'text-green-400' : 'text-red-400'}>
                  {testResult.tests.authentication.apiKey ? '✓' : '✗'}
                </span>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Last tested: {new Date(testResult.timestamp).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
