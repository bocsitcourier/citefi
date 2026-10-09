const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { parseLiteralEnv, summarize, inspectApp } = require('../../scripts/inspect-do-config.cjs');

test('reports only safe configuration; credentials and URL passwords never appear', () => {
  const env = parseLiteralEnv([
    'DO_SPACES_BUCKET=citefi',
    'DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com',
    'DO_SPACES_KEY=sentinel-private-access',
    'DO_SPACES_SECRET="sentinel-private-secret"',
    'SESSION_SECRET=sentinel-session-secret-long-enough-123456',
    'API_KEY_ENCRYPTION_SECRET=sentinel-encryption-long-enough-123456',
    'DATABASE_URL=postgresql://user:sentinel-db@localhost/citefi_staging',
    'REDIS_URL=redis://:sentinel-redis@127.0.0.1:6379/1',
    'NEXTAUTH_URL=https://staging.example.com/path?token=sentinel-query',
    'STORAGE_PREFIX=staging/synthetic/',
    'UNRELATED_SECRET=sentinel-unrelated',
  ].join('\n'));
  const report = summarize(env, true);
  assert.equal(report.storageConfigured, true);
  assert.equal(report.applicationOrigin, 'https://staging.example.com');
  assert.equal(report.bucketExistenceChecked, false);
  assert.deepEqual(Object.values(report.isolationConfiguration), [true, true, true, true, true]);
  assert.doesNotMatch(JSON.stringify(report), /sentinel/);
});

test('shell expansion is not executed and invalid configuration fails closed', () => {
  const env = parseLiteralEnv([
    'DO_SPACES_BUCKET=$(touch /tmp/do-inspection-must-not-execute)',
    'DO_SPACES_ENDPOINT=https://user:secret@nyc3.digitaloceanspaces.com',
    'STORAGE_PREFIX=../../production',
    'DO_SPACES_KEY="${SOME_SECRET}"',
    'NEXTAUTH_URL=https://user:password@example.com',
  ].join('\n'));
  const report = summarize(env, true);
  assert.equal(report.bucket, null);
  assert.equal(report.spacesEndpoint, null);
  assert.equal(report.storagePrefix, null);
  assert.equal(report.applicationOrigin, null);
  assert.equal(report.storageConfigured, false);
});

test('inspection reads a bounded fixture without modifying files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-do-test-'));
  try {
    const file = path.join(dir, '.env.local');
    const original = 'DO_SPACES_BUCKET=test-bucket\nDO_SPACES_SECRET=never-output-this';
    fs.writeFileSync(file, original);
    const report = inspectApp(dir, true);
    assert.equal(report.configurationStatus, 'read');
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.doesNotMatch(JSON.stringify(report), /never-output-this/);
    fs.writeFileSync(file, 'x'.repeat(128 * 1024 + 1));
    assert.equal(inspectApp(dir, true).configurationStatus, 'invalid-or-oversized');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('workflow is manual, default-branch-only, read-only and uses existing secrets', () => {
  const workflow = yaml.load(fs.readFileSync('.github/workflows/inspect-do.yml', 'utf8'));
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['inspect']);
  const job = workflow.jobs.inspect;
  assert.equal(job.if, "${{ github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}");
  assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.match(job.steps[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual(job.steps[1].env, {
    DO_HOST: '${{ secrets.DO_HOST }}', DO_SSH_PRIVATE_KEY: '${{ secrets.DO_SSH_KEY }}',
    DO_SSH_HOST_FINGERPRINT: '${{ secrets.DO_SSH_HOST_FINGERPRINT }}', DO_USER: 'citefi',
  });
  assert.equal(job.steps[1].run, 'bash scripts/inspect-do.sh');
  const transport = fs.readFileSync('scripts/inspect-do.sh', 'utf8');
  assert.match(transport, /StrictHostKeyChecking=yes/);
  assert.match(transport, /verify-ssh-host-key\.sh/);
  assert.match(transport, /'node -' < "\$SCRIPT_DIR\/inspect-do-config\.cjs"/);
  assert.doesNotMatch(transport, /scp|sudo|pm2|systemctl|deploy-to-do\.sh|set -x/);
});
