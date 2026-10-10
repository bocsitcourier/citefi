import { db } from "./db";
import { socialPosts } from "@/shared/schema";
import { and, eq, notInArray, sql } from "drizzle-orm";

export const NON_SCHEDULABLE_STATUSES = ["POSTED", "DELETED"];

export function validateSocialSchedule(scheduleAt: string, status: string, now = new Date()): Date {
  const date = new Date(scheduleAt);
  if (!Number.isFinite(date.getTime()) || date <= now) {
    throw Object.assign(new Error("scheduleAt must be a future date/time"), { statusCode: 400 });
  }
  if (NON_SCHEDULABLE_STATUSES.includes(status)) {
    throw Object.assign(new Error(`Cannot schedule a post with status '${status}'`), { statusCode: 409 });
  }
  return date;
}

export async function scheduleSocialPost(postId: number, teamId: number, scheduleAt: string, expectedStatus: string) {
  const date = validateSocialSchedule(scheduleAt, expectedStatus);
  const [post] = await db.update(socialPosts).set({
    scheduleAt: date, status: "SCHEDULED", updatedAt: new Date(),
  }).where(and(
    eq(socialPosts.id, postId),
    eq(socialPosts.teamId, teamId),
    eq(socialPosts.status, expectedStatus),
    notInArray(socialPosts.status, NON_SCHEDULABLE_STATUSES),
    sql`${date.toISOString()}::timestamptz > CURRENT_TIMESTAMP`,
  )).returning();
  if (!post) throw Object.assign(new Error("Post changed or schedule is no longer in the future"), { statusCode: 409 });
  return post;
}
