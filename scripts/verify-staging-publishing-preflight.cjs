const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const ROOT = '/var/www/citefi-staging';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

function stagingProxyOrigins(text) {
  const clean = text.replace(/#[^\n]*/g, '');
  const origins = new Set();
  const starts = [...clean.matchAll(/\bserver\s*\{/g)];
  for (const start of starts) {
    let depth = 1, end = start.index + start[0].length;
    const bodyStart = end;
    while (end < clean.length && depth) {
      if (clean[end] === '{') depth++;
      if (clean[end] === '}') depth--;
      end++;
    }
    if (depth) continue;
    const block = clean.slice(bodyStart, end - 1);
    if (!/\blisten\s+[^;]*\b443\b[^;]*;/.test(block)
        || !/\bproxy_pass\s+https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):5100(?:\/|;)/.test(block)) continue;
    const names = block.match(/\bserver_name\s+([^;]+);/)?.[1] || '';
    for (const name of names.split(/\s+/)) {
      if (/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(name) && name.includes('.')) {
        origins.add(`https://${name}`);
      }
    }
  }
  return [...origins];
}

function discoverRoutes() {
  const directory = '/etc/nginx/sites-enabled';
  const report = { source: 'nginx-enabled-site-files', status: 'read', stagingHttpsCandidates: [] };
  try {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > 128 * 1024) continue;
        report.stagingHttpsCandidates.push(...stagingProxyOrigins(fs.readFileSync(file, 'utf8')));
      } catch { report.status = 'partial'; }
    }
    report.stagingHttpsCandidates = [...new Set(report.stagingHttpsCandidates)];
  } catch { report.status = 'unavailable'; }
  return report;
}

async function checkConditionalStorage(client, commands, bucket, prefix, bytes, runId) {
  if (bucket !== 'citefi' || prefix !== 'staging/synthetic/' || !/^[a-f0-9-]{36}$/.test(runId)) {
    throw new Error('Not the authorized storage scope');
  }
  const hash = digest(bytes);
  const key = `${prefix}publishing-live-qa/${runId}/${hash}.png`;
  const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(15000) });
  const read = async () => {
    const result = await send(new commands.GetObjectCommand({ Bucket: bucket, Key: key }));
    const downloaded = Buffer.from(await result.Body.transformToByteArray());
    if (downloaded.length !== bytes.length || digest(downloaded) !== hash) throw new Error('Downloaded digest mismatch');
  };
  await send(new commands.PutObjectCommand({
    Bucket: bucket, Key: key, Body: bytes, ContentType: 'image/png',
    IfNoneMatch: '*', CacheControl: 'private, no-store',
  }));
  await read();
  let rejected = false;
  try {
    await send(new commands.PutObjectCommand({
      Bucket: bucket, Key: key, Body: Buffer.concat([bytes, Buffer.from('must-not-replace')]),
      ContentType: 'image/png', IfNoneMatch: '*',
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412) throw error;
    rejected = true;
  }
  if (!rejected) throw new Error('Provider did not reject a conflicting create-only write');
  await read();
  return {
    key, sha256: hash, bytes: bytes.length, conditionalCreateSucceeded: true,
    conflictingCreateHttpStatus: 412, originalDigestStillMatches: true,
    retainedSyntheticObjects: 1, applicationMediaEndpointChecked: false,
  };
}

async function main() {
  let client;
  let phase = 'staging-preflight';
  const report = {
    operation: 'verify-staging-publishing-preflight', routes: discoverRoutes(),
    productionChanged: false, servicesRestarted: false, externalDeliveries: 0,
  };
  try {
    if (fs.realpathSync(ROOT) !== ROOT) throw new Error('Staging aliases another environment');
    const envFile = fs.realpathSync(path.join(ROOT, '.env.local'));
    if (!envFile.startsWith(`${ROOT}/`) || fs.statSync(envFile).size > 128 * 1024) throw new Error('Invalid staging environment file');
    let loader;
    for (const candidate of [path.join(ROOT, 'current/package.json'), path.join(ROOT, 'package.json')]) {
      if (!fs.existsSync(candidate)) continue;
      const real = fs.realpathSync(candidate);
      if (!real.startsWith(`${ROOT}/`)) continue;
      const requireStaging = createRequire(real);
      try { requireStaging.resolve('dotenv'); requireStaging.resolve('@aws-sdk/client-s3'); loader = requireStaging; break; }
      catch { /* Try the other established staging layout. */ }
    }
    if (!loader) throw new Error('Staging dependencies unavailable');
    const env = loader('dotenv').parse(fs.readFileSync(envFile, 'utf8'));
    const db = new URL(env.DATABASE_URL || '');
    const redis = new URL(env.REDIS_URL || '');
    const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!local(db) || db.pathname !== '/citefi_staging' || !['postgres:', 'postgresql:'].includes(db.protocol)
        || !local(redis) || redis.pathname !== '/1' || !['redis:', 'rediss:'].includes(redis.protocol)
        || env.DO_SPACES_BUCKET !== 'citefi' || env.DO_SPACES_ENDPOINT !== 'https://nyc3.digitaloceanspaces.com'
        || env.STORAGE_PREFIX !== 'staging/synthetic/' || !env.DO_SPACES_KEY || !env.DO_SPACES_SECRET) {
      throw new Error('Staging isolation or storage configuration differs from authorization');
    }
    report.stagingApplicationOrigin = httpsOrigin(env.NEXTAUTH_URL || env.NEXT_PUBLIC_APP_URL);
    report.sessionSigningConfiguredInFile = (env.SESSION_SECRET || '').length >= 32;
    // Only inspect known staging receiver config paths; never contact candidate
    // origins or infer that an arbitrary HTTPS destination is an isolated receiver.
    report.receiverConfigurationCandidates = [];
    for (const relative of ['packages/apex-receiver/.env', 'current/packages/apex-receiver/.env']) {
      try {
        const file = fs.realpathSync(path.join(ROOT, relative));
        if (!file.startsWith(`${ROOT}/`) || fs.statSync(file).size > 128 * 1024) continue;
        const receiverEnv = loader('dotenv').parse(fs.readFileSync(file, 'utf8'));
        const origin = httpsOrigin(receiverEnv.BASE_URL);
        if (origin) report.receiverConfigurationCandidates.push({
          origin, engineOrigin: httpsOrigin(receiverEnv.APEX_ENGINE_URL),
          credentialPresent: !!receiverEnv.CITEFI_API_KEY,
        });
      } catch { /* Missing config is not permission to contact another site. */ }
    }
    const commands = loader('@aws-sdk/client-s3');
    client = new commands.S3Client({
      region: 'us-east-1', endpoint: env.DO_SPACES_ENDPOINT, forcePathStyle: false, maxAttempts: 1,
      credentials: { accessKeyId: env.DO_SPACES_KEY, secretAccessKey: env.DO_SPACES_SECRET },
    });
    phase = 'conditional-storage-check';
    // Fixed one-pixel PNG. No paid generation or customer media reads.
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    report.storage = await checkConditionalStorage(client, commands, env.DO_SPACES_BUCKET, env.STORAGE_PREFIX, bytes, randomUUID());
    report.success = true;
  } catch (error) {
    report.success = false;
    report.failurePhase = phase;
    const httpStatus = error?.$metadata?.httpStatusCode;
    if (Number.isInteger(httpStatus)) report.httpStatus = httpStatus;
    process.exitCode = 1;
  } finally {
    if (client) client.destroy();
    console.log(JSON.stringify(report, null, 2));
  }
}

module.exports = { stagingProxyOrigins, checkConditionalStorage };
if (!module.parent) main();
