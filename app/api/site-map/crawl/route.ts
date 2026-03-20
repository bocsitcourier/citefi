import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { siteCrawlJobs } from "@/shared/schema";
import { requireTeamMember } from "@/lib/api/auth";
import { addSiteCrawlJob } from "@/lib/queue";
import { z } from "zod";

const crawlRequestSchema = z.object({
  baseUrl: z.string().url("Must be a valid URL"),
  maxPages: z.number().int().min(5).max(200).default(50),
  maxDepth: z.number().int().min(1).max(5).default(3),
});

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    const data = crawlRequestSchema.parse(body);

    const parsed = new URL(data.baseUrl);
    const domain = parsed.hostname.replace(/^www\./, "");

    const [crawlJobRow] = await db.insert(siteCrawlJobs).values({
      teamId,
      userId,
      domain,
      baseUrl: data.baseUrl,
      status: "PENDING",
      maxPages: data.maxPages,
      maxDepth: data.maxDepth,
    }).returning();
    const crawlJob = crawlJobRow!;

    await addSiteCrawlJob({
      crawlJobId: crawlJob.id,
      teamId,
      userId,
      baseUrl: data.baseUrl,
      maxPages: data.maxPages,
      maxDepth: data.maxDepth,
    });

    return NextResponse.json({
      id: crawlJob.id,
      domain,
      status: "PENDING",
      message: `Crawl queued for ${domain}. Up to ${data.maxPages} pages will be indexed.`,
    });
  } catch (error: any) {
    console.error("Error starting site crawl:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to start crawl" },
      { status: statusCode }
    );
  }
}
