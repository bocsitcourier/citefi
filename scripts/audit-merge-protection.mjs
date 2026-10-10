#!/usr/bin/env node
// Standalone GET-only audit. No application imports, dotenv, SDKs or deploy hooks.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const POLICY = Object.freeze({
  repository: 'bocsitcourier/citefi',
  branch: 'main',
  context: 'Offline deployment safety',
  integrationId: 15368,
});

export async function auditMergeProtection({ fetchImpl = fetch, token } = {}) {
  const failures = [];
  const unknowns = [];
  const base = `/repos/${POLICY.repository}`;
  async function get(path) {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, {
        method: 'GET',
        redirect: 'error', // Never forward a credential to a redirect destination.
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      throw new Error(`GET ${path}: network/timeout failure; enforcement could not be verified.`);
    }
    if (!response.ok) {
      // Do not echo API bodies, headers, tokens or raw transport errors.
      throw new Error(`GET ${path}: HTTP ${response.status}; check repository access, ruleset visibility and API rate limits.`);
    }
    try { return await response.json(); } catch {
      throw new Error(`GET ${path}: invalid JSON; enforcement could not be verified.`);
    }
  }
  async function effectiveRules() {
    const rules = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await get(`${base}/rules/branches/${POLICY.branch}?per_page=100&page=${page}`);
      if (!Array.isArray(batch) || batch.some(rule => !rule || typeof rule.type !== 'string'
        || !Number.isSafeInteger(rule.ruleset_id) || rule.ruleset_id <= 0)) {
        throw new Error('Effective main rules have an unrecognized API shape.');
      }
      rules.push(...batch);
      if (batch.length < 100) return rules;
    }
    throw new Error('Effective rules pagination exceeded the safety limit; audit is incomplete.');
  }
  try {
    const rules = await effectiveRules();
    const statusRules = rules.filter(rule => rule.type === 'required_status_checks');
    if (!rules.some(rule => rule.type === 'pull_request')) {
      failures.push('main does not effectively require pull-request-based changes (rule missing, disabled or no longer targets main).');
    }
    if (!statusRules.some(rule => rule.parameters?.required_status_checks?.some(
      check => check.context === POLICY.context && check.integration_id === POLICY.integrationId))) {
      failures.push(`main must require "${POLICY.context}" from GitHub Actions (integration ${POLICY.integrationId}); context or source is missing/changed.`);
    }
    if (!statusRules.some(rule => rule.parameters?.strict_required_status_checks_policy === true)) {
      failures.push('main does not require branches to be up to date before merging.');
    }
    for (const rule of statusRules) {
      if (rule.parameters?.do_not_enforce_on_create === true) {
        failures.push(`Ruleset ${rule.ruleset_id} permits creation without required checks.`);
      }
    }
    // Ask GitHub which rules apply, rather than attempting to reproduce its
    // ref-pattern and inherited organization/enterprise targeting semantics.
    for (const id of new Set(rules.map(rule => rule.ruleset_id))) {
      try {
        const detail = await get(`${base}/rulesets/${id}?includes_parents=true`);
        if (detail?.id !== id || detail.target !== 'branch' || !Array.isArray(detail.rules)) {
          unknowns.push(`Ruleset ${id}: unrecognized detail response; cannot verify enforcement.`);
          continue;
        }
        if (detail.enforcement !== 'active') {
          failures.push(`Ruleset ${id} is ${detail.enforcement ?? 'unknown'}, not active.`);
        }
        if (!Array.isArray(detail.bypass_actors)) {
          unknowns.push(`Ruleset ${id}: bypass_actors is hidden/malformed. Use an identity with ruleset write visibility; absence is not proof of no bypass.`);
        } else if (detail.bypass_actors.length) {
          failures.push(`Ruleset ${id} has ${detail.bypass_actors.length} bypass actor(s); no administrator, integration, team, user or PR-only bypass is permitted.`);
        }
        for (const rule of rules.filter(rule => rule.ruleset_id === id)) {
          if (!detail.rules.some(candidate => candidate.type === rule.type
            && JSON.stringify(candidate.parameters) === JSON.stringify(rule.parameters))) {
            unknowns.push(`Ruleset ${id}: effective rules and detail disagree; settings may have changed during the audit.`);
            break;
          }
        }
      } catch (error) { unknowns.push(error.message); }
    }
    // Avoid reporting success for an observable mid-audit deletion/edit.
    if (JSON.stringify(await effectiveRules()) !== JSON.stringify(rules)) {
      unknowns.push('Effective main rules changed during the audit; run again against stable settings.');
    }
  } catch (error) { unknowns.push(error.message); }
  return {
    repository: POLICY.repository,
    branch: POLICY.branch,
    status: failures.length ? 'weakened' : unknowns.length ? 'unverifiable' : 'passed',
    failures,
    unknowns,
  };
}

export function formatReport(result) {
  return [
    `GitHub merge protection: ${result.status.toUpperCase()} (${result.repository}:${result.branch})`,
    ...result.failures.map(message => `FAIL: ${message}`),
    ...result.unknowns.map(message => `UNVERIFIABLE: ${message}`),
    ...(result.status === 'passed' ? [
      'PASS: effective active rules require PRs, up-to-date branches and Offline deployment safety from GitHub Actions, with no visible bypass actors.',
    ] : ['No repository settings were changed. Inspect GitHub Settings → Rules → Rulesets and rerun the audit.']),
  ].join('\n');
}

export async function main({ env = process.env, fetchImpl = fetch, stdout = console.log } = {}) {
  const result = await auditMergeProtection({ fetchImpl, token: env.MERGE_PROTECTION_AUDIT_TOKEN });
  const report = formatReport(result);
  stdout(report);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (env.GITHUB_ACTIONS === 'true' && result.status !== 'passed') {
    stdout('::error title=GitHub merge protection audit failed::main merge protections are weakened or unverifiable. See the audit step summary.');
  }
  return result.status === 'passed' ? 0 : result.status === 'weakened' ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('UNVERIFIABLE: audit could not finish or write its report. No settings were changed.');
    process.exitCode = 2;
  });
}
