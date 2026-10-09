---
name: GitHub networking
description: Sandbox transport constraints do not justify bypassing protected-branch checks.
---

The main-agent sandbox has historically rejected some state-changing git
transport operations. GitHub REST operations can avoid that transport problem,
but must still honor the repository's protected-branch rules.

**Why:** The previous direct force-ref synchronization approach predates required
merge checks. Treating it as the default now conflicts with deliberate no-bypass
enforcement.

**How to apply:** Use REST to publish a branch and open a pull request when git
transport is unavailable. Never force-update main or weaken the ruleset to get
past a sync failure. See [required deployment checks](required-deployment-check.md).

Preserving remote commits and remote-only changes takes priority over mirroring
the identities of individual local commits. Consolidating local changes is an
acceptable synchronization tradeoff; replacing the remote tree with the local
snapshot is not.

**Why:** The REST write path avoids blocked git pushes, but a snapshot overwrite
would silently discard GitHub-side work when the histories diverge.

**How to apply:** Keep a real three-way merge boundary and stop on conflicts;
do not simplify synchronization to "upload HEAD's tree onto remote main."

Check the GitHub deployment secret inventory before concluding DigitalOcean
access was never configured merely because SSH secrets are absent in Replit.
Deployment access can exist in GitHub without being available to the workspace.

**Why:** The user previously deployed through GitHub and explicitly directed us
to check the saved publishing secrets after a workspace-only check missed them.

**How to apply:** Inspect secret names and deployment run status read-only.
Do not disclose values, attempt to extract GitHub secrets, or trigger a deployment
as a substitute for authorization to inspect or test staging.

Prefer an explicitly authorized GitHub-run inspection using existing deployment
secrets over repeatedly requesting that the user duplicate SSH credentials here.
A successful deployment-named workflow does not prove a deployment occurred.

**Why:** The user expects reuse of previously configured access. A verification-only
run can succeed while skipping SSH authentication and the actual deployment.

**How to apply:** Inspect job conclusions before reporting deployment success.
If the existing workflow cannot perform the requested inspection, explain the
need for a separate read-only workflow rather than implying access never existed.

Read-only SSH authorization does not authorize storage provisioning or external
delivery. Treat literal environment-file inspection as configuration evidence,
not proof of effective runtime variables or usable provider access.

**Why:** Existing GitHub-held SSH credentials can authenticate without copying
private keys into Replit, but file-only inspection cannot certify injected
settings, bucket existence, or receiver behavior.

**How to apply:** Reuse the saved access path, then obtain exact staging
resource/write authorization before advancing to storage or receiver tests.

Treat transport failures on REST writes as ambiguous outcomes, not permission
to blindly retry. Recovery should verify content-addressed objects or reconcile
immutable branch/PR identity; automatic retries are reserved for explicit
rate-limit rejections and must have a finite wait budget.

**Why:** A lost response can occur after GitHub accepted the write. Blind retries
can duplicate publication, while unlimited rate-limit waits can leave the sync
workflow stalled indefinitely.

**How to apply:** Keep recovery journals credential-free and tied to the exact
merge inputs. When the base advances, preserving the new three-way merge boundary
is more important than maximizing reuse from an earlier journal.
