import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawn } from 'child_process';

console.log('🚀 Starting Citefi (Production)...\n');

console.log('🔧 Starting BullMQ workers in dedicated process...\n');
const workerProcess = spawn('tsx', ['server/worker-process.ts'], {
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

const nextStart = spawn('npx', ['next', 'start', '-p', process.env.PORT || '5000'], {
  stdio: 'inherit',
  shell: true,
});

nextStart.on('error', (error) => {
  console.error('Failed to start Next.js:', error);
  process.exit(1);
});

nextStart.on('close', (code) => {
  console.log(`Next.js process exited with code ${code}`);
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  workerProcess.kill('SIGINT');
  nextStart.kill('SIGINT');
});

process.on('SIGTERM', () => {
  workerProcess.kill('SIGTERM');
  nextStart.kill('SIGTERM');
});
