// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
config({ path: '.env.local', override: true });

import { spawn, execFileSync } from 'child_process';
import { assertPortAvailable } from '../lib/ops/port-guard';

console.log('🚀 Starting Citefi (Next.js)...\n');

// ── Redis startup ────────────────────────────────────────────────────────────
// BullMQ requires Redis. Bootstrapping an unauthenticated daemon is permitted
// only when a developer explicitly opts in.
try {
  execFileSync('redis-cli', ['ping'], { stdio: 'pipe' });
  console.log('✅ Redis already running');
} catch {
  if (process.env.NODE_ENV === 'development' && process.env.LOCAL_DEV_REDIS === 'true') {
    console.log('🔧 Starting explicitly enabled local Redis server...');
    try {
      execFileSync('redis-server', ['--daemonize', 'yes', '--loglevel', 'warning', '--port', '6379'], { stdio: 'pipe' });
      console.log('✅ Redis started');
    } catch (redisErr) {
      console.warn('⚠️  Could not start local Redis:', (redisErr as Error).message);
    }
  } else {
    console.warn('⚠️  Redis is unavailable; set LOCAL_DEV_REDIS=true only for local development bootstrap.');
  }
}

// ── Port guard ──────────────────────────────────────────────────────────────
// On Replit, restarts send SIGTERM to the parent but the Next.js child process
// (via shell:true) can survive momentarily and keep port 5000 bound.
// We forcibly free it before spawning next dev so EADDRINUSE never occurs.
const PORT = parseInt(process.env.PORT || '5000', 10);

await assertPortAvailable(PORT);

// ── Workers ─────────────────────────────────────────────────────────────────
let workerProcess: ReturnType<typeof spawn> | null = null;

if (process.env.DISABLE_WORKERS === 'true') {
  console.log('⏸️  Workers disabled (DISABLE_WORKERS=true) — UI-only dev mode\n');
} else {
  console.log('🔧 Starting BullMQ workers in dedicated process...\n');
  workerProcess = spawn('tsx', ['server/worker-process.ts'], {
    stdio: 'inherit',
    shell: true,
    detached: true,
    env: { ...process.env, WORKER_PROCESS: 'true' },
  });

  workerProcess.on('error', (error) => {
    console.error('❌ Failed to start worker process:', error);
  });

  workerProcess.on('close', (code) => {
    console.log(`⚠️  Worker process exited with code ${code}`);
  });
}

// ── Next.js dev server ───────────────────────────────────────────────────────
const nextDev = spawn('npx', ['next', 'dev', '--turbopack'], {
  stdio: 'inherit',
  shell: false,
  detached: true,
});

nextDev.on('error', (error) => {
  console.error('Failed to start Next.js:', error);
  process.exit(1);
});

nextDev.on('close', (code) => {
  console.log(`Next.js process exited with code ${code}`);
  process.exit(code || 0);
});

// ── Page pre-warmer ──────────────────────────────────────────────────────────
const BASE_URL = `http://localhost:${PORT}`;

const PAGES_TO_WARM = [
  // Read-only pages only — never warm auth mutation endpoints or protected
  // pages that just redirect (e.g. /admin → /login).
  '/api/health',
  // Auth module graph — any 401/400/405 response still triggers Turbopack
  // compilation, making startup failures visible immediately in logs instead
  // of silently caching a 404 on the user's first login attempt.
  // GET triggers compilation even for POST-only routes (Next.js returns 405).
  '/api/auth/me',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/verify-2fa',
  '/api/auth/send-email-code',
  '/home',
  '/content',
  '/monitoring',
  '/media',
  '/social',
  '/seo-tools',
  '/personas',
  '/learning',
  '/settings',
  '/settings/publishing',
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
      // ignore — any response triggers compilation
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ All pages pre-warmed in ${elapsed}s — navigation is now instant`);
}

warmupPages().catch(() => {});

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Kill the whole process group (negative PID) so the shell wrapper doesn't
// orphan the actual next/worker child processes.
function killGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

process.on('SIGINT', () => {
  if (workerProcess) killGroup(workerProcess, 'SIGINT');
  killGroup(nextDev, 'SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (workerProcess) killGroup(workerProcess, 'SIGTERM');
  killGroup(nextDev, 'SIGTERM');
  process.exit(0);
});
