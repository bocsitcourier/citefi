# Enterprise Authentication Security Review

**Date:** September 9, 2026  
**Perspective:** CTO and security architecture review for an enterprise marketing SaaS  
**Scope:** Password login, Google Authenticator TOTP, recovery codes, remembered sessions, session validation/revocation, Replit Preview behavior, administrative access, auditability, and tenant context.

## Executive assessment

The authentication system has a solid base: password hashing, distributed rate limits, escalating account lockout, short-lived and one-time 2FA challenges, hashed session tokens, database-backed revocation, CSRF protection, and server-side role checks.

The reported one-minute logout was not caused by the database session lifetime. Every recent session inspected before remediation had an exact 24-hour lifetime. The more likely failure was Replit's cross-site Preview iframe dropping the HttpOnly cookie during page navigation while the Edge page gate could not read the development-only bearer fallback.

The immediate session defect and the highest-risk Google Authenticator setup/removal gaps have been remediated. The system is improved but is not yet at the target enterprise maturity level because TOTP secret encryption, recovery-code login, replay resistance, token rotation, centralized policy, and authentication-context containment still need work.

## Implemented in this remediation

### Session reliability and 90-day remembered login

- The previously cosmetic “Remember me” control now creates a revocable 90-day session.
- JWT expiry, database expiry, and cookie `Max-Age` use the same centralized policy.
- The preference is cryptographically bound to the password-completed 2FA challenge, so a client cannot change a normal session into a remembered session during verification.
- Session metadata records whether the user explicitly selected the remembered-session option.
- Normal logins remain 24 hours.
- Google Authenticator is still required for each new login; the 90-day option does not silently bypass MFA on another device.
- In development only, the admin page-navigation gate allows the application shell to load when the cross-site Preview iframe drops the cookie. Protected APIs still require the development bearer credential and authoritative server guards. Production retains the full page gate.

Runtime evidence:

- Remembered cookie `Max-Age`: 7,776,000 seconds.
- Session remained valid after the reported one-minute boundary: HTTP 200 after 70 seconds.
- Recent pre-change database sessions: 1,440-minute lifetime, with no one-minute records.

### Google Authenticator setup hardening

- Enabling TOTP requires the user's current password.
- The generated setup is wrapped in a server-signed, user-bound, 10-minute setup challenge.
- Activation only accepts the signed setup challenge and a valid six-digit TOTP.
- Setup and account-state changes are committed atomically.
- Enabling MFA revokes the user's other sessions.
- Setup responses use `Cache-Control: no-store`.
- TOTP input is restricted to six digits.
- Clock-drift tolerance was reduced from two 30-second steps to one.

### Google Authenticator removal hardening

- Disabling TOTP requires both the current password and a live Google Authenticator code.
- Per-IP and per-user rate limits apply.
- Secret deletion, account-state changes, session revocation, and the audit event are committed atomically.
- Other sessions are revoked when MFA is removed.
- Audit details record that step-up verification occurred.

## Existing controls that passed review

- Passwords use bcrypt with cost 12.
- JWTs have unique IDs, preventing same-second token-hash collisions.
- Server session rows store only SHA-256 token hashes.
- Suspended and inactive users cannot complete login.
- Password and 2FA verification have separate rate limits.
- Login challenges are random, hashed at rest, method-bound, expire after five minutes, and are consumed atomically.
- Concurrent verification of the same challenge creates only one session.
- A suspension or MFA-policy change between password and 2FA steps blocks session issuance.
- Admin authorization rechecks the live database role and account state.
- Cookie-authenticated mutations require CSRF proof.
- Session revocation is checked on every authoritative API request.

## Remaining gaps

### P0 — Authentication database context must be callback-scoped

Session bootstrap currently enters ambient system database authority before awaited authorization work. A separate remediation task has been implemented but still requires merge/reconciliation and full regression validation in this working tree.

Required outcome:

- Identity/session lookup runs inside a bounded system callback.
- Tenant work runs inside a bounded tenant callback.
- Admin work runs inside an explicit bounded admin callback.
- No route can inherit system authority after an awaited guard returns.

### P0 — TOTP secrets are plaintext at rest

The Base32 authenticator secret is stored directly in the database. A database disclosure would allow an attacker to generate current MFA codes.

Required outcome:

- Encrypt secrets with an application-managed, rotatable key using authenticated encryption.
- Store key version, nonce, authentication tag, and ciphertext.
- Support staged migration of existing plaintext rows.
- Never log or include secrets in audit details.

### P0 — Recovery codes are generated but cannot complete login

Backup codes are hashed and shown once during setup, but the login verification route does not accept or atomically consume them.

Required outcome:

- Accept a recovery code as an explicit alternative to TOTP.
- Verify its password hash and remove exactly one matching code atomically.
- Alert the user and record a high-signal audit event.
- Show remaining-code count and support step-up-protected regeneration.

### P1 — TOTP replay prevention

The system records `lastUsedAt` but does not record or reject an already accepted TOTP time-step. The same valid code could be reused during its acceptance window with a different login challenge.

Required outcome:

- Persist the last accepted TOTP counter, not only a timestamp.
- Atomically reject counters less than or equal to the stored counter.
- Account for the permitted clock-drift window.

### P1 — Long-lived sessions need rotation and idle policy

The explicit 90-day remembered session is database-revocable, but it remains one long-lived bearer JWT.

Target enterprise design:

- Short-lived access token.
- Rotating, one-time refresh credential stored as a hash.
- Refresh-token family reuse detection.
- Absolute 90-day maximum for remembered sessions.
- Configurable inactivity timeout.
- Reauthentication for password, MFA, billing, API-key, export, and administrative security changes.

### P1 — Admin MFA policy is optional

Global administrators can currently operate without TOTP enabled.

Development posture at review time:

- Active global-administrator records: 37
- Active global administrators enrolled in TOTP: 0

Required outcome:

- Require phishing-resistant MFA or TOTP for global administrators.
- Provide a controlled enrollment grace period and break-glass process.
- Prevent policy bypass through role changes, recovery, or pre-existing sessions.

### P1 — Authentication changes need security notifications

MFA enable/disable and new remembered-device events are audited, but the user is not consistently notified through a separate channel.

Required outcome:

- Notify on MFA enable, disable, reset, recovery-code use, password change, new remembered session, and suspicious login.
- Include safe device/time/location context without secrets.
- Provide a one-click session-revocation path.

### P2 — SameSite and embedding policy should be environment-specific

`SameSite=None` is required for Replit's embedded development Preview but expands ambient-cookie exposure. Production should use the strictest cookie mode compatible with the actual product embedding requirements.

### P2 — Self-service session management

Administrators can inspect and terminate sessions, but every user should be able to see active devices, last activity, and revoke individual or all other sessions.

### P2 — Enterprise identity roadmap

For enterprise customers, add SAML/OIDC SSO, SCIM lifecycle management, domain verification, enforced organization MFA policy, and WebAuthn/passkeys. TOTP should remain a supported fallback rather than the strongest available factor.

## Verification

- TypeScript check: pass.
- Diff whitespace validation: pass.
- Authentication integration suite after all changes: 30/30 passing.
- Added coverage for:
  - 90-day password login.
  - 90-day session issuance after the 2FA challenge.
  - Cookie/database lifetime alignment.
  - One-time 2FA challenge concurrency.
  - Suspension between password and 2FA.
- A real Google Authenticator-compatible TOTP was generated and used to activate MFA.
- MFA removal without step-up proof returned 401.
- Password-plus-current-TOTP removal succeeded and removed the stored authenticator record.

## Release recommendation

The one-minute session reliability defect and immediate MFA setup/removal weaknesses are fixed in development.

For an enterprise security claim, release remains conditional on:

1. Callback-scoped authentication database context being merged and validated.
2. TOTP secret encryption.
3. Recovery-code login and TOTP replay prevention.
4. Rotating refresh sessions and idle timeout policy.
5. Mandatory MFA for global administrators.
6. External staging, restore, rollback, canary, monitoring, and security certification evidence.