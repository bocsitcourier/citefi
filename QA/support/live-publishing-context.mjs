import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export const runId = randomUUID();
export const imageBytes = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK3sAAAAASUVORK5CYII=', 'base64'),
  Buffer.from(runId),
]);
const root = '/var/www/citefi-staging/publishing-qa';
export const receiverEventsPath = `${root}/receiver-events.jsonl`;
const require = createRequire(import.meta.url);
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT, region: 'us-east-1', maxAttempts: 1,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
});
export async function writeOwnedBytes(key, bytes) {
  assert.match(key, /^private\/(?:articles|publishing-reviewed)\//);
  await client.send(new PutObjectCommand({
    Bucket: 'citefi', Key: `staging/synthetic/${key}`, Body: bytes, ContentType: 'image/png',
  }), { abortSignal: AbortSignal.timeout(15000) });
}
export async function receiverEvents(jobId) {
  const text = await fs.readFile(receiverEventsPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  });
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.jobId === jobId);
}
export async function verifyReceiver(jobId, hash) {
  const events = await receiverEvents(jobId);
  assert.equal(events.length, 1, 'Exactly one real receiver submission is permitted');
  assert.equal(events[0].intendedStatus, 200);
  assert.ok(events[0].durationMs >= 1500, 'Actual receiver download was delayed by the staging ingress gate');
  assert.ok(events[0].durationMs < 30000, 'Actual receiver completed inside sender window');
  const uploads = Object.values(events[0].mediaUrls);
  assert.ok(uploads.length > 0, 'Receiver must retain downloaded media');
  const { createHash } = await import('node:crypto');
  for (const url of uploads) {
    assert.equal(new URL(url).origin, 'https://citefi.co:8444');
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(downloaded).digest('hex'), hash);
  }
}
export async function loseResponseFor(jobId) {
  await fs.writeFile(`${root}/ambiguous-jobs.json`, JSON.stringify([jobId]), { mode: 0o600 });
}
export async function clearLostResponses() {
  await fs.writeFile(`${root}/ambiguous-jobs.json`, '[]', { mode: 0o600 });
}
