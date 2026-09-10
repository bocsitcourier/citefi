import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
process.env.GEMINI_API_KEY ??= "test-key-no-network";
process.env.OPENAI_API_KEY ??= "test-key-no-network";

const {
  ProviderAccountingError,
  ProviderResultNotDurableError,
  ProviderSubmissionUncertainError,
  isNonReplayableProviderError,
} = await import("../lib/cost-telemetry");
const { classifyError } = await import("../lib/errors");
const { createPipelineHandler } = await import("../lib/pipeline-worker");
const { executePaidMediaBoundary } = await import("../lib/media-provider-boundary");
const {
  generateSingleImage,
  generateAndStoreHeroImage,
} = await import("../lib/gemini-image-generator");
const { callOpenAI } = await import("../lib/openai-client");

void test("paid-provider boundary failures classify fatal instead of consuming queue retries", () => {
  const cases = [
    new ProviderAccountingError("ledger unavailable after provider response", new Error("db down")),
    new ProviderSubmissionUncertainError("socket closed after submission", new Error("timeout")),
    new ProviderResultNotDurableError("provider returned bytes but storage failed", "operations/123"),
  ];

  for (const error of cases) {
    assert.equal(isNonReplayableProviderError(error), true);
    const classified = classifyError(error, "video_gen", { provider: "veo" });
    assert.equal(classified.disposition, "fatal");
    assert.equal(classified.code, error.code);
  }
});

void test("mocked image, video, and audio providers each submit once after paid-result delivery loss", async () => {
  const physicalProviderSubmissions = { image: 0, video: 0, audio: 0 };
  let releases = 0;
  let reconciliationHolds = 0;
  for (const mediaKind of ["image", "video", "audio"] as const) {
    const providerOperationId =
      mediaKind === "video" ? "operations/mock-veo-42" : `mock-${mediaKind}-response-42`;
    const handler = createPipelineHandler(
      `mock-costly-${mediaKind}`,
      async () => {
        physicalProviderSubmissions[mediaKind]++;
        throw new ProviderResultNotDurableError(
          `mock ${mediaKind} provider completed, storage failed`,
          providerOperationId,
          new Error("mock object storage outage")
        );
      },
      {
        stage: `${mediaKind}_gen`,
        execution: { scope: "system", reason: "media replay-safety unit test" },
        getBilling: () => ({ teamId: 7, runId: `media-run-${mediaKind}-7` }),
        _deps: {
          recordProviderFailure: async () => undefined,
          releaseReservation: async () => {
            releases++;
          },
          markReservationForReconciliation: async () => {
            reconciliationHolds++;
          },
        },
      }
    );

    await assert.rejects(
      () => handler({
        id: `media-job-${mediaKind}`,
        data: {},
        attemptsMade: 0,
        opts: { attempts: 5 },
      } as any),
      (error: any) => {
        assert.equal(error?.name, "UnrecoverableError");
        assert.match(error?.message ?? "", /PROVIDER_RESULT_NOT_DURABLE/);
        return true;
      }
    );
  }

  assert.deepEqual(physicalProviderSubmissions, { image: 1, video: 1, audio: 1 });
  assert.equal(reconciliationHolds, 3);
  assert.equal(releases, 0);
});

void test("mocked ambiguous submission is terminal before a second physical attempt", async () => {
  let physicalProviderSubmissions = 0;
  const handler = createPipelineHandler(
    "mock-ambiguous-media",
    async () => {
      physicalProviderSubmissions++;
      throw new ProviderSubmissionUncertainError(
        "mock timeout after request body was sent",
        new Error("ETIMEDOUT")
      );
    },
    {
      stage: "image_gen",
      execution: { scope: "system", reason: "media replay-safety unit test" },
      _deps: { recordProviderFailure: async () => undefined },
    }
  );

  await assert.rejects(
    () => handler({ id: "image-1", data: {}, attemptsMade: 0, opts: { attempts: 3 } } as any),
    (error: any) => error?.name === "UnrecoverableError"
  );
  assert.equal(physicalProviderSubmissions, 1);
});

void test("accepted provider accounting failure marks hold and never auto-releases", async () => {
  let holds = 0;
  let releases = 0;
  const handler = createPipelineHandler(
    "mock-accounting-failure",
    async () => {
      throw new ProviderAccountingError(
        "provider accepted but immutable accounting failed",
        new Error("fake ledger outage")
      );
    },
    {
      stage: "audio_gen",
      execution: { scope: "system", reason: "media replay-safety unit test" },
      getBilling: () => ({ teamId: 7, runId: "audio-accounting-run" }),
      _deps: {
        recordProviderFailure: async () => undefined,
        markReservationForReconciliation: async () => { holds++; },
        releaseReservation: async () => { releases++; },
      },
    }
  );

  await assert.rejects(
    () => handler({ id: "accounting-1", data: {}, attemptsMade: 0, opts: { attempts: 3 } } as any),
    (error: any) => error?.name === "UnrecoverableError"
  );
  assert.equal(holds, 1);
  assert.equal(releases, 0);
});

void test("non-durable Veo error retains its in-memory operation name for manual handling", () => {
  const operationName = "operations/mock-abandoned-veo-99";
  const abandoned = new ProviderResultNotDurableError(
    "worker stopped after Veo accepted the operation",
    operationName,
    new Error("mock worker shutdown")
  );
  assert.equal(abandoned.providerRequestId, operationName);
  assert.equal(classifyError(abandoned, "video_gen").disposition, "fatal");
});

void test("direct production media boundary does not resubmit fake SDK after storage failure", async () => {
  for (const mediaKind of ["image", "video", "audio"] as const) {
    let physicalCalls = 0;
    let storageCalls = 0;
    await assert.rejects(
      () => executePaidMediaBoundary({
        mediaKind,
        submit: async () => {
          physicalCalls++;
          return { id: `fake-${mediaKind}-provider-id`, bytes: Buffer.from(mediaKind) };
        },
        persist: async () => {
          storageCalls++;
          throw new Error(`fake ${mediaKind} storage failure`);
        },
        providerRequestId: (result) => result.id,
      }),
      (error: any) => {
        assert.equal(error?.code, "PROVIDER_RESULT_NOT_DURABLE");
        assert.equal(error?.providerRequestId, `fake-${mediaKind}-provider-id`);
        return true;
      }
    );
    assert.equal(physicalCalls, 1, `${mediaKind} SDK physical call count`);
    assert.equal(storageCalls, 1, `${mediaKind} storage call count`);
  }
});

void test("direct production media boundary does not persist or resubmit after fake accounting failure", async () => {
  let physicalCalls = 0;
  let storageCalls = 0;
  const accountingFailure = new ProviderAccountingError(
    "fake immutable accounting failed after provider success",
    new Error("fake ledger outage")
  );

  await assert.rejects(
    () => executePaidMediaBoundary({
      mediaKind: "audio",
      submit: async () => {
        physicalCalls++;
        throw accountingFailure;
      },
      persist: async () => {
        storageCalls++;
        return "should-not-persist";
      },
    }),
    (error) => error === accountingFailure
  );
  assert.equal(physicalCalls, 1);
  assert.equal(storageCalls, 0);
});

void test("actual generateSingleImage treats timeout and missing paid payload as terminal", async () => {
  let timeoutPhysicalCalls = 0;
  await assert.rejects(
    () => generateSingleImage(
      "fake prompt",
      { teamId: 7 },
      {
        generateContent: async () => {
          timeoutPhysicalCalls++;
          throw new Error("fetch failed: ETIMEDOUT");
        },
        logFailure: async () => undefined,
      }
    ),
    (error: any) => error?.code === "PROVIDER_SUBMISSION_UNCERTAIN"
  );
  assert.equal(timeoutPhysicalCalls, 1);

  let completedPhysicalCalls = 0;
  await assert.rejects(
    () => generateSingleImage(
      "fake prompt",
      { teamId: 7 },
      {
        generateContent: async () => {
          completedPhysicalCalls++;
          return { responseId: "fake-gemini-complete", candidates: [] };
        },
        logSuccess: async () => undefined,
      }
    ),
    (error: any) =>
      error?.code === "PROVIDER_RESULT_NOT_DURABLE" &&
      error?.providerRequestId === "fake-gemini-complete"
  );
  assert.equal(completedPhysicalCalls, 1);
});

void test("actual stored-image production path submits once when fake storage fails", async () => {
  let physicalCalls = 0;
  let storageCalls = 0;
  await assert.rejects(
    () => generateAndStoreHeroImage(
      "fake prompt",
      42,
      9,
      7,
      undefined,
      {
        generateContent: async () => {
          physicalCalls++;
          return {
            responseId: "fake-gemini-stored",
            candidates: [{
              content: { parts: [{ inlineData: { data: Buffer.from("image").toString("base64") } }] },
            }],
          };
        },
        logSuccess: async () => undefined,
        upload: async () => {
          storageCalls++;
          throw new Error("fake object storage outage");
        },
      }
    ),
    (error: any) =>
      error?.code === "PROVIDER_RESULT_NOT_DURABLE" &&
      error?.providerRequestId === "fake-gemini-stored"
  );
  assert.equal(physicalCalls, 1);
  assert.equal(storageCalls, 1);
});

void test("actual callOpenAI 429 policy has one owner and three physical calls, not twelve", async () => {
  let physicalCalls = 0;
  const rateLimitError = Object.assign(new Error("fake explicit 429"), { status: 429 });
  await assert.rejects(
    () => callOpenAI(
      async () => {
        physicalCalls++;
        throw rateLimitError;
      },
      "fake 429 retry ownership",
      undefined,
      { teamId: 7, operationType: "podcast_tts", model: "fake-model" },
      {
        logFailure: async () => undefined,
        sleep: async () => undefined,
      }
    ),
    (error) => error === rateLimitError
  );
  assert.equal(physicalCalls, 3);
});

void test("production provider modules retain bounded replay and operation evidence", () => {
  const openAI = readFileSync("lib/openai-client.ts", "utf8");
  assert.doesNotMatch(openAI, /isRateLimit\s*\|\|\s*isTimeout/);
  assert.match(openAI, /if\s*\(isTimeout\)\s*\{[\s\S]*ProviderSubmissionUncertainError/);
  assert.match(openAI, /attempt\s*<\s*MAX_RETRIES\s*&&\s*isRateLimit/);

  const veo = readFileSync("lib/veo-video-generator.ts", "utf8");
  assert.match(veo, /operationId\s*=\s*operation\.name/);
  assert.match(veo, /providerSubmitted\s*=\s*true/);
  assert.match(veo, /ProviderResultNotDurableError\([\s\S]*operationId/);

  const images = readFileSync("lib/gemini-image-generator.ts", "utf8");
  assert.match(images, /paidProviderResultReceived\s*=\s*true/);
  assert.match(images, /ProviderResultNotDurableError/);

  const podcastTts = readFileSync("lib/openai-tts.ts", "utf8");
  assert.match(podcastTts, /MAX_SEGMENTS\s*=\s*40/);
  assert.match(podcastTts, /MAX_TOTAL_CHARACTERS\s*=\s*30_000/);
});