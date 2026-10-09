const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ROOT = '/var/www/citefi-staging';

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
    productionChanged: false,
  };
}

async function main() {
  const action = process.argv[2] || 'inspect';
  try {
    if (action !== 'inspect') throw new Error('Setup/verification implementation not yet installed');
    console.log(JSON.stringify(inspect(), null, 2));
  } catch {
    console.log(JSON.stringify({ operation: 'staging-publishing-server', action, success: false }));
    process.exitCode = 1;
  }
}

module.exports = { serverBlocks };
if (!module.parent) main();
