# DigitalOcean deployment entry point

This is the starting point for Citefi production operations. Production is the
DigitalOcean server, not the Replit preview or a separate Replit deployment.

## Existing SSH access

The established GitHub Actions path supplies existing repository secrets to the
SSH runner. Do not copy credentials into documentation, logs, chat, or source.

| Repository setting | Runner setting | Purpose |
| --- | --- | --- |
| Secret `DO_SSH_KEY` | `DO_SSH_PRIVATE_KEY` | SSH client authentication |
| Secret `DO_HOST` | `DO_HOST` | Destination host |
| Secret `DO_SSH_HOST_FINGERPRINT` | `DO_SSH_HOST_FINGERPRINT` | Independently verified host identity |
| Variable `DO_PUBLIC_HEALTHCHECK_URL` | `DO_PUBLIC_HEALTHCHECK_URL` | Public readiness endpoint |

The normal service account is `citefi`; the application root is
`/var/www/citefi`. Never print or retrieve the private key just to establish
whether access exists.

## Choose the correct operation

- **Read-only server configuration inspection:** the
  [inspection workflow](../.github/workflows/inspect-do.yml) runs
  [the fixed inspection script](../scripts/inspect-do.sh) on the reviewed default
  branch. It uses pinned SSH and does not deploy, migrate, restart the app, or
  print credentials.
- **Host identity verification only:** the
  [DigitalOcean workflow](../.github/workflows/deploy.yml) supports
  `ssh_verify_only=true`. This checks the host pin and rejects a deliberately
  wrong pin; it does not authenticate using the SSH private key or deploy.
- **Production release:** the same workflow, with `ssh_verify_only=false`,
  validates the selected source and invokes the
  [shared immutable release runner](../scripts/deploy-to-do.sh).
  Follow the approval, migration, readiness, and rollback requirements in the
  [production readiness runbook](production-readiness-runbook.md).

Use the protected pull-request source path in
[the deployment safety rules](deployment-safety-merge-rule.md).
`scripts/trigger-do-deploy.sh` is a legacy trigger, not the approved source-sync
path: do not use it to force-update protected main or avoid merge conflicts.

## What counts as deployed

A local passing build, pushed commit, opened pull request, successful host-pin
check, or PM2 reload alone is not proof of a completed production update.

Record the release source SHA, successful deployment run URL, activated release
identity, and full local and public readiness results. Preserve the prior
known-good release and backup/rollback evidence. If a step fails, report that
specific blocker rather than claiming deployment succeeded.

The runbook contains a dated October 8, 2026 host-pin verification record. Its
deployment jobs were skipped; do not describe that record as a successful
application deployment or proof that SSH authentication works today.

## Supporting runbooks

### Successful production release — October 10, 2026

- Active application source: `3f85ef0ef9b0156f0f392f8eba20e1fcf79d6886`.
- [Successful release run](https://github.com/bocsitcourier/citefi/actions/runs/38010933244).
- Owner approved the one-time preservation migration. The prior legacy build
  was retained at `releases/bootstrap-a7b06342527f8481b08a9e04ac99e70cd673663d`;
  preservation itself did not run migrations or restart processes.
- Active release:
  `/var/www/citefi/releases/3f85ef0ef9b0156f0f392f8eba20e1fcf79d6886-a754b8cf49f55f7c`.
- Versioned migrations completed and schema controls were verified. Both named
  production processes started using `scripts/process-bootstrap.ts`. No
  staging processes were reloaded.
- The separately approved recovery configuration is loaded before the shared
  `.env.local`; application secrets were not copied or replaced.
- External full health returned HTTP 200 and `ok: true`: database, Redis,
  worker/queues, canary, storage, models, backup, restore verification, and
  deployment all passed. The public login page rendered correctly.
- [Post-release persistence verification](https://github.com/bocsitcourier/citefi/actions/runs/38011701354)
  confirmed both named processes use the exact active bootstrap release and
  full health remained ready, then saved PM2 state without another reload.

### Production release attempt — October 10, 2026

- Public target verified from DNS, the server certificate, and the application
  response: `https://citefi.co`. The repository's public release health-check
  variable now points to `https://citefi.co/api/health?full=1`.
- Candidate source: `3852a1c4d5e1285285ad53772462cc9d6c519d80`.
- [Release run](https://github.com/bocsitcourier/citefi/actions/runs/38009891866):
  pinned host verification and release validation succeeded. The transport's
  isolated validation, production build, packaging, and SSH transfer completed.
- Host activation was refused because `/var/www/citefi/current` is not a
  symlink to a preserved built release. The host stopped in layout validation,
  before migrations, candidate unpacking, symlink cutover, or PM2 reload.
- No new production release was activated. The existing public health endpoint
  still reports degraded status with a missing worker heartbeat and missing
  configured backup-status file.
- Next prerequisite: the approved-window, service-account-only
  **one-time host migration** in the production readiness runbook. Verify and
  preserve the existing built artifact; do not bypass the rollback-layout gate,
  substitute an empty directory, or declare the degraded baseline healthy.

### Historical SSH review — October 9, 2026

Read-only GitHub job metadata confirms that SSH deployment was established:

- [August 13 SSH deployment](https://github.com/bocsitcourier/citefi/actions/runs/31753266954):
  the `SSH deploy to droplet` job and `Deploy via SSH` step both succeeded.
  This is historical workflow evidence, not proof of present production readiness.
- [October 8 host verification](https://github.com/bocsitcourier/citefi/actions/runs/37851398006):
  `Verify pinned SSH host key` succeeded; `Validate release` and
  `SSH deploy to droplet` were skipped.
- The [October 9 inspection](https://github.com/bocsitcourier/citefi/actions/runs/37883323350)
  and [isolated staging records](publishing-exact-approval.md) establish a real
  GitHub-held SSH access path, but do not establish a production cutover.

Older workflows pulled and rebuilt the active tree and sometimes stopped all
PM2 services. The current process builds an immutable artifact off-host and
switches the release atomically. Do not restore the older in-place commands.
Missing local SSH variables do not establish that GitHub-held access is missing.

At the time of this review, [PR #30](https://github.com/bocsitcourier/citefi/pull/30)
was open, unmerged and mergeable. Its required safety check had passed.
Refresh those facts before release; this entry is not a deployment receipt.

- [Production release, host verification, readiness, and rollback](production-readiness-runbook.md)
- [Database backup and restore](db-backup-runbook.md)
- [Required GitHub deployment checks](deployment-safety-merge-rule.md)

Keep dated operational evidence in the appropriate runbook. Never store private
keys, passwords, environment-file contents, or signed access URLs in these files.
