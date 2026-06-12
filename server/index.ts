// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn, execSync } from 'child_process';
import * as net from 'net';

console.log('🚀 Starting ApexContent Engine (Next.js)...\n');

// ── Port guard ──────────────────────────────────────────────────────────────
// On Replit, restarts send SIGTERM to the parent but the Next.js child process
// (via shell:true) can survive momentarily and keep port 5000 bound.
// We forcibly free it before spawning next dev so EADDRINUSE never occurs.
const PORT = parseInt(process.env.PORT || '5000', 10);

async function waitForPortFree(port: number, maxMs = 15000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => { probe.close(); resolve(true); });
      probe.listen(port, '0.0.0.0');
    });
    if (free) return;
    await new Promise(r => setTimeout(r, 200));
  }
  console.warn(`⚠️  Port ${port} still busy after ${maxMs}ms — starting anyway`);
}

function forceKillPort(port: number) {
  try {
    // fuser -k sends SIGKILL to every process bound to the port
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // fuser may not be available; fall through to the wait loop
  }
}

// Kill anything on the port, then wait until it's actually free
forceKillPort(PORT);
await waitForPortFree(PORT);

// ── Workers ─────────────────────────────────────────────────────────────────
let workerProcess: ReturnType<typeof spawn> | null = null;

if (process.env.DISABLE_WORKERS === 'true') {
  console.log('⏸️  Workers disabled (DISABLE_WORKERS=true) — UI-only dev mode\n');
} else {
  console.log('🔧 Starting pg-boss workers in dedicated process...\n');
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
