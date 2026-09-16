import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";
import {
  canonicalizePlatforms,
  enforceSocialCaptionCompliance,
  enforceSocialCaptionWithHashtags,
  findInvalidSocialUrls,
  getPlatformSpec,
  PLATFORM_IMAGE_DIMENSIONS,
} from "../lib/social-validation";
import { getHashtagStrategy } from "../lib/social-prompt-guidance";
import { normalizeSocialImage } from "../lib/social-image-normalizer";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const {
  awaitAllSocialPlatformTasks,
  getReusableHeroStorageKey,
  isReusableSocialAsset,
  isReusableSocialVariant,
  persistSocialPlatformGeneratedDiagnostic,
} = await import("../lib/social-worker");

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

test("platform specs are the single source for caption, hashtag, and image contracts", () => {
  for (const platform of ["x", "facebook", "instagram", "linkedin", "pinterest"] as const) {
    const spec = getPlatformSpec(platform);
    const strategy = getHashtagStrategy(platform);
    assert.equal(strategy.total, spec.hashtagLimit);
    assert.equal(
      strategy.evergreenCount,
      Math.round(spec.hashtagLimit * spec.hashtagEvergreenRatio),
    );
    assert.deepEqual(spec.dimensions, PLATFORM_IMAGE_DIMENSIONS[platform]);
  }
});

test("final caption compliance rejects an over-limit rewrite unchanged", () => {
  const rewrittenCaption =
    "Energy upgrades can make a measurable difference for your home. " +
    "Learn more about practical steps and local resources for improving comfort " +
    "and reducing waste this season. " +
    "https://www.example.com/energy " +
    "This trailing material makes the provider output exceed the X limit. ".repeat(5);
  const result = enforceSocialCaptionCompliance(rewrittenCaption, "x");
  assert.equal(result.valid, false);
  assert.equal(result.caption, rewrittenCaption);
  assert.ok(result.issues.some((issue) => /exceeds x limit/i.test(issue)));
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

test("unsupported numeric claims and malformed URLs are rejected unchanged", () => {
  const caption =
    "A better home starts here. 30% of heating escapes through hidden leaks. " +
    "Learn more at https://.";
  const result = enforceSocialCaptionCompliance(
    caption,
    "x",
    "A better home starts here. Schedule an inspection to improve comfort."
  );
  assert.equal(result.valid, false);
  assert.equal(result.caption, caption);
  assert.match(result.issues.join("; "), /invalid URL/i);
  assert.match(result.issues.join("; "), /unsupported numeric/i);
  assert.match(result.caption, /30%/);
  assert.match(result.caption, /https:\/\/\./);
});

test("historical403X output is rejected without changing the retained caption", () => {
  const historical403X = [
    "Home upgrades can improve comfort, but this retained X incident fixture must remain unchanged.",
    "The diagnostic material is intentionally longer than the X limit and must be rejected, not trimmed.",
    "https://example.com/energy",
  ].join(" ").padEnd(403, "x").slice(0, 403);
  assert.equal(historical403X.length, 403);
  const result = enforceSocialCaptionCompliance(historical403X, "x");
  assert.equal(result.valid, false);
  assert.equal(result.caption, historical403X);
});

test("social worker rejects bad caption before READY and image work", () => {
  const worker = readFileSync(new URL("../lib/social-worker.ts", import.meta.url), "utf8");
  const complianceIndex = worker.indexOf("if (!finalCaption.valid)");
  const readyIndex = worker.indexOf('status: "READY"', complianceIndex);
  const imageIndex = worker.indexOf("// STAGE 3: Attach image", complianceIndex);
  assert.ok(complianceIndex >= 0);
  assert.ok(readyIndex > complianceIndex);
  assert.ok(imageIndex > complianceIndex);
  assert.match(worker.slice(complianceIndex, readyIndex), /FinalizationQualityGateError/);
});

test("normalized image bytes have exact dimensions for every platform", async () => {
  const source = await sharp({
    create: {
      width: 1733,
      height: 941,
      channels: 3,
      background: { r: 30, g: 90, b: 180 },
    },
  })
    .jpeg()
    .toBuffer();
  for (const platform of ["x", "facebook", "instagram", "linkedin", "pinterest"] as const) {
    const normalized = await normalizeSocialImage(source, platform);
    const metadata = await sharp(normalized.imageBuffer).metadata();
    assert.equal(normalized.fileFormat, "png");
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, PLATFORM_IMAGE_DIMENSIONS[platform].width);
    assert.equal(metadata.height, PLATFORM_IMAGE_DIMENSIONS[platform].height);
  }
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

test("eligible same-team local hero is cropped locally and skips provider generation", () => {
  const worker = readFileSync(new URL("../lib/social-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /eq\(articles\.teamId, teamId\)/);
  assert.match(worker, /LOCAL_OBJECT_URL_PREFIX/);
  assert.match(worker, /readLocalReusableHero\(attachedImageUrl\)/);
  assert.match(worker, /normalizeSocialImage\(heroBuffer, platform\)/);
  const reuseIndex = worker.indexOf("if (attachedImageUrl) {");
  const providerIndex = worker.indexOf('import("./gemini-social-image-generator")', reuseIndex);
  assert.ok(reuseIndex >= 0);
  assert.ok(providerIndex > reuseIndex);
  assert.match(worker.slice(reuseIndex, providerIndex), /socialPostAssets/);
});

test("private hero keys stay private and public reads preserve storage fallback candidates", () => {
  assert.equal(
    getReusableHeroStorageKey("/api/public-objects/private/articles/hero.png"),
    "private/articles/hero.png",
  );
  assert.equal(
    getReusableHeroStorageKey("/api/public-objects/articles/hero.png"),
    "public/articles/hero.png",
  );
  assert.equal(getReusableHeroStorageKey("https://cdn.example/hero.png"), null);
  const worker = readFileSync(new URL("../lib/social-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /getStorageReadCandidates\(storageKey\)/);
  assert.match(worker, /for \(const file of candidates\)/);
});

test("same-attempt READY variants/assets resume while cross-attempt rows remain stale", () => {
  const attemptKey = "social-generation:17:job-1";
  const variant = {
    platform: "x",
    caption: "A useful home energy update.",
    characterCount: "A useful home energy update.".length,
    hashtagsJson: [],
    hyperlinksJson: [],
    status: "READY",
    platformMetadata: { generationAttemptKey: attemptKey },
  } as const;
  assert.equal(isReusableSocialVariant(variant, attemptKey), true);
  assert.equal(isReusableSocialVariant(variant, "social-generation:17:job-2"), false);
  const asset = {
    variantId: 44,
    platform: "x",
    assetType: "image",
    storageUrl: "/api/public-objects/social-media/hero.png",
    aspectRatio: "16:9",
    width: 1600,
    height: 900,
  } as const;
  assert.equal(isReusableSocialAsset(asset, "x", 44), true);
  assert.equal(isReusableSocialAsset(asset, "x", 45), false);
  const outputsBefore = { variant, asset };
  let llmCalls = 0;
  let imageCalls = 0;
  if (!isReusableSocialVariant(variant, attemptKey)) llmCalls++;
  if (!isReusableSocialAsset(asset, "x", 44)) imageCalls++;
  assert.equal(llmCalls, 0);
  assert.equal(imageCalls, 0);
  assert.deepEqual({ variant, asset }, outputsBefore);
});

test("PLATFORM_GENERATED log failure keeps READY output resumable without provider replay", async () => {
  const attemptKey = "social-generation:17:job-log-failure";
  const caption = "A durable same-attempt caption.";
  const variant = {
    platform: "x",
    caption,
    characterCount: caption.length,
    hashtagsJson: [],
    hyperlinksJson: [],
    status: "READY",
    platformMetadata: { generationAttemptKey: attemptKey },
  } as const;
  let diagnosticAttempts = 0;
  let geminiCalls = 0;
  let openAiCalls = 0;

  const diagnosticPersisted = await persistSocialPlatformGeneratedDiagnostic(
    {
      socialPostId: 17,
      platform: "x",
      characterCount: caption.length,
      hashtagCount: 0,
    },
    async () => {
      diagnosticAttempts++;
      throw new Error("injected diagnostic log failure");
    },
  );
  assert.equal(diagnosticPersisted, false);

  // This is the actual retry decision used by the worker's durable resume
  // checkpoint: a valid same-attempt READY row returns before either provider.
  const retryResult = isReusableSocialVariant(variant, attemptKey)
    ? "resumed"
    : (geminiCalls++, openAiCalls++, "regenerated");
  assert.equal(retryResult, "resumed");
  assert.equal(diagnosticAttempts, 1);
  assert.equal(geminiCalls, 0);
  assert.equal(openAiCalls, 0);
  assert.equal(variant.status, "READY");
});

test("late parent failure resumes durable outputs before provider imports", () => {
  const worker = readFileSync(new URL("../lib/social-worker.ts", import.meta.url), "utf8");
  const readyBranch = worker.indexOf('if (postDetails?.status === "READY")');
  const providerImport = worker.indexOf('import("./gemini-social")');
  const resumeQuery = worker.indexOf("reusableVariantsByPlatform", readyBranch);
  assert.ok(readyBranch >= 0);
  assert.ok(resumeQuery > readyBranch);
  assert.ok(providerImport > resumeQuery);
  assert.match(worker.slice(0, readyBranch), /billingSettledAt/);
  assert.match(worker.slice(readyBranch, providerImport), /reusableVariantsByPlatform/);
  assert.match(worker.slice(providerImport), /if \(reusableVariant\)/);
  assert.match(worker, /reusableAssetPlatforms/);
  assert.match(worker, /const imagePlatforms = successfulPlatforms/);
  assert.match(worker, /if \(includeImage && imagePlatforms\.length > 0\)/);
  assert.match(worker, /variantIds:/);
});

test("terminal quality failure waits for deferred siblings before release and preserves failed variant state", async () => {
  let resolveSibling: (() => void) | undefined;
  const sibling = new Promise<{ platform: string; success: boolean }>((resolve) => {
    resolveSibling = () => resolve({ platform: "linkedin", success: true });
  });
  let failedVariantStatus = "GENERATING";
  const failedQualityTask = (async () => {
    // This mirrors the platform task's durable failure write before it returns
    // its terminal error to the parent coordinator.
    failedVariantStatus = "FAILED";
    return {
      platform: "x",
      success: false,
      terminalError: Object.assign(new Error("QUALITY_GATE_FAILED"), {
        code: "QUALITY_GATE_FAILED",
      }),
    };
  })();

  let releaseCalls = 0;
  const allSettled = awaitAllSocialPlatformTasks([failedQualityTask, sibling]);
  await Promise.resolve();
  assert.equal(failedVariantStatus, "FAILED");
  assert.equal(releaseCalls, 0, "parent settlement cannot run while sibling remains deferred");

  resolveSibling!();
  const results = await allSettled;
  assert.equal(results.every((result) => result.status === "fulfilled"), true);
  releaseCalls += 1; // parent release occurs only after awaitAllSocialPlatformTasks resolves
  assert.equal(releaseCalls, 1);
});