---
name: Admin panel audit findings
description: 8 bugs found and fixed in the comprehensive June 2026 architect review covering admin, content pipeline, and security.
---

## Fixed Bugs (all shipped)

### 1. toggle-2fa — Schema mismatch (CRITICAL)
- **Bug**: Route read `targetUser.twoFactorEnforced` (column doesn't exist → always undefined → toggle always set to true).
- **Fix**: Read `targetUser.twoFactorEnabled` (the real column, 0/1 integer) and invert it.
- **File**: `app/api/admin/users/[id]/toggle-2fa/route.ts`

### 2. title-pool — Reddit research not in try/catch (CRITICAL)
- **Bug**: `performRedditResearch()` was called without try/catch. Any Reddit API failure crashed the entire batch creation (title pool + batch insert never ran).
- **Fix**: Wrapped in try/catch with empty fallback `{ questions: [], subreddits: [], intentClusters: [], contentAngles: [] }`.
- **File**: `app/api/jobs/title-pool/route.ts`

### 3. suspend — No session invalidation (HIGH SECURITY)
- **Bug**: Suspending a user only set `accountStatus = 'suspended'` in DB. Active JWTs remained valid until natural expiry.
- **Fix**: After status update, immediately UPDATE sessions SET isActive=0, forceLogoutAt=now(), terminationReason='account_suspended'.
- **File**: `app/api/admin/users/[id]/suspend/route.ts`
- **Pattern**: Force-logout logic (same as `force-logout/route.ts`) — reuse this pattern anywhere accounts are locked.

### 4. change-role — Admin self-demotion not blocked (HIGH)
- **Bug**: An admin could demote themselves if other admins existed. "Last admin" check used `ne(users.id, userId)` which excluded the target but not the caller.
- **Fix**: Added early guard `if (userId === auth.userId) → 400`.
- **File**: `app/api/admin/users/[id]/change-role/route.ts`

### 5. quotas — Arbitrary quota type injection (MEDIUM)
- **Bug**: `quotaType: z.string()` accepted any string, allowing unknown keys into userQuotas table.
- **Fix**: Replaced with `z.enum(VALID_QUOTA_TYPES)` allowlist of 14 known types.
- **File**: `app/api/admin/quotas/[userId]/route.ts`
- **How to apply**: Add to VALID_QUOTA_TYPES when adding new quota categories.

### 6. error-logs — PATCH/DELETE scope (MEDIUM)
- **Bug**: PATCH (resolve) and DELETE only operated on `errorLogs` table. Video idea and social video errors shown in the UI panel couldn't be resolved/deleted.
- **Fix**: PATCH now accepts `source` field and routes: video_idea → videoIdeas.status='DISMISSED', social_video → socialPosts.videoStatus='DISMISSED', else errorLogs. DELETE accepts `entries: [{id, source}]` for cross-table bulk deletes (backward-compat `ids[]` still works for article logs).
- **File**: `app/api/admin/error-logs/route.ts`

### 7. credits/grant — No fallback idempotency (MEDIUM)
- **Bug**: `idempotencyKey` was optional; callers who omitted it could double-grant on rapid re-clicks.
- **Fix**: Server-side fallback key = `admin-grant:${adminUserId}:${teamId}:${amount}:${bucket}:${Math.floor(Date.now() / 60000)}`. Deduplicates within a 1-minute window without requiring the caller to send a key.
- **File**: `app/api/admin/credits/grant/route.ts`

### 8. review/chatgpt — No paywall gate (MEDIUM)
- **Bug**: Any authenticated user (including free tier with 0 credits) could call `/api/review/chatgpt` and trigger 5 parallel AI calls (hyperlinks, SEO, hashtags, social snippets, image enhancement).
- **Fix**: Added `checkTeamPaywall(teamId)` before ownership check; returns 402 if team lacks access.
- **File**: `app/api/review/chatgpt/route.ts`

## Still-open known gaps (not fixed in this pass)

- **GPT-4 token truncation**: `finalizeContent` throws on `finish_reason === 'length'`; no dead-letter strategy.
- **Brand normalization collision**: `normalizeBrandCapitalization` uses global `/gi` regex; breaks if brand name matches common English word.
- **Recursive JSON-LD schema**: `enhanceArticleWithGPT` regex strip may miss malformed scripts, causing nested schemas.
- **Batch cancellation race**: Worker loop doesn't check cancellation mid-orchestration, can spawn unneeded article jobs.
- **Error screenshot auth**: `error-screenshot` endpoint uses `requireAuth` not `requireAdmin`; any user can write to error_logs (rate-limited to 5/10min).
