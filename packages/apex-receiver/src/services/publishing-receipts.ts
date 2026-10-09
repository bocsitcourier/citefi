import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
export interface ReceiptConfig { apiKey: string; baseUrl: string; storagePath: string; publishingReceiptFenceReady?: boolean }

export interface SubmissionBinding {
  jobId: string; dispatchAttempt: string; contentHash: string; receiverOrigin: string;
}
interface NativeReceipt extends SubmissionBinding {
  version: 1; receiptId: string; outcome: "accepted" | "not_accepted";
  final: true; operationFenced: boolean; observedAt: string; pageUrl?: string;
}
export function submissionBinding(body: Record<string, unknown>, config: ReceiptConfig): SubmissionBinding | null {
  if (body.dispatchAttempt === undefined && body.contentHash === undefined && body.receiverOrigin === undefined) return null;
  if (typeof body.jobId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.jobId) ||
      typeof body.dispatchAttempt !== "string" || !Number.isFinite(Date.parse(body.dispatchAttempt)) ||
      new Date(body.dispatchAttempt).toISOString() !== body.dispatchAttempt ||
      typeof body.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(body.contentHash) ||
      body.receiverOrigin !== new URL(config.baseUrl).origin)
    throw new Error("Invalid publishing submission binding");
  return { jobId: body.jobId, dispatchAttempt: body.dispatchAttempt,
    contentHash: body.contentHash, receiverOrigin: body.receiverOrigin as string };
}
function root(config: ReceiptConfig) {
  // Never under the publicly served /uploads tree.
  return path.resolve(config.storagePath, "..", ".publishing-operations");
}
function directory(jobId: string, config: ReceiptConfig) {
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error("Invalid operation identifier");
  return path.join(root(config), jobId);
}
async function syncDirectory(dir: string) {
  const handle = await fs.open(dir, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
async function durableWrite(dir: string, name: string, value: unknown) {
  const temp = path.join(dir, `${name}.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, path.join(dir, name));
  await syncDirectory(dir);
}

/** Atomic per-operation claim survives process restarts. A crashed claim is
 * never deleted/reused or interpreted as non-acceptance. Single owned durable
 * filesystem only; distributed receivers require equivalent shared CAS. */
export async function claimSubmission(binding: SubmissionBinding, config: ReceiptConfig): Promise<boolean> {
  await fs.mkdir(root(config), { recursive: true, mode: 0o700 });
  const dir = directory(binding.jobId, config);
  try { await fs.mkdir(dir, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  await syncDirectory(root(config));
  await durableWrite(dir, "binding.json", binding);
  return true;
}
export async function finishSubmission(binding: SubmissionBinding, outcome: NativeReceipt["outcome"], config: ReceiptConfig, pageUrl?: string) {
  if (outcome === "not_accepted" && config.publishingReceiptFenceReady !== true)
    throw new Error("Durable shared receiver fence is not explicitly configured; outcome remains unknown");
  const dir = directory(binding.jobId, config);
  const retained = JSON.parse(await fs.readFile(path.join(dir, "binding.json"), "utf8")) as SubmissionBinding;
  if (JSON.stringify(retained) !== JSON.stringify(binding)) throw new Error("Submission binding changed");
  // Only callers which own the atomic claim may finalize. All validation
  // rejections occur before any publication side effect; processing errors
  // retain an unresolved claim and cannot issue a negative receipt.
  const receipt: NativeReceipt = {
    version: 1, receiptId: randomUUID(), ...binding, outcome, final: true,
    operationFenced: outcome === "not_accepted", observedAt: new Date().toISOString(),
    ...(pageUrl ? { pageUrl } : {}),
  };
  if (outcome === "accepted") {
    const page = new URL(pageUrl ?? "");
    if (page.origin !== binding.receiverOrigin || page.protocol !== "https:" || page.username || page.password)
      throw new Error("Invalid accepted publication URL");
  }
  // Do not replace an existing final receipt, even under a duplicate caller.
  const marker = await fs.open(path.join(dir, "finalizing"), "wx", 0o600);
  await marker.sync();
  await marker.close();
  await durableWrite(dir, "receipt.json", receipt);
  return receipt;
}
export async function readNativeReceipt(jobId: string, attempt: string, config: ReceiptConfig) {
  try {
    const raw = await fs.readFile(path.join(directory(jobId, config), "receipt.json"), "utf8");
    const receipt = JSON.parse(raw) as NativeReceipt;
    if (receipt.dispatchAttempt !== attempt) return null;
    const signature = createHmac("sha256", config.apiKey).update(`publishing-receipt-v1.${raw}`).digest("hex");
    return { raw, signature };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
