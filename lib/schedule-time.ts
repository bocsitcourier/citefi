import { CronExpressionParser } from "cron-parser";

/** Reject invalid configuration; never replace the user's cadence with a fallback. */
export function calculateNextRun(cronExpression: string, timezone: string, now = new Date()): Date {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return CronExpressionParser.parse(cronExpression, { currentDate: now, tz: timezone }).next().toDate();
  } catch {
    throw Object.assign(new Error("Invalid cron expression or timezone"), { statusCode: 400 });
  }
}
