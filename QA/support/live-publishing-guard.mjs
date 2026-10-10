// A separate, explicitly staging-only network boundary. The ordinary offline
// guard remains unchanged and is still the default for every existing suite.
import fs from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import { createRequire, syncBuiltinESMExports } from 'node:module';

if (process.env.QA_LIVE_PUBLISHING !== 'true' || process.env.QA_ISOLATED_DATABASE !== 'true') {
  throw new Error('Live publishing guard requires owned services and explicit live mode');
}
const configuration = '/var/www/citefi-staging/publishing-qa/live-tests.env';
if (process.env.QA_LIVE_PUBLISHING_CONFIG !== configuration ||
    fs.realpathSync(configuration) !== configuration ||
    fs.statSync(configuration).uid !== process.getuid() ||
    (fs.statSync(configuration).mode & 0o077)) {
  throw new Error('Live publishing configuration is not the fixed owner-only staging file');
}
const require = createRequire(import.meta.url);
const values = require('dotenv').parse(fs.readFileSync(configuration));
if (values.DO_SPACES_BUCKET !== 'citefi' ||
    values.DO_SPACES_ENDPOINT !== 'https://nyc3.digitaloceanspaces.com' ||
    values.STORAGE_PREFIX !== 'staging/synthetic/' ||
    values.QA_LIVE_APP_URL !== 'https://citefi.co:8443' ||
    values.QA_LIVE_RECEIVER_URL !== 'https://citefi.co:8444') {
  throw new Error('Not the authorized isolated staging targets');
}
for (const key of [
  'DO_SPACES_BUCKET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_KEY', 'DO_SPACES_SECRET',
  'STORAGE_PREFIX', 'QA_LIVE_APP_URL', 'QA_LIVE_RECEIVER_URL', 'QA_LIVE_RECEIVER_KEY', 'QA_LIVE_SIGNING_SECRET',
]) process.env[key] = values[key] || '';
if (!values.DO_SPACES_KEY || !values.DO_SPACES_SECRET ||
    values.QA_LIVE_SIGNING_SECRET?.length < 32 || values.QA_LIVE_RECEIVER_KEY?.length < 32) {
  throw new Error('Staging credentials/signing are incomplete');
}

const permitted = new Map([
  ['citefi.co', new Set([8443, 8444])],
  ['citefi.nyc3.digitaloceanspaces.com', new Set([443])],
  ['nyc3.digitaloceanspaces.com', new Set([443])],
]);
const ownedPorts = new Set((process.env.QA_TEST_ALLOWED_PORTS || '').split(',').map(Number));
for (const name of [...permitted.keys()]) {
  for (const address of await dns.lookup(name, { all: true })) {
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address) ||
        address.address === '::1' || /^(?:fc|fd|fe80):/i.test(address.address)) {
      throw new Error('Live publishing target did not resolve to a public address');
    }
    const ports = permitted.get(address.address) || new Set();
    for (const port of permitted.get(name)) ports.add(port);
    permitted.set(address.address, ports);
  }
}
function allowed(host, port) {
  host = String(host || 'localhost').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return (['localhost', '127.0.0.1', '::1'].includes(host) && ownedPorts.has(Number(port))) ||
    permitted.get(host)?.has(Number(port));
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host ?? first.hostname : args[1];
  const port = typeof first === 'object' ? first.port : first;
  if (!allowed(host, port)) throw new Error('Live publishing attempted a socket outside its fixed staging/owned-service allowlist');
  return connect.apply(this, args);
};
const fetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80))) {
    throw new Error('Live publishing attempted fetch outside its fixed staging/owned-service allowlist');
  }
  return fetch(input, { ...init, redirect: 'error' });
};
syncBuiltinESMExports();
