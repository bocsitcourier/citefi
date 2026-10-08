import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { generatedImageAsPng } from "../lib/generated-image-bytes";

test("native JPEG image is fully decoded and persisted as actual PNG", async () => {
  const jpeg = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#336699" },
  }).jpeg().toBuffer();
  const png = await generatedImageAsPng(jpeg.toString("base64"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const source = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const decoded = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(decoded.info, source.info);
  assert.deepEqual(decoded.data, source.data);
});

test("native PNG remains a fully decodable PNG", async () => {
  const original = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#12345680" },
  }).png().toBuffer();
  const png = await generatedImageAsPng(original.toString("base64"));
  assert.deepEqual(await sharp(png).raw().toBuffer(), await sharp(original).raw().toBuffer());
});

test("invalid/truncated paid image bytes fail rather than masquerading as PNG", async () => {
  await assert.rejects(generatedImageAsPng("not base64!"));
  await assert.rejects(generatedImageAsPng(Buffer.from("not an image").toString("base64")));
  const jpeg = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  await assert.rejects(generatedImageAsPng(jpeg.subarray(0, 30).toString("base64")));
});
