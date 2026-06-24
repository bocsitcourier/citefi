/**
 * Usage caps enforcement — T107 launch-readiness gap.
 * Provides: getCapStatus, checkUsageCap (throws on hard stop), recordUsageEvent, sendCapAlert.
 *
 * Concurrent cap bypass fix (T005):
 * checkUsageCap atomically inserts a PENDING reservation BEFORE reading the total spend.
 * Subsequent concurrent cap checks will see the reservation in their SUM query, preventing
 * double-booking within the 2-hour stale-reservation expiry window.
 * Call cancelCapReservation(id) on job failure to release the hold.
 */

import { db } from "@/lib/db";

import { spendingCaps, usageEvents, teams, teamMembers, users } from "@/shared/schema";
import { eq, and, gte, sum, inArray, isNull, ne, or } from "drizzle-orm";
import { deliverEmail } from "@/lib/email";

/** Escape user-controlled strings before inserting them into HTML email bodies. */
const escHtml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type UsageAction = "article_generation" | "social_post" | "podcast" | "video" | "title_pool" | "cap_reservation";

/** Returns the current period key (YYYY-MM) in UTC */
function currentPeriodKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Start of current UTC month */
function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export interface CapStatus {
  /** Monthly cap in cents. 0 = unlimited. */
  monthlyCapCents: number;
  /** Total confirmed spend this period in cents (completed events only) */
  spentCents: number;
  /** Remaining headroom in cents. null if unlimited. */
  remainingCents: number | null;
  /** 0–100 usage percentage. null if unlimited. */
  usagePct: number | null;
  /** Whether a hard stop is configured */
  hardStop: boolean;
  /** Whether the cap is currently exceeded */
  exceeded: boolean;
  alertThresholdPct: number;
  periodKey: string;
}

/** Get confirmed spend + cap status for a team this month.
 *  Counts only COMPLETED events — pending reservations are excluded for UI clarity. */
export async function getCapStatus(teamId: number): Promise<CapStatus> {
  const [cap] = await db
    .select()
    .from(spendingCaps)
    .where(eq(spendingCaps.teamId, teamId))
    .limit(1);

  const periodStart = startOfMonth();
  const [spendRow] = await db
    .select({ total: sum(usageEvents.costEstimateCents) })
    .from(usageEvents)
    .where(and(
      eq(usageEvents.teamId, teamId),
      gte(usageEvents.createdAt, periodStart),
      eq(usageEvents.status, "completed")
    ));

  const spentCents = Number(spendRow?.total ?? 0);
  const monthlyCapCents = cap?.monthlyCapCents ?? 0;
  const hardStop = cap?.hardStop ?? false;
  const alertThresholdPct = cap?.alertThresholdPct ?? 80;

  if (monthlyCapCents === 0) {
    return {
      monthlyCapCents: 0,
      spentCents,
      remainingCents: null,
      usagePct: null,
      hardStop,
      exceeded: false,
      alertThresholdPct,
      periodKey: currentPeriodKey(),
    };
  }

  const remainingCents = Math.max(0, monthlyCapCents - spentCents);
  const usagePct = Math.round((spentCents / monthlyCapCents) * 100);
  const exceeded = spentCents >= monthlyCapCents;

  return { monthlyCapCents, spentCents, remainingCents, usagePct, hardStop, exceeded, alertThresholdPct, periodKey: currentPeriodKey() };
}

/**
 * Pre-flight cap check — call BEFORE enqueuing an expensive job.
 *
 * Atomically inserts a PENDING reservation event FIRST, then reads the running total
 * (completed + recent pending). This means two concurrent cap checks both see each
 * other's reservations, preventing double-booking.
 *
 * Returns the reservation event ID if a cap is configured (null = unlimited).
 * Throws 402 with SPENDING_CAP_EXCEEDED if hardStop is set and cap would be exceeded.
 * Call cancelCapReservation(id) on job failure to release the hold.
 */
export async function checkUsageCap(teamId: number, estimatedCents: number = 0): Promise<number | null> {
  const [cap] = await db
    .select()
    .from(spendingCaps)
    .where(eq(spendingCaps.teamId, teamId))
    .limit(1);

  if (!cap || cap.monthlyCapCents === 0) {
    // No cap configured — just fire a soft alert if threshold crossed (non-blocking)
    const status = await getCapStatus(teamId);
    if (status.monthlyCapCents > 0 && estimatedCents > 0) {
      const projectedPct = Math.round(((status.spentCents + estimatedCents) / status.monthlyCapCents) * 100);
      await maybeSendAlert(teamId, status, projectedPct).catch(() => {});
    }
    return null;
  }

  // INSERT the pending reservation FIRST so concurrent cap checks include it in their SUM.
  const [reserved] = await db
    .insert(usageEvents)
    .values({
      teamId,
      action: "cap_reservation",
      units: 0,
      costEstimateCents: estimatedCents,
      status: "pending",
    })
    .returning({ id: usageEvents.id });

  const reservationId = reserved.id;
  const periodStart = startOfMonth();
  // Stale-reservation expiry: only count pending events < 2 hours old.
  // This ensures a crashed job can't permanently block the cap.
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  // Count completed events + recent pending events (both contribute to the projected spend)
  const [spendRow] = await db
    .select({ total: sum(usageEvents.costEstimateCents) })
    .from(usageEvents)
    .where(and(
      eq(usageEvents.teamId, teamId),
      gte(usageEvents.createdAt, periodStart),
      or(
        eq(usageEvents.status, "completed"),
        and(eq(usageEvents.status, "pending"), gte(usageEvents.createdAt, twoHoursAgo))
      )
    ));

  const totalProjected = Number(spendRow?.total ?? 0);

  if (cap.hardStop && totalProjected > cap.monthlyCapCents) {
    // Over cap — cancel the reservation immediately and throw
    await db.delete(usageEvents).where(eq(usageEvents.id, reservationId)).catch(() => {});
    const alreadySpent = totalProjected - estimatedCents;
    const remaining = Math.max(0, cap.monthlyCapCents - alreadySpent);
    const error: any = new Error(
      `Monthly spending cap of $${(cap.monthlyCapCents / 100).toFixed(2)} would be exceeded by this job. ` +
      `You have $${(remaining / 100).toFixed(2)} remaining. ` +
      `Raise your cap in Settings → Usage to continue.`
    );
    error.statusCode = 402;
    error.code = "SPENDING_CAP_EXCEEDED";
    throw error;
  }

  // Fire soft alert if threshold crossed (non-blocking)
  const projectedPct = Math.round((totalProjected / cap.monthlyCapCents) * 100);
  const alertStatus: CapStatus = {
    monthlyCapCents: cap.monthlyCapCents,
    spentCents: totalProjected,
    remainingCents: Math.max(0, cap.monthlyCapCents - totalProjected),
    usagePct: projectedPct,
    hardStop: cap.hardStop ?? false,
    exceeded: totalProjected >= cap.monthlyCapCents,
    alertThresholdPct: cap.alertThresholdPct ?? 80,
    periodKey: currentPeriodKey(),
  };
  await maybeSendAlert(teamId, alertStatus, projectedPct).catch(() => {});

  return reservationId;
}

/**
 * Cancel a pending cap reservation — call when a job fails before completing.
 * Safe to call even if the reservation was already deleted.
 */
export async function cancelCapReservation(reservationId: number): Promise<void> {
  await db
    .delete(usageEvents)
    .where(and(eq(usageEvents.id, reservationId), eq(usageEvents.status, "pending")));
}

/** Write a usage event after successful billable work completion */
export async function recordUsageEvent(opts: {
  teamId: number;
  action: UsageAction;
  units?: number;
  costEstimateCents: number;
  jobId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(usageEvents).values({
    teamId: opts.teamId,
    action: opts.action,
    units: opts.units ?? 1,
    costEstimateCents: opts.costEstimateCents,
    jobId: opts.jobId ?? null,
    metadataJson: opts.metadata ?? null,
    status: "completed",
  });
}

/** Send threshold alert email + in-app notification if not already sent this period */
async function maybeSendAlert(teamId: number, status: CapStatus, projectedPct: number): Promise<void> {
  if (projectedPct < status.alertThresholdPct) return;

  const periodKey = currentPeriodKey();

  // Atomic dedup: conditional UPDATE only succeeds if we haven't sent an alert this period.
  // Two concurrent requests can both read cap.lastAlertPeriodKey !== periodKey, but only
  // the first UPDATE to match the WHERE clause will return a row — the second gets 0 rows.
  const updated = await db
    .update(spendingCaps)
    .set({ lastAlertPeriodKey: periodKey, lastAlertSentAt: new Date() })
    .where(and(
      eq(spendingCaps.teamId, teamId),
      or(isNull(spendingCaps.lastAlertPeriodKey), ne(spendingCaps.lastAlertPeriodKey, periodKey))
    ))
    .returning({ id: spendingCaps.id });

  if (!updated.length) return; // Already sent this period (another concurrent request won the race)

  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const admins = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));

  const adminUserIds = admins.map((a) => a.userId);
  if (!adminUserIds.length) return;

  const adminUsers = await db
    .select({ email: users.email, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, adminUserIds));

  const capDollars = (status.monthlyCapCents / 100).toFixed(2);
  const spentDollars = (status.spentCents / 100).toFixed(2);

  for (const adminUser of adminUsers) {
    deliverEmail({
      to: adminUser.email,
      subject: `Citefi spending alert: ${projectedPct}% of monthly cap used`,
      text: `Your team "${team?.name}" has used ${projectedPct}% of its $${capDollars}/month spending cap ($${spentDollars} of $${capDollars}). Adjust your cap in Settings → Usage if needed.`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Spending Alert</h2><p>Your team <strong>"${escHtml(team?.name ?? "")}"</strong> has used <strong>${projectedPct}%</strong> of its $${capDollars}/month spending cap.</p><p><strong>$${spentDollars}</strong> of <strong>$${capDollars}</strong> used this month.</p><p>Adjust your cap in <a href="${process.env.NEXTAUTH_URL ?? ""}/client/usage">Settings → Usage</a>.</p></div>`,
    }).catch(() => {});
  }
}
