import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeyTemplates } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    await requireTeamMember(req);

    const templates = await db
      .select()
      .from(journeyTemplates)
      .orderBy(desc(journeyTemplates.isBuiltin), journeyTemplates.name);

    return NextResponse.json({ templates });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/templates GET]", err);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: err?.statusCode || 500 });
  }
}
