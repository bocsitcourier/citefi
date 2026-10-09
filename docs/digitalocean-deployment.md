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

- [Production release, host verification, readiness, and rollback](production-readiness-runbook.md)
- [Database backup and restore](db-backup-runbook.md)
- [Required GitHub deployment checks](deployment-safety-merge-rule.md)

Keep dated operational evidence in the appropriate runbook. Never store private
keys, passwords, environment-file contents, or signed access URLs in these files.
