import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  reviewedMediaDigest, verifyReviewedMedia,
  REVIEWED_MEDIA_DOWNLOAD_TIMEOUT_MS, REVIEWED_MEDIA_MAX_BYTES,
} from '../../packages/apex-receiver/src/services/reviewed-media.ts';

test('reviewed references bind exact immutable digest and HTTPS', () => {
  const bytes = Buffer.from('owned synthetic image');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const source = `https://stage.invalid/api/publishing/review-media?key=${encodeURIComponent(`private/publishing-reviewed/1/${hash}.png`)}`;
  assert.equal(reviewedMediaDigest(source), hash);
  assert.doesNotThrow(() => verifyReviewedMedia(bytes, hash));
  assert.throws(() => verifyReviewedMedia(Buffer.from('different'), hash), /digest mismatch/);
  assert.throws(() => reviewedMediaDigest(source.replace('https:', 'http:')), /Invalid/);
  assert.throws(() => reviewedMediaDigest(source.replace('%2F1%2F', '%2F0%2F')), /Invalid/);
  assert.equal(reviewedMediaDigest('https://stage.invalid/legacy/image.png'), undefined);
});

test('receiver window and byte cap stay inside engine contract', () => {
  assert.ok(REVIEWED_MEDIA_DOWNLOAD_TIMEOUT_MS < 30_000);
  assert.equal(REVIEWED_MEDIA_MAX_BYTES, 32 * 1024 * 1024);
  assert.throws(() => verifyReviewedMedia(Buffer.alloc(REVIEWED_MEDIA_MAX_BYTES + 1), '0'.repeat(64)), /byte limit/);
});
