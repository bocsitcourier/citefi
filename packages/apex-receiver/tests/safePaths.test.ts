import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createSafeSlug, resolvePathWithin } from '../src/utils/safePaths';

test('resolvePathWithin permits files below the configured root', () => {
  const root = path.resolve('/var/lib/apex/uploads');
  assert.equal(
    resolvePathWithin(root, 'audio', 'episode.mp3'),
    path.join(root, 'audio', 'episode.mp3')
  );
});

test('resolvePathWithin rejects traversal and absolute paths', () => {
  const root = path.resolve('/var/lib/apex/uploads');
  assert.throws(() => resolvePathWithin(root, '../secrets.txt'));
  assert.throws(() => resolvePathWithin(root, '/etc/passwd'));
  assert.throws(() => resolvePathWithin(root, '.'));
});

test('createSafeSlug is a non-empty single filename component', () => {
  assert.equal(createSafeSlug('../../A post!'), 'a-post');
  assert.throws(() => createSafeSlug('///'));
});