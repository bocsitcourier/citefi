---
name: Authentication session policy
description: Durable session-lifetime and Google Authenticator step-up decisions
---

Normal sessions have a 24-hour absolute lifetime. An explicit “Keep me signed in for 90 days” choice aligns JWT, database, and cookie expiry at 90 days. It does not suppress Google Authenticator on a separate new login.

**Why:** Users needed persistence beyond the Preview iframe's apparent one-minute logout, while silently trusting a device to bypass MFA for 90 days would weaken authentication without a dedicated device-token and revocation model.

**How to apply:** Bind the remembered-session choice to the password-completed challenge, keep sessions database-revocable, and require password plus current TOTP before enabling or disabling Google Authenticator. Treat trusted-device MFA bypass as a separate security feature.