import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { getModelResolutionStatus, refreshModelResolution } from "@/lib/model-resolver";
import { getRedisConnection } from "@/lib/queue";
import { readWorkerReadiness } from "@/lib/ops/worker-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only, platform-admin diagnostics. Never generates paid canaries. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    await refreshModelResolution();
    const worker = await readWorkerReadiness(getRedisConnection()).catch(() => null);
    return NextResponse.json({
      ...getModelResolutionStatus(),
      worker: worker ? {
        updatedAt: worker.updatedAt, modelsReady: worker.modelsReady,
        resolution: worker.modelResolution ?? null,
      } : null,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const status = typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode : 500;
    return NextResponse.json({ error: status === 401 || status === 403
      ? "Unauthorized" : "Model diagnostics unavailable" }, { status });
  }
}
