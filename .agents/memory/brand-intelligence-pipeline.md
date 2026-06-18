---
name: Brand Intelligence Pipeline
description: Architecture decisions for the Client Intelligence Engine — schema, service, injection, and UI.
---

## Key decisions

**client_brand_profiles schema**
- One row per team (UNIQUE constraint on team_id, not just an index).
- `profile_json` stores the full `ClientBrandProfileJson` (8 dimensions + policy pack + exemplars).
- `manual_overrides_json` is deep-merged on top of `profile_json` at read time via `mergeProfileWithOverrides()`.
- Status states: `pending → running → complete | failed`.
- Progress steps: `website → competitors → gaps → policy → assembling`.

**Why:**
Single-row-per-team makes GET and UPDATE simple. Deep merge means manual corrections survive a re-run.

**Migration pattern**
- Use `scripts/migrate-t015-*.ts` with `neon(process.env.DATABASE_URL!)` template literals — same driver as the API routes.
- Run: `node --env-file=.env.local --import tsx/esm scripts/migrate-*.ts`

**Context injection into learning service**
- `lib/learning-service.ts` `buildOptimizationContext()` fetches brand context via `getClientBrandContext(teamId)` in a `Promise.all` alongside `collectNegativeConstraints`.
- Brand context is prepended as the **first** element of `promptEnhancements[]` so it takes precedence over pattern-based enhancements.
- `getClientBrandContext()` returns `""` (empty string, falsy) if no complete profile exists — safe to call unconditionally.

**API surface**
- `POST /api/intelligence/run` — upsert row + enqueue pg-boss job.
- `GET /api/intelligence` — returns merged profile (profile_json deep-merged with manual_overrides_json).
- `PATCH /api/intelligence` — `action: "overrides"` or `action: "add_exemplar"`.
- `GET /api/intelligence/agency` — bulk status map for all child teams under an agency; returns `{ statuses: Record<teamId, { status, companyName, lastRunAt }> }`.

**How to apply**
When adding new content generators, import `getClientBrandContext` from `lib/client-brand-profile-service` and inject it into the prompt. Do NOT call it inside a retry loop — it's a DB read, cache it per job.
