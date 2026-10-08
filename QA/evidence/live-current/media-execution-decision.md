# Separate architect media-execution decision

2026-10-08. Requested by the assigned media QA scope after four failed article
cases. Decision from the architect-assisted execution assessment:

**APPROVED, conditional image-only execution.** Article truncation remains
unresolved; an isolated image pass must not imply article acceptance.

Allowed: one unique real `gemini-3.1-flash-image` request through production
authenticated identity regeneration, at most one physical submission, no
retry, $0.1592 maximum estimate and $0.16 reservation using the existing shared
USD30 ledger/lock. Retain $0.517071 prior valuation and $6 historical coverage
hold; historical calls remain UNKNOWN / UNRECONCILED.

Required before execution:

- Current official pricing capture and matching test DB locked rates.
- Owned disposable PostgreSQL/Redis only; no customer data or general workers.
- Full pixel decode of HTTP-retrieved bytes, matching durable stored bytes.
- Authorized retrieval, other-tenant retrieval/generation denial, and no paid
  call on tenant denial.
- Production receipt/COGS correlation and credit debit/settlement evidence.
- Export all relevant rows, receipt spool and stored objects before cleanup.
- Explicit filesystem-only boundary; no cloud certification. Selected 3.1
  is distinct from the application's 2.5 image default.
- Ambiguous outcomes retain reservation/lock; never retry automatically.

**Podcast/video are not authorized by this decision.** First supply a reviewed
per-stage manifest under the same ledger/lock: every script/expansion/judge,
TTS segment and video clip physical submission, current prices, maximum usage
and reserve; bound polls by count/time and pin them to the durably captured
provider operation ID. Export receipts/usage/accounting/security before DB
cleanup; require real playback/FFmpeg checks. No hidden auxiliaries,
unrestricted schedulers, publishing or customer DB.

This is execution permission only. Overall status remains **NOT CERTIFIED**.
