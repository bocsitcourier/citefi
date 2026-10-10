---
name: Provider and parser runtime configuration
description: Verify installed dependency behavior and outgoing request limits rather than trusting types or fallback success.
---

Safety-relevant configuration must be checked against the installed dependency's
runtime behavior and, for provider limits, the serialized request sent to the
transport.

**Why:** An installed provider SDK lacked a newer thinking-level export and
converter support. Its supported deep-merge request extension worked, but only a
mocked wire-level assertion proved that thinking controls, output ceilings, and
JSON schemas all survived serialization. Separately, an incorrect cron-parser
API was hidden by a catch that substituted a daily fallback instead of honoring
the user's schedule.

**How to apply:** Keep real-library offline tests for parser/timezone behavior
and captured provider HTTP bodies. Reject invalid configuration explicitly.
Do not substitute unrelated schedules or assume unsupported SDK fields are
sent because TypeScript accepts an object. Preserve limits in attempt evidence;
do not upgrade dependencies solely to obtain an enum when an already-supported,
tested transport extension is sufficient.
