const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const GiB = 1024 ** 3;
const POLICY = Object.freeze({ keepNewest: 3, minimumAgeMs: 7 * 86400000,
  maximumBytes: 12 * GiB, minimumFreeBytes: 4 * GiB, setupBudgetBytes: 4 * GiB });
const RELEASE = /^source-[a-f0-9]{64}$/;
const MEDIA = /\.(?:png|jpe?g|webp|gif|mp3|wav|ogg|mp4|mov|pdf)$/i;

function checkedRoot(root) {
  if (fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory()) {
    throw new Error('Retention root must be a real directory');
  }
}

// Never follow directory links while measuring or deleting. Link edges are
// inspected separately, including intermediate hops (not just realpath).
function scan(directory, state, manifest = {}) {
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    const relative = path.relative(state.root, file);
    state.entries.push([relative, stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]);
    state.bytes += stat.blocks * 512;
    if (stat.isSymbolicLink()) {
      state.links.push(file);
      const local = path.relative(state.release, file);
      if (/\.log$/i.test(name) || (!local.split(path.sep).includes('node_modules') && MEDIA.test(name)) ||
          /(?:^|\/)(?:uploads|evidence|retained-media|storage)(?:\/|$)/i.test(local)) state.evidence = true;
    }
    else if (stat.isDirectory()) scan(file, state, manifest);
    else {
      const local = path.relative(state.release, file);
      if (/\.log$/i.test(name) || (!local.split(path.sep).includes('node_modules') && MEDIA.test(name)) ||
          /(?:^|\/)(?:uploads|evidence|retained-media|storage)(?:\/|$)/i.test(local)) {
        // Frozen exported media is application source, not retained test media.
        // Legacy/untracked/changed media and all logs protect the entire release.
        if (/\.log$/i.test(name) || !manifest[local] ||
            createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== manifest[local]) {
          state.evidence = true;
        }
      }
    }
  }
}

function owner(root, filename, names) {
  const relative = path.relative(root, filename);
  const name = relative.split(path.sep)[0];
  return !relative.startsWith('..') && !path.isAbsolute(relative) && names.has(name) ? name : null;
}

function linkOwners(root, filename, names) {
  const owners = new Set();
  const visited = new Set();
  let current = path.resolve(filename);
  // Resolve one component at a time so A -> B -> C preserves B as well as C.
  for (let hop = 0; hop < 128; hop++) {
    const parts = current.split(path.sep).filter(Boolean);
    let prefix = path.parse(current).root;
    let redirected = false;
    for (let i = 0; i < parts.length; i++) {
      prefix = path.join(prefix, parts[i]);
      const release = owner(root, prefix, names);
      if (release) owners.add(release);
      let stat;
      try { stat = fs.lstatSync(prefix); }
      catch (error) {
        if (error.code === 'ENOENT') return owners;
        throw error;
      }
      if (stat.isSymbolicLink()) {
        if (visited.has(prefix)) throw new Error('Cyclic staging dependency link');
        visited.add(prefix);
        current = path.resolve(path.dirname(prefix), fs.readlinkSync(prefix), ...parts.slice(i + 1));
        redirected = true;
        break;
      }
    }
    if (!redirected) return owners;
  }
  throw new Error('Staging dependency link limit exceeded');
}

function preview(root, activePaths, now = Date.now()) {
  checkedRoot(root);
  const names = new Set(fs.readdirSync(root).filter(name => RELEASE.test(name)));
  const states = [...names].sort().map(name => {
    const release = path.join(root, name);
    const stat = fs.lstatSync(release);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Linked or invalid source release');
    let manifest = {};
    const manifestFile = path.join(release, '.staging-source-media.json');
    if (fs.existsSync(manifestFile)) {
      if (fs.lstatSync(manifestFile).isSymbolicLink()) throw new Error('Linked media manifest');
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    }
    const state = { root, release, name, bytes: stat.blocks * 512, links: [], entries: [], evidence: false,
      createdMs: stat.birthtimeMs || stat.ctimeMs, identity: [stat.dev, stat.ino] };
    scan(release, state, manifest);
    return state;
  });
  const protectedNames = new Set();
  const reasons = {};
  function protect(name, reason) {
    if (!protectedNames.has(name)) reasons[name] = reason;
    protectedNames.add(name);
  }
  for (const filename of activePaths) {
    for (const name of linkOwners(root, filename, names)) protect(name, 'active-reference');
  }
  for (const state of [...states].sort((a, b) => b.createdMs - a.createdMs || b.name.localeCompare(a.name)).slice(0, POLICY.keepNewest)) {
    protect(state.name, 'newest-snapshot');
  }
  for (const state of states) {
    if (now - state.createdMs < POLICY.minimumAgeMs) protect(state.name, 'minimum-age');
    if (state.evidence) protect(state.name, 'private-evidence-or-retained-media');
  }
  // All retained releases, not only the active one, must retain their full graph.
  let previousSize;
  do {
    previousSize = protectedNames.size;
    for (const state of states.filter(item => protectedNames.has(item.name))) {
      for (const link of state.links) {
        for (const target of linkOwners(root, link, names)) protect(target, 'transitive-dependency');
      }
    }
  } while (previousSize !== protectedNames.size);
  const candidates = states.filter(state => !protectedNames.has(state.name));
  const disk = fs.statfsSync(root);
  const freeBytes = disk.bavail * disk.bsize;
  const totalBytes = states.reduce((sum, state) => sum + state.bytes, 0);
  const reclaimableBytes = candidates.reduce((sum, state) => sum + state.bytes, 0);
  const payload = {
    policy: POLICY, activePaths: [...activePaths].sort(),
    releases: states.map(state => ({ name: state.name, bytes: state.bytes, identity: state.identity,
      links: state.links.map(link => [path.relative(root, link), fs.readlinkSync(link)]),
      reason: reasons[state.name] || 'expired', candidateEntries: protectedNames.has(state.name) ? [] : state.entries })),
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { operation: 'preview-staging-source-retention', readOnly: true, digest, policy: POLICY,
    freeBytes, totalBytes, reclaimableBytes,
    setupAllowed: freeBytes >= POLICY.minimumFreeBytes + POLICY.setupBudgetBytes &&
      totalBytes + POLICY.setupBudgetBytes <= POLICY.maximumBytes,
    candidates: candidates.map(state => state.name),
    protected: states.filter(state => protectedNames.has(state.name)).map(state => ({ name: state.name, reason: reasons[state.name] })) };
}

function requireSpace(root, requestedBytes = POLICY.setupBudgetBytes) {
  checkedRoot(root);
  const disk = fs.statfsSync(root);
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 0 ||
      disk.bavail * disk.bsize < POLICY.minimumFreeBytes + requestedBytes) {
    throw new Error('Insufficient staging disk headroom; preview retention before authorized cleanup');
  }
}

function cleanup(root, activePaths, digest, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('Read-only retention preview digest required');
  const report = preview(root, activePaths, now);
  if (report.digest !== digest) throw new Error('Retention preview changed; preview again');
  // Validate the whole batch before touching anything. Callers hold the same
  // exclusive operation lock used by setup/verify and re-read live PM2 paths.
  for (const name of report.candidates) {
    const directory = path.join(root, name);
    if (!RELEASE.test(name) || fs.realpathSync(directory) !== directory) throw new Error('Unsafe cleanup target');
  }
  for (const name of report.candidates) fs.rmSync(path.join(root, name), { recursive: true });
  return { operation: 'cleanup-staging-source-retention', deleted: report.candidates,
    reclaimedBytes: report.reclaimableBytes, productionChanged: false, evidenceAndMediaPreserved: true };
}

module.exports = { POLICY, MEDIA, preview, cleanup, requireSpace };
