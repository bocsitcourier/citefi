---
name: Identity lifecycle invariants
description: Concurrency rules for administrator preservation and recovery-credential invalidation.
---

Every operation that can remove an active platform administrator must acquire
the same transaction-scoped advisory lock and recount active administrators
inside that transaction.

**Why:** Separate “last administrator” checks can both pass concurrently, then
delete, demote, or suspend every administrator.

**How to apply:** Use the shared invariant lock for self-deletion and
administrator-driven deletion, demotion, or suspension. Revalidate the target
state after locking and commit the state change and session revocation
atomically.

Every successful password mutation must invalidate all outstanding
recovery-credential types, not only the credential used for that mutation.
Recovery issuance and password mutation must serialize on the same user-row
lock.

**Why:** Otherwise an older email code or reset link can overwrite the newly
secured password, and a concurrent issuer can create a credential between
invalidation and commit.

**How to apply:** Password change and every reset channel must cancel all
pending email-code and link-token recovery records while holding the user lock.
All issuance paths acquire that lock before replacing or creating credentials.