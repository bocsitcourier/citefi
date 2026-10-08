// Offline-only recovery: no credentials, DB, network, reservation mutation
// or provider replay. The original failed route outcome remains unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const [runId] = process.argv.slice(2);
if (!runId || !/^[a-z0-9-]{1,80}$/.test(runId)) {
  throw new Error("Usage: node scripts/qa-inspect-retained-image.mjs <existing-run-id>");
}
const root = join("QA/evidence/live-current", runId);
const receipt = JSON.parse(await readFile(join(root, "image-receipt.json"), "utf8"));
const response = JSON.parse(await readFile(join(root, "image-native-response.json"), "utf8"));
assert.equal(createHash("sha256").update(JSON.stringify(response)).digest("hex"), receipt.responseSha256);
const images = response.candidates.flatMap((candidate) => candidate.content?.parts ?? [])
  .filter((part) => part.inlineData?.data);
assert.equal(images.length, 1);
const bytes = Buffer.from(images[0].inlineData.data, "base64");
const metadata = await sharp(bytes, { failOn: "error" }).metadata();
const pixels = await sharp(bytes, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
assert.equal(pixels.data.length, pixels.info.width * pixels.info.height * pixels.info.channels);
assert.ok(pixels.info.width >= 512 && pixels.info.height >= 512);
const extension = metadata.format === "jpeg" ? "jpg" : metadata.format === "png" ? "png" : null;
assert.ok(extension, "native image must be JPEG or PNG");
const report = {
  certification: "NOT CERTIFIED",
  originalRouteOutcome: "FAIL; image-native-response was rejected by the QA accounting guard",
  evidenceBoundary: "offline decode of retained real provider bytes, NOT successful route retrieval",
  providerRequestId: receipt.providerRequestId,
  physicalSubmissionsAdded: 0,
  mimeType: images[0].inlineData.mimeType,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  format: metadata.format,
  width: pixels.info.width,
  height: pixels.info.height,
  fullPixelDecode: true,
  decodedSha256: createHash("sha256").update(pixels.data).digest("hex"),
  nativeUsage: receipt.usage,
  accountingBoundary: "Original $0.16 reservation/lock stays held; no offline rebilling or settlement",
  retrievedThroughApplication: false,
  cloudStorageCertified: false,
};
async function durableWrite(name, data) {
  const handle = await open(join(root, name), "wx", 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
await durableWrite(`native-provider-image.${extension}`, bytes);
await durableWrite("retained-image-decode.json", `${JSON.stringify(report, null, 2)}\n`);
// The first live call stored no application object. A durable explicit empty
// export completes the retained DB/spool export, not application acceptance.
await mkdir(join(root, "storage-export"), { recursive: true });
const exportRows = JSON.parse(await readFile(join(root, "owned-db-export.json"), "utf8"));
await durableWrite("retained-export-status.json", JSON.stringify({
  evidenceBoundary: "DB and spool exported by failed run before shell timeout; no stored application image",
  tables: Object.keys(exportRows).filter((name) => Array.isArray(exportRows[name])),
  storageObjects: 0,
  paidReservationRetained: true,
}, null, 2));
const directory = await open(root, "r");
try { await directory.sync(); } finally { await directory.close(); }
console.log(JSON.stringify(report, null, 2));
