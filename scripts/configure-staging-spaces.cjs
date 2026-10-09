// Streamed over SSH. Only fixed staging paths and existing staging credentials.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const ROOT = '/var/www/citefi-staging';
const SETTINGS = Object.freeze({
  DO_SPACES_BUCKET: 'citefi',
  DO_SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  STORAGE_PREFIX: 'staging/synthetic/',
});

function assertIsolation(env) {
  const db = new URL(env.DATABASE_URL || '');
  const redis = new URL(env.REDIS_URL || '');
  const local = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!local(db) || !['postgres:', 'postgresql:'].includes(db.protocol) || db.pathname !== '/citefi_staging'
      || !local(redis) || !['redis:', 'rediss:'].includes(redis.protocol) || redis.pathname !== '/1'
      || (env.STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '') !== 'staging/synthetic') {
    throw new Error('Staging isolation does not match the authorized target');
  }
  if (!env.DO_SPACES_KEY || !env.DO_SPACES_SECRET || /[$`]/.test(env.DO_SPACES_KEY + env.DO_SPACES_SECRET)) {
    throw new Error('Usable literal staging Spaces credentials are required');
  }
}

function updatedEnvText(text, parseEnv) {
  const before = parseEnv(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const seen = new Set();
  let updated = text.replace(
    /^[ \t]*(?:export[ \t]+)?(DO_SPACES_BUCKET|DO_SPACES_ENDPOINT|STORAGE_PREFIX)[ \t]*=.*(?:\r?\n|$)/gm,
    (_line, key) => {
      if (seen.has(key)) return '';
      seen.add(key);
      return `${key}=${SETTINGS[key]}${eol}`;
    },
  );
  for (const [key, value] of Object.entries(SETTINGS)) {
    if (seen.has(key)) continue;
    if (updated && !updated.endsWith('\n')) updated += eol;
    updated += `${key}=${value}${eol}`;
  }
  const after = parseEnv(updated);
  for (const [key, value] of Object.entries(SETTINGS)) {
    if (after[key] !== value) throw new Error('Storage setting replacement failed');
  }
  const otherKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of otherKeys) {
    if (!(key in SETTINGS) && before[key] !== after[key]) {
      throw new Error('Refusing changes to unrelated environment settings');
    }
  }
  return updated;
}

function saveChecked(file, original, updated, expectedStat) {
  if (original === updated) return false;
  const temporary = `${file}.spaces-${randomUUID()}.tmp`;
  let created = false;
  try {
    const current = fs.statSync(file);
    if (current.dev !== expectedStat.dev || current.ino !== expectedStat.ino
        || fs.readFileSync(file, 'utf8') !== original) {
      throw new Error('Staging configuration changed during the access check');
    }
    // The temporary file contains credentials, stays inside staging, and is
    // owner-only; it is either renamed into place or removed before returning.
    const fd = fs.openSync(temporary, 'wx', 0o600);
    created = true;
    try {
      fs.writeFileSync(fd, updated);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    created = false;
    return true;
  } finally { if (created) fs.unlinkSync(temporary); }
}

async function main() {
  let lockFd;
  let lockFile;
  let client;
  let configurationSaved = false;
  let phase = 'staging-preflight';
  try {
    const root = fs.realpathSync(ROOT);
    if (root !== ROOT) throw new Error('Staging root must not alias another environment');
    const file = fs.realpathSync(path.join(ROOT, '.env.local'));
    if (!file.startsWith(`${ROOT}/`)) throw new Error('Staging configuration resolves outside staging');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 128 * 1024 || stat.uid !== process.getuid()) {
      throw new Error('Staging configuration must be bounded and owned by the SSH user');
    }
    lockFile = `${file}.spaces-config.lock`;
    lockFd = fs.openSync(lockFile, 'wx', 0o600);
    const original = fs.readFileSync(file, 'utf8');
    phase = 'staging-dependencies';
    let requireStaging;
    for (const candidate of [path.join(ROOT, 'current/package.json'), path.join(ROOT, 'package.json')]) {
      if (!fs.existsSync(candidate)) continue;
      const real = fs.realpathSync(candidate);
      if (!real.startsWith(`${ROOT}/`)) continue;
      const loader = createRequire(real);
      try { loader.resolve('dotenv'); loader.resolve('@aws-sdk/client-s3'); requireStaging = loader; break; }
      catch { /* Try the other established staging dependency layout. */ }
    }
    if (!requireStaging) throw new Error('Staging storage dependencies unavailable');
    const { parse: parseEnv } = requireStaging('dotenv');
    const env = parseEnv(original);
    phase = 'staging-isolation';
    assertIsolation(env);
    const updated = updatedEnvText(original, parseEnv);
    const { S3Client, HeadBucketCommand } = requireStaging('@aws-sdk/client-s3');
    client = new S3Client({
      region: 'us-east-1', endpoint: SETTINGS.DO_SPACES_ENDPOINT,
      forcePathStyle: false, maxAttempts: 1,
      credentials: { accessKeyId: env.DO_SPACES_KEY, secretAccessKey: env.DO_SPACES_SECRET },
    });
    phase = 'bucket-access';
    await client.send(new HeadBucketCommand({ Bucket: SETTINGS.DO_SPACES_BUCKET }),
      { abortSignal: AbortSignal.timeout(15000) });
    phase = 'staging-save';
    const changed = saveChecked(file, original, updated, stat);
    configurationSaved = true;
    const saved = parseEnv(fs.readFileSync(file, 'utf8'));
    assertIsolation(saved);
    for (const [key, value] of Object.entries(SETTINGS)) {
      if (saved[key] !== value) throw new Error('Saved staging configuration did not verify');
    }
    console.log(JSON.stringify({
      operation: 'configure-staging-spaces-only', savedConfigurationVerified: true,
      changed, bucket: SETTINGS.DO_SPACES_BUCKET, endpoint: SETTINGS.DO_SPACES_ENDPOINT,
      storagePrefix: SETTINGS.STORAGE_PREFIX, bucketHeadSucceeded: true,
      credentialsChanged: false, productionChanged: false, objectsWritten: 0,
      servicesRestarted: false, receiverDownloadsChecked: false,
    }, null, 2));
  } catch (error) {
    // Provider messages, request data and raw environment contents are not safe
    // diagnostics. Only disclose the phase and numeric HTTP status if present.
    const httpStatus = error?.$metadata?.httpStatusCode;
    console.error(JSON.stringify({
      operation: 'configure-staging-spaces-only', success: false, phase,
      ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
      configurationSaved,
    }));
    process.exitCode = 1;
  } finally {
    if (client) client.destroy();
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lockFile); }
  }
}

module.exports = { SETTINGS, assertIsolation, updatedEnvText, saveChecked };
if (!module.parent) main();
