---
name: Restore security evidence
description: Requirements for proving that a backup restores both data and database authorization controls.
---

A disaster-recovery backup must deterministically recreate required constrained
roles and privileges without exporting login roles, passwords, or privileged
cluster state.

**Why:** Plain database dumps do not create cluster roles, and dumps that omit
ACLs can restore rows while leaving RLS policies unusable or application access
overprivileged.

**How to apply:** Include a safe non-login tenant-role bootstrap and explicit
grant reconstruction in the backup stream. Refuse an existing role with login,
superuser, bypass-RLS, create-role, or create-database attributes.

Restore readiness requires a recent round trip to a fresh database on an
isolated server, plus verification of role safety and membership, RLS-enabled
tables, tenant policies, and table/schema/sequence/helper-function privileges.

**Why:** Table counts and sample rows prove data presence only; they do not prove
that the restored application can enforce tenant isolation.

**How to apply:** Keep backup success and restore evidence as separate health
signals. Failed or stale restore evidence must keep production readiness false.