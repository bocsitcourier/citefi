#!/usr/bin/env node
// Offline contract for the actual YAML. Unknown jobs/conditions fail closed:
// extending the workflow requires explicitly extending this safety contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
const dependencies = (job) => job.needs === undefined ? [] : [].concat(job.needs).sort();
const expression = (value = '') => value.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '').trim();
const deployCondition = "!inputs.ssh_verify_only && needs.verify-ssh.result == 'success' && needs.validate.result == 'success'";

// Keep the verification job deliberately small. This allowlist is stronger than
// a keyword scan: a new script, action, secret, container or reusable workflow
// cannot smuggle transport/migrations into the verification-only path.
const verificationSteps = [
  { uses: 'actions/checkout@v4' },
  { name: 'Test fail-closed host verification', run: 'bash tests/deployment/ssh-host-key.test.sh' },
  {
    name: 'Verify production ED25519 pin',
    env: {
      DO_HOST: '${{ secrets.DO_HOST }}',
      DO_SSH_HOST_FINGERPRINT: '${{ secrets.DO_SSH_HOST_FINGERPRINT }}',
      KNOWN_HOSTS_FILE: '${{ runner.temp }}/ssh-pin/known_hosts',
    },
    run: 'scripts/verify-ssh-host-key.sh\necho "Production ED25519 host pin verified." >> "$GITHUB_STEP_SUMMARY"\n',
  },
  {
    name: 'Confirm a mismatched production pin is rejected',
    env: {
      DO_HOST: '${{ secrets.DO_HOST }}',
      DO_SSH_HOST_FINGERPRINT: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      KNOWN_HOSTS_FILE: '${{ runner.temp }}/ssh-pin/rejected',
    },
    run: 'if scripts/verify-ssh-host-key.sh 2>"$RUNNER_TEMP/ssh-pin/rejection.log"; then\n'
      + '  echo "ERROR: mismatched pin was accepted." >&2\n  exit 1\nfi\n'
      + 'grep -q \'SSH host fingerprint mismatch\' "$RUNNER_TEMP/ssh-pin/rejection.log"\n'
      + 'test ! -e "$KNOWN_HOSTS_FILE"\n'
      + 'echo "Mismatched host pin rejected before SSH/SCP." >> "$GITHUB_STEP_SUMMARY"\n',
  },
];

function assertContract(w) {
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch'], 'deployment must remain manual');
  assert.deepEqual(w.on.workflow_dispatch.inputs.ssh_verify_only, {
    description: 'Verify the pinned host key only (no deployment or migrations)',
    type: 'boolean', default: false,
  });
  assert.deepEqual(Object.keys(w.jobs).sort(), ['deploy', 'validate', 'verify-ssh'],
    'new jobs must be reviewed for verification-only and pin gates');
  assert.equal(w.env, undefined, 'no workflow-wide secret injection');
  assert.equal(w.defaults, undefined, 'no workflow-wide shell overrides');
  const verify = w.jobs['verify-ssh'];
  assert.deepEqual(Object.keys(verify).sort(), ['name', 'runs-on', 'steps', 'timeout-minutes']);
  assert.equal(verify['runs-on'], 'ubuntu-latest', 'verification must use a clean hosted runner');
  assert.deepEqual(verify.steps, verificationSteps, 'verification job must remain pin-only and fail closed');
  for (const [id, job] of Object.entries(w.jobs)) {
    assert.equal(job['continue-on-error'], undefined, `${id} cannot ignore gate failure`);
    assert.equal(job.uses, undefined, `${id} cannot delegate gates to an unchecked workflow`);
    assert.equal(job.strategy, undefined, `${id} cannot introduce unchecked matrix jobs`);
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined, `${id} steps must fail closed`);
    }
  }
  assert.deepEqual(dependencies(w.jobs.validate), ['verify-ssh']);
  assert.equal(expression(w.jobs.validate.if), '!inputs.ssh_verify_only');
  assert.deepEqual(dependencies(w.jobs.deploy), ['validate', 'verify-ssh']);
  assert.equal(expression(w.jobs.deploy.if), deployCondition);
}
assertContract(workflow);

// PR checks must stay credential-free too. An exact allowlist prevents a
// future CI edit from quietly adding live scans, key loading or release work.
const ciWorkflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deployment-safety.yml'), 'utf8'));
function assertCiContract(w) {
  assert.deepEqual(w, {
    name: 'Deployment safety',
    on: {
      pull_request: {},
    },
    permissions: { contents: 'read' },
    jobs: {
      'deployment-safety': {
        name: 'Offline deployment safety',
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 5,
        steps: [
          { uses: 'actions/checkout@v4', with: { 'persist-credentials': false } },
          { uses: 'actions/setup-node@v4', with: { 'node-version': 22 } },
          {
            name: 'Install YAML parser without lifecycle scripts',
            run: 'mkdir -p "$RUNNER_TEMP/deployment-contract"\n'
              + 'cd "$RUNNER_TEMP/deployment-contract"\n'
              + 'npm install --ignore-scripts --no-audit --no-fund --package-lock=false --userconfig=/dev/null --globalconfig=/dev/null --registry=https://registry.npmjs.org js-yaml@4.3.2\n',
          },
          {
            name: 'Check workflow gates and stubbed host pins',
            run: 'env -i PATH="$PATH" HOME="$RUNNER_TEMP" NODE_PATH="$RUNNER_TEMP/deployment-contract/node_modules" node tests/deployment/workflow-gates.test.cjs\n',
          },
        ],
      },
    },
  }, 'PR safety checks must run offline without credentials or deployment');
}
assertCiContract(ciWorkflow);
const ciMutations = [
  ['privileged PR event', (w) => { w.on.pull_request_target = w.on.pull_request; delete w.on.pull_request; }],
  ['path filter strands unrelated required checks', (w) => { w.on.pull_request.paths = ['tests/deployment/**']; }],
  ['ignored paths strand required checks', (w) => { w.on.pull_request['paths-ignore'] = ['docs/**']; }],
  ['branch filter strands required checks', (w) => { w.on.pull_request.branches = ['release/**']; }],
  ['renamed required check', (w) => { w.jobs['deployment-safety'].name = 'Deployment tests'; }],
  ['skipped required job', (w) => { w.jobs['deployment-safety'].if = '${{ false }}'; }],
  ['write permission', (w) => { w.permissions.contents = 'write'; }],
  ['persisted checkout credential', (w) => { w.jobs['deployment-safety'].steps[0].with['persist-credentials'] = true; }],
  ['credential-bearing runner', (w) => { w.jobs['deployment-safety']['runs-on'] = 'self-hosted'; }],
  ['secret injection', (w) => { w.env = { DO_SSH_PRIVATE_KEY: '${{ secrets.DO_SSH_KEY }}' }; }],
  ['ignored test failure', (w) => { w.jobs['deployment-safety']['continue-on-error'] = true; }],
  ['skipped safety test', (w) => { w.jobs['deployment-safety'].steps[3].if = '${{ false }}'; }],
  ['live host scan', (w) => { w.jobs['deployment-safety'].steps.push({ run: 'scripts/verify-ssh-host-key.sh' }); }],
  ['deployment command', (w) => { w.jobs['deployment-safety'].steps.push({ run: 'scripts/deploy-to-do.sh' }); }],
  ['migration command', (w) => { w.jobs['deployment-safety'].steps.push({ run: 'npm run db:push' }); }],
  ['application install with hooks', (w) => { w.jobs['deployment-safety'].steps[2].run = 'npm ci'; }],
  ['offline tests removed', (w) => { w.jobs['deployment-safety'].steps.pop(); }],
];
for (const [name, mutate] of ciMutations) {
  const changed = structuredClone(ciWorkflow);
  mutate(changed);
  assert.throws(() => assertCiContract(changed), undefined, `CI regression not caught: ${name}`);
}

// Evaluate only the explicitly supported GitHub expressions, never JS eval.
// No status-check function is present, so GitHub implicitly adds success():
// failed, cancelled and skipped dependencies all prevent a job from starting.
function eligible(job, verifyOnly, results) {
  if (!dependencies(job).every((id) => results[id] === 'success')) return false;
  const condition = expression(job.if);
  if (!condition) return true;
  if (condition === '!inputs.ssh_verify_only') return !verifyOnly;
  assert.equal(condition, deployCondition, 'unsupported job condition');
  return !verifyOnly && results['verify-ssh'] === 'success' && results.validate === 'success';
}

for (const verifyOnly of [true, false]) {
  for (const pinResult of ['success', 'failure', 'cancelled', 'skipped']) {
    for (const validationResult of ['success', 'failure', 'cancelled', 'skipped']) {
      const results = { 'verify-ssh': pinResult, validate: validationResult };
      assert.equal(eligible(workflow.jobs.validate, verifyOnly, results), !verifyOnly && pinResult === 'success');
      assert.equal(eligible(workflow.jobs.deploy, verifyOnly, results),
        !verifyOnly && pinResult === 'success' && validationResult === 'success');
    }
  }
}

// Prove the contract rejects representative future regressions, including
// seemingly innocuous new jobs that have not declared either safety gate.
const mutations = [
  ['ungated new job', (w) => { w.jobs.migrate = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'npm run db:push' }] }; }],
  ['automatic pull-request deployment', (w) => { w.on.pull_request = {}; }],
  ['automatic push deployment', (w) => { w.on.push = {}; }],
  ['validate bypass', (w) => { delete w.jobs.validate.if; }],
  ['validate always', (w) => { w.jobs.validate.if = '${{ always() }}'; }],
  ['validate loses pin dependency', (w) => { delete w.jobs.validate.needs; }],
  ['deploy loses pin dependency', (w) => { w.jobs.deploy.needs = 'validate'; }],
  ['deploy loses release dependency', (w) => { w.jobs.deploy.needs = 'verify-ssh'; }],
  ['deploy bypass', (w) => { delete w.jobs.deploy.if; }],
  ['deploy always', (w) => { w.jobs.deploy.if = '${{ always() }}'; }],
  ['ignored pin failure', (w) => { w.jobs['verify-ssh']['continue-on-error'] = true; }],
  ['ignored live failure', (w) => { w.jobs['verify-ssh'].steps[2]['continue-on-error'] = true; }],
  ['private key in verifier', (w) => { w.jobs['verify-ssh'].env = { DO_SSH_PRIVATE_KEY: '${{ secrets.DO_SSH_KEY }}' }; }],
  ['global private key', (w) => { w.env = { DO_SSH_PRIVATE_KEY: '${{ secrets.DO_SSH_KEY }}' }; }],
  ['verify invokes deploy', (w) => { w.jobs['verify-ssh'].steps.push({ run: 'scripts/deploy-to-do.sh' }); }],
  ['verify invokes migration', (w) => { w.jobs['verify-ssh'].steps.push({ run: 'npm run db:push' }); }],
  ['verify loads key action', (w) => { w.jobs['verify-ssh'].steps.push({ uses: 'webfactory/ssh-agent@v0.9.0' }); }],
  ['live pin removed', (w) => { w.jobs['verify-ssh'].steps.splice(2, 1); }],
  ['wrong pin removed', (w) => { w.jobs['verify-ssh'].steps.pop(); }],
  ['verification skipped', (w) => { w.jobs['verify-ssh'].if = '${{ false }}'; }],
  ['verification on credential-bearing host', (w) => { w.jobs['verify-ssh']['runs-on'] = 'self-hosted'; }],
];
for (const [name, mutate] of mutations) {
  const changed = structuredClone(workflow);
  mutate(changed);
  assert.throws(() => assertContract(changed), undefined, `regression not caught: ${name}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-gates-'));
try {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/verify-ssh-host-key.sh'), path.join(tmp, 'scripts/verify-ssh-host-key.sh'));
  fs.chmodSync(path.join(tmp, 'scripts/verify-ssh-host-key.sh'), 0o700);
  const executable = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\nset -euo pipefail\n${body}\n`, { mode: 0o700 });
  executable('keyscan', 'printf "example ssh-ed25519 AAAATEST\\n"');
  executable('keygen', 'cat >/dev/null; echo "256 SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB example (ED25519)"');
  // Also block default scanner/parser names: ignoring the injected fixtures
  // must fail locally, never fall through to a real host scan or key command.
  for (const name of ['ssh', 'scp', 'sftp', 'ssh-add', 'ssh-keyscan', 'ssh-keygen']) {
    executable(name, 'echo forbidden >> "$TRACE"; exit 99');
  }
  // No inherited credentials, NODE_OPTIONS, database URLs or SSH agent.
  const baseEnv = {
    PATH: `${bin}:${process.env.PATH}`, HOME: tmp,
    SSH_KEYSCAN_BIN: path.join(bin, 'keyscan'), SSH_KEYGEN_BIN: path.join(bin, 'keygen'),
  };
  for (const verifyOnly of [true, false]) {
    for (const pin of ['matching', 'missing', 'wrong']) {
      const dir = path.join(tmp, `${verifyOnly}-${pin}`);
      fs.mkdirSync(dir);
      const trace = path.join(dir, 'trace');
      const summary = path.join(dir, 'summary');
      const run = (script, extra = {}) => spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
        cwd: tmp, env: { ...baseEnv, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summary, TRACE: trace, ...extra },
        encoding: 'utf8', timeout: 10000,
      });
      let result = 'success';
      // Run the real live-pin and wrong-pin YAML commands against offline scan
      // fixtures. The shell parser/fingerprint unit suite runs separately.
      for (const step of workflow.jobs['verify-ssh'].steps.slice(2)) {
        const env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key,
          value.replace('${{ runner.temp }}', dir)
            .replace('${{ secrets.DO_HOST }}', 'example')
            .replace('${{ secrets.DO_SSH_HOST_FINGERPRINT }}',
              pin === 'matching' ? 'SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
                : pin === 'missing' ? '' : 'SHA256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'),
        ]));
        const child = run(step.run, env);
        assert.equal(child.error, undefined);
        if (child.status !== 0) { result = 'failure'; break; }
      }
      assert.equal(result, pin === 'matching' ? 'success' : 'failure');
      const results = { 'verify-ssh': result };
      // Replace ALL release steps with recording commands: no package install,
      // build, credentials, deployment or migrations can actually run here.
      for (const id of ['validate', 'deploy']) {
        if (!eligible(workflow.jobs[id], verifyOnly, results)) { results[id] = 'skipped'; continue; }
        const markers = id === 'validate' ? 'release-validation' : 'private-key-load deploy-runner ssh scp migrations';
        const child = run(`printf '%s\\n' ${markers} >> "$TRACE"`);
        assert.equal(child.status, 0, child.stderr);
        results[id] = 'success';
      }
      const actual = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n') : [];
      assert.deepEqual(actual, !verifyOnly && pin === 'matching'
        ? ['release-validation', 'private-key-load', 'deploy-runner', 'ssh', 'scp', 'migrations'] : [],
      `unsafe release/transport path: verifyOnly=${verifyOnly}, pin=${pin}`);
      if (pin === 'matching') {
        assert.match(fs.readFileSync(summary, 'utf8'), /Production ED25519 host pin verified/);
        assert.match(fs.readFileSync(summary, 'utf8'), /Mismatched host pin rejected before SSH\/SCP/);
      } else {
        assert.equal(fs.existsSync(path.join(dir, 'ssh-pin/known_hosts')), false);
      }
      assert.equal(fs.existsSync(path.join(dir, 'ssh-pin/rejected')), false);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('PR CI safety, workflow pin gates, verification-only isolation, and mutation regressions passed');
