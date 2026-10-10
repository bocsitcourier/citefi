const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '../..');

test('release compilation receives unusable services without altering the parent environment', () => {
  const fixture = path.join(root, 'QA/support/qa-fixtures.mjs');
  const variables = ['DATABASE_URL', 'DATABASE_POOLED_URL', 'NEON_DATABASE_URL',
    'GEMINI_API_KEY', 'OPENAI_API_KEY', 'REDIS_URL'];
  const env = { PATH: process.env.PATH };
  for (const key of variables) env[key] = 'parent-value-not-for-compilation';
  const output = execFileSync(process.execPath, ['--import', fixture, '-e',
    `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(variables)}.map(k => [k, process.env[k]]))))`],
    { env, encoding: 'utf8' });
  const actual = JSON.parse(output);
  for (const key of ['DATABASE_URL', 'DATABASE_POOLED_URL', 'NEON_DATABASE_URL', 'REDIS_URL']) {
    const url = new URL(actual[key]);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '1');
  }
  assert.equal(actual.GEMINI_API_KEY, 'qa-offline-gemini-fixture');
  assert.equal(actual.OPENAI_API_KEY, 'qa-offline-openai-fixture');
  for (const key of variables) assert.equal(env[key], 'parent-value-not-for-compilation');
});

test('both off-host release builds scope the fixture preload to compilation only', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
  const steps = workflow.jobs.validate.steps;
  const build = steps.find(step => step.run === 'npm run build');
  assert.equal(build.env.NODE_OPTIONS, '--import=./QA/support/qa-fixtures.mjs');
  assert.equal(workflow.env?.NODE_OPTIONS, undefined);
  assert.equal(workflow.jobs.deploy.env?.NODE_OPTIONS, undefined);
  const transport = fs.readFileSync(path.join(root, 'scripts/deploy-to-do.sh'), 'utf8');
  assert.match(transport, /NODE_OPTIONS="\$\{NODE_OPTIONS:-\} --import=\$\(pwd\)\/QA\/support\/qa-fixtures\.mjs" npm run build/);
  assert.doesNotMatch(transport, /export NODE_OPTIONS=/);
  assert.doesNotMatch(transport.slice(transport.indexOf('remote_env=(')), /NODE_OPTIONS|qa-fixtures/);
  const host = fs.readFileSync(path.join(root, 'scripts/host-release.sh'), 'utf8');
  assert.doesNotMatch(host, /qa-fixtures/);
});
