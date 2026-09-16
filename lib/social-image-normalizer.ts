import sharp from "sharp";
import {
  canonicalizePlatform,
  getPlatformSpec,
  UnsupportedSocialPlatformError,
} from "./social-validation";

export interface NormalizedSocialImage {
  imageBuffer: Buffer;
  fileFormat: string;
  mimeType: string;
  width: number;
  height: number;
  aspectRatio: string;
}

/**
 * Normalize provider bytes to the exact persisted platform contract. Gemini
 * may return a different native size, so storage must never trust provider
 * dimensions or prompt-only aspect-ratio instructions.
 */
export async function normalizeSocialImage(
  imageBuffer: Buffer,
  platform: string
): Promise<NormalizedSocialImage> {
  const canonicalPlatform = canonicalizePlatform(platform);
  if (!canonicalPlatform) throw new UnsupportedSocialPlatformError(platform);
  const platformSpec = getPlatformSpec(canonicalPlatform);
  const dimensions = platformSpec.dimensions;
  const outputBuffer = await sharp(imageBuffer)
    .resize(dimensions.width, dimensions.height, {
      fit: "cover",
      position: "centre",
    })
    .png()
    .toBuffer();
  const metadata = await sharp(outputBuffer).metadata();
  if (metadata.width !== dimensions.width || metadata.height !== dimensions.height) {
    throw new Error(
      `Normalized ${canonicalPlatform} image dimensions ${metadata.width ?? "unknown"}x${metadata.height ?? "unknown"} ` +
      `do not match required ${dimensions.width}x${dimensions.height}`
    );
  }
  return {
    imageBuffer: outputBuffer,
    fileFormat: metadata.format ?? "png",
    mimeType: "image/png",
    width: metadata.width,
    height: metadata.height,
    aspectRatio: platformSpec.aspectRatio,
  };
}