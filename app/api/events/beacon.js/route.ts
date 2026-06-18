/**
 * GET /api/events/beacon.js
 * Serves the ApexContent Engine engagement beacon script with correct
 * Content-Type: application/javascript so client sites can load it as:
 *   <script src="https://ENGINE_URL/api/events/beacon.js" ...></script>
 */
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Cache the file content at module load time (Next.js caches module evaluation)
let beaconScript: string | null = null;

function getBeaconScript(): string {
  if (!beaconScript) {
    beaconScript = readFileSync(join(process.cwd(), "public", "beacon.js"), "utf-8");
  }
  return beaconScript;
}

export async function GET(_req: NextRequest) {
  try {
    const script = getBeaconScript();
    return new NextResponse(script, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("// beacon unavailable", {
      status: 200,
      headers: { "Content-Type": "application/javascript" },
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
