import sharp from "sharp";

/**
 * Image callers persist PNG names/content types. Decode the actual provider
 * bytes and normalize them to PNG instead of relabeling JPEG/WebP bytes.
 * This does not call a provider and must never trigger another paid attempt.
 */
export async function generatedImageAsPng(data: string): Promise<Buffer> {
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("Provider image is not valid base64");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024) {
    throw new Error("Provider image byte limit exceeded");
  }
  return sharp(bytes, { failOn: "error", limitInputPixels: 64 * 1024 * 1024 })
    .png()
    .toBuffer();
}
