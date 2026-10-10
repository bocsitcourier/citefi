#!/usr/bin/env node
// REST publishes objects/branches/PRs; git transport is read-only.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REQUIRED_CHECK = 'Offline deployment safety';
const ACTIONS_APP_ID = 15368;

export function gitRunner(cwd, env = process.env) {
  return (args, options = {}) => {
    try {
      return execFileSync('git', args, {
        cwd, env, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'], ...options,
      });
    } catch (error) {
      // Never echo command arguments, authentication headers or git stderr.
      throw new Error(`Git ${args[0]} failed (exit ${error.status ?? 'unknown'}). Check repository access/history or merge conflicts.`);
    }
  };
}

export function githubClient({
  owner, repo, token, fetchImpl = (...args) => fetch(...args),
  wait = sleep, now = Date.now, maxRetries = 3, maxWaitMs = 300_000,
}) {
  return async (method, endpoint, data) => {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${endpoint}`, {
          method, redirect: 'error', signal: AbortSignal.timeout(60_000),
          headers: {
            Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
      } catch {
        throw new Error(`GitHub ${method} ${endpoint} transport failed; rerun to resume object publication and reconcile any created branch/PR.`);
      }
      let body;
      try { body = await response.json(); } catch { body = {}; }
      const header = (name) => response.headers?.get(name);
      const retryAfter = header('retry-after');
      const primary = header('x-ratelimit-remaining') === '0';
      const limited = response.status === 429 || (response.status === 403 && (
        primary || retryAfter != null ||
        /secondary rate limit|API rate limit exceeded/i.test(body?.message ?? '')
      ));
      if (limited) {
        const time = now();
        const after = retryAfter == null ? NaN : /^\d+(?:\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - time;
        const reset = primary && header('x-ratelimit-reset') != null
          ? Number(header('x-ratelimit-reset')) * 1000 - time : NaN;
        const delays = [after, reset].filter(Number.isFinite);
        const delay = delays.length ? Math.max(1000, ...delays) : 60_000 * 2 ** attempt;
        if (attempt >= maxRetries || delay > maxWaitMs - waited) {
          throw new Error(`GitHub ${method} ${endpoint} rate limit retry budget exhausted (HTTP ${response.status}); rerun later to resume safely.`);
        }
        await wait(delay);
        waited += delay;
        continue;
      }
      return { status: response.status, body };
    }
  };
}

function expect(response, status, operation) {
  if (response.status !== status) {
    // Do not log raw provider bodies; they can contain sensitive request data.
    throw new Error(`${operation} failed (HTTP ${response.status}). Check token permissions and repository rules; no protection bypass will be attempted.`);
  }
  return response.body;
}

function sha(value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error('GitHub returned an invalid object SHA.');
  return value;
}

// This is a hint journal, not authority: scope it to the exact merge inputs and
// verify every reused content-addressed object with GitHub. Pending entries also
// recover a successful upload whose response (or subsequent checkpoint) was lost.
function publicationJournal(git, identity) {
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const directory = git(['rev-parse', '--path-format=absolute', '--git-path', 'github-sync']).trim();
  const path = join(directory, `${key}.json`);
  let state = { version: 1, identity, objects: {} };
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    if (cached.version !== 1 || JSON.stringify(cached.identity) !== JSON.stringify(identity) ||
        !cached.objects || typeof cached.objects !== 'object' || Array.isArray(cached.objects) ||
        Object.entries(cached.objects).some(([object, status]) =>
          !/^(blob|tree):[a-f0-9]{40}$/.test(object) || !['pending', 'confirmed'].includes(status)) ||
        Object.keys(cached).some((field) => !['version', 'identity', 'objects'].includes(field))) {
      throw new Error('Invalid journal');
    }
    state = cached;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Publication journal is unreadable or does not match source/base identity; remove the Git-directory github-sync journal and rerun.');
  }
  const save = (object, status) => {
    state.objects[object] = status;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    } catch {
      throw new Error('Could not checkpoint object publication in the Git directory; rerun after fixing local filesystem access.');
    } finally {
      // Best-effort cleanup must not mask a checkpoint failure or leak OS errors.
      try { unlinkSync(temporary); } catch {}
    }
  };
  return {
    async reuse(api, type, object) {
      const key = `${type}:${sha(object)}`;
      if (!state.objects[key]) return false;
      const response = await api('GET', `/git/${type}s/${object}`);
      if (response.status === 404) return false;
      const found = expect(response, 200, 'Cached object verification');
      if (sha(found.sha) !== object) throw new Error('Cached GitHub object content hash mismatch.');
      return true;
    },
    pending: (type, object) => save(`${type}:${sha(object)}`, 'pending'),
    confirmed: (type, object) => save(`${type}:${sha(object)}`, 'confirmed'),
  };
}

// Reuse unchanged remote subtrees. Upload changed blobs (binary-safe), file
// modes, symlinks and gitlinks without relying on a write-capable git transport.
async function publishTree(git, api, localTree, remoteTree, journal) {
  if (localTree === remoteTree) return localTree;
  if (await journal.reuse(api, 'tree', localTree)) return localTree;
  const entries = (tree) => tree ? git(['ls-tree', '-z', tree]).split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, type, object] = line.slice(0, tab).split(' ');
    return { mode, type, sha: object, path: line.slice(tab + 1) };
  }) : [];
  const previous = new Map(entries(remoteTree).map((entry) => [entry.path, entry]));
  const tree = [];
  for (const entry of entries(localTree)) {
    const old = previous.get(entry.path);
    let object = entry.sha;
    if (old?.sha !== object) {
      if (entry.type === 'tree') {
        object = await publishTree(git, api, object, old?.type === 'tree' ? old.sha : undefined, journal);
      } else if (entry.type === 'blob') {
        if (!await journal.reuse(api, 'blob', object)) {
          const content = git(['cat-file', 'blob', object], { encoding: 'buffer' }).toString('base64');
          journal.pending('blob', object);
          object = sha(expect(await api('POST', '/git/blobs', { content, encoding: 'base64' }), 201, 'Blob upload').sha);
          if (object !== entry.sha) throw new Error('GitHub blob content hash mismatch.');
          journal.confirmed('blob', object);
        }
      }
    }
    tree.push({ path: entry.path, mode: entry.mode, type: entry.type, sha: object });
  }
  // No base_tree: omitted entries represent real deletions, not retained files.
  journal.pending('tree', localTree);
  const uploaded = sha(expect(await api('POST', '/git/trees', { tree }), 201, 'Tree upload').sha);
  if (uploaded !== localTree) throw new Error('GitHub tree content hash mismatch.');
  journal.confirmed('tree', uploaded);
  return uploaded;
}

export async function reportChecks(api, pr, log) {
  log(`Pull request: ${pr.html_url}`);
  log(`PR state: ${pr.state}; merge state: ${pr.mergeable_state ?? 'unknown (GitHub is calculating)'}`);
  const head = sha(pr.head?.sha);
  const checks = [];
  for (let page = 1; ; page++) {
    const body = expect(await api('GET', `/commits/${head}/check-runs?filter=latest&per_page=100&page=${page}`), 200, 'Check lookup');
    if (!Array.isArray(body.check_runs)) throw new Error('Invalid check-runs response.');
    checks.push(...body.check_runs);
    if (body.check_runs.length < 100) break;
  }
  const required = checks.filter((check) => check.name === REQUIRED_CHECK && check.app?.id === ACTIONS_APP_ID);
  log(`Required check "${REQUIRED_CHECK}" (GitHub Actions): ${required.length
    ? required.map((check) => check.status === 'completed' ? check.conclusion : check.status).join(', ')
    : 'pending — not reported yet'}`);
  for (const check of checks) {
    log(`  ${check.name}: ${check.status === 'completed' ? check.conclusion : check.status}`);
  }
  const status = expect(await api('GET', `/commits/${head}/status`), 200, 'Commit status lookup');
  log(`Combined commit statuses: ${status.state}`);
  log('Not merged. Merge in GitHub only after required checks pass and the branch is up to date.');
}

export function hasLocalBaseCommit(git, commit) {
  const expected = sha(commit);
  try {
    git(['cat-file', '-e', `${expected}^{commit}`]);
    git(['cat-file', '-e', `${expected}^{tree}`]);
    return true;
  } catch {
    return false;
  }
}

export async function synchronize({ owner, repo, base = 'main', git, api, fetchBase, log = console.log }) {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Invalid GitHub owner/repository.');
  }
  git(['check-ref-format', `refs/heads/${base}`]);
  if (git(['status', '--porcelain']).trim()) throw new Error('Commit or stash local changes before synchronization; only committed HEAD is published.');
  const local = sha(git(['rev-parse', 'HEAD']).trim());
  const refPath = `/git/ref/heads/${encodeURIComponent(base)}`;
  const remote = sha(expect(await api('GET', refPath), 200, 'Base branch lookup').object?.sha);
  log(`Syncing ${owner}/${repo}: committed HEAD ${local.slice(0, 12)} into ${base} ${remote.slice(0, 12)} through a PR.`);
  if (local === remote) {
    log('Already up to date — nothing to publish.');
    return;
  }
  await fetchBase(remote);
  // merge-tree performs a real three-way merge, refuses unrelated histories
  // and exits nonzero on conflicts. It never changes HEAD/index/working files.
  const mergedTree = sha(git(['merge-tree', '--write-tree', remote, local]).trim().split('\n')[0]);
  const remoteTree = sha(git(['rev-parse', `${remote}^{tree}`]).trim());
  if (mergedTree === remoteTree) {
    log('Remote already contains these changes — nothing to publish.');
    return;
  }
  // Immutable branch per pair of source/base commits; reruns reuse it and PR.
  const branch = `replit-sync/${local}-${remote}`;
  const branchRef = `/git/ref/heads/${encodeURIComponent(branch)}`;
  const existing = await api('GET', branchRef);
  let head;
  if (existing.status === 200) {
    head = sha(existing.body.object?.sha);
    const commit = expect(await api('GET', `/git/commits/${head}`), 200, 'Sync commit lookup');
    if (commit.tree?.sha !== mergedTree || commit.parents?.length !== 1 || commit.parents[0].sha !== remote) {
      throw new Error('Existing sync branch does not match the intended tree/base; refusing to overwrite it.');
    }
  } else {
    expect(existing, 404, 'Sync branch lookup');
    const journal = publicationJournal(git, { owner, repo, base, local, remote, mergedTree, remoteTree });
    const tree = await publishTree(git, api, mergedTree, remoteTree, journal);
    head = sha(expect(await api('POST', '/git/commits', {
      message: `Synchronize Replit changes (${local.slice(0, 12)})\n\nSource HEAD: ${local}\nBase HEAD: ${remote}\nPreserves remote history; local changes are consolidated into this commit.`,
      tree, parents: [remote],
    }), 201, 'Sync commit creation').sha);
    const created = await api('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: head });
    if (created.status === 422) {
      // Another invocation may have won the race. Verify, never force-update.
      const raced = expect(await api('GET', branchRef), 200, 'Concurrent sync branch lookup');
      const racedHead = sha(raced.object?.sha);
      const commit = expect(await api('GET', `/git/commits/${racedHead}`), 200, 'Concurrent sync commit lookup');
      if (commit.tree?.sha !== mergedTree || commit.parents?.length !== 1 || commit.parents[0].sha !== remote) {
        throw new Error('Concurrent branch creation differs from intended synchronization.');
      }
      head = racedHead;
    } else {
      expect(created, 201, 'Sync branch creation');
    }
  }
  log(`Published branch: ${branch}`);
  const query = `?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${branch}`)}`;
  const prs = expect(await api('GET', `/pulls${query}`), 200, 'Existing PR lookup');
  if (!Array.isArray(prs)) throw new Error('Invalid pull request response.');
  let pr = prs[0];
  if (!pr) {
    const created = await api('POST', '/pulls', {
      title: `Sync Replit changes ${local.slice(0, 12)}`, base, head: branch,
      body: `Committed Replit changes from ${local}, merged onto remote ${base} at ${remote}.\n\nRemote commits are preserved. Local changes are consolidated into one sync commit. No protected ref or ruleset was modified.\n\nMerge only after **${REQUIRED_CHECK}** passes and GitHub confirms the branch is up to date.`,
    });
    if (created.status === 422) {
      const raced = expect(await api('GET', `/pulls${query}`), 200, 'Concurrent PR lookup');
      if (!Array.isArray(raced) || !raced.length) expect(created, 201, 'PR creation');
      pr = raced[0];
    } else {
      pr = expect(created, 201, 'PR creation');
    }
  }
  // Always print the link before check reads, so permission/reporting failures
  // don't hide a successfully created PR.
  log(`Pull request: ${pr.html_url}`);
  pr = expect(await api('GET', `/pulls/${pr.number}`), 200, 'PR state lookup');
  if (pr.head?.sha !== head) throw new Error('PR head changed unexpectedly; inspect the PR before continuing.');
  await reportChecks(api, pr, log);
  const current = sha(expect(await api('GET', refPath), 200, 'Final base lookup').object?.sha);
  if (current !== remote) log('Base advanced during synchronization. Update the PR branch in GitHub and rerun checks before merging.');
  return pr;
}

async function main() {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN is missing; configure it in Replit Secrets.');
  const owner = process.env.GITHUB_OWNER || 'bocsitcourier';
  const repo = process.env.GITHUB_REPO || 'citefi';
  const base = process.env.GITHUB_BRANCH || 'main';
  const cwd = gitRunner(process.cwd())(['rev-parse', '--show-toplevel']).trim();
  const git = gitRunner(cwd);
  const api = githubClient({ owner, repo, token });
  await synchronize({
    owner, repo, base, git, api,
    fetchBase: (remote) => {
      // The authenticated ref lookup supplies the exact content-addressed SHA.
      // Reuse an existing commit/tree; merge-tree still validates the merge.
      if (hasLocalBaseCommit(git, remote)) return;
      // Credentials stay in child environment, never in URLs, args or config
      // files. Disable credential helpers and interactive prompts.
      const env = {
        ...process.env, GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '',
      };
      gitRunner(cwd, env)(['fetch', '--no-tags', '--no-write-fetch-head', `https://github.com/${owner}/${repo}.git`, remote]);
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Synchronization stopped: ${error.message}`); process.exitCode = 1; });
}
