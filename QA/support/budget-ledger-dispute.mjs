import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_ROOT = resolve(MODULE_DIRECTORY, "../evidence/live-current");
const MANIFEST_PATH = resolve(EVIDENCE_ROOT, "budget-ledger-dispute.json");
const CURRENT_LEDGER_PATH = resolve(EVIDENCE_ROOT, "budget-ledger.json");
const SNAPSHOT_ROOT = resolve(EVIDENCE_ROOT, "disputed-ledger-snapshots");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readCanonical(path, parent) {
  if (!existsSync(path) || realpathSync(path) !== path ||
      realpathSync(dirname(path)) !== parent) {
    throw new Error("Paid QA blocked: disputed ledger evidence path is missing or redirected");
  }
  return readFileSync(path);
}

/**
 * This unconditional live-only gate deliberately has no environment, test, or
 * path override. Offline fixtures use their isolated synthetic budget roots and
 * never call this guard.
 */
export function assertPaidQaLedgerResolved() {
  if (realpathSync(EVIDENCE_ROOT) !== EVIDENCE_ROOT ||
      realpathSync(SNAPSHOT_ROOT) !== SNAPSHOT_ROOT) {
    throw new Error("Paid QA blocked: disputed ledger evidence root is redirected");
  }
  const manifestBytes = readCanonical(MANIFEST_PATH, EVIDENCE_ROOT);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.version !== 1 ||
      manifest.status !== "disputed" ||
      manifest.financialInterpretation !== "UNKNOWN — no settlement, refund, or free-call inference" ||
      manifest.paidQaGate?.blocked !== true) {
    throw new Error("Paid QA blocked: ledger dispute manifest is invalid or not explicitly blocked");
  }

  for (const snapshot of manifest.snapshots ?? []) {
    const expectedFile = snapshot.side === "HEAD" ? "budget-ledger.head.json" :
      snapshot.side === "MERGE_HEAD" ? "budget-ledger.merge-head.json" : null;
    if (!expectedFile ||
        snapshot.authoritative !== false ||
        snapshot.file !== expectedFile ||
        typeof snapshot.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
        typeof snapshot.file !== "string" ||
        snapshot.file.includes("/") || snapshot.file.includes("\\") ||
        snapshot.file === "." || snapshot.file === "..") {
      throw new Error("Paid QA blocked: malformed historical ledger snapshot manifest");
    }
    const bytes = readCanonical(resolve(SNAPSHOT_ROOT, snapshot.file), SNAPSHOT_ROOT);
    if (hash(bytes) !== snapshot.sha256) {
      throw new Error(`Paid QA blocked: ${snapshot.side} ledger snapshot hash mismatch`);
    }
  }
  if (manifest.snapshots?.length !== 2 ||
      new Set(manifest.snapshots.map(snapshot => snapshot.side)).size !== 2) {
    throw new Error("Paid QA blocked: both disputed historical ledger snapshots are required");
  }

  const currentBytes = readCanonical(CURRENT_LEDGER_PATH, EVIDENCE_ROOT);
  const current = JSON.parse(currentBytes);
  if (manifest.authoritativeCurrentBalance !== false ||
      current.status !== "DISPUTED" ||
      current.authoritative !== false ||
      current.manifest !== "budget-ledger-dispute.json" ||
      current.snapshots?.length !== 2) {
    throw new Error("Paid QA blocked: current ledger pointer is not the expected dispute sentinel");
  }
  throw new Error("Paid QA blocked: ledger dispute unresolved; this fence requires separate reviewed reconciliation/permission integration");
}
