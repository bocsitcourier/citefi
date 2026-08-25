import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { requireTeamMember } from "@/lib/api/auth";
import { getCampaignByPublicId, recordCampaignExport } from "@/lib/campaign-service";
import { AD_EXPORT_NOTICE, buildAdExportRowsFromManifest, canonicalAdManifestJson, getCampaignAdForExport } from "@/lib/campaign-ads-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZIP_ENTRY_DATE = new Date("1980-01-01T00:00:00.000Z");

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; adId: string }> }) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const { id, adId } = await context.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(adId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    const campaign = await getCampaignByPublicId(teamId, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const ad = await getCampaignAdForExport(teamId, campaign.id, adId);
    if (!ad) return NextResponse.json({ error: "Ad pack is not authorized and export-ready" }, { status: 409 });

    const manifest: any = ad.manifestJson;
    const { googleRows, metaRows } = buildAdExportRowsFromManifest(manifest);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    const archiveComplete = new Promise<Buffer>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(stream);
    const entry = (name: string) => ({ name, date: ZIP_ENTRY_DATE, mode: 0o644 });
    archive.append(canonicalAdManifestJson(manifest), entry("manifest.json"));
    archive.append(`${ad.manifestSha256}  manifest.json\n`, entry("manifest.sha256"));
    archive.append(JSON.stringify(googleRows, null, 2), entry("google/rsa.json"));
    archive.append(toCsv(googleRows), entry("google/rsa.csv"));
    archive.append(JSON.stringify(metaRows, null, 2), entry("meta/creative-pack.json"));
    archive.append(`${AD_EXPORT_NOTICE}\nNo ad platform publishing or spend was performed by Citefi.\n`, entry("MANUAL-REVIEW-REQUIRED.txt"));
    await archive.finalize();
    const archiveBuffer = await archiveComplete;
    const artifactSha256 = createHash("sha256").update(archiveBuffer).digest("hex");

    const requestKey = request.headers.get("X-Idempotency-Key") ?? `ads-export:${ad.publicId}:${ad.manifestSha256}`;
    const audit = await recordCampaignExport(teamId, campaign.id, {
      requestedBy: userId, requestKey, kind: "ads_zip", status: "ready",
      filters: { adPublicId: ad.publicId, manifestSha256: ad.manifestSha256, artifactSha256, mode: "export_only" },
    });
    if (!audit) return NextResponse.json({ error: "Could not audit export" }, { status: 500 });
    const auditedArtifactSha256 = (audit.filters as any)?.artifactSha256;
    if (auditedArtifactSha256 && auditedArtifactSha256 !== artifactSha256) {
      return NextResponse.json({ error: "Generated artifact does not match the audited export" }, { status: 409 });
    }
    return new NextResponse(archiveBuffer, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="campaign-${campaign.publicId}-ads.zip"`,
      "X-Manifest-SHA256": ad.manifestSha256!,
      "X-Artifact-SHA256": artifactSha256,
    } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to export ads" }, { status: err.statusCode ?? 500 });
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]!);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}