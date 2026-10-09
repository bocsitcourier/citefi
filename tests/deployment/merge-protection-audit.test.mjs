import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { auditMergeProtection, main, POLICY } from '../../scripts/audit-merge-protection.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const status = {
  type: 'required_status_checks',
  parameters: {
    required_status_checks: [{ context: POLICY.context, integration_id: POLICY.integrationId }],
    strict_required_status_checks_policy: true,
    do_not_enforce_on_create: false,
  },
};
function fixture() {
  const detail = {
    id: 42, target: 'branch', enforcement: 'active', bypass_actors: [],
    rules: [{ type: 'pull_request' }, structuredClone(status)],
  };
  return {
    details: { 42: detail },
    rules: detail.rules.map(rule => ({
      ...structuredClone(rule), ruleset_id: 42,
      ruleset_source_type: 'Repository', ruleset_source: POLICY.repository,
    })),
    calls: [],
  };
}
function fakeApi(f) {
  return async (url, options) => {
    assert.equal(options.method, 'GET', 'audit must never mutate GitHub');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(new URL(url).origin, 'https://api.github.com');
    f.calls.push(url);
    if (f.throwNetwork) throw new Error('private credential must not leak');
    const path = new URL(url).pathname;
    const isRules = path.endsWith('/rules/branches/main');
    const error = isRules ? f.rulesError : f.detailError;
    if (error) return { ok: false, status: error, json: async () => { throw new Error('must not read errors'); } };
    let data = isRules ? f.rules : f.details[path.split('/').at(-1)];
    if (isRules && f.paginated) {
      data = new URL(url).searchParams.get('page') === '1' ? Array(100).fill(f.rules[0]) : f.rules.slice(1);
    }
    if (isRules && f.drift && f.calls.filter(call => call.includes('/rules/branches/')).length > 1) data = [];
    return { ok: true, json: async () => {
      if (f.invalidJson) throw new Error('private response must not leak');
      return structuredClone(data);
    } };
  };
}
const run = f => auditMergeProtection({ fetchImpl: fakeApi(f), token: 'synthetic-test-token' });
function updateStatus(f, mutate) {
  mutate(f.details[42].rules[1]);
  Object.assign(f.rules[1], structuredClone(f.details[42].rules[1]));
}

test('active effective protections pass using GET only, including a final drift check', async () => {
  const f = fixture();
  assert.equal((await run(f)).status, 'passed');
  assert.equal(f.calls.length, 3);
});

for (const enforcement of ['disabled', 'evaluate']) {
  test(`${enforcement} rules are not effective and cannot satisfy protection`, async () => {
    const f = fixture();
    f.details[42].enforcement = enforcement;
    f.rules = []; // GitHub excludes disabled/evaluate rules from the effective endpoint.
    const result = await run(f);
    assert.equal(result.status, 'weakened');
    assert.equal(result.failures.length, 3);
  });
  test(`inconsistent effective endpoint with ${enforcement} details fails`, async () => {
    const f = fixture();
    f.details[42].enforcement = enforcement;
    assert.match((await run(f)).failures.join('\n'), /not active/);
  });
}

test('deleted ruleset or retargeting away from main fails even if YAML is unchanged', async () => {
  const f = fixture();
  f.rules = [];
  assert.equal((await run(f)).status, 'weakened');
});
test('missing PR requirement fails', async () => {
  const f = fixture();
  f.rules.shift();
  assert.match((await run(f)).failures.join('\n'), /pull-request/);
});
for (const source of [null, undefined, -1, 9999, '15368']) {
  test(`untrusted check source ${source} fails`, async () => {
    const f = fixture();
    updateStatus(f, rule => { rule.parameters.required_status_checks[0].integration_id = source; });
    assert.match((await run(f)).failures.join('\n'), /context or source/);
  });
}
test('changed check context fails', async () => {
  const f = fixture();
  updateStatus(f, rule => { rule.parameters.required_status_checks[0].context = 'Deployment safety'; });
  assert.equal((await run(f)).status, 'weakened');
});
for (const strict of [false, undefined, 'true']) {
  test(`non-strict branch requirement ${strict} fails`, async () => {
    const f = fixture();
    updateStatus(f, rule => { rule.parameters.strict_required_status_checks_policy = strict; });
    assert.match((await run(f)).failures.join('\n'), /up to date/);
  });
}
test('creation exemption fails', async () => {
  const f = fixture();
  updateStatus(f, rule => { rule.parameters.do_not_enforce_on_create = true; });
  assert.match((await run(f)).failures.join('\n'), /creation/);
});
for (const actor_type of ['OrganizationAdmin', 'RepositoryRole', 'Team', 'Integration', 'User', 'DeployKey']) {
  for (const bypass_mode of ['always', 'pull_request', 'exempt']) {
    test(`${actor_type} ${bypass_mode} bypass fails`, async () => {
      const f = fixture();
      f.details[42].bypass_actors = [{ actor_type, actor_id: 1, bypass_mode }];
      assert.match((await run(f)).failures.join('\n'), /bypass actor/);
    });
  }
}
test('hidden bypass actors cannot silently pass', async () => {
  const f = fixture();
  delete f.details[42].bypass_actors;
  const result = await run(f);
  assert.equal(result.status, 'unverifiable');
  assert.match(result.unknowns.join('\n'), /write visibility/);
});
test('inherited and split active rules can satisfy policy without pinning a ruleset ID', async () => {
  const f = fixture();
  f.details[73] = { ...structuredClone(f.details[42]), id: 73, rules: [f.details[42].rules.pop()] };
  f.rules[1].ruleset_id = 73;
  f.rules[1].ruleset_source_type = 'Organization';
  f.rules[1].ruleset_source = 'bocsitcourier';
  assert.equal((await run(f)).status, 'passed');
  f.details[73].bypass_actors = [{ actor_type: 'OrganizationAdmin' }];
  assert.equal((await run(f)).status, 'weakened');
});
test('pagination does not miss PR/status requirements beyond first page', async () => {
  const f = fixture();
  f.paginated = true;
  assert.equal((await run(f)).status, 'passed');
  assert.ok(f.calls.some(url => url.includes('page=2')));
});
for (const code of [401, 403, 404, 429, 500]) {
  for (const endpoint of ['rulesError', 'detailError']) {
    test(`${endpoint} HTTP ${code} cannot silently pass`, async () => {
      const f = fixture();
      f[endpoint] = code;
      const result = await run(f);
      assert.equal(result.status, 'unverifiable');
      assert.match(result.unknowns.join('\n'), new RegExp(`HTTP ${code}`));
    });
  }
}
for (const mode of ['throwNetwork', 'invalidJson', 'drift']) {
  test(`${mode} is unverifiable and sanitized`, async () => {
    const f = fixture();
    f[mode] = true;
    const result = await run(f);
    assert.equal(result.status, 'unverifiable');
    assert.doesNotMatch(JSON.stringify(result), /private credential|private response|synthetic-test-token/);
  });
}
test('detail changes and malformed responses cannot pass', async () => {
  for (const mutate of [
    f => { f.rules = {}; },
    f => { f.rules[0].ruleset_id = null; },
    f => { f.details[42].id = 99; },
    f => { f.details[42].bypass_actors = null; },
    f => { f.details[42].rules.pop(); },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal((await run(f)).status, 'unverifiable');
  }
});
test('CLI reporting has distinct exit codes, summary and Actions error annotation', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'merge-audit-'));
  try {
    for (const expected of [0, 1, 2]) {
      const f = fixture();
      if (expected === 1) f.rules = [];
      if (expected === 2) f.detailError = 403;
      const output = [];
      const summary = join(tmp, `summary-${expected}`);
      const code = await main({
        env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary },
        fetchImpl: fakeApi(f), stdout: text => output.push(text),
      });
      assert.equal(code, expected);
      assert.match(readFileSync(summary, 'utf8'), /GitHub merge protection/);
      assert.equal(output.some(text => text.startsWith('::error')), expected !== 0);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
test('scheduled audit stays separate from PRs, GET-only and free of deploy credentials/hooks', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/merge-protection-audit.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow, {
    name: 'Merge protection audit',
    on: { schedule: [{ cron: '17 8 * * *' }], workflow_dispatch: {} },
    permissions: { contents: 'read' },
    jobs: { audit: {
      name: 'Audit live main merge protections', 'runs-on': 'ubuntu-latest', 'timeout-minutes': 5,
      steps: [
        { uses: 'actions/checkout@v4', with: { 'persist-credentials': false } },
        { uses: 'actions/setup-node@v4', with: { 'node-version': 22 } },
        {
          name: 'Read effective rules and report protection drift',
          env: { MERGE_PROTECTION_AUDIT_TOKEN: '${{ secrets.MERGE_PROTECTION_AUDIT_TOKEN }}' },
          run: 'node scripts/audit-merge-protection.mjs',
        },
      ],
    } },
  });
});
