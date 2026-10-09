import { sql } from "drizzle-orm";
import { db } from "../db";

// The database function authorizes current client membership itself and never
// grants reviewers raw access to dispatch contracts, receiver keys or audits.
export async function clientPublishingSummary(jobId: number | null, status: string | null, contentType: string | null, limit = 100) {
  const result = await db.execute(sql`select citefi_rls.publishing_client_summary(
    ${jobId}::integer, ${status}::text, ${contentType}::text, ${limit}::integer
  ) as data`);
  return result.rows[0]?.data as Record<string, unknown>[];
}
