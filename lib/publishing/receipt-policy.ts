import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { dispatchContract } from "./dispatch-policy";

export const receiptSchema = z.object({
  version: z.literal(1),
  receiptId: z.string().min(1).max(200),
  jobId: z.string().uuid(),
  dispatchAttempt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  receiverOrigin: z.string().url(),
  outcome: z.enum(["accepted", "not_accepted"]),
  // Negative evidence must guarantee the operation is permanently fenced at
  // the receiver. Missing records, HTTP errors and failure callbacks do not.
  final: z.literal(true),
  operationFenced: z.boolean(),
  observedAt: z.string().datetime(),
  pageUrl: z.string().max(2048).url().optional(),
}).strict();

export function reconciliationError(message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { statusCode });
}

export function verifyNativeReceipt(
  raw: string, signature: string, key: string,
  job: { publicId: string; lastAttemptAt: Date | null; errorDetails: unknown },
) {
  if (Buffer.byteLength(raw) > 32768 || !/^[a-f0-9]{64}$/.test(signature))
    reconciliationError("Invalid receipt envelope", 400);
  const expected = createHmac("sha256", key).update(`publishing-receipt-v1.${raw}`).digest("hex");
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")))
    reconciliationError("Receiver signature is invalid", 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { reconciliationError("Invalid receipt JSON", 400); }
  const result = receiptSchema.safeParse(parsed);
  if (!result.success) reconciliationError("Invalid native receipt", 400);
  const receipt = result.data;
  const contract = dispatchContract(job.errorDetails);
  if (!contract?.submissionStarted || !contract.receiverOrigin || !contract.receiverKeyHash ||
      !job.lastAttemptAt || receipt.jobId !== job.publicId ||
      receipt.dispatchAttempt !== job.lastAttemptAt.toISOString() ||
      receipt.contentHash !== contract.hash || receipt.receiverOrigin !== contract.receiverOrigin ||
      createHash("sha256").update(key).digest("hex") !== contract.receiverKeyHash)
    reconciliationError("Receipt is not bound to the original submission; legacy or rotated destinations stay paused");
  const origin = new URL(receipt.receiverOrigin);
  if (origin.protocol !== "https:" || origin.origin !== receipt.receiverOrigin)
    reconciliationError("Invalid receiver origin", 400);
  if (Date.parse(receipt.observedAt) < job.lastAttemptAt.getTime() ||
      Date.parse(receipt.observedAt) > Date.now() + 300000)
    reconciliationError("Receipt observation is outside the submission window");
  if (receipt.outcome === "not_accepted" && !receipt.operationFenced)
    reconciliationError("Non-acceptance requires an irrevocable receiver operation fence");
  if (receipt.outcome === "not_accepted" && receipt.pageUrl !== undefined)
    reconciliationError("Not-accepted proof cannot include a publication URL", 400);
  if (receipt.outcome === "accepted") {
    if (!receipt.pageUrl) reconciliationError("Accepted receipt requires a native published URL");
    const page = new URL(receipt.pageUrl);
    if (page.protocol !== "https:" || page.username || page.password || page.origin !== origin.origin)
      reconciliationError("Published URL is not on the bound receiver", 400);
  }
  return { receipt, digest: createHash("sha256").update(raw).digest("hex") };
}
