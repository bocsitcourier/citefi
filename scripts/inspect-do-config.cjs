// Runs over SSH stdin. Reads only fixed configuration paths; never imports the
// application, sources a shell env file, connects to a service, or writes files.
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_KEYS = new Set([
  'DO_SPACES_BUCKET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_KEY', 'DO_SPACES_SECRET',
  'STORAGE_PREFIX', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'DATABASE_URL',
  'REDIS_URL', 'SESSION_SECRET', 'API_KEY_ENCRYPTION_SECRET',
]);

function parseLiteralEnv(text) {
  const env = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/);
    if (!match || !CONFIG_KEYS.has(match[1])) continue;
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const end = value.lastIndexOf(quote);
      value = end > 0 ? value.slice(1, end) : '';
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    // This is intentionally not a shell/dotenv interpreter. Unknown expansion
    // cannot be certified and must never execute or be echoed into the report.
    if (/[$`]/.test(value)) value = '';
    env[match[1]] = value;
  }
  return env;
}

function parsedUrl(value) {
  try { return new URL(value); } catch { return undefined; }
}

function summarize(env, staging) {
  const endpoint = parsedUrl(env.DO_SPACES_ENDPOINT);
  const app = parsedUrl(env.NEXTAUTH_URL || env.NEXT_PUBLIC_APP_URL);
  const db = parsedUrl(env.DATABASE_URL);
  const redis = parsedUrl(env.REDIS_URL);
  const local = (url) => !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const bucket = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.DO_SPACES_BUCKET || '')
    ? env.DO_SPACES_BUCKET : null;
  const spacesEndpoint = endpoint?.protocol === 'https:' && !endpoint.username && !endpoint.password
    && /^[a-z0-9-]+\.digitaloceanspaces\.com$/.test(endpoint.hostname)
    && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash && !endpoint.port
    ? endpoint.origin : null;
  const prefix = env.STORAGE_PREFIX || '';
  const safePrefix = /^[a-zA-Z0-9/_-]{0,128}$/.test(prefix) && !prefix.includes('..') ? prefix : null;
  const credentialPresence = {
    accessKey: !!env.DO_SPACES_KEY, secretKey: !!env.DO_SPACES_SECRET,
  };
  const report = {
    bucket, spacesEndpoint, storagePrefix: safePrefix,
    credentialPresence,
    storageConfigured: !!(bucket && spacesEndpoint && credentialPresence.accessKey && credentialPresence.secretKey),
    // No provider requests: configuration is not proof of bucket existence.
    bucketExistenceChecked: false,
    applicationOrigin: app?.protocol === 'https:' && !app.username && !app.password ? app.origin : null,
    sessionSigningConfigured: (env.SESSION_SECRET || '').length >= 32,
    publishingEncryptionConfigured: (env.API_KEY_ENCRYPTION_SECRET || '').length >= 32,
  };
  if (staging) {
    report.isolationConfiguration = {
      localDatabase: local(db) && ['postgres:', 'postgresql:'].includes(db.protocol),
      stagingDatabaseName: db?.pathname === '/citefi_staging',
      localRedis: local(redis) && ['redis:', 'rediss:'].includes(redis.protocol),
      redisDatabaseOne: redis?.pathname === '/1',
      syntheticStoragePrefix: prefix.replace(/^\/+|\/+$/g, '') === 'staging/synthetic',
    };
  }
  return report;
}

function inspectApp(root, staging) {
  const report = { root, directoryExists: fs.existsSync(root) };
  for (const relative of ['.env.local', 'current/.env.local', 'shared/.env.local']) {
    const file = path.join(root, relative);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 128 * 1024) {
        report.configurationStatus = 'invalid-or-oversized';
        return report;
      }
      const env = parseLiteralEnv(fs.readFileSync(file, 'utf8'));
      return { ...report, configurationFile: relative, configurationStatus: 'read',
        ...summarize(env, staging) };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      report.configurationStatus = 'unreadable';
      return report;
    }
  }
  return { ...report, configurationStatus: 'missing' };
}

function main() {
  try {
    console.log(JSON.stringify({
      sshAuthenticated: true, inspectionMode: 'read-only-literal-config',
      production: inspectApp('/var/www/citefi', false),
      staging: inspectApp('/var/www/citefi-staging', true),
      receiverDownloadsChecked: false,
    }, null, 2));
  } catch {
    console.error('Read-only inspection failed; no environment contents or exception details logged.');
    process.exitCode = 1;
  }
}

module.exports = { parseLiteralEnv, summarize, inspectApp };
if (!module.parent) main();
