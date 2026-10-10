# Deployment safety merge rule

`main` in `bocsitcourier/citefi` is governed by the active
[Require offline deployment safety ruleset](https://github.com/bocsitcourier/citefi/rules/24757240).

## Required configuration

- Target: `refs/heads/main`.
- Enforcement: **Active**, with no bypass actors (including administrators).
- Changes must go through a pull request; no additional review approvals are required.
- Required check: **Offline deployment safety**.
- Expected source: **GitHub Actions** (integration ID `15368`), not any arbitrary status publisher.
- Require the branch to be up to date before merging.

The check comes from `.github/workflows/deployment-safety.yml`. It tests the
deployment workflow gates and synthetic SSH pin fixtures, not a live deployment.
It uses a read-only checkout, disables persisted checkout credentials and npm
lifecycle scripts, and does not need production credentials.

## Why there are no path filters

GitHub leaves a required check pending when its entire workflow is skipped by
path or branch filters. A documentation-only or application-only pull request
would then be blocked indefinitely. This small check therefore runs on **every**
pull request, without path or branch filters or a job-level skip condition.
The offline contract includes negative tests for these regressions and for
renaming the required job.

See GitHub's [required-check troubleshooting guide](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).
Do not use commit-message CI-skip directives on pull requests: those can also
prevent a required workflow from reporting. Push a non-skipping commit if that
happens. If a merge queue is introduced, add and test a `merge_group` trigger
before requiring this check in the queue.

## Verification and maintenance

Run the credential-free local checks:

```sh
env -i PATH="$PATH" HOME=/tmp node tests/deployment/workflow-gates.test.cjs
bash tests/deployment/ssh-host-key.test.sh
```

Also verify repository enforcement in GitHub, because YAML cannot configure
branch rules:

### Read-only live protection audit

Run `node scripts/audit-merge-protection.mjs` (or `npm run audit:merge-protection`)
from a trusted checkout. This is a standalone Node script: no application
startup, dependency installation, `.env` loading, deployment, migrations or
GitHub configuration writes. It sends only GET requests to `api.github.com`,
refuses redirects, bounds pagination and times out requests.

The audit queries **effective rules for main**, including inherited rules, then
reads each applicable ruleset to verify active enforcement and an explicitly
empty bypass list. It requires the exact check context and GitHub Actions
integration ID, strict up-to-date enforcement and a pull-request rule. It does
not rely on the historical ruleset ID: a replacement can satisfy the policy.
Rules that are deleted, disabled, in evaluate mode or retargeted away from main
cannot satisfy the effective policy. A final effective-rules read detects
observable mid-audit changes; this is a point-in-time audit, not an atomic
snapshot or a substitute for GitHub's own enforcement.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | All required protections verified |
| 1 | Protections weakened; concrete failures listed |
| 2 | Unable to verify (permissions, hidden bypass settings, API/network failure, malformed data or concurrent edits) |

Any nonzero result needs attention. If weakening and API failures coexist, code
1 reports both. Never interpret permission errors or absent `bypass_actors` as
proof that bypass is disabled.

`.github/workflows/merge-protection-audit.yml` runs daily at 08:17 UTC and can be
run manually. It fails the run, emits an error annotation and writes a step
summary when weakened or unverifiable. This is **not a required PR check**, has
no PR/deploy trigger and never changes settings. GitHub Actions failure
notifications depend on the recipient's notification preferences; the failed
run and summary are the durable warning. Scheduling requires the workflow on
the default branch and Actions/scheduled workflows to be enabled.

Authentication is optional for public API reads, but GitHub hides
`bypass_actors` unless the caller has **write access to the ruleset**. Therefore
an ordinary read-only token or `GITHUB_TOKEN` may be insufficient to prove the
no-bypass requirement. If needed, an administrator must provision a dedicated
GitHub audit identity with visibility to all applicable rulesets (including
inherited ones), and securely supply `MERGE_PROTECTION_AUDIT_TOKEN` to the local
process or the same-named Actions secret. Restrict it to this repository and
the minimum permissions GitHub needs to expose that field, with no deployment,
cloud, SSH, database or application credentials. Although GitHub may require
write-capable visibility, this auditor **only performs reads**. Do not paste
tokens into commands, logs or this runbook; use the secret-management flow.
No credential has been provisioned and no live audit is claimed by adding this
workflow. Missing visibility intentionally produces an unverifiable warning.


#### Observed setup blockers (2026-10-09)

A credential-free live run returned **UNVERIFIABLE** (exit code 2):

```text
Ruleset 24757240: bypass_actors is hidden/malformed. Use an identity with ruleset write visibility; absence is not proof of no bypass.
```

The effective-main endpoint returned HTTP 200 with a pull-request rule and
`Offline deployment safety` pinned to GitHub Actions (`15368`), strict
up-to-date checks enabled and `do_not_enforce_on_create: false`. The applicable
ruleset detail endpoint returned HTTP 200 with active enforcement and a
repository source, but **omitted `bypass_actors`**. There were no inherited
rules in that effective-rules response. This does not prove an empty bypass
list, and future audits must still inspect any inherited rules that appear.

Additional setup blockers:

- `MERGE_PROTECTION_AUDIT_TOKEN` is absent from this Replit workspace. The
  existence of the GitHub Actions secret has **not** been verified; workspace
  secrets and Actions secrets are separate.
- GitHub reports `main` as the default branch. Reading
  `/repos/bocsitcourier/citefi/contents/.github/workflows/merge-protection-audit.yml?ref=main`
  returned HTTP 404, as did the audit workflow and workflow-run endpoints.
  The successful workflow listing did not contain the audit workflow.
  The local workflow therefore cannot yet be claimed to run daily on GitHub.
- No manual GitHub audit was started, and no successful hosted audit is claimed.
  All live requests used GET, without any existing deployment or personal token.

Administrator setup required before verification can continue:

1. Provision an audit-only identity with access restricted to
   `bocsitcourier/citefi`. Grant only the permissions GitHub requires to expose
   ruleset bypass lists; verify visibility rather than assuming read access
   is sufficient. If inherited rules appear, obtain visibility at their owning
   organization/enterprise too. Do not add this identity as a bypass actor.
2. Store its credential as the repository Actions secret
   `MERGE_PROTECTION_AUDIT_TOKEN` through GitHub's secret settings. For a local
   verification, supply it separately through Replit's secure secret form.
   Neither secret store populates the other. Do not use the existing personal
   GitHub token or any deployment credential.
3. Publish the existing audit workflow and script to `main` through a branch
   and pull request with the required safety check; never bypass enforcement.
4. In GitHub Actions, open **Merge protection audit**, select **Run workflow**
   on `main`, and record its run URL and audit summary. Confirm **PASSED**, or
   record each exact ruleset/HTTP visibility blocker. Workflow dispatch and
   secret provisioning are administrator setup actions, not GET-only audit
   operations; the audit credential itself needs neither secret-management nor
   workflow-dispatch permissions.

The available Replit GitHub connector uses a managed authenticated proxy. It
does not provide the standalone Actions credential required by this workflow,
and its default broad OAuth scopes are not a substitute for a repository-scoped,
dedicated audit identity.

Mocked tests require no credentials or network:

```sh
env -i PATH="$PATH" HOME=/tmp node --test tests/deployment/merge-protection-audit.test.mjs
```

These tests also run in the existing offline PR safety workflow. They cover
missing/disabled rules, check context/source drift, strict policy, PR rules,
all bypass types/modes, hidden bypass lists, inherited rules, pagination,
permission/rate-limit errors, network/JSON failures and concurrent edits.

### Manual enforcement evidence

1. Check that the linked ruleset is active, targets `main`, has no bypass actors,
   and pins the exact job name to GitHub Actions.
2. A failing `Offline deployment safety` check must prevent merging.
3. A documentation-only pull request must report the same check and be mergeable
   once the check succeeds.

During initial setup, GitHub rejected a merge of the failing safety check with
HTTP 405 and `Required status check "Offline deployment safety" is failing.`
The runner revealed that npm cannot load the same `/dev/null` file as both user
and global config; the workflow now uses two separate empty config files.

Live verification:

- [Safety bootstrap PR](https://github.com/bocsitcourier/citefi/pull/2): the
  failing check was blocked, then the corrected hosted check passed and the PR
  merged with the active rule in place.
- [Documentation-only PR](https://github.com/bocsitcourier/citefi/pull/3): only
  this runbook changed; the required check ran, passed, and permitted merging.
- The effective rules for `main` were read back after both merges and still
  required the GitHub Actions check, an up-to-date branch, and a pull request,
  with no bypass actors.

Direct/force updates to `main` are intentionally blocked. Do not disable the
rule or add an administrator bypass to restore direct sync.

## Replit → GitHub synchronization

Run the existing **Push to GitHub** console workflow, or:

```sh
bash scripts/push-to-github.sh
```

The shell entrypoint now delegates to `scripts/github-sync.mjs`. It:

1. Requires a clean working tree; commit or stash changes first. It publishes
   committed `HEAD`, not uncommitted files.
2. Reads the remote base (`main` by default), fetches its exact commit through
   read-only HTTPS git transport, and performs a three-way merge using
   `git merge-tree`. Remote-only changes and remote commit history are retained.
   Conflicting or unrelated histories stop **before** GitHub writes, without
   changing the local branch, index or working tree.
3. Uploads changed blobs/trees through REST, creates one consolidated sync
   commit with the remote base as its parent, and publishes an immutable
   `replit-sync/<local-sha>-<base-sha>` branch. Local individual commit history
   is not copied; its merged changes are consolidated into the sync commit.
   Unchanged remote subtrees are reused; deletions, binary files, symlinks,
   executable modes and submodule links retain their Git representation.
4. Opens or reuses an open PR for that branch. Repeating the workflow with the
   same source and base reuses the branch/PR, never force-updates anything.
5. Prints the PR URL, merge state, checks on the PR's current head and combined
   commit status. The exact required check must come from GitHub Actions; a
   missing check is explicitly reported as pending, not success.

The workflow **does not merge or deploy**. Publication success is not merge
approval: checks can still be pending or failing. Follow the printed PR link,
wait for **Offline deployment safety**, and merge only when GitHub permits it.
If `main` advances, update the PR branch in GitHub and rerun checks; do not bypass
the up-to-date requirement. For later syncs, first bring the merged remote
history into your local branch with a normal fetch/merge to avoid repeated
consolidation conflicts. An existing sync branch changed by someone else is
not overwritten; inspect it before retrying.

Configuration remains `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH` (the PR base)
and the Replit `GITHUB_PERSONAL_ACCESS_TOKEN` secret. The token needs repository
contents read/write, pull requests read/write and checks/status read access;
publishing workflow-file changes may also require the token's workflow
permission. It does **not** need administration or protection-bypass access.
Credentials are never included in git URLs, command arguments or printed
provider errors. Git write transport is not used. A failed read-only fetch
stops explicitly rather than replacing remote history.

Run offline synchronization tests without any credentials:

```sh
npm run test:github-sync
```

These use disposable local Git repositories and mocked GitHub responses,
including rejected direct updates, successful PR creation, content/history
preservation, conflicts, retry/race handling and pending/failed check reporting.
They do not contact GitHub or trigger deployments.
