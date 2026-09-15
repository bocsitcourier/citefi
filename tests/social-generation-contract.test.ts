import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";
import {
  canonicalizePlatforms,
  enforceSocialCaptionCompliance,
  enforceSocialCaptionWithHashtags,
  findInvalidSocialUrls,
  PLATFORM_IMAGE_DIMENSIONS,
} from "../lib/social-validation";
import { normalizeSocialImage } from "../lib/social-image-normalizer";

test("social API canonicalizes Twitter aliases and deduplicates platforms", () => {
  assert.deepEqual(
    canonicalizePlatforms(["Twitter", "twitter-x", "x", "Instagram", "instagram"]),
    ["x", "instagram"]
  );
  assert.throws(
    () => canonicalizePlatforms(["x", "tiktok"]),
    /Unsupported social platform "tiktok"/
  );
});

test("final caption compliance runs the platform limit after a rewrite", () => {
  const rewrittenCaption =
    "Energy upgrades can make a measurable difference for your home. " +
    "Learn more about practical steps and local resources for improving comfort " +
    "and reducing waste this season. " +
    "https://www.example.com/energy";
  const result = enforceSocialCaptionCompliance(rewrittenCaption, "x");
  assert.equal(result.valid, true);
  assert.ok(result.caption.length <= 280);
  assert.deepEqual(findInvalidSocialUrls(result.caption), []);
});

test("final X caption budget includes hashtags appended by the dashboard", () => {
  const result = enforceSocialCaptionWithHashtags(
    "A concise caption that is intentionally long enough to leave room only " +
      "for a small number of appended tags while remaining readable for the audience.",
    [
      { tag: "#Energy", mailtoLink: "mailto:energy@example.com" },
      { tag: "#HomeComfort", mailtoLink: "mailto:comfort@example.com" },
      { tag: "#ThisTagMustBeDroppedBecauseTheCombinedTextWouldExceedTheXLimit", mailtoLink: "mailto:drop@example.com" },
    ],
    "x"
  );
  assert.equal(result.valid, true);
  assert.ok(result.characterCountWithHashtags <= 280);
  assert.equal(
    result.characterCountWithHashtags,
    result.caption.length +
      (result.hashtags.length > 0
        ? 1 + result.hashtags.map((hashtag) => hashtag.tag).join(" ").length
        : 0)
  );
});

test("unsupported numeric savings claims and broken URLs do not persist", () => {
  const result = enforceSocialCaptionCompliance(
    "A better home starts here. 30% of heating escapes through hidden leaks. " +
      "Learn more at https://.",
    "x",
    "A better home starts here. Schedule an inspection to improve comfort."
  );
  assert.equal(result.valid, true);
  assert.ok(!result.caption.includes("30%"));
  assert.ok(!result.caption.includes("https://."));
  assert.deepEqual(findInvalidSocialUrls(result.caption), []);
});

test("normalized image bytes have exact canonical dimensions and format", async () => {
  const source = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 30, g: 90, b: 180 },
    },
  })
    .jpeg()
    .toBuffer();
  const normalized = await normalizeSocialImage(source, "pinterest");
  const metadata = await sharp(normalized.imageBuffer).metadata();
  assert.equal(normalized.fileFormat, "png");
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, PLATFORM_IMAGE_DIMENSIONS.pinterest.width);
  assert.equal(metadata.height, PLATFORM_IMAGE_DIMENSIONS.pinterest.height);
});

test("social worker settles the original cap reservation", () => {
  const worker = readFileSync(new URL("../lib/social-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /completeCapReservation/);
  assert.match(worker, /reservationId: job\.data\.capReservationId/);
  assert.match(worker, /let deliveryCommitted = false/);
  assert.match(worker, /if \(deliveryCommitted\)/);
  assert.match(worker, /if \(postDetails\?\.status === "READY"\) return/);
});

test("social worker uses bounded pinned image fetches and fatal Gemini empty-output handling", () => {
  const worker = readFileSync(new URL("../lib/social-worker.ts", import.meta.url), "utf8");
  const gemini = readFileSync(new URL("../lib/gemini-social.ts", import.meta.url), "utf8");
  assert.match(worker, /safeFetchPageWithRedirects\(attachedImageUrl, 3\)/);
  assert.doesNotMatch(worker, /fetch\(attachedImageUrl\)/);
  assert.match(worker, /isNonRetryableSocialOutputError/);
  assert.match(gemini, /MODEL_OUTPUT_INVALID/);
  assert.match(gemini, /nonRetryable = true/);
});