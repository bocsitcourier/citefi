const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const ROOT = '/var/www/citefi-staging';
const QA_ROOT = `${ROOT}/publishing-qa`;
let phase = 'preflight';

function commandResult(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000 });
  return { ok: result.status === 0, output: result.stdout || '' };
}

function serverBlocks(text) {
  const clean = text.replace(/#[^\n]*/g, '');
  return [...clean.matchAll(/\bserver\s*\{/g)].flatMap(start => {
    let depth = 1, end = start.index + start[0].length;
    const beginning = end;
    while (end < clean.length && depth) {
      if (clean[end] === '{') depth++;
      if (clean[end] === '}') depth--;
      end++;
    }
    return depth ? [] : [clean.slice(beginning, end - 1)];
  });
}

function publicTlsRoutes() {
  const routes = [];
  try {
    for (const filename of fs.readdirSync('/etc/nginx/sites-enabled')) {
      const file = path.join('/etc/nginx/sites-enabled', filename);
      if (fs.statSync(file).size > 128 * 1024) continue;
      for (const block of serverBlocks(fs.readFileSync(file, 'utf8'))) {
        if (!/\blisten\s+[^;]*\b443\b[^;]*;/.test(block)) continue;
        const domains = (block.match(/\bserver_name\s+([^;]+);/)?.[1] || '').split(/\s+/)
          .filter(name => /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(name) && name.includes('.'));
        const certificate = block.match(/\bssl_certificate\s+([^;\s]+)\s*;/)?.[1];
        const certificateKey = block.match(/\bssl_certificate_key\s+([^;\s]+)\s*;/)?.[1];
        if (domains.length && certificate?.startsWith('/') && certificateKey?.startsWith('/')) {
          routes.push({ domains, certificate, certificateKey });
        }
      }
    }
  } catch { /* Do not disclose filesystem exception details. */ }
  return routes;
}

function inspect() {
  const appRoots = [path.join(ROOT, 'current'), ROOT].filter(dir => fs.existsSync(dir));
  const tls = publicTlsRoutes();
  let processNames = [];
  try {
    const dump = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pm2/dump.pm2'), 'utf8'));
    processNames = dump.map(item => item.name).filter(name => typeof name === 'string' && name.startsWith('citefi-staging'));
  } catch { /* A missing saved PM2 list is not evidence of running services. */ }
  return {
    operation: 'inspect-staging-publishing-server',
    infrastructureAdministrator: process.getuid() === 0,
    staging: appRoots.map(dir => ({
      directory: dir, built: fs.existsSync(path.join(dir, '.next/BUILD_ID')),
      dependencies: fs.existsSync(path.join(dir, 'node_modules')),
      exactMediaRouteSource: fs.existsSync(path.join(dir, 'app/api/publishing/review-media/route.ts')),
      receiverSource: fs.existsSync(path.join(dir, 'packages/apex-receiver/src/index.ts')),
      bootstrapSource: fs.existsSync(path.join(dir, 'scripts/process-bootstrap.ts')),
    })),
    savedStagingProcessNames: processNames,
    publicTlsDomains: tls.flatMap(route => route.domains),
    existingCertificatePairs: tls.length,
    privilegedOperationsAvailable: process.getuid() === 0 || commandResult('sudo', ['-n', 'true']).ok,
    existingNginxConfigurationValid: process.getuid() === 0
      ? commandResult('nginx', ['-t']).ok : commandResult('sudo', ['-n', 'nginx', '-t']).ok,
    nodeVersion: process.version,
    availableMemoryMiB: Math.floor(os.freemem() / 1024 / 1024),
    dependencyFailures: ['dependency-install.log', 'receiver-dependency-install.log'].flatMap(name => {
      try {
        const text = fs.readFileSync(`${QA_ROOT}/${name}`, 'utf8');
        return [{ stage: name, codes: [...text.matchAll(/^npm (?:error|ERR!) code ([A-Z0-9_]+)/gm)].map(match => match[1]),
          lockMismatches: text.split('\n').filter(line => /^npm (?:error|ERR!) (?:Missing:|Invalid:)/.test(line))
            .map(line => line.replace(/[^a-zA-Z0-9@./_:+~^ '=-]/g, '').slice(0, 180)).slice(0, 12),
        }];
      } catch { return []; }
    }),
    productionChanged: false,
  };
}

function stageRoot() {
  if (process.getuid() !== 0 || fs.realpathSync(ROOT) !== ROOT) throw new Error('Fixed staging infrastructure administrator required');
  const record = commandResult('getent', ['passwd', 'citefi']).output.trim().split(':');
  if (record[0] !== 'citefi' || !/^\d+$/.test(record[2]) || !/^\d+$/.test(record[3])) throw new Error('Staging service account missing');
  return { uid: Number(record[2]), gid: Number(record[3]), home: record[5] };
}

function prepare() {
  const account = stageRoot();
  if (fs.existsSync(QA_ROOT) && fs.realpathSync(QA_ROOT) !== QA_ROOT) throw new Error('Staging QA root is a link');
  fs.mkdirSync(QA_ROOT, { recursive: true, mode: 0o700 });
  fs.chownSync(QA_ROOT, account.uid, account.gid);
  const incoming = `${QA_ROOT}/incoming`;
  fs.mkdirSync(incoming, { mode: 0o700, recursive: true });
  if (fs.realpathSync(incoming) !== incoming) throw new Error('Staging incoming directory is a link');
  // Only root can replace the source archive between integrity check and extraction.
  fs.chownSync(incoming, 0, 0);
  fs.chmodSync(incoming, 0o700);
  return account;
}

function run(command, args, timeout = 30000, logFile) {
  const fd = logFile ? fs.openSync(logFile, 'a', 0o600) : undefined;
  const result = spawnSync(command, args, {
    timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    stdio: logFile ? ['ignore', fd, fd] : ['ignore', 'pipe', 'pipe'],
  });
  if (fd !== undefined) fs.closeSync(fd);
  if (result.status !== 0) {
    const error = new Error('Fixed staging command failed');
    error.status = result.status; error.code = result.error?.code;
    throw error;
  }
  return result.stdout || '';
}

function ownedWrite(file, contents, account) {
  if (!file.startsWith(`${QA_ROOT}/`) || (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())) throw new Error('Invalid staging file');
  const temporary = `${file}.tmp-${randomBytes(8).toString('hex')}`;
  fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
  fs.chownSync(temporary, account.uid, account.gid);
  fs.renameSync(temporary, file);
}

function envText(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z0-9_]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('Unsupported staging environment value');
    return `${key}=${JSON.stringify(value)}`;
  }).join('\n') + '\n';
}

function isolatedEnv(env) {
  const database = env.DATABASE_URL || env.NEON_DATABASE_URL;
  const url = new URL(database);
  const redis = new URL(env.REDIS_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/citefi_staging' ||
      redis.protocol !== 'redis:' || !['localhost', '127.0.0.1', '[::1]'].includes(redis.hostname) || redis.pathname !== '/1' ||
      env.STORAGE_PREFIX !== 'staging/synthetic/' || env.DO_SPACES_BUCKET !== 'citefi' ||
      env.DO_SPACES_ENDPOINT !== 'https://nyc3.digitaloceanspaces.com' ||
      !env.DO_SPACES_KEY || !env.DO_SPACES_SECRET) throw new Error('Staging isolation/storage configuration failed');
  return database;
}

async function setup(expectedHash) {
  const account = prepare();
  phase = 'validate-source-integrity';
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Pinned source digest required');
  const archive = `${QA_ROOT}/incoming/source.tar.gz`;
  if (fs.realpathSync(archive) !== archive || fs.statSync(archive).size > 32 * 1024 * 1024 ||
      createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== expectedHash) throw new Error('Source archive integrity failed');
  const stageRequire = createRequire(`${ROOT}/package.json`);
  const envFile = `${ROOT}/.env.local`;
  if (!fs.realpathSync(envFile).startsWith(`${ROOT}/`)) throw new Error('Staging environment outside staging root');
  const stageEnv = stageRequire('dotenv').parse(fs.readFileSync(envFile));
  phase = 'validate-saved-staging-isolation';
  const database = isolatedEnv(stageEnv);
  phase = 'validate-existing-tls-certificate';
  const tls = publicTlsRoutes().find(route => route.domains.includes('citefi.co'));
  if (!tls || !commandResult('openssl', ['x509', '-in', tls.certificate, '-noout', '-checkend', '86400']).ok) throw new Error('Existing public certificate unavailable');
  phase = 'extract-pinned-staging-source';
  const listing = run('tar', ['-tzf', archive]);
  for (const entry of listing.split('\n').filter(Boolean)) {
    if (entry.startsWith('/') || entry.split('/').includes('..') || entry.split('/').some(part => part === '.env' || part === '.env.local' || part === 'node_modules')) throw new Error('Unsafe source archive entry');
  }
  const details = run('tar', ['-tvzf', archive]);
  if (details.split('\n').some(line => /^[lh]/.test(line))) throw new Error('Source archive may not contain links');
  const source = `${QA_ROOT}/source-${expectedHash}`;
  fs.mkdirSync(source, { mode: 0o700, recursive: true });
  if (fs.realpathSync(source) !== source) throw new Error('Staging source directory is a link');
  fs.chownSync(source, account.uid, account.gid);
  // The unprivileged service account cannot traverse the root-owned incoming directory.
  const extractionArchive = `${source}/.incoming-source.tar.gz`;
  fs.copyFileSync(archive, extractionArchive);
  fs.chownSync(extractionArchive, account.uid, account.gid);
  run('runuser', ['-u', 'citefi', '--', 'tar', '-xzf', extractionArchive, '--no-same-owner', '--no-same-permissions', '-C', source]);
  fs.unlinkSync(extractionArchive);
  phase = 'install-staging-only-dependencies';
  if (!fs.existsSync(`${source}/node_modules/next/package.json`)) {
    run('runuser', ['-u', 'citefi', '--', 'env', `HOME=${account.home}`, 'npm', 'ci',
      '--prefix', source, '--ignore-scripts', '--no-audit', '--no-fund'], 360000, `${QA_ROOT}/dependency-install.log`);
  }
  if (!fs.existsSync(`${source}/packages/apex-receiver/node_modules/helmet/package.json`)) {
    run('runuser', ['-u', 'citefi', '--', 'env', `HOME=${account.home}`, 'npm', 'install',
      '--prefix', `${source}/packages/apex-receiver`, '--ignore-scripts', '--no-audit', '--no-fund'],
    180000, `${QA_ROOT}/receiver-dependency-install.log`);
  }
  phase = 'configure-private-staging-signing';
  let existing = {};
  const liveFile = `${QA_ROOT}/live-tests.env`;
  if (fs.existsSync(liveFile) && !fs.lstatSync(liveFile).isSymbolicLink()) existing = stageRequire('dotenv').parse(fs.readFileSync(liveFile));
  const signing = existing.QA_LIVE_SIGNING_SECRET?.length >= 32 ? existing.QA_LIVE_SIGNING_SECRET : randomBytes(32).toString('hex');
  const receiverKey = existing.QA_LIVE_RECEIVER_KEY?.length >= 32 ? existing.QA_LIVE_RECEIVER_KEY : randomBytes(32).toString('hex');
  const storage = Object.fromEntries(['DO_SPACES_BUCKET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_KEY', 'DO_SPACES_SECRET', 'STORAGE_PREFIX'].map(key => [key, stageEnv[key]]));
  ownedWrite(liveFile, envText({
    ...storage, QA_LIVE_APP_URL: 'https://citefi.co:8443', QA_LIVE_RECEIVER_URL: 'https://citefi.co:8444',
    QA_LIVE_SIGNING_SECRET: signing, QA_LIVE_RECEIVER_KEY: receiverKey,
  }), account);
  // Use a separate staging runtime environment. Never rotate production or
  // overwrite the shared staging environment used by the old release.
  const runtimeEnv = {
    ...storage, DATABASE_URL: database, NEON_DATABASE_URL: database, DATABASE_POOLED_URL: database,
    REDIS_URL: stageEnv.REDIS_URL, SESSION_SECRET: signing,
    NEXTAUTH_URL: 'https://citefi.co:8443', NEXT_PUBLIC_APP_URL: 'https://citefi.co:8443',
    DEPLOY_ENVIRONMENT: 'staging', WORKER_PROCESS: 'false',
    OPENAI_API_KEY: 'qa-isolated-disabled-openai', GEMINI_API_KEY: 'qa-isolated-disabled-gemini',
  };
  for (const key of ['JWT_SECRET', 'CSRF_SECRET', 'APPROVAL_TOKEN_SECRET', 'API_KEY_ENCRYPTION_SECRET']) {
    runtimeEnv[key] = stageEnv[key] || randomBytes(32).toString('hex');
  }
  ownedWrite(`${source}/.env.local`, envText(runtimeEnv), account);
  ownedWrite(`${QA_ROOT}/receiver.env`, envText({
    CITEFI_API_KEY: receiverKey, APEX_ENGINE_URL: 'https://citefi.co:8443', BASE_URL: 'https://citefi.co:8444',
    STORAGE_PATH: `${QA_ROOT}/receiver/uploads`, PORT: '5110', DEBUG: 'false',
  }), account);
  fs.mkdirSync(`${QA_ROOT}/receiver/uploads`, { recursive: true, mode: 0o700 });
  for (const directory of [`${QA_ROOT}/receiver`, `${QA_ROOT}/receiver/uploads`]) fs.chownSync(directory, account.uid, account.gid);
  if (!fs.existsSync(`${QA_ROOT}/ambiguous-jobs.json`)) ownedWrite(`${QA_ROOT}/ambiguous-jobs.json`, '[]', account);
  phase = 'start-only-staging-processes';
  const pm2 = (...args) => run('runuser', ['-u', 'citefi', '--', 'env', `HOME=${account.home}`, `PM2_HOME=${account.home}/.pm2`, 'pm2', ...args]);
  const processes = JSON.parse(pm2('jlist'));
  for (const name of ['citefi-staging-web', 'citefi-staging-worker', 'citefi-publishing-staging-web', 'citefi-publishing-staging-receiver']) {
    if (processes.some(item => item.name === name)) pm2('stop', name);
  }
  for (const name of ['citefi-publishing-staging-web', 'citefi-publishing-staging-receiver']) {
    if (processes.some(item => item.name === name)) pm2('delete', name);
  }
  pm2('start', `${source}/node_modules/next/dist/bin/next`, '--name', 'citefi-publishing-staging-web',
    '--namespace', 'citefi-staging', '--cwd', source, '--interpreter', 'node',
    '--node-args', '--env-file=.env.local', '--', 'dev', '--webpack', '-H', '127.0.0.1', '-p', '5100');
  pm2('start', `${source}/QA/support/staging-real-receiver.ts`, '--name', 'citefi-publishing-staging-receiver',
    '--namespace', 'citefi-staging', '--cwd', source, '--interpreter', 'node',
    '--node-args', `--env-file=${QA_ROOT}/receiver.env --import tsx`);
  pm2('save');
  phase = 'configure-dedicated-staging-tls-ports';
  const configuration = `/etc/nginx/conf.d/citefi-publishing-staging.conf`;
  if (fs.existsSync(configuration) && fs.lstatSync(configuration).isSymbolicLink()) throw new Error('Staging proxy file is a link');
  const config = [[8443, 5100], [8444, 5110]].map(([port, upstream]) => `server {
  listen ${port} ssl;
  server_name citefi.co;
  ssl_certificate ${tls.certificate};
  ssl_certificate_key ${tls.certificateKey};
  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:${upstream};
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
  }
}
`).join('\n');
  const previous = fs.existsSync(configuration) ? fs.readFileSync(configuration) : null;
  fs.writeFileSync(configuration, config, { mode: 0o644 });
  try { run('nginx', ['-t']); }
  catch (error) {
    if (previous) fs.writeFileSync(configuration, previous);
    else fs.unlinkSync(configuration);
    throw error;
  }
  const firewall = commandResult('ufw', ['status']).output;
  if (/Status: active/.test(firewall)) {
    run('ufw', ['allow', '8443/tcp']); run('ufw', ['allow', '8444/tcp']);
  }
  run('systemctl', ['reload', 'nginx']);
  ownedWrite(`${QA_ROOT}/setup.json`, JSON.stringify({
    source, sourceSha256: expectedHash, appUrl: 'https://citefi.co:8443', receiverUrl: 'https://citefi.co:8444',
    productionApplicationChanged: false, productionDataChanged: false, productionCredentialsRotated: false,
    sharedProxyCheckedReload: true, paidGenerationEnabled: false,
  }), account);
  phase = 'verify-real-https-readiness';
  let appStatus = 0, receiverStatus = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      appStatus = (await fetch('https://citefi.co:8443/api/publishing/review-media', { signal: AbortSignal.timeout(20000) })).status;
      receiverStatus = (await fetch('https://citefi.co:8444/api/v1/status/ping', { signal: AbortSignal.timeout(10000) })).status;
      if (appStatus === 404 && receiverStatus === 200) break;
    } catch { /* Transient first compilation or process startup. */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (appStatus !== 404 || receiverStatus !== 200) throw new Error('Staging HTTPS readiness failed');
  return {
    operation: 'setup-staging-publishing-server', success: true, sourceSha256: expectedHash,
    appUrl: 'https://citefi.co:8443', receiverUrl: 'https://citefi.co:8444',
    unsignedMediaRequestStatus: appStatus, realReceiverHealthStatus: receiverStatus,
    paidGenerationEnabled: false, productionApplicationChanged: false,
    productionDataChanged: false, productionCredentialsRotated: false, sharedProxyCheckedReload: true,
    fullAcceptancePassed: false,
  };
}

function verify() {
  const account = stageRoot();
  const setupInfo = JSON.parse(fs.readFileSync(`${QA_ROOT}/setup.json`, 'utf8'));
  if (!setupInfo.source.startsWith(`${QA_ROOT}/source-`) || fs.realpathSync(setupInfo.source) !== setupInfo.source) throw new Error('Unowned test source');
  phase = 'owned-services-live-acceptance';
  const pgDirectory = fs.readdirSync('/usr/lib/postgresql').filter(value => /^\d+$/.test(value)).sort((a, b) => Number(b) - Number(a))[0];
  if (!pgDirectory) throw new Error('Existing PostgreSQL binaries missing');
  const log = `${QA_ROOT}/live-acceptance.log`;
  fs.writeFileSync(log, '', { mode: 0o600 });
  const result = spawnSync('runuser', ['-u', 'citefi', '--', 'env',
    `HOME=${account.home}`, `PATH=/usr/lib/postgresql/${pgDirectory}/bin:${process.env.PATH}`,
    `QA_LIVE_PUBLISHING_CONFIG=${QA_ROOT}/live-tests.env`,
    'bash', `${setupInfo.source}/QA/support/with-isolated-database.sh`, '--with-redis', '--direct', '--live-publishing', '--',
    'tests/security/publishing-review-binding.integration.test.mjs',
  ], { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(log, `${result.stdout || ''}\n${result.stderr || ''}`, { mode: 0o600 });
  fs.chownSync(log, account.uid, account.gid);
  const successes = (result.stdout || '').split('\n').filter(line => /^PASS /.test(line));
  const failures = (result.stdout || '').concat(result.stderr || '').split('\n')
    .filter(line => /^FAIL /.test(line)).map(line => line.split(':')[0]);
  const summary = {
    operation: 'verify-staging-publishing-server', success: result.status === 0,
    passed: successes, failed: failures, exitCode: result.status,
    ownedPostgresRedis: true, realProviderReceiver: true,
    sourceSha256: setupInfo.sourceSha256, paidGeneration: false, customerPublication: false,
    productionChanges: false,
  };
  ownedWrite(`${QA_ROOT}/acceptance.json`, JSON.stringify(summary, null, 2), account);
  if (result.status !== 0) process.exitCode = 1;
  return summary;
}

async function main() {
  const action = process.argv[2] || 'inspect';
  try {
    const report = action === 'inspect' ? inspect() : action === 'prepare'
      ? (prepare(), { operation: 'prepare-staging-publishing-server', success: true })
      : action === 'setup' ? await setup(process.argv[3]) : action === 'verify' ? verify()
      : (() => { throw new Error('Unknown fixed staging operation'); })();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ operation: 'staging-publishing-server', action, phase, success: false, exitCode: error.status, errorCode: error.code }));
    process.exitCode = 1;
  }
}

module.exports = { serverBlocks };
if (!module.parent) main();
