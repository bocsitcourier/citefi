import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedTeamAdminContext } from "@/lib/api/auth";
import { adjudicate, checkReceiver, reconciliationView, recordReceipt } from "@/lib/publishing/reconciliation";
import { createPublishingJob } from "@/lib/publishing";
import { db } from "@/lib/db";
import { publishingJobs } from "@/shared/schema";
import { and, eq } from "drizzle-orm";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import"), rawReceipt: z.string().max(32768), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("check"), authorizeLiveRead: z.literal(true), receiverOrigin: z.string().max(2048).url() }).strict(),
  z.object({ action: z.literal("decide"), receiptId: z.number().int().positive(), decisionId: z.string().uuid(),
    reason: z.string().trim().min(10).max(2000), expectedAttempt: z.string().datetime(),
    expectedStatus: z.string().max(50), expectedUpdatedAt: z.string().datetime() }).strict(),
  z.object({ action: z.literal("replacement"), decisionId: z.string().uuid() }).strict(),
]);
type Context = { params: Promise<{ id: string }> };
function jobId(id: string) {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw Object.assign(new Error("Invalid job ID"), { statusCode: 400 });
  return Number(id);
}
function failure(error: unknown) {
  const status = (error as { statusCode?: number })?.statusCode ?? 500;
  return NextResponse.json({ error: status < 500 ? (error as Error).message : "Publishing reconciliation failed" }, { status });
}
export async function GET(request: NextRequest, context: Context) {
  try {
    return await withAuthenticatedTeamAdminContext(request, async operator => {
      const data = await reconciliationView(operator, jobId((await context.params).id));
      return NextResponse.json({ success: true, data });
    });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    return await withAuthenticatedTeamAdminContext(request, async operator => {
      const id = jobId((await context.params).id);
      // Bound streamed input, not just Content-Length.
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 65536) { await reader.cancel(); return NextResponse.json({ error: "Evidence body too large" }, { status: 413 }); }
        chunks.push(next.value);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      const parsed = inputSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Invalid reconciliation request" }, { status: 400 });
      const input = parsed.data;
      let data: unknown;
      if (input.action === "import") data = await recordReceipt(operator, id, input.rawReceipt, input.signature, "native_import");
      else if (input.action === "check") data = await checkReceiver(operator, id, input.receiverOrigin);
      else if (input.action === "decide") data = await adjudicate(operator, id, input);
      else {
        const [job] = await db.select().from(publishingJobs).where(and(
          eq(publishingJobs.id, id), eq(publishingJobs.teamId, operator.teamId),
        ));
        if (!job?.articleId) return NextResponse.json({ error: "Job not found or unsupported" }, { status: 404 });
        const replacement = await createPublishingJob(operator.teamId, job.connectionId,
          job.contentType as "article" | "podcast", job.articleId,
          { userId: operator.userId, role: operator.role },
          { originalJobId: id, decisionId: input.decisionId, operator });
        data = { replacementJobId: replacement.id };
      }
      return NextResponse.json({ success: true, data });
    });
  } catch (error) { return failure(error); }
}
