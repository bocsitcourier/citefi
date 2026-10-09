const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('dotenv');
const yaml = require('js-yaml');
const { SETTINGS, assertIsolation, updatedEnvText, saveChecked } = require('../../scripts/configure-staging-spaces.cjs');
const env = {
  DATABASE_URL: 'postgresql://fixture:secret@localhost/citefi_staging',
  REDIS_URL: 'redis://:secret@127.0.0.1:6379/1',
  STORAGE_PREFIX: 'staging/synthetic/',
  DO_SPACES_KEY: 'fixture-access', DO_SPACES_SECRET: 'fixture-secret',
};

test('only the authorized isolated staging configuration is admitted', () => {
  assert.doesNotThrow(() => assertIsolation(env));
  for (const override of [
    { DATABASE_URL: 'postgresql://localhost/citefi' }, { REDIS_URL: 'redis://localhost/0' },
    { STORAGE_PREFIX: '' }, { DO_SPACES_KEY: '' }, { DO_SPACES_SECRET: '${PRODUCTION_KEY}' },
    { DATABASE_URL: 'postgresql://external.example/citefi_staging' },
  ]) assert.throws(() => assertIsolation({ ...env, ...override }));
});

test('replacements preserve credentials, comments, unrelated values and are idempotent', () => {
  const original = [
    '# keep this comment', 'DO_SPACES_KEY=fixture-access', 'DO_SPACES_SECRET="fixture-secret"',
    'export DO_SPACES_BUCKET=old', 'DO_SPACES_BUCKET=duplicate',
    'DO_SPACES_ENDPOINT=', 'STORAGE_PREFIX=staging/synthetic/', 'OTHER="unchanged"',
  ].join('\r\n');
  const updated = updatedEnvText(original, parse);
  assert.equal(parse(updated).DO_SPACES_SECRET, parse(original).DO_SPACES_SECRET);
  assert.equal(parse(updated).OTHER, 'unchanged');
  for (const [key, value] of Object.entries(SETTINGS)) assert.equal(parse(updated)[key], value);
  assert.match(updated, /# keep this comment\r\n/);
  assert.equal(updated.match(/DO_SPACES_BUCKET=/g).length, 1);
  assert.equal(updatedEnvText(updated, parse), updated);
});

test('atomic owner-only save refuses concurrent configuration changes and cleans up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-spaces-config-'));
  try {
    const file = path.join(dir, '.env.local');
    const original = 'DO_SPACES_KEY=fixture-access\nDO_SPACES_SECRET=fixture-secret\n';
    fs.writeFileSync(file, original);
    const stat = fs.statSync(file);
    const updated = updatedEnvText(original, parse);
    fs.writeFileSync(file, original + '# concurrent edit\n');
    assert.throws(() => saveChecked(file, original, updated, stat));
    assert.equal(fs.readFileSync(file, 'utf8'), original + '# concurrent edit\n');
    fs.writeFileSync(file, original);
    assert.equal(saveChecked(file, original, updated, fs.statSync(file)), true);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir), ['.env.local']);
    assert.equal(saveChecked(file, updated, updated, fs.statSync(file)), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manual workflow cannot accept arbitrary targets or run secret-bearing branch code', () => {
  const w = yaml.load(fs.readFileSync('.github/workflows/configure-staging-spaces.yml', 'utf8'));
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs), ['confirm_staging_only']);
  assert.equal(w.on.workflow_dispatch.inputs.confirm_staging_only.default, false);
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.equal(w.jobs.configure.if,
    "${{ inputs.confirm_staging_only && github.ref == format('refs/heads/{0}', github.event.repository.default_branch) }}");
  assert.equal(w.jobs.configure.steps[0].with['persist-credentials'], false);
  assert.equal(w.jobs.configure.steps[1].env.DO_SSH_PRIVATE_KEY, '${{ secrets.DO_SSH_KEY }}');
  const remote = fs.readFileSync('scripts/configure-staging-spaces.cjs', 'utf8');
  assert.doesNotMatch(remote, /PutObject|DeleteObject|CreateBucket|child_process|process\.env/);
  assert.match(remote, /HeadBucketCommand/);
  assert.match(remote, /phase = 'bucket-access';[\s\S]*await client\.send[\s\S]*phase = 'staging-save';/);
});
