import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sitePages } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get("domain");

    const conditions = [eq(sitePages.teamId, teamId), eq(sitePages.isActive, 1)];
    if (domain) conditions.push(eq(sitePages.domain, domain));

    const pages = await db.select().from(sitePages)
      .where(and(...conditions))
      .orderBy(desc(sitePages.lastCrawledAt));

    return NextResponse.json(pages);
  } catch (error: any) {
    console.error("Error fetching site pages:", error);
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch pages" },
      { status: statusCode }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get("id");
    const domain = searchParams.get("domain");

    if (pageId) {
      await db.delete(sitePages)
        .where(and(eq(sitePages.id, parseInt(pageId)), eq(sitePages.teamId, teamId)));
      return NextResponse.json({ message: "Page removed" });
    }

    if (domain) {
      const result = await db.delete(sitePages)
        .where(and(eq(sitePages.domain, domain), eq(sitePages.teamId, teamId)));
      return NextResponse.json({ message: `All pages for ${domain} removed` });
    }

    return NextResponse.json({ error: "Provide id or domain parameter" }, { status: 400 });
  } catch (error: any) {
    console.error("Error deleting site pages:", error);
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to delete pages" },
      { status: statusCode }
    );
  }
}
