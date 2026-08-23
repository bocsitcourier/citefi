import { systemDb as db } from "@/lib/db";
import { dailyBriefPreferences, users, dailyBriefs } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { addDailyBriefJob } from "./queue";

/** Compute YYYY-MM-DD in a specific IANA timezone */
function getLocalDateString(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Compute local hour (0-23) in a specific IANA timezone.
 *  Uses formatToParts to avoid the "24" returned at midnight by some
 *  Intl implementations when hour12:false is combined with certain locales. */
function getLocalHour(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find(p => p.type === "hour");
    // Some engines return "24" at midnight; normalise to 0
    return parseInt(hourPart?.value ?? "0", 10) % 24;
  } catch {
    return now.getUTCHours();
  }
}

/** Day of week in a specific timezone: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat */
function getLocalDayOfWeek(now: Date, timezone: string): number {
  try {
    const dayStr = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: timezone,
    }).format(now);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[dayStr] ?? now.getUTCDay();
  } catch {
    return now.getUTCDay();
  }
}

/** Returns true if a brief should be sent today based on the user's cadence setting */
function isBriefDueToday(cadence: string, dayOfWeek: number): boolean {
  switch (cadence) {
    case 'daily':
      return true;
    case '3x_week':
      // Mon, Wed, Fri = 1, 3, 5
      return [1, 3, 5].includes(dayOfWeek);
    case 'weekly':
      // Monday only = 1
      return dayOfWeek === 1;
    default:
      return true;
  }
}

/**
 * Checks all users' brief preferences and enqueues jobs for those due.
 * Runs every hour. Correctly uses each user's local timezone for date + hour comparison.
 */
export async function scheduleDueBriefs() {
  console.log("📅 Checking for due daily briefs...");

  const now = new Date();

  const prefs = await db
    .select({ pref: dailyBriefPreferences, user: users })
    .from(dailyBriefPreferences)
    .innerJoin(users, eq(dailyBriefPreferences.userId, users.id))
    .where(eq(users.accountStatus, 'active'));

  let enqueued = 0;

  for (const { pref, user } of prefs) {
    try {
      const tz = pref.timezone || 'America/New_York';
      const localHour = getLocalHour(now, tz);
      const localDate = getLocalDateString(now, tz);
      const localDow = getLocalDayOfWeek(now, tz);

      // Fire if we are AT or PAST the configured hour (catch-up after downtime),
      // but still within the same local date — the "already generated" check below
      // prevents double-sending if the job already completed earlier today.
      if (localHour < pref.sendHourLocal) continue;

      // Skip if cadence says not today
      if (!isBriefDueToday(pref.cadence, localDow)) {
        console.log(`📅 Skipping brief for user ${user.id} — cadence=${pref.cadence} not due on day ${localDow}`);
        continue;
      }

      // Skip if brief already generated for today (in user's local date)
      const [existing] = await db
        .select({ id: dailyBriefs.id })
        .from(dailyBriefs)
        .where(and(
          eq(dailyBriefs.userId, user.id),
          eq(dailyBriefs.localDate, localDate)
        ))
        .limit(1);

      if (existing) continue;

      await addDailyBriefJob({
        userId: user.id,
        teamId: pref.teamId,
        localDate,
      });
      enqueued++;
    } catch (err) {
      console.error(`Failed to schedule brief for user ${user.id}:`, err);
    }
  }

  console.log(enqueued > 0
    ? `✅ Enqueued ${enqueued} daily brief jobs.`
    : `ℹ️ No new briefs due at this hour.`
  );
}

export function startBriefScheduler() {
  scheduleDueBriefs().catch(err => console.error("Initial brief schedule failed:", err));
  setInterval(() => {
    scheduleDueBriefs().catch(err => console.error("Hourly brief schedule failed:", err));
  }, 60 * 60 * 1000);
}
