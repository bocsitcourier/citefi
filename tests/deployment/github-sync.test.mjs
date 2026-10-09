import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, chmodSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitRunner, synchronize, githubClient } from '../../scripts/github-sync.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'github-sync-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = gitRunner(cwd);
  git(['init', '-q']);
  git(['config', 'user.name', 'Offline fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  const write = (path, content) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = (message) => {
    git(['add', '-A']); git(['commit', '-qm', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  write('shared.txt', 'base\n');
  write('removed.txt', 'delete me\n');
  const base = commit('common ancestor');
  write('remote.txt', 'remote-only work\n');
  const remote = commit('remote work');
  git(['checkout', '-q', '--detach', base]);
  write('local.txt', 'local-only work\n');
  const local = commit('local work [skip ci]');
  return { cwd, git, write, commit, base, remote, local };
}

// Stateful in-memory GitHub. Git plumbing computes real object IDs, but no
// network, environment secrets, remote repository or deployments are used.
function mock(f, options = {}) {
  const calls = [];
  const logs = [];
  const branches = new Map();
  const commits = new Map();
  const objects = new Map();
  let pr;
  const tree = (commit) => f.git(['rev-parse', `${commit}^{tree}`]).trim();
  const response = (status, body = {}) => ({ status, body });
  const api = async (method, endpoint, data) => {
    calls.push({ method, endpoint, data });
    if (method === 'PATCH' && endpoint === '/git/refs/heads/main') {
      return response(options.directStatus ?? 403, { message: 'Protected branch update failed. Changes must be made through a pull request.' });
    }
    if (endpoint.includes('/rules') || endpoint.includes('/protection') || endpoint.endsWith('/merge') ||
        ['PATCH', 'DELETE', 'PUT'].includes(method)) {
      assert.fail(`Forbidden mutation: ${method} ${endpoint}`);
    }
    if (options.fail?.(method, endpoint)) return response(options.failStatus ?? 403);
    if (method === 'GET' && endpoint === '/git/ref/heads/main') {
      const reads = calls.filter((call) => call.endpoint === endpoint).length;
      return response(200, { object: { sha: options.advance && reads > 1 ? f.base : f.remote } });
    }
    if (method === 'GET' && endpoint.startsWith('/git/ref/heads/')) {
      const name = decodeURIComponent(endpoint.slice('/git/ref/heads/'.length));
      return branches.has(name) ? response(200, { object: { sha: branches.get(name) } }) : response(404);
    }
    if (method === 'GET' && endpoint.startsWith('/git/commits/')) {
      const head = endpoint.slice('/git/commits/'.length);
      return response(200, commits.get(head));
    }
    if (method === 'GET' && /^\/git\/(blobs|trees)\//.test(endpoint)) {
      return objects.has(endpoint) ? response(200, { sha: objects.get(endpoint) }) : response(404);
    }
    if (method === 'POST' && endpoint === '/git/blobs') {
      const sha = f.git(['hash-object', '-w', '--stdin'], {
        input: Buffer.from(data.content, 'base64'), stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      objects.set(`/git/blobs/${sha}`, sha);
      return response(201, { sha });
    }
    if (method === 'POST' && endpoint === '/git/trees') {
      const input = data.tree.map((entry) => `${entry.mode} ${entry.type} ${entry.sha}\t${entry.path}\0`).join('');
      const sha = f.git(['mktree', '-z', '--missing'], { input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      objects.set(`/git/trees/${sha}`, sha);
      return response(201, { sha });
    }
    if (method === 'POST' && endpoint === '/git/commits') {
      assert.deepEqual(data.parents, [f.remote], 'remote commits remain ancestors');
      assert.doesNotMatch(data.message, /\[skip ci\]/);
      const head = f.git(['commit-tree', data.tree, '-p', f.remote, '-m', data.message]).trim();
      commits.set(head, { tree: { sha: data.tree }, parents: [{ sha: f.remote }] });
      return response(201, { sha: head });
    }
    if (method === 'POST' && endpoint === '/git/refs') {
      assert.match(data.ref, /^refs\/heads\/replit-sync\//);
      assert.equal(data.force, undefined);
      branches.set(data.ref.slice('refs/heads/'.length), data.sha);
      return response(options.branchRace ? 422 : 201, {});
    }
    if (method === 'GET' && endpoint.startsWith('/pulls?')) {
      return response(200, pr ? [pr] : []);
    }
    if (method === 'POST' && endpoint === '/pulls') {
      assert.equal(data.base, 'main');
      assert.equal(branches.has(data.head), true);
      pr = {
        number: 12, html_url: 'https://github.com/offline/fixture/pull/12',
        state: 'open', mergeable_state: 'blocked', head: { sha: branches.get(data.head) },
      };
      return response(options.prRace ? 422 : 201, pr);
    }
    if (method === 'GET' && endpoint === '/pulls/12') return response(200, pr);
    if (method === 'GET' && endpoint.includes('/check-runs?')) {
      const page = Number(new URL(`https://offline.invalid${endpoint}`).searchParams.get('page'));
      return response(200, { check_runs: options.pages ? options.pages[page - 1] ?? [] : options.checks ?? [] });
    }
    if (method === 'GET' && endpoint.endsWith('/status')) return response(200, { state: options.status ?? 'pending' });
    assert.fail(`Unexpected API call: ${method} ${endpoint}`);
  };
  const run = (overrides = {}) => synchronize({
    owner: 'offline', repo: 'fixture', git: f.git, api,
    fetchBase: async (sha) => assert.equal(sha, f.remote),
    log: (line) => logs.push(line),
    ...overrides,
  });
  return { api, run, calls, logs, branches, commits, objects, tree };
}

const required = (conclusion = 'success', app = 15368) => ({
  name: 'Offline deployment safety', status: 'completed', conclusion, app: { id: app },
});
const writes = (m) => m.calls.filter((call) => call.method !== 'GET');

test('protected direct updates are rejected; normal sync uses only a branch and PR', async (t) => {
  const f = fixture(t);
  const m = mock(f, { checks: [required()], status: 'success' });
  assert.equal((await m.api('PATCH', '/git/refs/heads/main', { sha: f.local, force: true })).status, 403);
  const start = m.calls.length;
  const originalHead = f.git(['rev-parse', 'HEAD']);
  const result = await m.run();
  assert.equal(result.html_url, 'https://github.com/offline/fixture/pull/12');
  assert.equal(f.git(['rev-parse', 'HEAD']), originalHead);
  assert.equal(f.git(['status', '--porcelain']), '');
  const syncCalls = m.calls.slice(start);
  assert.equal(syncCalls.some((call) => call.method === 'PATCH'), false);
  const head = result.head.sha;
  assert.equal(f.git(['show', `${head}:remote.txt`]), 'remote-only work\n');
  assert.equal(f.git(['show', `${head}:local.txt`]), 'local-only work\n');
  f.git(['merge-base', '--is-ancestor', f.remote, head]);
  assert.match(m.logs.join('\n'), /GitHub Actions\): success/);
  assert.match(m.logs.join('\n'), /Not merged/);
});

test('a 422 protection rejection is not treated as an object-upload signal', async (t) => {
  const f = fixture(t), m = mock(f, { directStatus: 422 });
  assert.equal((await m.api('PATCH', '/git/refs/heads/main', {})).status, 422);
  const start = m.calls.length;
  await m.run();
  assert.equal(m.calls.slice(start).some((call) => call.method === 'PATCH' || call.method === 'DELETE'), false);
});

test('preserves remote additions, local deletions, nested/binary files, executable modes and symlinks', async (t) => {
  const f = fixture(t);
  rmSync(join(f.cwd, 'removed.txt'));
  f.write('nested/space "雪".bin', Buffer.from([0, 1, 128, 255]));
  f.write('run.sh', '#!/bin/sh\nexit 0\n');
  chmodSync(join(f.cwd, 'run.sh'), 0o755);
  symlinkSync('local.txt', join(f.cwd, 'link'));
  f.commit('asset changes');
  const m = mock(f);
  const result = await m.run();
  const head = result.head.sha;
  assert.equal(f.git(['show', `${head}:remote.txt`]), 'remote-only work\n');
  assert.throws(() => f.git(['show', `${head}:removed.txt`]));
  assert.deepEqual(f.git(['show', `${head}:nested/space "雪".bin`], { encoding: 'buffer' }), Buffer.from([0, 1, 128, 255]));
  assert.match(f.git(['ls-tree', head, 'run.sh']), /^100755 blob/);
  assert.match(f.git(['ls-tree', head, 'link']), /^120000 blob/);
});

test('preserves submodule gitlinks without uploading them as blobs', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, 'vendor/submodule'), { recursive: true });
  f.git(['update-index', '--add', '--cacheinfo', `160000,${f.base},vendor/submodule`]);
  f.git(['commit', '-qm', 'add gitlink']);
  const m = mock(f);
  const result = await m.run();
  assert.match(f.git(['ls-tree', `${result.head.sha}:vendor`, 'submodule']), new RegExp(`^160000 commit ${f.base}`));
});

test('read-only fetch failure stops before mutations with no git-write fallback', async (t) => {
  const f = fixture(t), m = mock(f);
  await assert.rejects(m.run({ fetchBase: async () => { throw new Error('read-only fetch unavailable'); } }), /fetch unavailable/);
  assert.deepEqual(writes(m), []);
});

test('rerun reuses matching branch/PR without any additional writes', async (t) => {
  const f = fixture(t), m = mock(f);
  await m.run();
  const count = writes(m).length;
  await m.run();
  assert.equal(writes(m).length, count);
  assert.equal(m.calls.filter((call) => call.method === 'POST' && call.endpoint === '/pulls').length, 1);
});

test('conflicts stop before any GitHub writes and leave the worktree unchanged', async (t) => {
  const f = fixture(t);
  f.git(['checkout', '-q', '--detach', f.remote]);
  f.write('shared.txt', 'remote conflicting line\n');
  f.remote = f.commit('remote conflict');
  f.git(['checkout', '-q', '--detach', f.local]);
  f.write('shared.txt', 'local conflicting line\n');
  f.commit('local conflict');
  const m = mock(f);
  await assert.rejects(m.run(), /merge-tree failed.*merge conflicts/);
  assert.deepEqual(writes(m), []);
  assert.equal(f.git(['status', '--porcelain']), '');
});

test('unrelated histories are refused rather than replacing remote contents', async (t) => {
  const f = fixture(t);
  f.git(['checkout', '-q', '--orphan', 'unrelated']);
  f.git(['rm', '-q', '-rf', '.']);
  f.write('other.txt', 'other\n');
  f.commit('new root');
  const m = mock(f);
  await assert.rejects(m.run(), /merge-tree failed/);
  assert.deepEqual(writes(m), []);
});

test('dirty worktree is rejected before even reading GitHub', async (t) => {
  const f = fixture(t), m = mock(f);
  f.write('uncommitted.txt', 'do not omit silently');
  await assert.rejects(m.run(), /Commit or stash/);
  assert.deepEqual(m.calls, []);
});

test('equal HEAD and already-contained changes are no-ops', async (t) => {
  const f = fixture(t), m = mock(f);
  f.git(['checkout', '-q', '--detach', f.remote]);
  await m.run();
  assert.deepEqual(writes(m), []);
  f.git(['checkout', '-q', '--detach', f.base]);
  await m.run();
  assert.deepEqual(writes(m), []);
});

test('does not overwrite a branch with unexpected contents or parent', async (t) => {
  const f = fixture(t), m = mock(f);
  await m.run();
  const count = writes(m).length;
  m.commits.get([...m.branches.values()][0]).parents = [{ sha: f.local }];
  await assert.rejects(m.run(), /refusing to overwrite/);
  assert.equal(writes(m).length, count);
});

test('branch and PR creation races reconcile without forcing or duplicating', async (t) => {
  const f = fixture(t), m = mock(f, { branchRace: true, prRace: true });
  const pr = await m.run();
  assert.equal(pr.number, 12);
  assert.equal(m.calls.some((call) => ['PATCH', 'DELETE', 'PUT'].includes(call.method)), false);
});

test('missing or wrong-source required checks are reported as pending, failures as failures', async (t) => {
  const f = fixture(t);
  const m = mock(f, { checks: [required('success', 999)] });
  await m.run();
  assert.match(m.logs.join('\n'), /GitHub Actions\): pending — not reported yet/);
  const failed = mock(f, { checks: [required('failure')] });
  await failed.run();
  assert.match(failed.logs.join('\n'), /GitHub Actions\): failure/);
});

test('check pagination and running state are reported; advancing base is not overwritten', async (t) => {
  const f = fixture(t);
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ name: `Other ${i}`, status: 'completed', conclusion: 'success' }));
  const running = { ...required(), status: 'in_progress', conclusion: null };
  const m = mock(f, { pages: [firstPage, [running]], advance: true });
  await m.run();
  assert.match(m.logs.join('\n'), /GitHub Actions\): in_progress/);
  assert.match(m.logs.join('\n'), /Base advanced/);
});

test('permission/upload failures stop explicitly without fallback or protection changes', async (t) => {
  for (const endpoint of ['/git/ref/heads/main', '/git/blobs', '/git/trees', '/git/commits', '/git/refs', '/pulls']) {
    const f = fixture(t), m = mock(f, { fail: (method, path) => path === endpoint && (method === 'POST' || path.includes('/git/ref/')) });
    await assert.rejects(m.run(), /HTTP 403/);
    assert.equal(m.calls.some((call) => ['PATCH', 'DELETE', 'PUT'].includes(call.method)), false);
  }
});

test('PR URL remains visible if check read permissions are missing', async (t) => {
  const f = fixture(t), m = mock(f, { fail: (_method, path) => path.includes('/check-runs') });
  await assert.rejects(m.run(), /Check lookup failed \(HTTP 403\)/);
  assert.match(m.logs.join('\n'), /https:\/\/github.com\/offline\/fixture\/pull\/12/);
});

test('REST client rejects redirects/transport errors and does not expose credential-bearing errors', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const api = githubClient({ owner: 'offline', repo: 'fixture', token: 'synthetic-offline-token' });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/offline/fixture/git/refs');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-offline-token');
    return { status: 403, json: async () => ({ message: 'protected' }) };
  };
  assert.equal((await api('POST', '/git/refs', { ref: 'refs/heads/replit-sync/test' })).status, 403);
  globalThis.fetch = async () => { throw new Error('synthetic-offline-token'); };
  await assert.rejects(api('GET', '/git/ref/heads/main'), (error) => {
    assert.doesNotMatch(error.message, /synthetic-offline-token/);
    return /transport failed/.test(error.message);
  });
});

const uploads = (m, type) => m.calls.filter((call) => call.method === 'POST' && call.endpoint === `/git/${type}s`);
const journalFiles = (f) => {
  const directory = f.git(['rev-parse', '--path-format=absolute', '--git-path', 'github-sync']).trim();
  return readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => join(directory, name));
};

test('interrupted blob publication resumes across invocations without repeating completed uploads', async (t) => {
  const f = fixture(t);
  f.write('a.bin', Buffer.from([0, 255]));
  f.write('nested/b.txt', 'nested');
  f.commit('more files');
  const m = mock(f);
  let completed = 0;
  await assert.rejects(m.run({ api: async (method, path, data) => {
    if (method === 'POST' && path === '/git/blobs' && completed === 2) throw new Error('interrupted');
    const response = await m.api(method, path, data);
    if (method === 'POST' && path === '/git/blobs') completed++;
    return response;
  } }), /interrupted/);
  const prior = uploads(m, 'blob').map((call) => call.data.content);
  assert.equal(m.branches.size, 0);
  await m.run();
  for (const content of prior) assert.equal(uploads(m, 'blob').filter((call) => call.data.content === content).length, 1);
  assert.equal(f.git(['status', '--porcelain']), '');
  const [path] = journalFiles(f);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort(), ['identity', 'objects', 'version']);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /token|Authorization|content|synthetic-offline/i);
});

test('lost blob and tree responses reconcile pending objects before reuploading', async (t) => {
  for (const type of ['blob', 'tree']) {
    const f = fixture(t), m = mock(f);
    let interrupted = false;
    await assert.rejects(m.run({ api: async (method, path, data) => {
      const response = await m.api(method, path, data);
      if (!interrupted && method === 'POST' && path === `/git/${type}s`) {
        interrupted = true;
        throw new Error('response lost');
      }
      return response;
    } }), /response lost/);
    const first = uploads(m, type)[0];
    await m.run();
    assert.equal(uploads(m, type).filter((call) => JSON.stringify(call.data) === JSON.stringify(first.data)).length, 1);
    assert.ok(m.calls.some((call) => call.method === 'GET' && call.endpoint.startsWith(`/git/${type}s/`)));
  }
});

test('completed nested and root trees survive interruption before commit or branch creation', async (t) => {
  for (const stop of ['/git/trees', '/git/commits', '/git/refs']) {
    const f = fixture(t);
    f.write('nested/a.txt', 'a'); f.commit('nested tree');
    const m = mock(f);
    let treeCount = 0;
    await assert.rejects(m.run({ api: async (method, path, data) => {
      if (method === 'POST' && path === stop && (stop !== '/git/trees' || ++treeCount === 2)) throw new Error('interrupted');
      return m.api(method, path, data);
    } }), /interrupted/);
    const blobs = uploads(m, 'blob').length;
    const trees = uploads(m, 'tree').map((call) => JSON.stringify(call.data));
    await m.run();
    assert.equal(uploads(m, 'blob').length, blobs);
    for (const tree of trees) assert.equal(uploads(m, 'tree').filter((call) => JSON.stringify(call.data) === tree).length, 1);
  }
});

test('unavailable cached objects are republished; wrong SHA and verification errors fail closed', async (t) => {
  for (const failure of ['missing', 'hash', 'permission']) {
    const f = fixture(t), m = mock(f, { fail: (method, path) => method === 'POST' && path === '/git/commits' });
    await assert.rejects(m.run(), /HTTP 403/);
    const blobs = uploads(m, 'blob').length;
    const resumed = async (method, path, data) => {
      if (method === 'GET' && path.startsWith('/git/trees/')) {
        if (failure === 'permission') return { status: 403, body: {} };
        if (failure === 'hash') return { status: 200, body: { sha: f.base } };
      }
      if (method === 'POST' && path === '/git/commits') {
        return { status: 403, body: {} }; // stop after object verification/publication
      }
      return m.api(method, path, data);
    };
    if (failure === 'missing') {
      m.objects.clear();
      await assert.rejects(m.run({ api: resumed }), /HTTP 403/);
      assert.equal(uploads(m, 'blob').length, blobs * 2);
    } else {
      await assert.rejects(m.run({ api: resumed }), failure === 'hash' ? /hash mismatch/ : /verification failed/);
      assert.equal(uploads(m, 'blob').length, blobs);
    }
  }
});

test('journal identity/tampering is rejected and new source/base/repository inputs cannot reuse it', async (t) => {
  const f = fixture(t), m = mock(f, { fail: (_method, path) => path === '/git/commits' });
  await assert.rejects(m.run(), /HTTP 403/);
  const [path] = journalFiles(f);
  const original = readFileSync(path, 'utf8');
  for (const mutation of [
    (state) => { state.identity.local = f.base; },
    (state) => { state.objects['blob:not-a-sha'] = 'confirmed'; },
    (state) => { state.objects[`tree:${f.base}`] = 'trusted'; },
  ]) {
    const state = JSON.parse(original); mutation(state); writeFileSync(path, JSON.stringify(state));
    const count = writes(m).length;
    await assert.rejects(m.run(), /journal.*source\/base identity/);
    assert.equal(writes(m).length, count);
  }
  writeFileSync(path, '{broken');
  await assert.rejects(m.run(), /journal.*source\/base identity/);
  writeFileSync(path, original);
  const cases = [
    { repo: 'other' },
    { base: 'release' },
    {},
    {},
  ];
  for (let i = 0; i < cases.length; i++) {
    if (i === 2) { f.write('new.txt', 'new source'); f.commit('advance source'); }
    if (i === 3) {
      const local = f.git(['rev-parse', 'HEAD']).trim();
      f.git(['checkout', '-q', '--detach', f.remote]);
      f.write('new-remote.txt', 'new base'); f.remote = f.commit('advance base');
      f.git(['checkout', '-q', '--detach', local]);
    }
    const count = uploads(m, 'blob').length;
    await assert.rejects(m.run({
      ...cases[i],
      api: (method, endpoint, data) => m.api(method, endpoint === '/git/ref/heads/release' ? '/git/ref/heads/main' : endpoint, data),
    }), /HTTP 403/);
    assert.ok(uploads(m, 'blob').length > count, 'changed identity starts a separate journal');
  }
  assert.equal(journalFiles(f).length, 5);
});

test('checkpoint failures stop before upload and abandoned atomic-write files do not affect recovery', async (t) => {
  const f = fixture(t), m = mock(f);
  const directory = f.git(['rev-parse', '--path-format=absolute', '--git-path', 'github-sync']).trim();
  writeFileSync(directory, 'blocks journal directory');
  await assert.rejects(m.run(), /journal.*source\/base identity/);
  assert.deepEqual(writes(m), []);
  rmSync(directory);
  mkdirSync(directory);
  writeFileSync(join(directory, 'abandoned.json.partial.tmp'), '{unfinished');
  await m.run();
  assert.equal(journalFiles(f).length, 1);
  assert.equal(f.git(['status', '--porcelain']), '');
});

test('incorrect upload hashes are never checkpointed as confirmed or used to create a branch', async (t) => {
  for (const type of ['blob', 'tree']) {
    const f = fixture(t), m = mock(f);
    await assert.rejects(m.run({ api: (method, path, data) =>
      method === 'POST' && path === `/git/${type}s`
        ? { status: 201, body: { sha: f.base } }
        : m.api(method, path, data),
    }), /content hash mismatch/);
    const state = JSON.parse(readFileSync(journalFiles(f)[0], 'utf8'));
    assert.ok(Object.entries(state.objects).some(([key, status]) => key.startsWith(`${type}:`) && status === 'pending'));
    assert.equal(state.objects[`${type}:${f.base}`], undefined);
    assert.equal(m.branches.size, 0);
    assert.equal(m.calls.some((call) => call.endpoint === '/git/commits'), false);
    await m.run();
    assert.equal(m.branches.size, 1);
  }
});

const limitedResponse = (status, headers = {}, body = {}) => ({
  status, headers: new Headers(headers), json: async () => body,
});

test('primary and secondary limits retry only after the indicated wait, with bounded backoff', async () => {
  for (const [response, expected] of [
    [limitedResponse(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '102' }), [2000]],
    [limitedResponse(429, { 'retry-after': '3' }), [3000]],
    [limitedResponse(403, { 'retry-after': new Date(104_000).toUTCString() }), [4000]],
    [limitedResponse(403, {}, { message: 'You have exceeded a secondary rate limit.' }), [60_000]],
    [limitedResponse(429), [60_000]],
    [limitedResponse(403, { 'retry-after': '1', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '105' }), [5000]],
  ]) {
    const waits = [], requests = [];
    const api = githubClient({
      owner: 'offline', repo: 'fixture', token: 'synthetic-offline-token', now: () => 100_000,
      wait: async (ms) => waits.push(ms),
      fetchImpl: async (_url, options) => { requests.push(options); return requests.length === 1 ? response : limitedResponse(201, {}, { sha: 'ok' }); },
    });
    assert.equal((await api('POST', '/git/blobs', { content: 'AA==', encoding: 'base64' })).status, 201);
    assert.deepEqual(waits, expected);
    assert.equal(requests[0].body, requests[1].body);
  }
  const waits = [];
  const api = githubClient({
    owner: 'offline', repo: 'fixture', token: 'synthetic-offline-token',
    wait: async (ms) => waits.push(ms), fetchImpl: async () => limitedResponse(429),
  });
  await assert.rejects(api('GET', '/git/ref/heads/main'), /rate limit retry budget exhausted/);
  assert.deepEqual(waits, [60_000, 120_000]);
});

test('long/reset limits fail explicitly, and permission, protection, validation and transport failures are not retried', async () => {
  for (const response of [
    limitedResponse(429, { 'retry-after': '3600' }),
    limitedResponse(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3700' }),
    limitedResponse(403, {}, { message: 'synthetic-offline-token protected' }),
    limitedResponse(422, {}, { message: 'secondary rate limit' }),
    limitedResponse(500),
    null,
  ]) {
    let requests = 0;
    const api = githubClient({
      owner: 'offline', repo: 'fixture', token: 'synthetic-offline-token', now: () => 100_000,
      wait: async () => assert.fail('must not wait'),
      fetchImpl: async () => { requests++; if (!response) throw new Error('synthetic-offline-token'); return response; },
    });
    if (!response || response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
      await assert.rejects(api('POST', '/git/refs', {}), (error) => {
        assert.doesNotMatch(error.message, /synthetic-offline-token/);
        return /retry budget exhausted|transport failed/.test(error.message);
      });
    } else assert.equal((await api('POST', '/git/refs', {})).status, response.status);
    assert.equal(requests, 1);
  }
});

test('rate-limit exhaustion during publication preserves prior uploads for the next invocation', async (t) => {
  const f = fixture(t); f.write('z.txt', 'another blob'); f.commit('extra file');
  const m = mock(f);
  let blobRequests = 0;
  const client = githubClient({
    owner: 'offline', repo: 'fixture', token: 'synthetic-offline-token', maxRetries: 1,
    wait: async () => {},
    fetchImpl: async (url, options) => {
      const path = url.split('/repos/offline/fixture')[1];
      if (options.method === 'POST' && path === '/git/blobs' && ++blobRequests > 1) return limitedResponse(429, { 'retry-after': '1' });
      const response = await m.api(options.method, path, options.body ? JSON.parse(options.body) : undefined);
      return limitedResponse(response.status, {}, response.body);
    },
  });
  await assert.rejects(m.run({ api: client }), /rate limit retry budget exhausted/);
  const content = uploads(m, 'blob')[0].data.content;
  await m.run();
  assert.equal(uploads(m, 'blob').filter((call) => call.data.content === content).length, 1);
  assert.equal(m.calls.some((call) => ['PATCH', 'PUT', 'DELETE'].includes(call.method)), false);
});

test('workflow retains the safe shell entrypoint and contains no legacy git push/ref force path', () => {
  const wrapper = readFileSync(new URL('../../scripts/push-to-github.sh', import.meta.url), 'utf8');
  assert.match(wrapper, /exec node scripts\/github-sync\.mjs/);
  assert.doesNotMatch(wrapper, /force|git push|curl|TOKEN/);
  const source = readFileSync(new URL('../../scripts/github-sync.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /api\(['"](?:PATCH|DELETE|PUT)['"]/);
  assert.doesNotMatch(source, /force:\s*true/);
  const config = readFileSync(new URL('../../.replit', import.meta.url), 'utf8');
  assert.match(config, /name = "Push to GitHub"[\s\S]*?args = "bash scripts\/push-to-github\.sh"/);
});
