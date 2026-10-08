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

1. Check that the linked ruleset is active, targets `main`, has no bypass actors,
   and pins the exact job name to GitHub Actions.
2. A failing `Offline deployment safety` check must prevent merging.
3. A documentation-only pull request must report the same check and be mergeable
   once the check succeeds.

During initial setup, GitHub rejected a merge of the failing safety check with
HTTP 405 and `Required status check "Offline deployment safety" is failing.`
The runner revealed that npm cannot load the same `/dev/null` file as both user
and global config; the workflow now uses two separate empty config files.

Direct/force updates to `main`, including the old `scripts/push-to-github.sh`
sync path, are intentionally blocked. Use a branch and pull request instead;
do not disable the rule or add an administrator bypass to restore direct sync.
