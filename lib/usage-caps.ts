/**
 * Usage caps enforcement — T107 launch-readiness gap.
 * Provides: getCapStatus, checkUsageCap (throws on hard stop), recordUsageEvent, sendCapAlert.
 */

import { db } from "@/lib/db";
import { spendingCaps, usageEvents, teams, teamMembers, users } from "@/shared/schema";
import { eq, and, gte, sum, inArray } from "drizzle-orm";
import { deliverEmail } from "@/lib/email";

export type UsageAction = "article_generation" | "social_post" | "podcast" | "video" | "title_pool";

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
  /** Total estimated cost spent this period in cents */
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

/** Get current spend + cap status for a team this month */
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
    .where(and(eq(usageEvents.teamId, teamId), gte(usageEvents.createdAt, periodStart)));

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
 * Throws 402 with a clear message if hardStop is set and cap is exceeded.
 * Also fires alert email/notification if threshold crossed (non-blocking).
 */
export async function checkUsageCap(teamId: number, estimatedCents: number = 0): Promise<void> {
  const status = await getCapStatus(teamId);

  if (status.monthlyCapCents > 0) {
    const projectedSpend = status.spentCents + estimatedCents;
    const projectedPct = Math.round((projectedSpend / status.monthlyCapCents) * 100);

    if (status.hardStop && projectedSpend > status.monthlyCapCents) {
      const error: any = new Error(
        `Monthly spending cap of $${(status.monthlyCapCents / 100).toFixed(2)} would be exceeded by this job. ` +
        `You have $${(Math.max(0, status.monthlyCapCents - status.spentCents) / 100).toFixed(2)} remaining. ` +
        `Raise your cap in Settings → Usage to continue.`
      );
      error.statusCode = 402;
      error.code = "SPENDING_CAP_EXCEEDED";
      throw error;
    }

    await maybeSendAlert(teamId, status, projectedPct).catch(() => {});
  }
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
  });
}

/** Send threshold alert email + in-app notification if not already sent this period */
async function maybeSendAlert(teamId: number, status: CapStatus, projectedPct: number): Promise<void> {
  if (projectedPct < status.alertThresholdPct) return;

  const [cap] = await db.select().from(spendingCaps).where(eq(spendingCaps.teamId, teamId)).limit(1);
  if (!cap) return;

  const periodKey = currentPeriodKey();
  if (cap.lastAlertPeriodKey === periodKey) return;

  await db
    .update(spendingCaps)
    .set({ lastAlertPeriodKey: periodKey, lastAlertSentAt: new Date() })
    .where(eq(spendingCaps.teamId, teamId));

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
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Spending Alert</h2><p>Your team <strong>"${team?.name}"</strong> has used <strong>${projectedPct}%</strong> of its $${capDollars}/month spending cap.</p><p><strong>$${spentDollars}</strong> of <strong>$${capDollars}</strong> used this month.</p><p>Adjust your cap in <a href="${process.env.NEXTAUTH_URL ?? ""}/client/usage">Settings → Usage</a>.</p></div>`,
    }).catch(() => {});
  }
}
