---
name: Billing and team audit fixes
description: Bugs fixed during comprehensive architect-led audit of billing, credits, team management, and learning systems.
---

# Billing and Team Audit Fixes

## past_due paywall
**Rule:** `past_due`, `unpaid`, `incomplete_expired` billing statuses with zero credits → block with 402. Do NOT include `past_due` in the "allowed" whitelist.
**Why:** Spec says "Failed payment → generation blocked." The old code allowed past_due teams with 0 credits, contradicting this.
**File:** `lib/billing/paywall.ts` — check `isPaymentFailed` before `hasActivePaidPlan`.

## Stripe webhook unknown price — fail closed
**Rule:** If `getPlanByStripePriceId(priceId)` returns null in `checkout.session.completed` or `customer.subscription.updated`, preserve the team's existing `billingPlan` and log an error. Never downgrade to 'free'.
**Why:** An unknown price is a misconfiguration; downgrading silently to free gives them zero credits while Stripe thinks they have a paid plan.
**File:** `app/api/billing/webhook/route.ts`

## Seat limit enforcement — two gates
**Rule:** Check at invite creation (POST /api/client/team) AND at invite acceptance (POST /api/admin/invites/accept/[token]).
**Why:** Plan downgrade between invite creation and acceptance could bypass the first gate.
**How:** Count `teamMembers` + pending non-expired `userInvites` vs `BILLING_PLANS[plan].maxSeats`. Skip if `maxSeats === null` (enterprise = unlimited).
**Files:** `app/api/client/team/route.ts`, `app/api/admin/invites/accept/[token]/route.ts`

## Cancel invite endpoint
**Route:** `DELETE /api/client/team/invite/[id]` → sets `status = 'cancelled'` (soft cancel, not delete).
**Guards:** requireTeamMember (admin role), verify invite belongs to same teamId, must be in `status = 'pending'`.
**File:** `app/api/client/team/invite/[id]/route.ts`

## External patterns exploration cap
**Rule:** In `buildOptimizationContext()`, external unvalidated patterns (`source='external' AND validatedByOwnAudience=false`) are capped to 1 slot out of the top 8 selected patterns.
**Why:** Competitive intel seeds patterns at Wilson 5 — they can dominate Thompson Sampling before the team has its own signal.
**File:** `lib/learning-service.ts` — filter in the `.slice(0, 8)` step.

## Critical unresolved gaps (deferred as follow-up tasks)
- Generation orchestrator is post-generation only (patterns not injected pre-prompt)
- Split-brain decisioning: 3 parallel Thompson Sampling systems
- Beacon doesn't populate journeyId/journeyStep on events
