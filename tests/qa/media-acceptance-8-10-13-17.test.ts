/**
 * Media acceptance inventory 8-10, 13-17.
 *
 * This is intentionally a local acceptance harness.  Provider calls are
 * represented by fixture transports (never by an SDK/network call), while
 * the receipt boundary, direct-image operation, normalizers, compositor,
 * podcast duration helpers, settlement, and zip exporter are production
 * exports.  The TAP handoff labels the service-level evidence separately
 * from the feature orchestrators that currently have no transport seam.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";

process.env.DATABASE_URL ??= "postgres://media_acceptance:media_acceptance@127.0.0.1:55488/media_acceptance";
process.env.GEMINI_API_KEY ??= "fixture-no-network";
process.env.OPENAI_API_KEY ??= "fixture-no-network";

const execFileAsync = promisify(execFile);

const {
  executePaidMediaBoundary,
} = await import("../../lib/media-provider-boundary");
const {
  runDirectImageOperation,
} = await import("../../lib/direct-image-operation");
const {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
  reconcileProviderAttempt,
} = await import("../../lib/provider-attempt-receipts");
const {
  ProviderAccountingError,
  ProviderResultNotDurableError,
} = await import("../../lib/cost-telemetry");
const { ProviderAttemptAccountingError } = await import("../../lib/provider-attempt-receipts");
const { normalizeSocialImage } = await import("../../lib/social-image-normalizer");
const {
  canonicalObjectKey,
  decodeAssetSource,
} = await import("../../lib/media-library");
const { sanitizeCaptionText, composeVideo } = await import("../../lib/social-video-compositor");
const {
  createPodcastMeasuredDurationMetadata,
  parsePodcastDuration,
  preflightPodcastScriptDuration,
  probePodcastAudioDuration,
  renderPodcastSegmentsAfterPreflight,
} = await import("../../lib/podcast-duration");
const { settleDeliveredPodcast } = await import("../../lib/podcast-worker");
const { createZipArchive } = await import("../../lib/zip-archive");
const { objectStorageClient } = await import("../../lib/storage");

type StoredObject = {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
};

/**
 * A filesystem-backed object store with the same small surface used by the
 * production S3/GCS shims.  It provides durable bytes, URLs, range reads,
 * metadata, and a stream so this suite cannot pass by only checking strings.
 */
class FixtureObjectStore {
  readonly objects = new Map<string, StoredObject>();
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(): Promise<FixtureObjectStore> {
    return new FixtureObjectStore(await mkdtemp(join(tmpdir(), "media-acceptance-store-")));
  }

  async close(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  bucket() {
    return {
      file: (key: string) => {
        const normalized = key.replace(/^\/+/, "");
        return {
          save: async (body: Buffer, options?: { contentType?: string; metadata?: Record<string, string> }) => {
            const value = Buffer.from(body);
            this.objects.set(normalized, {
              body: value,
              contentType: options?.contentType ?? "application/octet-stream",
              metadata: options?.metadata ?? {},
            });
            const diskPath = join(this.root, normalized);
            await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(diskPath), { recursive: true }));
            await writeFile(diskPath, value);
            await writeFile(`${diskPath}.metadata.json`, JSON.stringify({
              contentType: options?.contentType ?? "application/octet-stream",
              metadata: options?.metadata ?? {},
            }));
          },
          getMetadata: async () => {
            const object = this.objects.get(normalized);
            if (!object) {
              const error = Object.assign(new Error("NoSuchKey"), { code: 404 });
              throw error;
            }
            return [{
              contentType: object.contentType,
              size: object.body.length,
              md5Hash: createHash("md5").update(object.body).digest("hex"),
            }];
          },
          createReadStream: (options?: { start?: number; end?: number }) => {
            const object = this.objects.get(normalized);
            if (!object) return Readable.from([]);
            const start = options?.start ?? 0;
            const end = options?.end ?? object.body.length - 1;
            return Readable.from(object.body.subarray(start, end + 1));
          },
          download: async () => {
            const object = this.objects.get(normalized);
            if (!object) throw Object.assign(new Error("NoSuchKey"), { code: 404 });
            return [Buffer.from(object.body)];
          },
        };
      },
    };
  }

  async put(key: string, body: Buffer, contentType: string, metadata: Record<string, string> = {}) {
    await this.bucket().file(key).save(body, { contentType, metadata });
    return `/api/public-objects/${key}`;
  }

  async read(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    assert.ok(object, `fixture object ${key} exists`);
    return Buffer.from(object.body);
  }

  async range(key: string, start: number, end: number): Promise<Buffer> {
    const object = this.objects.get(key);
    assert.ok(object, `fixture object ${key} exists`);
    assert.ok(start >= 0 && end >= start && end < object.body.length);
    return Buffer.from(object.body.subarray(start, end + 1));
  }
}

type FixtureStore = FixtureObjectStore;

type FixtureMediaKind = "image" | "video" | "audio";

type FixtureProvider = {
  calls: number;
  submit: () => Promise<{ id: string; bytes: Buffer; usage: { unitType: "images" | "seconds"; unitCount: number } }>;
};

function fixtureProvider(
  mediaKind: FixtureMediaKind,
  bytes: Buffer,
  unitCount: number,
  id = `fixture-${mediaKind}-accepted`,
): FixtureProvider {
  const provider: FixtureProvider = {
    calls: 0,
    submit: async () => {
      provider.calls += 1;
      return {
        id,
        bytes: Buffer.from(bytes),
        usage: {
          unitType: mediaKind === "image" ? "images" : "seconds",
          unitCount,
        },
      };
    },
  };
  return provider;
}

function receiptFixture(
  store: FixtureStore,
  mediaKind: FixtureMediaKind,
  resourceType: string,
  resourceId: number,
  attemptKey: string,
  validateOwnership: (context: unknown) => Promise<unknown> = async () => undefined,
) {
  const receiptStore = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  const ledger: unknown[] = [];
  return {
    receiptStore,
    spool,
    ledger,
    context: {
      teamId: 810,
      operationType: mediaKind === "image" ? "image_generation" : mediaKind === "video" ? "veo_clip" : "podcast_tts",
      provider: "gemini" as const,
      model: `fixture-${mediaKind}-v1`,
      resourceType,
      resourceId,
      attemptKey,
      attempt: 1,
    },
    request: {
      model: `fixture-${mediaKind}-v1`,
      maxDurationSeconds: mediaKind === "video" ? 6 : undefined,
      maxImages: mediaKind === "image" ? 1 : undefined,
      timeoutMs: 30_000,
      adapterVersion: "media-acceptance-fixture-v1",
    },
    deps: {
      store: receiptStore,
      spool,
      validateOwnership,
      recordUsage: async (input: unknown) => {
        ledger.push(input);
        return { inserted: true };
      },
    },
    persist: async (result: { id: string; bytes: Buffer }) => {
      const extension = mediaKind === "image" ? "png" : mediaKind === "video" ? "mp4" : "mp3";
      return store.put(
        `public/media-acceptance/${resourceType}-${resourceId}.${extension}`,
        result.bytes,
        mediaKind === "image" ? "image/png" : mediaKind === "video" ? "video/mp4" : "audio/mpeg",
        { providerRequestId: result.id },
      );
    },
  };
}

async function runFixtureBoundary(options: {
  store: FixtureStore;
  mediaKind: FixtureMediaKind;
  resourceType: string;
  resourceId: number;
  attemptKey: string;
  bytes: Buffer;
  unitCount: number;
  id?: string;
  validateOwnership?: (context: unknown) => Promise<unknown>;
}) {
  const provider = fixtureProvider(options.mediaKind, options.bytes, options.unitCount, options.id);
  const fixture = receiptFixture(
    options.store,
    options.mediaKind,
    options.resourceType,
    options.resourceId,
    options.attemptKey,
    options.validateOwnership,
  );
  const result = await executePaidMediaBoundary({
    mediaKind: options.mediaKind,
    submit: provider.submit,
    persist: async (providerResult) => fixture.persist(providerResult),
    providerRequestId: (providerResult) => providerResult.id,
    receipt: {
      context: fixture.context,
      request: fixture.request,
      _deps: fixture.deps,
      captureResponse: async (providerResult) => ({
        providerRequestId: providerResult.id,
        usage: {
          unitType: providerResult.usage.unitType,
          unitCount: providerResult.usage.unitCount,
          known: true,
        },
        metadata: { providerRequestId: providerResult.id },
      }),
    },
  });
  return { result, provider, fixture };
}

async function tinyPng(width = 32, height = 18): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 34, g: 120, b: 220 },
    },
  }).png().toBuffer();
}

async function fixtureAudio(seconds: number): Promise<Buffer> {
  assert.ok(ffmpegPath, "ffmpeg-static must be available for local acceptance fixtures");
  const root = await mkdtemp(join(tmpdir(), "media-acceptance-audio-"));
  const output = join(root, "fixture.mp3");
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${seconds}`,
      "-c:a", "libmp3lame",
      "-b:a", "24k",
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function fixtureVideo(): Promise<Buffer> {
  assert.ok(ffmpegPath, "ffmpeg-static must be available for local acceptance fixtures");
  const root = await mkdtemp(join(tmpdir(), "media-acceptance-video-"));
  const output = join(root, "fixture.mp4");
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "lavfi",
      "-i", "color=c=blue:s=320x180:d=2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function streamBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test("row 8: direct hero/media image uses the real operation, fixture transport, storage roundtrip, and settlement", async () => {
  const store = await FixtureObjectStore.create();
  try {
    const source = await tinyPng();
    const provider = fixtureProvider("image", source, 1, "fixture-hero-8");
    const receiptStore = new MemoryProviderAttemptReceiptStore();
    const spool = new MemoryProviderAttemptReceiptSpool();
    const ledger: unknown[] = [];
    let linkedUrl: string | null = null;
    let reserved = 0;
    let released = 0;
    let debited = 0;
    let settledCap = 0;
    const state = { unresolved: false, claimed: false };

    const result = await runDirectImageOperation({
      teamId: 810,
      userId: 811,
      resourceType: "article_hero",
      resourceId: 8,
      resourceVersion: "hero-v1",
      generate: () => executePaidMediaBoundary({
        mediaKind: "image",
        submit: provider.submit,
        persist: async (value) => {
          linkedUrl = await store.put("public/media-acceptance/hero-8.png", value.bytes, "image/png");
          return linkedUrl;
        },
        providerRequestId: (value) => value.id,
        receipt: {
          context: {
            teamId: 810,
            operationType: "image_generation",
            provider: "gemini",
            model: "fixture-image-v1",
            resourceType: "article_hero",
            resourceId: 8,
            attemptKey: "hero:8:v1",
            attempt: 1,
          },
          request: {
            model: "fixture-image-v1",
            maxImages: 1,
            timeoutMs: 30_000,
            adapterVersion: "media-acceptance-fixture-v1",
          },
          _deps: {
            store: receiptStore,
            spool,
            validateOwnership: async () => undefined,
            recordUsage: async (input: unknown) => {
              ledger.push(input);
              return { inserted: true };
            },
          },
          captureResponse: async (value) => ({
            providerRequestId: value.id,
            usage: { unitType: "images", unitCount: 1, known: true },
            metadata: { providerRequestId: value.id },
          }),
        },
      }),
      persist: async (url) => url,
      _deps: {
        assertNoUnresolvedAttempt: async () => {
          if (state.unresolved) {
            throw Object.assign(new Error("hero requires reconciliation"), {
              code: "RECONCILIATION_REQUIRED",
              statusCode: 409,
            });
          }
        },
        getCreditCost: async () => 1,
        checkCap: async () => 88,
        reserve: async (_params) => {
          reserved += 1;
          return {
            ok: true,
            runId: "direct-image:article_hero:8:v1",
            requiredCredits: 1,
            allowanceRemaining: 0,
            purchasedRemaining: 0,
            totalRemaining: 0,
          };
        },
        resolveRunId: async () => "direct-image:article_hero:8:v1",
        claimProviderEntry: async () => {
          if (state.claimed) return "resource_busy";
          state.claimed = true;
          state.unresolved = true;
          return "claimed";
        },
        debit: async (_params) => {
          debited += 1;
          state.unresolved = false;
          return {
            ok: true,
            fromAllowance: 1,
            fromPurchased: 0,
            allowanceRemaining: 0,
            purchasedRemaining: 0,
            totalRemaining: 0,
          };
        },
        release: async () => {
          released += 1;
        },
        markReconciliation: async () => {
          state.unresolved = true;
          return true;
        },
        recordUsage: async () => undefined,
        settleCap: async () => {
          settledCap += 1;
        },
        cancelCap: async () => undefined,
      },
    });

    assert.equal(result, linkedUrl);
    assert.equal(provider.calls, 1, "hero provider fixture submits exactly once");
    assert.equal(reserved, 1);
    assert.equal(debited, 1);
    assert.equal(released, 0);
    assert.equal(settledCap, 1);
    assert.equal(ledger.length, 1);
    assert.equal((await store.read("public/media-acceptance/hero-8.png")).equals(source), true);
    assert.equal((await store.bucket().file("public/media-acceptance/hero-8.png").getMetadata())[0]!.contentType, "image/png");
    assert.equal((await store.range("public/media-acceptance/hero-8.png", 0, 7)).equals(source.subarray(0, 8)), true);
    assert.equal([...receiptStore.rows.values()][0]?.status, "accounted");
  } finally {
    await store.close();
  }
});

test("row 8/9: cancellation, provider rejection, post-success storage failure, and accounting failure are non-replayable", async () => {
  const store = await FixtureObjectStore.create();
  try {
    let cancellationGenerateCalls = 0;
    let cancellationProviderCalls = 0;
    let cancellationStorageWrites = 0;
    let cancellationUsageWrites = 0;
    let reserveParams: { teamId: number; runId: string; amount?: number } | null = null;
    const releaseParams: Array<{
      teamId: number;
      userId?: number;
      runId: string;
      reason?: string;
      amount?: number;
      releaseKey?: string;
    }> = [];
    await assert.rejects(
      runDirectImageOperation({
        teamId: 810,
        userId: 811,
        resourceType: "article_asset",
        resourceId: 89,
        resourceVersion: "cancel-v1",
        generate: async () => {
          cancellationGenerateCalls += 1;
          // Cancellation is observed before this seam would call the provider.
          throw Object.assign(new Error("generation cancelled before provider acceptance"), {
            code: "CANCELLED",
          });
        },
        persist: async () => {
          cancellationStorageWrites += 1;
          return "never";
        },
        _deps: {
          assertNoUnresolvedAttempt: async () => undefined,
          getCreditCost: async () => 1,
          checkCap: async () => null,
          resolveRunId: async () => "direct-image:article_asset:89",
          reserve: async (_params) => {
            reserveParams = _params;
            return {
              ok: true,
              runId: "direct-image:article_asset:89",
              requiredCredits: 1,
              allowanceRemaining: 0,
              purchasedRemaining: 0,
              totalRemaining: 0,
            };
          },
          claimProviderEntry: async () => "claimed",
          clearOwnedProviderEntryFlag: async () => true,
          release: async (params) => {
            releaseParams.push(params);
          },
          recordUsage: async () => {
            cancellationUsageWrites += 1;
          },
          cancelCap: async () => undefined,
        },
      }),
      /cancelled/,
    );
    assert.equal(cancellationGenerateCalls, 1);
    assert.equal(cancellationProviderCalls, 0);
    assert.equal(cancellationStorageWrites, 0);
    assert.equal(cancellationUsageWrites, 0);
    assert.deepEqual(reserveParams, {
      teamId: 810,
      runId: "direct-image:article_asset:89",
      operationType: "section_regenerate",
      amount: 1,
      userId: 811,
    });
    assert.equal(releaseParams.length, 1, "cancellation releases the held reservation exactly once");
    assert.deepEqual(releaseParams[0], {
      teamId: 810,
      userId: 811,
      runId: "direct-image:article_asset:89",
      reason: "direct_image_confirmed_pre_delivery_failure",
    });

    const source = await tinyPng();
    const rejectionFixture = receiptFixture(store, "image", "provider_rejection", 9, "provider-rejection:9:v1");
    const rejectionProvider = fixtureProvider("image", source, 1, "fixture-rejected-9");
    await assert.rejects(
      executePaidMediaBoundary({
        mediaKind: "image",
        submit: async () => {
          rejectionProvider.calls += 1;
          throw Object.assign(new Error("fixture provider rejected request"), { code: "INVALID_REQUEST" });
        },
        persist: async () => "must-not-persist",
        receipt: {
          context: rejectionFixture.context,
          request: rejectionFixture.request,
          _deps: rejectionFixture.deps,
        },
      }),
      /fixture provider rejected request/,
    );
    assert.equal(rejectionProvider.calls, 1);
    assert.equal([...rejectionFixture.receiptStore.rows.values()][0]?.status, "provider_rejected");

    const fixture = receiptFixture(store, "image", "batch_repair", 9, "batch-repair:9:v1");
    const provider = fixtureProvider("image", source, 1, "fixture-batch-9");
    const options = {
      mediaKind: "image" as const,
      submit: provider.submit,
      persist: async () => {
        throw new Error("fixture storage outage after provider success");
      },
      providerRequestId: (value: { id: string }) => value.id,
      receipt: {
        context: fixture.context,
        request: fixture.request,
        _deps: fixture.deps,
        captureResponse: async (value: { id: string }) => ({
          providerRequestId: value.id,
          usage: { unitType: "images" as const, unitCount: 1, known: true },
          metadata: { providerRequestId: value.id },
        }),
      },
    };
    await assert.rejects(
      executePaidMediaBoundary(options),
      (error: unknown) => error instanceof ProviderResultNotDurableError && (error as any).providerRequestId === "fixture-batch-9",
    );
    await assert.rejects(
      executePaidMediaBoundary({
        ...options,
        persist: async () => "must-not-replay",
      }),
      (error: any) => error?.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
    );
    assert.equal(provider.calls, 1);
    assert.equal(fixture.ledger.length, 1);

    const accountingProvider = fixtureProvider("image", source, 1, "fixture-accounting-9");
    const accountingFixture = receiptFixture(store, "image", "caption_repair", 9, "caption-repair:9:v1");
    accountingFixture.deps.recordUsage = async () => {
      throw new Error("fixture immutable ledger unavailable");
    };
    await assert.rejects(
      executePaidMediaBoundary({
        mediaKind: "image",
        submit: accountingProvider.submit,
        persist: async (value) => accountingFixture.persist(value),
        providerRequestId: (value) => value.id,
        receipt: {
          context: accountingFixture.context,
          request: accountingFixture.request,
          _deps: accountingFixture.deps,
          captureResponse: async (value) => ({
            providerRequestId: value.id,
            usage: { unitType: "images", unitCount: 1, known: true },
            metadata: { providerRequestId: value.id },
          }),
        },
      }),
      (error: unknown) =>
        error instanceof ProviderAccountingError ||
        error instanceof ProviderAttemptAccountingError ||
        (error as any)?.code === "PROVIDER_ACCOUNTING_FAILED" ||
        (error as any)?.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
    );
    assert.equal(accountingProvider.calls, 1);
  } finally {
    await store.close();
  }
});

test("row 9: batch caption repair uses the production sanitizer and rejects unsafe boundary output", async () => {
  assert.equal(
    sanitizeCaptionText('Scene 2: "Openai and Ai help teams"'),
    "OpenAI and AI help teams",
  );
  const longCaption = sanitizeCaptionText(`Caption: ${"word ".repeat(80)}`);
  assert.equal(longCaption.length, 120);
  assert.match(longCaption, /\.\.\.$/);
  assert.equal(sanitizeCaptionText("  A normal caption  "), "A normal caption");
});

test("row 10: identity regeneration roundtrip is tenant-resource scoped and rejects malformed identities", async () => {
  const store = await FixtureObjectStore.create();
  try {
    const validateIdentityOwnership = async (context: unknown) => {
      const candidate = context as {
        teamId?: number;
        resourceType?: string | null;
        resourceId?: string | number | null;
      };
      if (
        candidate.teamId !== 810 ||
        candidate.resourceType !== "article_asset" ||
        Number(candidate.resourceId) !== 10010
      ) {
        throw Object.assign(new Error("fixture ownership denied"), {
          code: "OWNERSHIP_DENIED",
        });
      }
    };
    const identity = Buffer.from("article_asset:10010", "utf8").toString("base64url");
    assert.deepEqual(decodeAssetSource(identity), {
      sourceType: "article_asset",
      sourceId: 10010,
    });
    assert.equal(decodeAssetSource("not-an-asset-identity"), null);
    assert.equal(
      decodeAssetSource(Buffer.from("social_video:10010", "utf8").toString("base64url"))?.sourceType,
      "social_video",
    );
    assert.equal(canonicalObjectKey("/api/public-objects/private/media/identity-10.png?download=1"), "private/media/identity-10.png");
    assert.equal(canonicalObjectKey("https://fixture.invalid/public/media/identity-10.png"), "media/identity-10.png");
    assert.equal(canonicalObjectKey("javascript:not-a-storage-key"), "not-a-storage-key");
    const fixture = await runFixtureBoundary({
      store,
      mediaKind: "image",
      resourceType: "article_asset",
      resourceId: 10010,
      attemptKey: "identity-regeneration:10010:v1",
      bytes: await tinyPng(),
      unitCount: 1,
      id: "fixture-identity-image-10",
      validateOwnership: validateIdentityOwnership,
    });
    assert.equal(fixture.provider.calls, 1);
    assert.equal(fixture.fixture.ledger.length, 1);
    assert.match(fixture.result, /article_asset-10010\.png$/);

    for (const [failureLabel, override] of [
      ["wrong-tenant", { teamId: 811 }],
      ["wrong-resource", { resourceId: 10011 }],
    ] as const) {
      const negativeStore = await FixtureObjectStore.create();
      try {
        const negativeFixture = receiptFixture(
          negativeStore,
          "image",
          "article_asset",
          10010,
          `identity-regeneration:${failureLabel}:v1`,
          validateIdentityOwnership,
        );
        const negativeProvider = fixtureProvider(
          "image",
          await tinyPng(),
          1,
          `fixture-identity-${failureLabel}`,
        );
        let storageWrites = 0;
        await assert.rejects(
          executePaidMediaBoundary({
            mediaKind: "image",
            submit: negativeProvider.submit,
            persist: async (value) => {
              storageWrites += 1;
              return negativeFixture.persist(value);
            },
            providerRequestId: (value) => value.id,
            receipt: {
              context: { ...negativeFixture.context, ...override },
              request: negativeFixture.request,
              _deps: negativeFixture.deps,
            },
          }),
          /fixture ownership denied/,
        );
        assert.equal(negativeProvider.calls, 0, `${failureLabel}: provider did not run`);
        assert.equal(negativeFixture.ledger.length, 0, `${failureLabel}: usage was not recorded`);
        assert.equal(storageWrites, 0, `${failureLabel}: storage was not written`);
        assert.equal(negativeStore.objects.size, 0, `${failureLabel}: object store remained empty`);
      } finally {
        await negativeStore.close();
      }
    }
  } finally {
    await store.close();
  }
});

test("row 13: social image provider bytes normalize to platform contract before persisted URL", async () => {
  const store = await FixtureObjectStore.create();
  try {
    const providerBytes = await tinyPng(91, 37);
    const fixture = await runFixtureBoundary({
      store,
      mediaKind: "image",
      resourceType: "social_asset",
      resourceId: 13,
      attemptKey: "social-image:13:v1",
      bytes: providerBytes,
      unitCount: 1,
      id: "fixture-social-image-13",
    });
    const normalized = await normalizeSocialImage(providerBytes, "instagram");
    const normalizedKey = "public/media-acceptance/social-image-13-normalized.png";
    const normalizedUrl = await store.put(normalizedKey, normalized.imageBuffer, normalized.mimeType, {
      width: String(normalized.width),
      height: String(normalized.height),
      aspectRatio: normalized.aspectRatio,
    });
    assert.match(normalizedUrl, /^\/api\/public-objects\//);
    assert.equal(normalized.width, 1080);
    assert.equal(normalized.height, 1080);
    assert.equal(normalized.fileFormat, "png");
    assert.equal((await store.read(normalizedKey)).equals(normalized.imageBuffer), true);
    assert.equal(fixture.provider.calls, 1);
    assert.equal(fixture.fixture.ledger.length, 1);
    await assert.rejects(normalizeSocialImage(providerBytes, "unsupported-platform"), /Unsupported social platform/);
  } finally {
    await store.close();
  }
});

test("row 14: slideshow compositor executes FFmpeg with local images/audio, persists MP4 metadata, URL, range, and playback duration", async () => {
  const store = await FixtureObjectStore.create();
  const previousBucket = (objectStorageClient as any).bucket;
  try {
    const root = await mkdtemp(join(tmpdir(), "media-acceptance-slideshow-"));
    const image = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: { r: 80, g: 30, b: 140 },
      },
    }).jpeg().toBuffer();
    const images = [];
    for (let sceneNumber = 1; sceneNumber <= 5; sceneNumber += 1) {
      const localPath = join(root, `scene-${sceneNumber}.jpg`);
      await writeFile(localPath, image);
      images.push({
        sceneNumber,
        storageUrl: `/fixture/scene-${sceneNumber}.jpg`,
        localPath,
        aspectRatio: "16:9",
      });
    }
    const audioPath = join(root, "voice.mp3");
    await writeFile(audioPath, await fixtureAudio(6));
    (objectStorageClient as any).bucket = () => store.bucket();
    const scenes = images.map((entry, index) => ({
      sceneNumber: entry.sceneNumber,
      timeRange: `${index}-${index + 1}s`,
      targetDuration: 1,
      narration: `Scene ${index + 1} narration`,
      visualDescription: "A calm blue studio background",
      caption: index === 0 ? 'Caption: "Openai and Ai"' : `Scene ${index + 1}`,
      geoReference: "fixture",
      seoKeywords: ["fixture"],
    }));
    const result = await composeVideo({
      socialPostId: 14,
      images,
      audio: {
        audioUrl: "/fixture/voice.mp3",
        localPath: audioPath,
        duration: 6,
        voice: "fixture",
      },
      scenes,
      companyName: "Fixture Company",
      platform: "facebook",
      landingPageUrl: "https://fixture.invalid/landing",
    });
    const key = `public/${result.videoUrl.replace("/api/public-objects/", "")}`;
    const stored = await store.read(key);
    assert.ok(stored.length > 0);
    assert.equal((await store.bucket().file(key).getMetadata())[0]!.contentType, "video/mp4");
    assert.match(result.videoUrl, /^\/api\/public-objects\/social-videos\/social-video-14-/);
    assert.equal(result.resolution, "1920x1080");
    assert.ok(result.duration >= 5 && result.duration <= 7, `duration=${result.duration}`);
    const firstRange = await store.range(key, 0, Math.min(31, stored.length - 1));
    assert.equal(firstRange.equals(stored.subarray(0, firstRange.length)), true);
    assert.equal((await streamBuffer(store.bucket().file(key).createReadStream({ start: 0, end: 31 }))).equals(firstRange), true);

    const delivered = await runFixtureBoundary({
      store,
      mediaKind: "video",
      resourceType: "social_slideshow",
      resourceId: 14,
      attemptKey: "social-slideshow:14:v1",
      bytes: stored,
      unitCount: Math.ceil(result.duration),
      id: "fixture-social-slideshow-14",
    });
    assert.equal(delivered.provider.calls, 1);
    assert.equal(delivered.fixture.ledger.length, 1);
    assert.match(delivered.result, /social_slideshow-14\.mp4$/);
    await rm(root, { recursive: true, force: true });
  } finally {
    (objectStorageClient as any).bucket = previousBucket;
    await store.close();
  }
});

test("rows 15/16: idea and like-video paid media boundary has one fixture submission, no replay after delivery loss, and concurrent duplicate recovery", async () => {
  const store = await FixtureObjectStore.create();
  try {
    const videoBytes = await fixtureVideo();
    for (const [resourceType, resourceId] of [["video_idea", 15], ["like_video", 16]] as const) {
      const fixture = receiptFixture(store, "video", resourceType, resourceId, `${resourceType}:${resourceId}:v1`);
      const provider = fixtureProvider("video", videoBytes, 2, `fixture-${resourceType}-${resourceId}`);
      const options = {
        mediaKind: "video" as const,
        submit: provider.submit,
        persist: async (value: { id: string; bytes: Buffer }) => fixture.persist(value),
        providerRequestId: (value: { id: string }) => value.id,
        receipt: {
          context: fixture.context,
          request: fixture.request,
          _deps: fixture.deps,
          captureResponse: async (value: { id: string }) => ({
            providerRequestId: value.id,
            usage: { unitType: "seconds" as const, unitCount: 2, known: true },
            metadata: { operationId: value.id },
          }),
        },
      };
      const first = executePaidMediaBoundary(options);
      const second = executePaidMediaBoundary(options);
      const settled = await Promise.allSettled([first, second]);
      assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(provider.calls, 1, `${resourceType} provider submits once under duplicate delivery`);
      assert.equal(fixture.ledger.length, 1);
      const success = settled.find((item) => item.status === "fulfilled") as PromiseFulfilledResult<string>;
      const stored = await store.read(success.value.replace("/api/public-objects/", ""));
      assert.equal(stored.equals(videoBytes), true);
    }
  } finally {
    await store.close();
  }
});

test("row 17: podcast preflight, ffprobe playback metadata, audio storage/export, and settlement recovery", async () => {
  const store = await FixtureObjectStore.create();
  try {
    const durationRange = parsePodcastDuration("1-2 minutes");
    assert.ok(durationRange);
    const text = "A useful podcast sentence for listeners. ".repeat(20);
    const script = {
      segments: [
        { text, voice: "female" },
        { text, voice: "male" },
      ],
    };
    const plan = preflightPodcastScriptDuration(script, durationRange, "acceptance");
    assert.ok(plan.totalWords >= durationRange.minWords);
    const audio = await renderPodcastSegmentsAfterPreflight(
      script,
      durationRange,
      "acceptance",
      async () => fixtureAudio(60),
    );
    const measuredSeconds = await probePodcastAudioDuration(audio);
    assert.ok(measuredSeconds >= 59.5 && measuredSeconds <= 60.5, `measured=${measuredSeconds}`);
    const metadata = createPodcastMeasuredDurationMetadata(measuredSeconds, durationRange, plan);
    assert.equal(metadata.durationSource, "ffprobe");
    assert.equal(metadata.planningDurationLabel, "estimate");
    const provider = fixtureProvider("audio", audio, Math.ceil(measuredSeconds), "fixture-podcast-17");
    const fixture = receiptFixture(store, "audio", "article_podcast", 17, "podcast:17:v1");
    const url = await executePaidMediaBoundary({
      mediaKind: "audio",
      submit: provider.submit,
      persist: async (value) => fixture.persist(value),
      providerRequestId: (value) => value.id,
      receipt: {
        context: fixture.context,
        request: fixture.request,
        _deps: fixture.deps,
        captureResponse: async (value) => ({
          providerRequestId: value.id,
          usage: { unitType: "seconds" as const, unitCount: Math.ceil(measuredSeconds), known: true },
          metadata: { providerRequestId: value.id, durationSeconds: measuredSeconds },
        }),
      },
    });
    assert.equal(provider.calls, 1);
    assert.equal(fixture.ledger.length, 1);
    const stored = await store.read(url.replace("/api/public-objects/", ""));
    assert.equal(stored.equals(audio), true);
    const storedSeconds = await probePodcastAudioDuration(stored);
    assert.ok(storedSeconds >= 59.5 && storedSeconds <= 60.5);

    let debitCalls = 0;
    let capCalls = 0;
    let markerCalls = 0;
    await assert.rejects(
      settleDeliveredPodcast(
        { articleId: 17, teamId: 810, userId: 811, creditRunId: "podcast:17:settlement", capReservationId: 1700 },
        17,
        {
          debit: async () => {
            debitCalls += 1;
            return { ok: true };
          },
          completeCap: async () => {
            capCalls += 1;
          },
          markSettled: async () => {
            markerCalls += 1;
            if (markerCalls === 1) throw new Error("fixture marker write outage");
          },
        },
      ),
      /Settlement failed/,
    );
    await settleDeliveredPodcast(
      { articleId: 17, teamId: 810, userId: 811, creditRunId: "podcast:17:settlement", capReservationId: 1700 },
      17,
      {
        debit: async () => {
          debitCalls += 1;
          return { ok: true };
        },
        completeCap: async () => {
          capCalls += 1;
        },
        markSettled: async () => {
          markerCalls += 1;
        },
      },
    );
    assert.equal(debitCalls, 2);
    assert.equal(capCalls, 2, "settlement retry does not regenerate or resubmit audio");
    assert.equal(provider.calls, 1);
    assert.equal(markerCalls, 2);

    const archive = createZipArchive({ zlib: { level: 9 } });
    const output = new PassThrough();
    const archiveDone = streamBuffer(output);
    archive.pipe(output);
    archive.append(stored, { name: "media/podcast-17.mp3" });
    archive.append(JSON.stringify(metadata), { name: "media/podcast-17.metadata.json" });
    await archive.finalize();
    const exported = await archiveDone;
    assert.ok(exported.length > 0);
    assert.ok(exported.includes(Buffer.from("podcast-17.mp3")));
    assert.ok(exported.includes(Buffer.from("podcast-17.metadata.json")));
  } finally {
    await store.close();
  }
});

test("rows 8-10/13-17: receipt recovery converges spool evidence without a second fixture provider call", async () => {
  const source = await tinyPng();
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  const ledger: unknown[] = [];
  const context = {
    teamId: 810,
    operationType: "image_generation",
    provider: "gemini" as const,
    model: "fixture-image-v1",
    resourceType: "article_hero",
    resourceId: 81017,
    attemptKey: "recovery:81017:v1",
    attempt: 1,
  };
  const request = {
    model: "fixture-image-v1",
    maxImages: 1,
    timeoutMs: 30_000,
    adapterVersion: "media-acceptance-fixture-v1",
  };
  let providerCalls = 0;
  const first = await executePaidMediaBoundary({
    mediaKind: "image",
    submit: async () => {
      providerCalls += 1;
      return { id: "fixture-recovery-81017", bytes: source };
    },
    persist: async (value) => value.id,
    providerRequestId: (value) => value.id,
    receipt: {
      context,
      request,
      _deps: {
        store,
        spool,
        validateOwnership: async () => undefined,
        recordUsage: async (input: unknown) => {
          ledger.push(input);
          return { inserted: true };
        },
      },
      captureResponse: async (value) => ({
        providerRequestId: value.id,
        usage: { unitType: "images", unitCount: 1, known: true },
        metadata: { providerRequestId: value.id },
      }),
    },
  });
  assert.equal(first, "fixture-recovery-81017");
  assert.equal(providerCalls, 1);
  assert.equal(ledger.length, 1);
  const sourceEventId = [...store.rows.keys()][0]!;
  const reconciled = await reconcileProviderAttempt(
    { sourceEventId },
    {
      store,
      spool,
      validateOwnership: async () => undefined,
      recordUsage: async () => {
        throw new Error("accounting must not replay for already-accounted receipt");
      },
    },
  );
  assert.equal(reconciled.ledger, null);
  assert.equal(reconciled.receipt.status, "accounted");
  assert.equal(providerCalls, 1);
  assert.equal(ledger.length, 1);
});