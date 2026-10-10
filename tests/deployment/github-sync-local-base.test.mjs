import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLocalBaseCommit } from '../../scripts/github-sync.mjs';

const commit = 'a'.repeat(40);

test('cached base requires both the exact commit and its tree', () => {
  const calls = [];
  assert.equal(hasLocalBaseCommit(args => { calls.push(args); return ''; }, commit), true);
  assert.deepEqual(calls, [
    ['cat-file', '-e', `${commit}^{commit}`],
    ['cat-file', '-e', `${commit}^{tree}`],
  ]);
});

test('missing or incomplete bases still require a fetch', () => {
  assert.equal(hasLocalBaseCommit(() => { throw new Error('missing'); }, commit), false);
  assert.equal(hasLocalBaseCommit(args => {
    if (args[2].endsWith('^{tree}')) throw new Error('missing tree');
    return '';
  }, commit), false);
});

test('invalid remote identifiers never reach git', () => {
  let called = false;
  assert.throws(() => hasLocalBaseCommit(() => { called = true; }, '--bad-ref'));
  assert.equal(called, false);
});
