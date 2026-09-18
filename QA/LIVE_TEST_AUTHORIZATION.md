# Live-test authorization — latest user decision

The user supplied **USD 30** as the maximum total testing spend and answered
**false** to allowing new paid QA while the two historical calls remain
unreconciled.

## Effective gate

- Record the USD 30 ceiling; do not interpret it as permission to bypass
  historical reconciliation.
- New paid QA remains paused while either historical call is unresolved.
- Do not retry either historical call to create replacement evidence.
- Do not interpret this answer as authorization for publishing, advertising,
  customer email, or unrestricted worker startup.
- No new paid call was made to record this decision.
- Earlier statements that no numeric limit had been supplied describe the
  prior state. This decision supplies a limit, but does not open the paid gate.

## Evidence still required

**User-confirmed availability:** The user reported that the requested historical
records are unavailable and supplied no files. No new reconciliation evidence
was received. Both attempts remain `UNKNOWN / UNRECONCILED`, and the paid gate
remains closed under the user's existing decision. Do not repeat the request
for the same unavailable records unless a new source becomes available.

See `QA/PROVIDER_RECONCILIATION.md` for the field-by-field gaps.

1. Original article-generation attempt: the retained snapshot reports
   `2026-09-10T16:23:00Z` and names `gemini-3.5-flash`, but neither field proves
   provider receipt or billing. Obtain original request/response logs or a
   provider-side record linking the request, timestamp, model, usage, cost,
   and original job.
2. First audio/transcription verification: obtain the original verification-v1
   request/response or provider-side record. Its provider, model, timestamp,
   request ID, usage, and cost are not established. Later verification-v2
   evidence cannot be substituted for it.

Provider billing/usage exports can assist matching, but aggregate totals alone
cannot close request-level gaps. Redact API keys, authorization headers,
cookies, credentials, and unrelated customer information before supplying
records. If evidence cannot establish the missing fields, preserve
`UNKNOWN / UNRECONCILED`; never manufacture a zero cost.

Overall certification remains **NOT CERTIFIED**. The runtime and other
verification gaps recorded in the QA reports remain separate requirements.