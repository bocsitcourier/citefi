import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/auth";
import { listActiveAdmins, listIncidents } from "@/lib/incident-intelligence/service";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  severity: z.enum(["warning", "error", "critical"]).optional(),
  status: z.enum(["open", "acknowledged", "resolved", "ignored"]).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  environment: z.string().trim().min(1).max(50).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    for (const key of ["severity", "status", "category", "environment"]) {
      if (params[key] === "all") delete params[key];
    }
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid incident filters", details: parsed.error.errors }, { status: 400 });
    }
    const [result, admins] = await Promise.all([
      listIncidents(parsed.data),
      listActiveAdmins(),
    ]);
    return NextResponse.json({ ...result, admins });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch incidents" },
      { status: error?.statusCode || 500 },
    );
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Incidents are immutable and cannot be deleted. Resolve or ignore them instead." },
    { status: 405, headers: { Allow: "GET" } },
  );
}