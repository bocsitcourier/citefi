# Identity lifecycle and tenant-role hardening

## Review scope

Reviewed authenticated identity/session validation, team-context resolution,
reviewer/editor role gates, platform-admin lifecycle routes, team membership
removal, and password-recovery issuance/completion. No customer database,
provider, mail service, deployment, or workflow was used.

## Confirmed gaps and targeted fixes

### High — concurrent team-admin removals could remove every administrator

`DELETE /api/client/team` previously counted administrators and deleted the
selected membership in separate, unlocked statements. Two admins could each
observe two admins and delete the other, leaving the team without an admin.
The old check also ignored `owner` memberships, so the last owner could be
removed without applying the invariant.

The handler now re-reads the target, counts `admin` and `owner` memberships,
and conditionally deletes within one transaction holding a team-keyed
transaction advisory lock. A losing concurrent removal sees the updated count
and is rejected. Self-removal remains blocked.

Regression: `tests/security/role-hardening.test.mjs` asserts lock → privileged
member recount → delete ordering and inclusion of both privileged roles.

### High — recovery credentials from different channels could remain valid together

Password-reset email-code issuance replaced earlier email codes but did not
cancel pending link tokens. Admin reset-link issuance likewise left
password-reset email codes usable. A holder of an older still-valid credential
could therefore reset the password after a newer recovery request had been
issued.

Each reset-credential issuance path now invalidates pending credentials from
the competing recovery channel while holding the user-row lock. Existing
successful reset paths revoke active sessions and invalidate outstanding
recovery credentials.

Regression: the offline role-hardening test checks reciprocal channel
invalidation and session/recovery revocation on both reset completion paths.

## Scenario review

| Scenario | Source-level result |
| --- | --- |
| Suspended account reuses a live session | Authenticated admin, team-member, and reviewer guards re-check `accountStatus === "active"`; suspension terminates sessions in its transaction. |
| Removed member reuses a team-context session | Explicit session team context is revalidated against current direct/agency membership and hard-fails instead of falling through to another team. |
| Reviewer attempts a content write | `requireContentEditor` rejects `client_viewer`; tenant RLS also has reviewer-column restrictions and an integration regression in `tests/security/tenant-rls.test.ts`. |
| Platform admin self-demotion | The role-change endpoint explicitly rejects changing the caller's own role. Platform admin demotion, suspension, and deletion share the platform-admin transaction lock before recounting. |
| Last platform admin lifecycle race | Change-role, suspend, and delete routes use the shared advisory lock and re-count active admins under that lock. |
| Cross-team resource identifier | The auth resource guard compares resource team to validated team; the tenant RLS suite includes cross-team read/write denial checks. |
| Password reset / session revocation | Both successful reset methods terminate existing sessions and invalidate outstanding reset credentials; issuance now invalidates credentials from the other reset channel. |

## Verification

Ran only `tests/security/role-hardening.test.mjs` through
`QA/support/run-offline.sh`, which supplies a clean environment and offline
guards. Database-backed RLS and concurrency tests were not run because they
require an isolated database; no production/customer database was accessed.
