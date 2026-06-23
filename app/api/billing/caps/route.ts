import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spendingCaps } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireTeamAdmin } from "@/lib/api/auth";
import { getCapStatus } from "@/lib/usage-caps";
import { z } from "zod";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const status = await getCapStatus(teamId);

    const [cap] = await db.select().from(spendingCaps).where(eq(spendingCaps.teamId, teamId)).limit(1);

    return NextResponse.json({
      cap: cap ?? null,
      status,
    });
  } catch (err: any) {
    const s = err?.statusCode ?? err?.status;
    if (s === 401 || s === 403) return NextResponse.json({ error: err.message }, { status: s });
    console.error("[billing/caps GET]", err);
    return NextResponse.json({ error: "Failed to load cap settings" }, { status: 500 });
  }
}

const updateCapSchema = z.object({
  monthlyCapCents: z.number().int().min(0).max(100_000_00),
  alertThresholdPct: z.number().int().min(1).max(100).default(80),
  hardStop: z.boolean().default(false),
});

export async function PUT(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const body = await req.json();
    const parsed = updateCapSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { monthlyCapCents, alertThresholdPct, hardStop } = parsed.data;

    await db
      .insert(spendingCaps)
      .values({ teamId, monthlyCapCents, alertThresholdPct, hardStop })
      .onConflictDoUpdate({
        target: spendingCaps.teamId,
        set: { monthlyCapCents, alertThresholdPct, hardStop, updatedAt: new Date() },
      });

    const status = await getCapStatus(teamId);
    return NextResponse.json({ success: true, status });
  } catch (err: any) {
    const s = err?.statusCode ?? err?.status;
    if (s === 401 || s === 403) return NextResponse.json({ error: err.message }, { status: s });
    console.error("[billing/caps PUT]", err);
    return NextResponse.json({ error: "Failed to update cap settings" }, { status: 500 });
  }
}
