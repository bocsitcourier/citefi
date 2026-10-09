const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { serverBlocks } = require('../../scripts/staging-publishing-server.cjs');

test('nginx block discovery respects nesting and excludes comments', () => {
  assert.deepEqual(serverBlocks('# server { fake }\nserver { location / { proxy_pass http://localhost:5100; } }\nserver { incomplete'),
    [' location / { proxy_pass http://localhost:5100; } ']);
});

test('staging operations are manual and reviewed-default-branch only', () => {
  const w = yaml.load(fs.readFileSync('.github/workflows/staging-publishing-server.yml', 'utf8'));
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.deepEqual(w.on.workflow_dispatch.inputs.operation.options, ['inspect', 'inspect-root', 'setup', 'verify', 'retention-preview', 'retention-cleanup']);
  assert.match(w.jobs.staging.if, /github.event.repository.default_branch/);
  assert.equal(w.jobs.staging.steps[0].with['persist-credentials'], false);
  assert.equal(w.jobs.staging.steps[1].env.DO_SSH_PRIVATE_KEY, '${{ secrets.DO_SSH_KEY }}');
  assert.match(fs.readFileSync('scripts/staging-publishing-server.sh', 'utf8'), /inspect\|inspect-root\|setup\|verify/);
});

test('root controller confines writes, drops privileges and isolates host-scoped cookies', () => {
  const source = fs.readFileSync('scripts/staging-publishing-server.cjs', 'utf8');
  assert.match(source, /fs\.realpathSync\(ROOT\) !== ROOT/);
  assert.match(source, /source archive integrity failed/i);
  assert.match(source, /proxy_set_header Cookie ""/);
  assert.match(source, /proxy_hide_header Set-Cookie/);
  assert.match(source, /'env', '-i'/);
  assert.doesNotMatch(source, /pm2\('(?:stop|delete)', 'all'\)/);
  assert.doesNotMatch(source, /'\/var\/www\/citefi\/'/);
});

test('exported locks normalize both private proxy hosts without changing package integrity', () => {
  const { normalizeLock } = require('../../scripts/create-staging-publishing-source.cjs');
  const lock = { packages: {
    a: { version: '1.0.0', integrity: 'sha512-example', resolved: 'http://package-firewall.replit.internal/npm/a/-/a-1.0.0.tgz' },
    b: { version: '2.0.0', integrity: 'sha512-example2', resolved: 'http://package-firewall.replit.local/npm/@scope/b/-/b-2.0.0.tgz' },
  }};
  assert.equal(normalizeLock(lock), 2);
  assert.equal(lock.packages.a.resolved, 'https://registry.npmjs.org/a/-/a-1.0.0.tgz');
  assert.equal(lock.packages.b.resolved, 'https://registry.npmjs.org/@scope/b/-/b-2.0.0.tgz');
  assert.equal(lock.packages.a.version, '1.0.0');
  assert.equal(lock.packages.a.integrity, 'sha512-example');
  assert.throws(() => normalizeLock({ resolved: 'http://package-firewall.replit.internal/npm/a/-/a-1.0.0.tgz' }));
});
