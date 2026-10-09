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
  assert.deepEqual(w.on.workflow_dispatch.inputs.operation.options, ['inspect', 'setup', 'verify']);
  assert.match(w.jobs.staging.if, /github.event.repository.default_branch/);
  assert.equal(w.jobs.staging.steps[0].with['persist-credentials'], false);
  assert.equal(w.jobs.staging.steps[1].env.DO_SSH_PRIVATE_KEY, '${{ secrets.DO_SSH_KEY }}');
  assert.match(fs.readFileSync('scripts/staging-publishing-server.sh', 'utf8'), /inspect\|setup\|verify/);
});
