#!/usr/bin/env node
// Run in an isolated release export, never against the original dependencies.
const fs = require('node:fs');
const path = require('node:path');

function normalizeLock(value) {
  let changed = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, item] of Object.entries(node)) {
      if (key === 'resolved' && typeof item === 'string') {
        let url;
        try { url = new URL(item); } catch {
          if (/package-firewall\.replit\.(?:local|internal)/.test(item)) {
            throw new Error('Malformed private package registry URL in release lockfile');
          }
        }
        if (!url || !['package-firewall.replit.local', 'package-firewall.replit.internal'].includes(url.hostname)) continue;
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
            url.port || url.search || url.hash || !url.pathname.startsWith('/npm/')) {
          throw new Error('Unsupported private package registry URL in release lockfile');
        }
        url.protocol = 'https:';
        url.hostname = 'registry.npmjs.org';
        url.pathname = url.pathname.slice(4);
        const replacement = url.toString();
        if (replacement !== item) { node[key] = replacement; changed++; }
      } else visit(item);
    }
  }
  visit(value);
  return changed;
}

function normalizeTree(root) {
  const excluded = new Set(['node_modules', '.git', '.next', '.local', '.agents', 'tests', 'QA', 'generated-artifacts']);
  let changed = 0;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name === 'package-lock.json') throw new Error('Release lockfiles must not be symlinks');
        continue;
      }
      if (entry.isDirectory() && !excluded.has(entry.name)) visit(filename);
      else if (entry.isFile() && entry.name === 'package-lock.json') {
        const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
        const count = normalizeLock(document);
        if (count) fs.writeFileSync(filename, JSON.stringify(document, null, 2) + '\n');
        changed += count;
      }
    }
  }
  visit(path.resolve(root));
  return changed;
}

module.exports = { normalizeLock, normalizeTree };
if (require.main === module) {
  try {
    console.log(`Normalized ${normalizeTree(process.argv[2] || process.cwd())} release package URLs`);
  } catch (error) {
    console.error(`Release lockfile normalization failed: ${error.message}`);
    process.exitCode = 1;
  }
}
