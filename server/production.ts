import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn } from 'child_process';
import {
  createSanitizedOutputForwarder,
  processDiagnosticLog,
} from '../lib/process-diagnostics';

processDiagnosticLog('log', '🚀 Starting Citefi (Production)...');

function captureFatal(kind: 'uncaughtException' | 'unhandledRejection', reason: unknown) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  processDiagnosticLog('error', `Fatal production supervisor ${kind}:`, error);
  process.exitCode = 1;
  void import('../lib/error-logger').then(({ logCritical }) =>
    logCritical('SYSTEM', `[production:${kind}] ${error.message}`, {
      component: 'production-supervisor',
      stackTrace: error.stack,
    })
  ).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.once('uncaughtException', (error) => captureFatal('uncaughtException', error));
process.once('unhandledRejection', (reason) => captureFatal('unhandledRejection', reason));

processDiagnosticLog('log', '🔧 Starting BullMQ workers in dedicated process...');
const workerProcess = spawn('tsx', ['server/worker-process.ts'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
  env: { ...process.env, WORKER_PROCESS: 'true' },
});
const workerStdout = createSanitizedOutputForwarder((text) => process.stdout.write(text));
const workerStderr = createSanitizedOutputForwarder((text) => process.stderr.write(text));
workerProcess.stdout.on('data', (chunk) => workerStdout.write(chunk));
workerProcess.stderr.on('data', (chunk) => workerStderr.write(chunk));

workerProcess.on('error', (error) => {
  processDiagnosticLog('error', '❌ Failed to start worker process:', error);
  process.exitCode = 1;
  void import('../lib/error-logger').then(({ logCritical }) =>
    logCritical('SYSTEM', `Worker process failed to start: ${error.message}`, {
      component: 'production-supervisor',
      stackTrace: error.stack,
    })
  ).finally(() => process.exit(1));
});

workerProcess.on('close', (code) => {
  workerStdout.end();
  workerStderr.end();
  processDiagnosticLog('log', `⚠️ Worker process exited with code ${code}`);
  if (code && code !== 0) process.exitCode = code;
});

const nextStart = spawn('npx', ['next', 'start', '-p', process.env.PORT || '5000'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});
const nextStdout = createSanitizedOutputForwarder((text) => process.stdout.write(text));
const nextStderr = createSanitizedOutputForwarder((text) => process.stderr.write(text));
nextStart.stdout.on('data', (chunk) => nextStdout.write(chunk));
nextStart.stderr.on('data', (chunk) => nextStderr.write(chunk));

nextStart.on('error', (error) => {
  processDiagnosticLog('error', 'Failed to start Next.js:', error);
  process.exit(1);
});

nextStart.on('close', (code) => {
  nextStdout.end();
  nextStderr.end();
  processDiagnosticLog('log', `Next.js process exited with code ${code}`);
  if (!code) process.exit(0);
  process.exitCode = code;
  void import('../lib/error-logger').then(({ logCritical }) =>
    logCritical('SYSTEM', `Next.js process exited unexpectedly with code ${code}`, {
      component: 'production-supervisor',
    })
  ).finally(() => process.exit(code));
});

process.on('SIGINT', () => {
  workerProcess.kill('SIGINT');
  nextStart.kill('SIGINT');
});

process.on('SIGTERM', () => {
  workerProcess.kill('SIGTERM');
  nextStart.kill('SIGTERM');
});
