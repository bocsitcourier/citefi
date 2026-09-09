# Enterprise Authentication and Security Review

**Date:** September 9, 2026  
**Perspective:** CTO and security architecture review for an enterprise marketing SaaS  
**Scope:** Authentication, MFA, sessions, administrator controls, tenant isolation, account lifecycle, secret and PII handling, dependency security, backup/restore readiness, and release evidence.

## Executive assessment

The development codebase now has a materially stronger authentication and authorization foundation. No confirmed P0 vulnerability remains in the reviewed scope. Password, TOTP, recovery, session, CSRF, administrator, and tenant-database controls have adversarial regression coverage, and the latest dependency and SAST scans are clean.

Production remains **NO-GO**. The code changes and tests do not substitute for migration, deployment, restore, canary, rollback, high-availability, graceful-drain, email-delivery, and monitoring evidence from the target environment. The currently published deployment also predates pooled-worker fixes and still shows intermittent Neon HTTP failures.

## Controls completed in development

### Sessions and credential selection

- Normal sessions expire after 24 hours.
- “Keep me signed in” creates an explicit, revocable 90-day session.
- JWT expiry, database expiry, and cookie lifetime use the same central policy.
- Remembering a login does not bypass MFA during a later login.
- Production authentication is HttpOnly-cookie-only.
- Development adds a `sessionStorage` bearer fallback only for Replit Preview’s cross-site iframe behavior.
- CSRF checks follow the credential actually selected. A bearer-shaped header cannot bypass CSRF when the cookie is the valid credential.
- Session records contain hashed tokens and unique JWT IDs and are checked for revocation on authoritative API requests.
- Password changes and both password-reset flows revoke affected sessions, consume pending login challenges, and invalidate every other email-code and link-token recovery credential under the same user-row lock.

### Google Authenticator-compatible TOTP

- Enrollment requires the current password or an existing factor.
- Setup uses a signed, user-bound, method-bound, ten-minute challenge.
- TOTP secrets use AES-256-GCM encrypted storage with a versioned application key.
- Activation, replacement, disabling, and replay-counter updates are transactional.
- Codes are six digits with one permitted 30-second drift step.
- The last accepted TOTP counter is persisted and reused counters are rejected atomically.
- Recovery codes are shown once, stored as hashes, accepted as an explicit login alternative, and consumed once.
- Disabling TOTP requires the current password and a fresh authenticator code.
- MFA state changes revoke other sessions.
- Setup and verification responses use `Cache-Control: no-store`.

### Administrator policy

- `users.role = "admin"` remains the platform-wide administrator role; team roles remain tenant-scoped.
- Active administrators receive a seven-day MFA-enrollment deadline.
- A missing administrator MFA deadline fails closed rather than creating an indefinite password-only bypass.
- After the deadline, an unenrolled administrator cannot use privileged APIs.
- Enrolled administrators need an MFA-assured session for administrator APIs.
- Highly sensitive actions require MFA verified within the previous 15 minutes, including:
  - role changes;
  - administrator deletion and suspension;
  - password and MFA reset;
  - audit-log export;
  - billing-charge review and refunds.
- MFA reset remains reset-only. An administrator cannot remotely enable TOTP for another user.
- Delete, demote, suspend, and self-delete operations share a transaction-scoped advisory lock and recount active administrators inside the transaction, preventing concurrent removal of the final active platform administrator.

### Callback-scoped database authority and tenant RLS

- Identity and session bootstrap uses bounded system callbacks.
- Tenant work uses bounded tenant callbacks.
- Authorization guards return claims; they no longer establish ambient database authority as an awaited side effect.
- Team-member, team-admin, client-reviewer, brief, billing, agency, content, and mixed account-export routes execute database and service work inside explicit callback scopes.
- Global administrator routes use an explicitly named `systemDb` client.
- The Express middleware invokes downstream handlers from inside its tenant callback.
- Unscoped or blocked access through the context-aware application database fails closed.
- One-off pooled queries and interactive Drizzle `db.transaction()` calls both apply the tenant role and request GUCs.
- Tenant execution context remains isolated across concurrent pooled connections and is restored after success or failure.
- Client-reviewer RLS policies limit both visibility and writable columns.

### Password reset and account lifecycle

- Token and email-code password resets claim the reset credential atomically.
- Successful resets update the password, revoke sessions, consume login challenges, cancel other pending reset methods, and write an audit event in one transaction.
- Password changes revalidate and lock the current session, then condition the password update on the previously verified password hash to prevent stale reauthentication from overwriting a concurrent reset.
- Self-service deletion requires the current password.
- MFA-enabled users need an MFA-assured session to delete their account.
- Password, session, MFA, and final-administrator state are revalidated inside the deletion transaction.
- Self-service deletion does not cancel a shared team subscription.
- The endpoint truthfully describes deletion as removal of sign-in and personal authentication data; it does not claim that shared, financial, fraud-prevention, or legally retained records disappear.

This remains a safe account-removal endpoint, not a complete enterprise right-to-erasure workflow. Missing capabilities include durable deletion requests and outbox state, ownership transfer, full object/content/integration inventory, billing reconciliation, retention classes, legal holds, and an operator-visible completion record.

### Email, logs, and credential handling

- Email bodies, OTPs, reset links, approval links, and bearer credentials are never printed as a fallback.
- Production fails explicitly when SMTP is unavailable.
- SMTP failures log only a bounded provider error code and rethrow a generic error.
- Operational logs no longer include raw email addresses, IP addresses, generated article titles, or free-form error messages that may contain personal data.
- Backup logs no longer print any portion of the database URI.
- Backup files and directories are created under a restrictive umask and permissions.
- Signed object-storage URLs are not written to durable error records.

### Backup and restore readiness controls

- Backup success and restore verification are separate health controls.
- Production readiness fails when restore evidence is missing, failed, or stale.
- Restore verification refuses:
  - the source database;
  - a target on the source PostgreSQL server;
  - a target without the `_restore_verify` marker;
  - a non-empty target.
- Verification restores only into an operator-provisioned disposable database on an isolated server.
- Each backup contains a constrained tenant-role bootstrap and reconstructs the role's current table grants plus required schema, sequence, and RLS-helper privileges without exporting login roles or password hashes.
- The verifier checks the compressed object, restored schema, user data, non-privileged tenant role, restore-owner membership, RLS-enabled tables, tenant row policies, and required tenant grants.
- The backup installer now installs both the backup script and restore verifier.
- Only successful, credential-free restore evidence is published.

No real isolated restore run was performed during this review. Readiness must remain false until recent evidence exists.

## Security scan triage

### Dependency audit

- Critical: 0
- High: 0
- Moderate: 0
- Low: 0

Toolchain and dependency updates were type-checked and exercised through the relevant regression suites.

### Static application security scan

- Findings: 0

Earlier alerts were verified as false positives for fixed SQL statements with positional parameters and URL credential-removal code. The fixed SQL sites are documented with narrow scanner suppressions.

### Privacy-flow scan

- Findings: 3
  - 1 medium: possible income-related text sent to Google Gemini during article generation.
  - 2 low: possible budget or address text sent to Google Gemini during critique and social generation.

These are intentional product data flows: the user requests AI generation or critique and the corresponding prompt is sent to the configured model provider. They are not secret or logging leaks. Enterprise release still requires provider-contract, DPA, retention, regional-processing, privacy-notice, consent, and customer-content policy review. Sensitive-category minimization should be added where a content type does not require those fields.

## Verification completed

- TypeScript: pass.
- Diff whitespace validation: pass.
- Shell syntax for backup, restore, and installer scripts: pass.
- Authentication integration suite: **35/35 pass**.
- Tenant RLS and callback isolation suite: **8/8 pass**.
- Health and CSRF controls: **18/18 pass**.
- Agency/reviewer/profitability route contracts: **8/8 pass**.
- Dependency audit: **0 findings**.
- SAST: **0 findings**.
- Privacy-flow scan: **3 intentional AI-provider flows; no log leak findings**.
- Development workflow restarted successfully; Next.js and BullMQ workers reached ready state.

## Remaining security and platform roadmap

### P1

1. Replace long-lived bearer sessions with short access tokens and rotating one-time refresh-token families, including family reuse detection, absolute lifetime, and inactivity policy.
2. Add self-service session/device visibility and individual or “all other” revocation.
3. Add security notifications for password changes, MFA enable/disable/reset, recovery-code use, new remembered sessions, and suspicious login.
4. Build the durable deletion/retention/legal-hold workflow described above.
5. Add WebAuthn/passkeys and controlled break-glass administration; retain TOTP as a fallback.

### P2

1. Add enterprise SAML/OIDC SSO, SCIM, domain verification, and organization-level authentication policy.
2. Minimize or classify sensitive categories before AI-provider transmission when they are not required for the requested output.
3. Add race-focused HTTP tests for concurrent administrator delete/demote/suspend operations, in addition to the transaction design and RLS tests.
4. Add deployment smoke coverage for editor, charting, email, and storage paths affected by upgraded dependencies.

## Production release blockers

Production approval requires all of the following:

1. Run the MFA hardening migration through the approved deployment process and verify encrypted legacy-secret conversion.
2. Configure and prove real SMTP or another approved email-delivery path.
3. Run an isolated restore verification against a disposable database on another PostgreSQL server and produce recent successful evidence.
4. Deploy the pooled worker/database changes and confirm the intermittent Neon HTTP failures no longer appear.
5. Collect staging and production evidence for canary accounting, rollback, graceful worker drain, queue recovery, high availability, alerting, and monitoring.
6. Verify DO Spaces configuration and complete historical media parity before removing legacy Object Storage reads.
7. Complete privacy and contractual review for customer content sent to model providers.

## Release recommendation

**Development security posture:** conditional pass for the reviewed authentication and tenant-isolation scope.
**Production readiness:** **NO-GO** until every blocker above has objective evidence from the target environment.