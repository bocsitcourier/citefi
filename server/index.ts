// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn } from 'child_process';

console.log('🚀 Starting ApexContent Engine (Next.js)...\n');

// Start pg-boss workers in separate process with active event loop
let workerProcess: ReturnType<typeof spawn> | null = null;

if (process.env.DISABLE_WORKERS === 'true') {
  console.log('⏸️  Workers disabled (DISABLE_WORKERS=true) — UI-only dev mode\n');
} else {
  console.log('🔧 Starting pg-boss workers in dedicated process...\n');
  workerProcess = spawn('tsx', ['server/worker-process.ts'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, WORKER_PROCESS: 'true' },
  });

  workerProcess.on('error', (error) => {
    console.error('❌ Failed to start worker process:', error);
  });

  workerProcess.on('close', (code) => {
    console.log(`⚠️  Worker process exited with code ${code}`);
  });
}

const nextDev = spawn('npx', ['next', 'dev', '--turbopack'], {
  stdio: 'inherit',
  shell: true,
});

nextDev.on('error', (error) => {
  console.error('Failed to start Next.js:', error);
  process.exit(1);
});

nextDev.on('close', (code) => {
  console.log(`Next.js process exited with code ${code}`);
  process.exit(code || 0);
});

// Pre-warm all main pages after server is ready so Turbopack compiles them
// upfront. Navigation will be instant after warmup rather than on first visit.
const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

const PAGES_TO_WARM = [
  // Auth API routes — must be first so login/logout compile before user interacts
  '/api/auth/me',
  '/api/auth/login',
  '/api/auth/logout',
  // Core API routes hit immediately after login
  '/api/notifications',
  '/api/batches',
  '/api/health',
  // UI pages
  '/home',
  '/content',
  '/batches',
  '/monitoring',
  '/media',
  '/social',
  '/seo-tools',
  '/personas',
  '/learning',
  '/settings',
  '/settings/publishing',
  '/admin',
];

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function warmupPages() {
  const ready = await waitForServer();
  if (!ready) {
    console.log('⚠️  Server warmup skipped — server did not become ready in time');
    return;
  }

  console.log(`🔥 Pre-warming ${PAGES_TO_WARM.length} pages for instant navigation...`);
  const start = Date.now();

  for (const page of PAGES_TO_WARM) {
    try {
      await fetch(`${BASE_URL}${page}`, {
        headers: { 'x-warmup': '1' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // ignore errors — any response triggers compilation
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ All pages pre-warmed in ${elapsed}s — navigation is now instant`);
}

// Start warmup in background, don't block server startup
warmupPages().catch(() => {});

// Handle shutdown gracefully
process.on('SIGINT', () => {
  workerProcess?.kill('SIGINT');
  nextDev.kill('SIGINT');
});

process.on('SIGTERM', () => {
  workerProcess?.kill('SIGTERM');
  nextDev.kill('SIGTERM');
});
