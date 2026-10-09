const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const { preview, cleanup, POLICY, requireSpace } = require('../../scripts/staging-source-retention.cjs');

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-retention-test-'));
  const root = path.join(parent, 'publishing-qa');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const releases = Array.from({ length: 9 }, (_, index) => {
    const file = path.join(root, `source-${index.toString(16).padStart(64, '0')}`);
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, 'package.json'), '{}');
    return file;
  });
  // Age clock is injected; no sleeps or writes to the actual shared server.
  const now = Date.now() + POLICY.minimumAgeMs + 10000;
  return { parent, root, releases, now };
}

test('preview is read-only and cleanup retains active and multi-hop dependency targets', t => {
  const { root, releases: r, now } = fixture(t);
  fs.mkdirSync(path.join(r[0], 'node_modules'));
  fs.writeFileSync(path.join(r[0], 'node_modules', 'package.js'), 'dependency');
  fs.symlinkSync('../' + path.basename(r[0]) + '/node_modules', path.join(r[1], 'node_modules'));
  fs.symlinkSync(path.join(r[1], 'node_modules'), path.join(r[2], 'node_modules'));
  fs.symlinkSync(path.join(r[2], 'node_modules'), path.join(r[3], 'node_modules'));
  const before = fs.readdirSync(root);
  const plan = preview(root, [r[3]], now);
  assert.deepEqual(fs.readdirSync(root), before);
  for (const release of r.slice(0, 4)) assert.ok(!plan.candidates.includes(path.basename(release)));
  assert.ok(plan.candidates.length > 0);
  const result = cleanup(root, [r[3]], plan.digest, now);
  assert.equal(result.deleted.length, plan.candidates.length);
  for (const release of r.slice(0, 4)) assert.ok(fs.existsSync(release));
  assert.equal(fs.readFileSync(path.join(r[3], 'node_modules/package.js'), 'utf8'), 'dependency');
});

test('dependencies linked inside receiver and inside another dependency tree stay intact', t => {
  const { root, releases: r, now } = fixture(t);
  fs.mkdirSync(path.join(r[0], 'receiver-deps'));
  fs.writeFileSync(path.join(r[0], 'receiver-deps/runtime.js'), 'runtime');
  fs.mkdirSync(path.join(r[1], 'node_modules'));
  fs.symlinkSync(path.join(r[0], 'receiver-deps'), path.join(r[1], 'node_modules/nested'));
  fs.mkdirSync(path.join(r[2], 'packages/apex-receiver'), { recursive: true });
  fs.symlinkSync(path.join(r[1], 'node_modules'), path.join(r[2], 'packages/apex-receiver/node_modules'));
  const report = preview(root, [r[2]], now);
  cleanup(root, [r[2]], report.digest, now);
  assert.ok(fs.existsSync(path.join(r[0], 'receiver-deps/runtime.js')));
  assert.ok(fs.existsSync(path.join(r[1], 'node_modules/nested/runtime.js')));
});

test('out-of-scope evidence, media, production, and GitHub recovery paths are never cleaned', t => {
  const { parent, root, releases: r, now } = fixture(t);
  for (const filename of ['live-acceptance.log', 'receiver/uploads/retained.png', 'incoming/source.tar.gz',
    'source-not-a-checksum/private.log']) {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    fs.writeFileSync(path.join(root, filename), 'private');
  }
  for (const name of ['production', 'github-sync-recovery']) {
    fs.mkdirSync(path.join(parent, name));
    fs.writeFileSync(path.join(parent, name, 'evidence'), 'untouched');
  }
  fs.writeFileSync(path.join(r[0], 'private.log'), 'private');
  fs.mkdirSync(path.join(r[1], 'uploads'));
  fs.writeFileSync(path.join(r[1], 'uploads/retained.mp4'), 'media');
  const plan = preview(root, [], now);
  cleanup(root, [], plan.digest, now);
  assert.ok(fs.existsSync(path.join(r[0], 'private.log')));
  assert.ok(fs.existsSync(path.join(r[1], 'uploads/retained.mp4')));
  assert.equal(fs.readFileSync(path.join(root, 'live-acceptance.log'), 'utf8'), 'private');
  assert.ok(fs.existsSync(path.join(root, 'receiver/uploads/retained.png')));
  assert.ok(fs.existsSync(path.join(parent, 'production/evidence')));
  assert.ok(fs.existsSync(path.join(parent, 'github-sync-recovery/evidence')));
});

test('changed/untracked source media protects snapshots but frozen source assets and package fixtures do not', t => {
  const { root, releases: r, now } = fixture(t);
  for (const release of r.slice(0, 2)) {
    fs.writeFileSync(path.join(release, 'asset.png'), 'source-asset');
    fs.writeFileSync(path.join(release, '.staging-source-media.json'), JSON.stringify({
      'asset.png': createHash('sha256').update('source-asset').digest('hex'),
    }));
  }
  fs.appendFileSync(path.join(r[1], 'asset.png'), '-changed');
  fs.mkdirSync(path.join(r[0], 'node_modules'));
  fs.writeFileSync(path.join(r[0], 'node_modules/fixture.png'), 'package fixture');
  const plan = preview(root, [], now);
  assert.ok(plan.candidates.includes(path.basename(r[0])));
  assert.ok(!plan.candidates.includes(path.basename(r[1])));
});

test('cleanup refuses missing or stale previews, newly active roots, and changed dependency links before deleting', t => {
  const { root, releases: r, now } = fixture(t);
  const plan = preview(root, [], now);
  assert.throws(() => cleanup(root, [], '', now), /digest required/);
  assert.throws(() => cleanup(root, [r[0]], plan.digest, now), /preview changed/);
  fs.writeFileSync(path.join(r[0], 'new-file'), 'new');
  assert.throws(() => cleanup(root, [], plan.digest, now), /preview changed/);
  const updated = preview(root, [r[4]], now);
  fs.symlinkSync(r[0], path.join(r[4], 'dependencies'));
  assert.throws(() => cleanup(root, [r[4]], updated.digest, now), /preview changed/);
  for (const release of r) assert.ok(fs.existsSync(release));
});

test('new snapshots are not eligible and cyclic/linked roots fail closed', t => {
  const { parent, root, releases: r, now } = fixture(t);
  assert.deepEqual(preview(root, [], Date.now()).candidates, []);
  fs.symlinkSync(root, path.join(parent, 'linked'));
  assert.throws(() => preview(path.join(parent, 'linked'), [], now), /real directory/);
  fs.symlinkSync('cycle-b', path.join(r[0], 'cycle-a'));
  fs.symlinkSync('cycle-a', path.join(r[0], 'cycle-b'));
  assert.throws(() => preview(root, [r[0]], now), /Cyclic/);
});

test('disk preflight rejects low free space and setup refuses over-budget retained bytes', t => {
  const { root, now } = fixture(t);
  const original = fs.statfsSync;
  t.after(() => { fs.statfsSync = original; });
  fs.statfsSync = () => ({ bavail: 1, bsize: 4096 });
  assert.throws(() => requireSpace(root), /disk headroom/);
  assert.equal(preview(root, [], now).setupAllowed, false);
  fs.statfsSync = () => ({ bavail: 1024 ** 3, bsize: 4096 });
  requireSpace(root);
  assert.equal(preview(root, [], now).setupAllowed, true);
  // Simulate allocated dependency blocks rather than writing GiBs in a test.
  const stat = fs.lstatSync;
  t.after(() => { fs.lstatSync = stat; });
  fs.lstatSync = file => {
    const result = stat(file);
    if (path.basename(file) === 'package.json') result.blocks = POLICY.maximumBytes / 512;
    return result;
  };
  assert.equal(preview(root, [], now).setupAllowed, false);
});

test('stdin SSH bundle parses without needing helper files on the host', () => {
  const { bundle } = require('../../scripts/bundle-staging-publishing-server.cjs');
  const text = bundle();
  assert.ok(!text.includes("require('./staging-source-retention.cjs')"));
  new vm.Script(text);
});

test('a kept inactive snapshot also pins its dependency targets', t => {
  const { root, releases: r, now } = fixture(t);
  fs.mkdirSync(path.join(r[0], 'node_modules'));
  fs.writeFileSync(path.join(r[0], 'node_modules/package.js'), 'shared');
  fs.symlinkSync(path.join(r[0], 'node_modules'), path.join(r[8], 'node_modules'));
  const plan = preview(root, [], now);
  assert.ok(plan.protected.some(item => item.name === path.basename(r[0]) && item.reason === 'transitive-dependency'));
  cleanup(root, [], plan.digest, now);
  assert.ok(fs.existsSync(path.join(r[8], 'node_modules/package.js')));
});

test('release-name symlinks are refused and post-install budget checks precede service replacement', t => {
  const { root, releases: r, now } = fixture(t);
  fs.symlinkSync(r[0], path.join(root, `source-${'f'.repeat(64)}`));
  assert.throws(() => preview(root, [], now), /invalid source release/);
  const server = fs.readFileSync('scripts/staging-publishing-server.cjs', 'utf8');
  assert.ok(server.indexOf("phase = 'validate-post-install-disk-budget'") < server.indexOf("phase = 'start-only-staging-processes'"));
  assert.ok(server.includes('retention.requireSpace(QA_ROOT, 0)'));
});
