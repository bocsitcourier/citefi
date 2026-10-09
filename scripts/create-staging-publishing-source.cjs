const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SOURCE_PATHS = [
  'app', 'components', 'lib', 'packages', 'server', 'shared', 'public',
  'hooks', 'client', 'migrations', 'scripts', 'QA/support', 'tests',
  'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json',
  'postcss.config.js', 'tailwind.config.ts', 'drizzle.config.ts',
];
const PRIVATE_HOSTS = new Set(['package-firewall.replit.local', 'package-firewall.replit.internal']);

function normalizeLock(lock) {
  let replacements = 0;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.resolved === 'string') {
      const url = new URL(value.resolved);
      if (PRIVATE_HOSTS.has(url.hostname)) {
        const pathname = url.pathname.replace(/^\/npm\//, '/');
        if (!/^\/(?:@[^/]+\/)?[^/]+\/-\/[^/]+\.tgz$/.test(pathname) || !value.integrity) {
          throw new Error('Noncanonical or unverified package proxy resolution');
        }
        value.resolved = `https://registry.npmjs.org${pathname}`;
        replacements++;
      } else if (!['https:', 'file:'].includes(url.protocol) || (url.protocol === 'https:' && url.hostname !== 'registry.npmjs.org')) {
        throw new Error('Unapproved staging package resolution');
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(lock);
  return replacements;
}

function run(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('Staging source archive operation failed');
}

function build() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'citefi-staging-build-'));
  const tree = path.join(temporary, 'source');
  fs.mkdirSync(tree);
  let locks = 0, replacements = 0;
  try {
    const intermediate = path.join(temporary, 'original.tar.gz');
    run(['-czf', intermediate, '--exclude=node_modules', '--exclude=.next',
      '--exclude=.env*', '--exclude=*.log', '--exclude=*.tsbuildinfo', '--exclude=__pycache__', ...SOURCE_PATHS]);
    run(['-xzf', intermediate, '-C', tree]);
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Staging source contains a link');
        if (entry.isDirectory()) walk(filename);
        else if (entry.name === 'package-lock.json') {
          const lock = JSON.parse(fs.readFileSync(filename, 'utf8'));
          replacements += normalizeLock(lock);
          fs.writeFileSync(filename, JSON.stringify(lock, null, 2) + '\n');
          locks++;
        }
      }
    }
    walk(tree);
    run(['-czf', '/tmp/citefi-staging-source.tar.gz', '-C', tree, ...SOURCE_PATHS]);
    console.log(JSON.stringify({ operation: 'build-staging-source', lockfiles: locks, normalizedResolutions: replacements, versionsAndIntegrityUnchanged: true }));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { normalizeLock };
if (require.main === module) build();
