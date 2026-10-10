import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('required reviewed media fail closed, never save wrong bytes, and clean only newly saved files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'owned-receiver-media-'));
  Object.assign(process.env, {
    CITEFI_API_KEY: 'qa-fixture-no-external-authentication',
    APEX_ENGINE_URL: 'https://owned-engine.invalid',
    BASE_URL: 'https://owned-receiver.invalid',
    STORAGE_PATH: directory,
  });
  const bytes = Buffer.from('owned unit-test bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const reference = id => ({
    id, type: 'image', filename: `${id}.png`, mimeType: 'image/png',
    sourceUrl: `https://owned-engine.invalid/api/publishing/review-media?key=${encodeURIComponent(`private/publishing-reviewed/1/${hash}.png`)}&id=${id}`,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(new URL(url).searchParams.get('id') === 'bad' ? 'wrong bytes' : bytes);
  };
  try {
    const { downloadMultipleMedia } = await import('../../packages/apex-receiver/src/services/media-downloader.ts');
    await assert.rejects(downloadMultipleMedia([reference('good'), reference('bad')]), /article was not published/);
    assert.deepEqual(await readdir(path.join(directory, 'images')), []);
    const result = await downloadMultipleMedia([reference('good')]);
    assert.equal(result.size, 1);
    assert.equal((await readdir(path.join(directory, 'images'))).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
