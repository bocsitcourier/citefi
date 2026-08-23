# Tenant Isolation Inventory — Task #150

Database-policy classification and Row-Level-Security (RLS) access matrix for
every table in `shared/schema.ts`. This document is the authoritative reference
for migration `migrations/0014_tenant_rls.sql`.

## 1. Runtime contract (already implemented in `lib/db.ts`)

Every tenant-scoped pooled query runs inside a transaction that first executes:

```sql
SET LOCAL ROLE citefi_tenant;
SELECT set_config('citefi.actor_type', $actor,  true),   -- 'web' | 'worker'
       set_config('citefi.user_id',    $userId, true),   -- '' when null (worker)
       set_config('citefi.team_id',    $teamId, true),   -- always a positive int
       set_config('citefi.member_role',$role,   true);   -- owner|admin|member|client_viewer|platform_admin
```

Consequences that shape every policy below:

* **`citefi_tenant` is `NOLOGIN`** — it is only ever reached via `SET LOCAL ROLE`
  from the trusted pool owner, never a direct login. RLS is `ENABLE` **and
  `FORCE`d** on every policied table so the role owner is not exempt.
* **`citefi.team_id` is always set** and validated by `enterTenantContext()`
  (positive integer). Policies key on it as the primary tenant boundary.
* **`citefi.user_id` is `''` for the `worker` actor.** Worker access is a
  team-wide grant (no per-user narrowing); web access can be narrowed per user.
* **`citefi.member_role`** distinguishes `admin`, `member`, `client_viewer`
  (external client reviewer) and `platform_admin` (global admin acting inside a
  team context).
* **System / migration / maintenance code** connects as the login role (pool
  owner, e.g. the app DB user) and does **not** `SET ROLE citefi_tenant`; it is
  therefore *not* subject to RLS. This is the `scope: "system"` path. Rollout
  rejects a login role that is neither superuser nor `BYPASSRLS`, because system
  maintenance must remain explicit and tenant paths must always switch roles.
* **Unscoped database access fails closed.** The context-enforced `db`,
  `getTxDb()`, `neonHttpDb`, and `statelessDb` entry points reject work when
  `AsyncLocalStorage` has neither a validated tenant context nor a named system
  context. Privileged bootstrap and lifecycle code must use the visibly named
  pooled `systemDb` or `runWithSystemContext(reason, fn)`.
* **System context is bounded, never a process default.** Worker bootstrap does
  not call `enterSystemContext()` at module scope because timers, listeners, and
  worker callbacks inherit their creator's async context. Cross-tenant monitors
  and schedulers use `systemDb` or a per-invocation named system scope; claimed
  tenant work switches to a positive worker `teamId` before tenant services run.
* **Worker failure cleanup keeps the validated tenant.** When a scoped
  processor rejects, AsyncLocalStorage restores its caller; the pipeline wrapper
  explicitly re-enters the already resolved tenant before any final-attempt
  billing lookup or reservation release. Legacy queue payloads may perform one
  audited system-scoped durable-owner lookup, then immediately switch to that
  positive tenant for processing and cleanup.
* **Provider cost telemetry inherits tenant identity.** Deep provider helpers
  may omit `teamId`; the telemetry boundary derives it from the validated
  tenant execution context and rejects a conflicting caller value. This keeps
  telemetry writes visible to the same tenant-scoped per-run budget gate.
* **Legacy pooled transactions are context-aware.** `getTxDb()` delegates
  tenant-context statements to the tenant-aware pool and tenant-context
  `transaction()` calls to `withTenantTransaction()`. It cannot expose the
  privileged login role while a tenant execution context is active.
* **Authenticated system-only writes stay narrow.** Self-service account
  deletion enters a named system transaction only for global identity cleanup;
  client crash reports use `systemDb` only for the parentless `error_logs` row.
  Ordinary account export and tenant content queries remain on the RLS-enforced
  `db` path. Personal account deletion never changes a shared team's Stripe
  subscription or billing state.

### Recursion safety

Team-membership and agency-hierarchy validation cannot be expressed as a plain
sub-`SELECT` inside a policy, because reading `team_members` / `teams` would
itself trigger their RLS policies (infinite recursion). All membership checks go
through **`SECURITY DEFINER` helper functions** owned by the pool/login role
with **`SET row_security = off`** in their body, so the helper reads the base
tables with RLS suppressed and returns a boolean the policy can trust.

## 2. Access-model primitives

Helpers created by the migration (schema `citefi_rls`), all `SECURITY DEFINER`,
`SET row_security = off`, `STABLE`, executable only by `citefi_tenant`:

| Helper | Returns true when |
|---|---|
| `citefi_rls.current_team_id()` | parses `citefi.team_id` GUC → int (0 if unset) |
| `citefi_rls.current_user_id()` | parses `citefi.user_id` GUC → int or NULL |
| `citefi_rls.actor_type()` | `citefi.actor_type` GUC text |
| `citefi_rls.member_role()` | `citefi.member_role` GUC text |
| `citefi_rls.is_client_viewer()` | `member_role() = 'client_viewer'` |
| `citefi_rls.web_membership_valid(team)` | actor=`web` AND `user_id` is an `owner`/`admin`/`member` of `team` **or** an `owner`/`admin` of `team.parent_team_id` (agency-admin inheritance), with the team (and parent) not soft-deleted and `client_status='active'`. Mirrors `requireTeamMember()` in `lib/api/auth.ts`. |
| `citefi_rls.client_viewer_membership_valid(team)` | actor=`web`, GUC role=`client_viewer`, selected team matches, and the current user still has a direct `client_viewer` membership in that active, non-deleted team. No agency inheritance. |
| `citefi_rls.worker_team_active(team)` | actor=`worker` AND `team` exists, not soft-deleted, `client_status='active'`. Worker has no user, so it is granted the whole active team. |
| `citefi_rls.tenant_can_access(team)` | `team = current_team_id()` AND (`web_membership_valid(team)` OR `worker_team_active(team)`). **The single gate every direct-tenant policy calls.** |
| `citefi_rls.guard_client_viewer_article_update()` | trigger guard that rejects client-reviewer changes outside the approval decision, review timestamp/by, feedback, and normal `updated_at` fields; also enforces allowed decisions and reviewer identity. |
| `citefi_rls.is_platform_admin()` | `member_role() = 'platform_admin'` |

`tenant_can_access(team)` deliberately re-validates membership *from the
database* rather than trusting the GUC alone: a compromised or stale
`citefi.team_id` cannot grant access to a team the actor is not actually a
member of, and a soft-deleted / archived team is rejected even if the GUC still
names it.

## 3. Policy tiers

| Tier | Meaning | RLS shape |
|---|---|---|
| **tenant-direct** | has `team_id` | `USING`/`WITH CHECK tenant_can_access(team_id)` |
| **tenant-direct-sensitive** | billing/margin/cost with `team_id` | as above **AND `NOT is_client_viewer()`** |
| **tenant-indirect** | no `team_id`; FK to a tenant parent | `EXISTS` on parent resolved through a `SECURITY DEFINER` parent-team helper, then `tenant_can_access(parent_team)` |
| **tenant-indirect-sensitive** | indirect + secrets (OAuth tokens) | indirect + `NOT is_client_viewer()` |
| **tenant-direct+approval** | `articles` | owner-team full; a currently validated `client_viewer` may read assigned rows and update only allowlisted approval fields, enforced by RLS plus a trigger |
| **hierarchy** | `teams`, `team_members` | own team + agency parent/child; write admin/system |
| **user** | personal rows keyed by `user_id`, no team | `user_id = current_user_id()` (web); worker/system as noted |
| **global-ref** | shared read-only reference data | read: any tenant actor; write: system only |
| **global-system / global-billing / global-audit / global-identity** | platform-managed, no per-tenant read | no `citefi_tenant` access (system/login-role only) except identity self-row |
| **global override row** | `credit_menu_overrides` with `team_id IS NULL` | readable by every tenant actor; writable only by system/platform_admin |

## 4. Count reconciliation

> **Task #151 addendum.** Migration `migrations/0015_campaigns.sql` adds two new
> tenant-direct tables — `campaigns` (rows 90) and `campaign_exports` (row 91) —
> plus a nullable `campaign_id` column on the nine independently-queried content
> roots (`job_batches`, `articles`, `social_posts`, `video_ideas`,
> `publishing_jobs`, `cost_telemetry`, `usage_events`,
> `content_performance_metrics`, `content_events`). Those roots already carry
> their own tenant policies from migration 0014; the added `campaign_id` is a
> nullable same-team composite FK `(team_id, campaign_id) → campaigns(team_id, id)`
> (MATCH SIMPLE, so it only fires when both are non-null) and is not itself a
> tenant boundary. The two new tables receive standard `tenant_can_access(team_id)`
> policies reusing the existing `citefi_rls` helpers. The counts below describe
> the migration-0014 baseline.

`shared/schema.ts` declares **89** `pgTable` definitions (excluding the two
Task #151 tables above). **87** receive data-plane RLS policies. The **2** excluded from data-plane tenant policies are
`users` and `team_members`, which form the *identity/membership boundary* the
helper functions read via `SECURITY DEFINER`; they get `ENABLE + FORCE RLS` with
a **self/own-team read** policy and **system-only write** rather than a
content-style tenant policy (documented rows 3 and 2 below). Every one of the 89
tables has an explicit, non-default posture — none is left implicitly open.

## 5. Full table inventory

Legend for **Access matrix** columns (R=read, W=write):
`admin`/`member` = same-team web members; `viewer` = `client_viewer`;
`worker` = worker actor for an active team; `sys` = system/login-role (no RLS).

| # | Table | Tier | Tenant key | admin R/W | member R/W | viewer R/W | worker R/W | sys R/W | Notes / exceptions |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `teams` | hierarchy | `id` / `parent_team_id` | ✓/✓ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✓ | Read: own team, its parent agency, and its client children. Write: admin of team or parent agency, else system. |
| 2 | `team_members` | hierarchy (identity boundary) | `team_id` | ✓/✓ | ✓/✗ | ✗/✗ | ✓/✗ | ✓/✓ | Read own-team (+ agency parent/child) rows. Write admin/system only. Read by helpers with RLS off. |
| 3 | `users` | global-identity (identity boundary) | `id` | ✓*/✓* | ✓*/✓* | ✓*/✗ | ✗/✗ | ✓/✓ | *Read: self row + users sharing an active team. Write: self row only, else system. No cross-tenant PII. |
| 4 | `sessions` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Own sessions only (`user_id = current_user_id()`). Write self/system. |
| 5 | `activity_logs` | tenant-audit | `team_id` (+`user_id`) | ✓/append | ✓/append | ✗/✗ | ✓/append | ✓/✓ | Read own team. INSERT-only (append), no UPDATE/DELETE for tenant. `client_viewer` no access. |
| 6 | `totp_secrets` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Self only. |
| 7 | `email_verification_codes` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Self only. |
| 8 | `job_batches` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 9 | `articles` | tenant-direct+approval | `team_id` / `approval_team_id` | ✓/✓ | ✓/✓ | ✓†/✓† | ✓/✓ | ✓/✓ | †`client_viewer`: validated direct membership; SELECT assigned rows; UPDATE only approval decision/review fields enforced by trigger. Mirrors `/api/content/[id]/approve`. |
| 10 | `article_assets` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 11 | `job_events` | tenant-indirect | `batch_id`→`job_batches`, `article_id`→`articles` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent team. NULL parents → system only. |
| 12 | `article_runs` | tenant-indirect+billing | `article_id`→`articles`; `billing_team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Indirect via article; contains billing fields → `client_viewer` fully denied. |
| 13 | `locales` | global-ref | (none) | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✓ | Read-all reference data; write system only. |
| 14 | `batch_seo_cache` | tenant-indirect | `batch_id`→`job_batches` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 15 | `seo_logs` | tenant-indirect | `article_id`→`articles` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 16 | `social_posts` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 17 | `social_post_variants` | tenant-indirect | `social_post_id`→`social_posts` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 18 | `social_post_assets` | tenant-indirect | `social_post_id`→`social_posts` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 19 | `social_post_jobs` | tenant-indirect | `social_post_id`→`social_posts` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 20 | `social_post_logs` | tenant-indirect | `social_post_id`→`social_posts` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 21 | `error_logs` | tenant-indirect | `batch_id` / `article_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent; rows with both parents NULL → system only. |
| 22 | `admin_action_logs` | global-audit | `user_id` | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | Platform audit. `platform_admin` may read via system path; no tenant access. |
| 23 | `article_versions` | tenant-indirect | `article_id`→`articles` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 24 | `user_invites` | tenant-direct | `team_id` | ✓/✓ | ✓/✗ | ✗/✗ | ✗/✗ | ✓/✓ | Read own team; write admin/system only. |
| 25 | `login_history` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Read self; write system. |
| 26 | `password_resets` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Read self; write system. |
| 27 | `user_quotas` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Self only. |
| 28 | `system_metrics` | global-system | (none) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | System only. |
| 29 | `maintenance_flags` | global-system | (none) | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✓ | Read-all (feature flags); write system/platform_admin. |
| 30 | `cleanup_jobs` | global-system | (none) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | System only. |
| 31 | `cleanup_config` | global-system | (none) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | System only. |
| 32 | `content_clusters` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 33 | `coverage_nodes` | tenant-indirect | `cluster_id`→`content_clusters` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 34 | `local_authority_signals` | global-ref | (none) | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✓ | Read-all reference; write system. |
| 35 | `video_ideas` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 36 | `learning_agents` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 37 | `learning_patterns` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 38 | `content_performance_metrics` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 39 | `agent_optimization_logs` | tenant-indirect | `agent_id`→`learning_agents` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 40 | `audience_personas` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 41 | `persona_messaging_templates` | tenant-indirect | `persona_id`→`audience_personas` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 42 | `persona_behavioral_signals` | tenant-indirect | `persona_id`→`audience_personas` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 43 | `facts` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 44 | `fact_versions` | tenant-indirect | `fact_id`→`facts` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 45 | `fact_claims` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 46 | `content_audit_trails` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 47 | `agent_execution_manifests` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 48 | `publishing_connections` | tenant-direct-sensitive | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Holds connection config/secrets → `client_viewer` denied. |
| 49 | `oauth_credentials` | tenant-indirect-sensitive | `connection_id`→`publishing_connections` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | OAuth tokens. EXISTS parent + `client_viewer` denied. |
| 50 | `publishing_jobs` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 51 | `publishing_callbacks` | tenant-indirect | `publishing_job_id`→`publishing_jobs` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 52 | `content_schedules` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 53 | `schedule_runs` | tenant-indirect | `schedule_id`→`content_schedules` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 54 | `notifications` | tenant-direct | `team_id` (+`user_id`) | ✓/✓ | ✓‡/✓ | ✗/✗ | ✓/✓ | ✓/✓ | ‡When `user_id` is set the row is visible only to that user; team-wide when NULL. |
| 55 | `site_pages` | tenant-direct | `team_id` (int, no FK) | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant (NOT NULL integer, no declared FK). |
| 56 | `site_crawl_jobs` | tenant-direct | `team_id` (int, no FK) | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 57 | `ai_learning_ledger` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 58 | `content_reviews` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 59 | `pattern_dimension_stats` | tenant-indirect | `pattern_id`→`learning_patterns` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent (parent is itself team-scoped). |
| 60 | `cost_telemetry` | tenant-direct-sensitive | `team_id` (nullable) | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Cost data → `client_viewer` denied. NULL `team_id` → system only. |
| 61 | `credit_balances` | tenant-direct-sensitive | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Billing → `client_viewer` denied. |
| 62 | `credit_ledger` | tenant-direct-sensitive | `team_id` (+`user_id`) | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Billing ledger → `client_viewer` denied. |
| 63 | `billing_events` | global-billing | `team_id` (nullable) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | Stripe webhook audit; system only. |
| 64 | `free_tier_grants` | global-billing | `team_id` (nullable) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | Anti-abuse dedupe; system only. |
| 65 | `rate_limit_windows` | global-system | (none) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | System only. |
| 66 | `content_feedback` | tenant-direct | `team_id` (+`user_id`) | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 67 | `judge_recalibration_queue` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 68 | `content_events` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 69 | `client_intelligence` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 70 | `decision_policies` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 71 | `decision_arms` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 72 | `holdout_assignments` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 73 | `variant_arms` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 74 | `client_brand_profiles` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 75 | `cohort_insights` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 76 | `journey_templates` | global-ref | (none) | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✓ | Read-all template library; write system/platform_admin. |
| 77 | `journeys` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 78 | `journey_steps` | tenant-indirect | `journey_id`→`journeys` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 79 | `cadence_performance` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 80 | `credit_menu_overrides` | tenant-direct + global override | `team_id` (NULL=global) | ✓§/✗ | ✓§/✗ | ✗/✗ | ✓§/✗ | ✓/✓ | §Sensitive (billing). Tenant may **read** its own `team_id` row **and** any `team_id IS NULL` global override. Writes: system/platform_admin only. `client_viewer` denied. |
| 81 | `citation_probes` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant (also carries `article_id`). |
| 82 | `spending_caps` | tenant-direct-sensitive | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Billing → `client_viewer` denied. |
| 83 | `usage_events` | tenant-direct-sensitive | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Cost/margin → `client_viewer` denied. |
| 84 | `used_approval_tokens` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Read self; write system (token lifecycle). |
| 85 | `revoked_approval_tokens` | user | `user_id` | self | self | self | ✗ | ✓/✓ | Read self; write system. |
| 86 | `daily_brief_preferences` | tenant-direct | `team_id` (+`user_id`) | ✓/✓ | ✓‡/✓ | ✗/✗ | ✓/✓ | ✓/✓ | ‡User-scoped rows narrowed by `user_id` when set. |
| 87 | `daily_briefs` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Standard tenant. |
| 88 | `daily_brief_deliveries` | tenant-indirect | `brief_id`→`daily_briefs` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | EXISTS parent. |
| 89 | `signup_competitor_intake` | global-system | `resolved_team_id` (nullable) | ✗/✗ | ✗/✗ | ✗/✗ | ✗/✗ | ✓/✓ | Written pre-tenant (no authenticated team at signup) → system only. |
| 90 | `campaigns` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Task #151 team-scoped aggregate. Standard tenant policy (`tenant_can_access(team_id)`); RLS installed by migration 0015 reusing the 0014 `citefi_rls` helpers. |
| 91 | `campaign_exports` | tenant-direct | `team_id` | ✓/✓ | ✓/✓ | ✗/✗ | ✓/✓ | ✓/✓ | Task #151 per-campaign export requests. Standard tenant policy; RLS installed by migration 0015. |

## 6. Sensitive (margin / billing / secret) tables — `client_viewer` explicitly denied

`article_runs` (billing fields), `cost_telemetry`, `credit_balances`,
`credit_ledger`, `credit_menu_overrides`, `spending_caps`, `usage_events`,
`billing_events` (system-only anyway), `publishing_connections` and
`oauth_credentials` (secrets). Every tenant policy on these adds
`AND NOT citefi_rls.is_client_viewer()`.

## 7. Special cases summarised

* **`articles` client-viewer approval** — separate SELECT + UPDATE policies gated
  on a current direct reviewer membership and matching `approval_team_id`.
  `guard_client_viewer_article_update` adds a column allowlist because RLS alone
  is only a row boundary. This matches `app/api/content/[id]/approve/route.ts`
  and `requireClientReviewer`.
* **`teams` hierarchy** — a member of an agency team can see/act on its client
  child teams; a client team can see its parent agency for context. Implemented
  through `citefi_rls.web_membership_valid` which encodes agency-admin
  inheritance.
* **`credit_menu_overrides` global override** — rows with `team_id IS NULL` are a
  platform-wide price override every tenant must be able to read; they are
  writable only by system/platform_admin.
* **Indirect NULL parents** (`job_events`, `error_logs`, `article_runs`,
  `cost_telemetry`) — rows whose linking FK is NULL are unreachable by any tenant
  policy and remain visible only through the system (login-role) path.

## 8. Rollback

`migrations/0014_tenant_rls_rollback.sql` reverses everything in strict reverse
dependency order: drop policies → `DISABLE`/`NO FORCE` RLS per table → revoke
grants → drop helper functions → drop `citefi_rls` schema → drop the
`citefi_tenant` role. See that file's header for the exact ordered steps. Both
the migration and rollback are idempotent (`IF EXISTS` / `IF NOT EXISTS` /
`DO $$` guards) so they can be re-run safely.
