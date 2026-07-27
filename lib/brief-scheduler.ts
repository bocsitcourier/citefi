import { db } from "@/lib/db";
import { dailyBriefPreferences, users, dailyBriefs } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { addDailyBriefJob } from "./queue";

/**
 * Checks all users' brief preferences and enqueues jobs for those due.
 * This should run every hour on the hour.
 */
export async function scheduleDueBriefs() {
  console.log("📅 Checking for due daily briefs...");
  
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // 1. Query all daily_brief_preferences JOINed with users
  // We need the timezone and sendHourLocal to decide if it's time.
  const prefs = await db
    .select({
      pref: dailyBriefPreferences,
      user: users,
    })
    .from(dailyBriefPreferences)
    .innerJoin(users, eq(dailyBriefPreferences.userId, users.id))
    .where(eq(users.accountStatus, 'active'));

  let enqueued = 0;

  for (const { pref, user } of prefs) {
    try {
      // 2. Determine local hour in user's timezone
      const localHour = parseInt(new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: pref.timezone,
      }).format(now));

      // 3. If localHour === sendHourLocal, check if a brief already exists for today
      if (localHour === pref.sendHourLocal) {
        const [existing] = await db
          .select()
          .from(dailyBriefs)
          .where(and(
            eq(dailyBriefs.userId, user.id),
            eq(dailyBriefs.localDate, todayStr)
          ))
          .limit(1);

        if (!existing) {
          // 4. Enqueue the job
          await addDailyBriefJob({
            userId: user.id,
            teamId: pref.teamId,
            localDate: todayStr,
          });
          enqueued++;
        }
      }
    } catch (err) {
      console.error(`Failed to schedule brief for user ${user.id}:`, err);
    }
  }

  if (enqueued > 0) {
    console.log(`✅ Enqueued ${enqueued} daily brief jobs.`);
  } else {
    console.log("ℹ️ No new briefs due at this hour.");
  }
}

/**
 * Starts the hourly scheduler for daily briefs.
 */
export function startBriefScheduler() {
  // Run immediately on startup
  scheduleDueBriefs().catch(err => console.error("Initial brief schedule failed:", err));

  // Then run every hour on the hour (approx)
  setInterval(() => {
    scheduleDueBriefs().catch(err => console.error("Hourly brief schedule failed:", err));
  }, 60 * 60 * 1000);
}
