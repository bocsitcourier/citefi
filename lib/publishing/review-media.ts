import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getStorageReadCandidates, saveImmutablePublishingMedia } from "../storage";

const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const sha256 = (body: Buffer) => createHash("sha256").update(body).digest("hex");

export interface ReviewMediaStore {
  read(key: string): Promise<Buffer>;
  pin(key: string, body: Buffer, mimeType: string): Promise<void>;
}

export const reviewMediaStore: ReviewMediaStore = {
  async read(key) {
    for (const file of getStorageReadCandidates(key)) {
      try {
        const [metadata] = await file.getMetadata();
        if (!metadata.size || Number(metadata.size) > MAX_ASSET_BYTES) throw new Error("Invalid asset size");
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = file.createReadStream();
        for await (const chunk of stream) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_ASSET_BYTES) { stream.destroy(); throw new Error("Asset exceeds review limit"); }
          chunks.push(bytes);
        }
        if (size !== Number(metadata.size)) throw new Error("Asset changed while reading");
        return Buffer.concat(chunks);
      } catch (error: any) {
        // Only an absent primary object permits migration fallback. A corrupt,
        // oversized or partially read primary must never masquerade as old bytes.
        const missing = error?.code === 404 || error?.code === "NoSuchKey" ||
          error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
        if (!missing) throw Object.assign(new Error("Reviewed asset cannot be verified"), { statusCode: 409 });
      }
    }
    throw Object.assign(new Error("Reviewed asset bytes are unavailable or exceed 32 MiB"), { statusCode: 409 });
  },
  pin: saveImmutablePublishingMedia,
};

// Use the configured application secret, never a destination credential or token
// in a URL. Capability is limited to one immutable key and expires after 30 min.
function signature(key: string, expires: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Review media signing is not configured");
  return createHmac("sha256", secret).update(`publishing-review-media:v1:${key}:${expires}`).digest("hex");
}

export function signedReviewMediaUrl(key: string): string {
  const expires = String(Math.floor(Date.now() / 1000) + 1800);
  return `/api/publishing/review-media?key=${encodeURIComponent(key)}&expires=${expires}&signature=${signature(key, expires)}`;
}

export function validReviewMediaSignature(key: string, expires: string, supplied: string): boolean {
  if (!/^private\/publishing-reviewed\/[1-9]\d*\/[a-f0-9]{64}\.[a-z0-9]+$/.test(key) ||
      !/^\d{10}$/.test(expires) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const remaining = Number(expires) - Math.floor(Date.now() / 1000);
  if (remaining < 0 || remaining > 1800) return false;
  return timingSafeEqual(Buffer.from(signature(key, expires), "hex"), Buffer.from(supplied, "hex"));
}
