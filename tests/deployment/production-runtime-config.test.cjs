const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = require('../../ecosystem.config.cjs');

test('only the two production processes load existing recovery settings before the shared app environment', () => {
  assert.deepEqual(config.apps.map(app => app.name), ['citefi-web', 'citefi-worker']);
  for (const app of config.apps) {
    assert.equal(app.interpreter_args,
      '--import tsx/esm --env-file=/var/www/citefi/ops-recovery/recovery.env --env-file=.env.local');
    assert.equal(app.env.NODE_OPTIONS, undefined);
    assert.equal(app.env.DATABASE_URL, undefined);
    assert.equal(app.env.GEMINI_API_KEY, undefined);
    assert.equal(app.env.OPENAI_API_KEY, undefined);
    assert.equal(app.env.DEPLOYMENT_STATUS_FILE, '/var/www/citefi/.deploy/release-status.json');
  }
});

test('Node retains recovery readiness settings and gives app settings precedence without changing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-env-test-'));
  try {
    const recovery = 'CANARY_ACCOUNTING_TEAM_ID=42\nBACKUP_STATUS_FILE=/shared/status.json\nPORT=5100\n';
    const app = 'PORT=5000\n';
    fs.writeFileSync(path.join(root, 'recovery.env'), recovery);
    fs.writeFileSync(path.join(root, '.env.local'), app);
    const output = execFileSync(process.execPath, [
      '--env-file=recovery.env', '--env-file=.env.local', '-e',
      'console.log(JSON.stringify({team:process.env.CANARY_ACCOUNTING_TEAM_ID,backup:process.env.BACKUP_STATUS_FILE,port:process.env.PORT}))',
    ], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), { team: '42', backup: '/shared/status.json', port: '5000' });
    assert.equal(fs.readFileSync(path.join(root, 'recovery.env'), 'utf8'), recovery);
    assert.equal(fs.readFileSync(path.join(root, '.env.local'), 'utf8'), app);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
