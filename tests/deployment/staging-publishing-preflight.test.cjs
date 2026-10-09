const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { stagingProxyOrigins, checkConditionalStorage } = require('../../scripts/verify-staging-publishing-preflight.cjs');
const run = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const commands = {
  PutObjectCommand: class { constructor(input) { this.input = input; this.operation = 'put'; } },
  GetObjectCommand: class { constructor(input) { this.input = input; this.operation = 'get'; } },
};

test('discovery only reports HTTPS server blocks routed to the staging port', () => {
  const config = `
    server { listen 443 ssl; server_name production.example.com; location / { proxy_pass http://127.0.0.1:5000; } }
    server { listen 80; server_name staging.example.com; location / { proxy_pass http://127.0.0.1:5100; } }
    server { listen 443 ssl; server_name staging.example.com; location / { proxy_pass http://127.0.0.1:5100/; } }
    # server { listen 443; server_name commented.example.com; proxy_pass http://localhost:5100; }
  `;
  assert.deepEqual(stagingProxyOrigins(config), ['https://staging.example.com']);
});

test('conditional probe rejects changed bytes and rechecks the original digest', async () => {
  let stored, gets = 0;
  const client = { async send(command) {
    assert.match(command.input.Key, /^staging\/synthetic\/publishing-live-qa\//);
    if (command.operation === 'put') {
      assert.equal(command.input.IfNoneMatch, '*');
      if (stored) throw { $metadata: { httpStatusCode: 412 } };
      stored = command.input.Body;
      return {};
    }
    gets++;
    return { Body: { transformToByteArray: async () => stored } };
  } };
  const result = await checkConditionalStorage(client, commands, 'citefi', 'staging/synthetic/', Buffer.from('fixture'), run);
  assert.equal(gets, 2);
  assert.equal(result.originalDigestStillMatches, true);
  assert.equal(result.applicationMediaEndpointChecked, false);
});

test('ignored conditional headers and unauthorized scopes fail explicitly', async () => {
  let stored, calls = 0;
  const unsafeClient = { async send(command) {
    calls++;
    if (command.operation === 'put') { stored = command.input.Body; return {}; }
    return { Body: { transformToByteArray: async () => stored } };
  } };
  await assert.rejects(checkConditionalStorage(unsafeClient, commands, 'citefi', '', Buffer.from('x'), run));
  assert.equal(calls, 0);
  await assert.rejects(checkConditionalStorage(unsafeClient, commands, 'citefi', 'staging/synthetic/', Buffer.from('x'), run),
    /did not reject/);
});

test('manual preflight workflow is default-branch-only and does not deploy', () => {
  const w = yaml.load(fs.readFileSync('.github/workflows/verify-staging-publishing-preflight.yml', 'utf8'));
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
  assert.equal(w.on.workflow_dispatch.inputs.confirm_synthetic_storage.default, false);
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.match(w.jobs.verify.if, /inputs.confirm_synthetic_storage.*github.event.repository.default_branch/);
  assert.equal(w.jobs.verify.steps[0].with['persist-credentials'], false);
  assert.equal(w.jobs.verify.steps[1].env.DO_SSH_PRIVATE_KEY, '${{ secrets.DO_SSH_KEY }}');
  const remote = fs.readFileSync('scripts/verify-staging-publishing-preflight.cjs', 'utf8');
  assert.doesNotMatch(remote, /DeleteObject|CreateBucket|child_process|process\.env/);
});
