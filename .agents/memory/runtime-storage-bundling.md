---
name: Runtime storage is not bundled code
description: Keep private receipt storage out of Turbopack source tracing without changing durability.
---
Operator-provided runtime receipt directories are evidence storage, not application source dependencies.

**Why:** Turbopack's dynamic directory-open analysis traced the entire project, creating very expensive builds and potentially packaging private receipt data. Directory fsync is still required for durable spool writes.

**How to apply:** Narrowly exclude runtime-data accesses from bundler tracing while retaining path ownership, durable writes, fsync, and recovery checks. Do not ignore accesses to libraries, certificates, or other files the deployed application must actually bundle.
