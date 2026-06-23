---
name: Content approval + spending caps architecture
description: Approval workflow columns, spending cap enforcement, usage events, and client_viewer role decisions.
---

# Content Approval Workflow (T104)
- Approval columns live directly on `articles` table (not a separate table): `approvalStatus` (draft|in_review|approved|changes_requested), `approvalTeamId`, `approvalRequestedAt`, `approvalReviewedAt`, `approvalReviewedBy`, `approvalFeedback`.
- `approvalTeamId` scopes the review to a specific client sub-team. Has `onDelete:"set null"` — deleting a client sub-team nullifies the field instead of cascading deletes.
- `requireClientReviewer()` in `lib/api/auth.ts` allows admin|member|client_viewer roles.
- `requireContentEditor()` blocks client_viewer — use on write routes.
- POST `/api/content/[id]/approve` — sets status, logs to activityLogs.
- GET `/api/content/review?status=in_review` — returns articles for current team (or approvalTeamId for client_viewer).

**Why:** Approval columns on articles avoids a join table and keeps the query surface minimal. client_viewer is a teamMembers.role string — no schema change needed.

# Spending Caps Enforcement (T107)
- `spendingCaps` table: per-team UNIQUE, monthlyCapCents (0=unlimited), alertThresholdPct, hardStop, lastAlertPeriodKey (YYYY-MM dedup).
- `usageEvents` table: append-only bigserial, teamId+createdAt composite index for efficient monthly sum queries.
- `lib/usage-caps.ts` exports: `getCapStatus()`, `checkUsageCap()` (throws 402 with code SPENDING_CAP_EXCEEDED on hardStop), `recordUsageEvent()`.
- `checkUsageCap()` is called in `app/api/jobs/batch-submit/route.ts` AFTER the paywall gate, BEFORE credit reserve.
- Alert email uses `deliverEmail()` from `lib/email.ts` — this function was previously private; it was exported to enable this.

**Why:** Pre-enqueue cap check prevents wasted pg-boss job slots. Hard stop is opt-in so teams aren't blocked without consent.

## Alert dedup is atomic (MEDIUM fix)
`maybeSendAlert()` uses a conditional `UPDATE … WHERE lastAlertPeriodKey IS NULL OR lastAlertPeriodKey != periodKey RETURNING id` — if `RETURNING` yields 0 rows, another concurrent request already sent the alert this period and we skip. Eliminates the read-then-write race where two concurrent requests could both "win" the check before either wrote the period key.

# Account Data Export (T108)
- POST `/api/account/export` — rate-limited 3/hr via `rateLimitDb()` from `lib/db-rate-limit.ts` (NOT `lib/rate-limit.ts`).
- Returns JSON download with profile, team, memberships, activity, logins, batches, articles — NO password hashes, tokens, or payment data.
- ExportDataCard component in `app/settings/page.tsx` handles the download via fetch+blob+anchor pattern.

# First-Run Onboarding (T111)
- GET `/api/onboarding/status` returns {isAgency, hasClients, hasPublishingConnection, hasContent, isComplete}.
- Redirect logic in `components/navigation/app-shell.tsx`: fires once after mount if isAgency && !hasClients && !isComplete.
- ONBOARDING_SKIP paths: /onboarding, /settings, /admin, /auth, /login, /signup, /accept-invite.
- Onboarding page at `app/onboarding/page.tsx` — 3-step card wizard; each step can be skipped.
