const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeLock, normalizeTree } = require('../../scripts/normalize-release-lockfiles.cjs');

test('both proxy hosts normalize without changing dependency identity or integrity', () => {
  const lock = { packages: {
    a: { version: '1', integrity: 'sha512-a', resolved: 'http://package-firewall.replit.local/npm/a/-/a-1.tgz' },
    b: { version: '2', integrity: 'sha512-b', resolved: 'https://package-firewall.replit.internal/npm/@scope/b/-/b-2.tgz' },
  }, dependencies: { c: { version: '3', integrity: 'sha512-c', resolved: 'http://package-firewall.replit.internal/npm/c/-/c-3.tgz' } } };
  const expected = JSON.parse(JSON.stringify(lock));
  expected.packages.a.resolved = 'https://registry.npmjs.org/a/-/a-1.tgz';
  expected.packages.b.resolved = 'https://registry.npmjs.org/@scope/b/-/b-2.tgz';
  expected.dependencies.c.resolved = 'https://registry.npmjs.org/c/-/c-3.tgz';
  assert.equal(normalizeLock(lock), 3);
  assert.deepEqual(lock, expected);
  assert.equal(normalizeLock(lock), 0);
});

test('unrelated registry URLs remain untouched and malformed private prefixes fail closed', () => {
  const lock = { resolved: 'https://example.test/asset.tgz' };
  assert.equal(normalizeLock(lock), 0);
  assert.equal(lock.resolved, 'https://example.test/asset.tgz');
  for (const resolved of [
    'http://package-firewall.replit.internal:8080/npm/a.tgz',
    'http://user:password@package-firewall.replit.internal/npm/a.tgz',
    'http://package-firewall.replit.internal/npm/a.tgz?token=private',
    'ftp://package-firewall.replit.internal/npm/a.tgz',
  ]) assert.throws(() => normalizeLock({ resolved }));
});

test('isolated normalization covers nested packages without changing the original lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-lock-'));
  try {
    const original = '{"resolved":"http://package-firewall.replit.internal/npm/a.tgz","integrity":"sha512-original"}';
    const exported = path.join(root, 'export');
    fs.writeFileSync(path.join(root, 'original-lock.json'), original);
    fs.mkdirSync(path.join(exported, 'packages', 'worker'), { recursive: true });
    for (const filename of ['package-lock.json', 'packages/worker/package-lock.json']) fs.writeFileSync(path.join(exported, filename), original);
    assert.equal(normalizeTree(exported), 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(exported, 'packages/worker/package-lock.json'))).resolved, 'https://registry.npmjs.org/a.tgz');
    assert.equal(fs.readFileSync(path.join(root, 'original-lock.json'), 'utf8'), original);
    fs.unlinkSync(path.join(exported, 'package-lock.json'));
    fs.symlinkSync(path.join(exported, 'packages/worker/package-lock.json'), path.join(exported, 'package-lock.json'));
    assert.throws(() => normalizeTree(exported), /must not be symlinks/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('both production release paths invoke the same normalizer before installation', () => {
  for (const filename of ['scripts/deploy-to-do.sh', '.github/workflows/deploy.yml']) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.ok(source.indexOf('node scripts/normalize-release-lockfiles.cjs .') < source.indexOf('npm ci --registry'));
    assert.ok(source.includes('node scripts/normalize-release-lockfiles.cjs .'));
  }
});
