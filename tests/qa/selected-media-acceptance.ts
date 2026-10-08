/**
 * Selected TTS-1 acceptance, registered only by the owned PG/Redis harness.
 * Defaults to no live execution; paid mode requires both manifest approvals.
 * The explicitly omitted expansion/critic/learning/Drive seams are not certified.
 */
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, desc } from "drizzle-orm";
import { NextRequest } from "next/server";
import ffmpegPath from "ffmpeg-static";
import test from "node:test";
import { EVIDENCE_ROOT, hash } from "../../QA/support/selected-media-plan.mjs";
import { reserveSelectedMediaRun } from "../../QA/support/selected-media-run.mjs";

const exec = promisify(execFile);
const modelClaims = "selected tts-1 (deprecated), NOT default gpt-4o-mini-tts; durable filesystem adapter, NOT cloud certification";

async function probeAndDecode(path: string, kind: "audio" | "video") {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
  const probe = JSON.parse(stdout);
  assert.ok(Number(probe.format.duration) > 0);
  assert.ok(probe.streams.some((s: any) => s.codec_type === "audio"));
  if (kind === "video") assert.ok(probe.streams.some((s: any) => s.codec_type === "video"));
  // Decode every frame/sample, not merely container headers or first frames.
  const decoded = await exec(ffmpegPath!, ["-v", "error", "-xerror", "-i", path,
    "-map", "0:a:0", ...(kind === "video" ? ["-map", "0:v:0"] : []), "-f", "null", "-"],
  { timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.equal(decoded.stderr.trim(), "");
  const { stderr } = await exec(ffmpegPath!, ["-hide_banner", "-i", path,
    "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
  { timeout: 120000, maxBuffer: 1024 * 1024 });
  const match = stderr.match(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf)) dB/);
  assert.ok(match && Number(match[1]) > -60, "audio must be audible, not silence");
  return { duration: Number(probe.format.duration), streams: probe.streams,
    fullDecode: true, audioMeanDb: Number(match![1]) };
}

async function seedOwnedRates(c: any, runId: string) {
  const { schema: s, systemDb: db } = c;
  const effectiveFrom = new Date("2026-10-08T00:00:00Z");
  const [version] = await db.insert(s.providerRateVersions).values({
    version: `selected-${runId}`, effectiveFrom,
    evidenceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    sourceNote: "Owned selected media QA; current official Google and OpenAI prices",
  }).returning();
  await db.insert(s.providerRates).values([
    { rateVersionId: version.id, provider: "gemini", model: "gemini-3.5-flash",
      unitType: "tokens", inputMicrousdPerMillion: 1500000,
      outputMicrousdPerMillion: 9000000, effectiveFrom,
      evidenceUrl: "https://ai.google.dev/gemini-api/docs/pricing" },
    { rateVersionId: version.id, provider: "openai", model: "tts-1",
      unitType: "characters", microusdPerUnit: 15, effectiveFrom,
      evidenceUrl: "https://developers.openai.com/api/docs/models/tts-1" },
    { rateVersionId: version.id, provider: "gemini", model: "veo-3.1-fast-generate-preview",
      unitType: "seconds", microusdPerUnit: 100000, effectiveFrom,
      evidenceUrl: "https://ai.google.dev/gemini-api/docs/pricing" },
  ]);
}

async function fixtureTransport(c: any, stage: string) {
  const videoPath = join(c.owned.root, "selected-fixture.mp4");
  const audioPath = join(c.owned.root, "selected-fixture.mp3");
  if (stage === "podcast") {
    const source = join(c.owned.root, "selected-audio-source.mp3");
    await writeFile(source, c.fixtureAudioBytes);
    await exec(ffmpegPath!, ["-v", "error", "-i", source, "-t", "30", "-c:a", "copy", audioPath]);
  }
  if (stage === "video") {
    await exec(ffmpegPath!, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=12",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-movflags", "+faststart", videoPath], { timeout: 60000 });
  }
  let count = 0;
  return async (input: any, init: any) => {
    const url = new URL(String(input));
    const number = ++count;
    if (url.pathname.endsWith(":generateContent")) {
      const script = stage === "podcast" ? {
        title: "Fixture Media Co sustainable energy", duration: "1-2 minutes",
        segments: [{ speaker: "host1", voice: "female", text: [
          "Welcome to Fixture Media Co. We help communities plan reliable sustainable energy.",
          ...Array.from({ length: 13 }, () => "Start with a careful energy assessment and compare practical options before choosing a solar installation."),
          "Contact Fixture Media Co to learn more about thoughtful community solar planning.",
        ].join(" ") }],
      } : {
        title: "Fixture Media Co solar planning", companyName: "Fixture Media Co",
        location: "Fixture City", totalDuration: 60,
        clips: Array.from({ length: 10 }, (_, i) => ({
          sceneNumber: i + 1, targetDuration: 6, geoReference: "Fixture City",
          prompt: `Scene ${i + 1}: A realistic coastal solar installation with adult engineers reviewing panels at golden hour. Slow cinematic camera movement. No text, no captions, no logos, no watermarks, no signs of any kind anywhere in the frame`,
          narration: i === 9 ? "Contact Fixture Media Co to learn more about thoughtful community solar planning."
            : `Explore sustainable energy with Fixture Media Co through carefully planned practical solar solutions, scene ${i + 1}.`,
        })),
      };
      if (stage === "podcast") {
        const words = script.segments![0]!.text.split(/\s+/);
        script.segments = [
          { speaker: "host1", voice: "female", text: words.slice(0, 100).join(" ") },
          { speaker: "host2", voice: "male", text: words.slice(100).join(" ") },
        ];
      }
      return Response.json({ responseId: `offline-script-${number}`, modelVersion: "gemini-3.5-flash",
        candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(script) }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1200, thoughtsTokenCount: 100, totalTokenCount: 2300 } });
    }
    if (url.pathname === "/v1/audio/speech") {
      return new Response(stage === "podcast" ? await readFile(audioPath) : c.fixtureAudioBytes, {
        headers: { "content-type": "audio/mpeg", "x-request-id": `offline-tts-${number}` },
      });
    }
    if (url.pathname.endsWith(":predictLongRunning")) {
      return Response.json({ name: `models/veo-3.1-fast-generate-preview/operations/offline-${number}`, done: false });
    }
    if (url.pathname.includes("/operations/")) {
      const name = url.pathname.replace(/^\/v1(?:beta)?\//, "");
      return Response.json({ name, done: true, response: {
        generateVideoResponse: { generatedSamples: [{
          video: { uri: `https://generativelanguage.googleapis.com/v1beta/files/${name.split("/").at(-1)}:download?alt=media` },
        }] },
      } });
    }
    if (url.pathname.includes("/files/")) {
      return new Response(await readFile(videoPath), { headers: { "content-type": "video/mp4" } });
    }
    throw new Error("Offline fixture refused unrecognized endpoint");
  };
}

export function registerSelectedMediaAcceptance(c: any) {
  if (!process.env.SELECTED_MEDIA_QA) return;
  const stage = process.env.SELECTED_MEDIA_QA;
  const offline = process.env.SELECTED_MEDIA_OFFLINE === "1";
  const runId = process.env.SELECTED_MEDIA_RUN_ID!;
  test(`selected bounded media: ${stage} route, real adapters, receipts and full playback`, async () => {
    let passed = false;
    const evidence: any = { offline, modelClaims, omittedPaidAuxiliaries: ["expansion", "critic", "Drive", "learning"],
      storageBoundary: "durable owned filesystem, not cloud", customerDatabaseAccessed: false };
    const root = offline ? join(c.owned.root, "isolated-selected-budget") : EVIDENCE_ROOT;
    if (offline) {
      await mkdir(root, { recursive: true });
      for (const file of ["budget-baseline.json", "budget-ledger.json"]) {
        await cp(join(EVIDENCE_ROOT, file), join(root, file));
      }
    }
    const run = reserveSelectedMediaRun(stage, runId, { root, offline });
    c.setRun(run);
    const { currentProviderAttempt } = await import("../../lib/provider-attempt-receipts");
    c.setReceiptGetter(() => currentProviderAttempt()?.receipt);
    if (offline) c.setFixtureFetch(await fixtureTransport(c, stage));
    await seedOwnedRates(c, runId);
    try {
      const { schema: s, systemDb: db, userId, teamId, articleId, ideaId } = c;
      let assetUrl: string;
      if (stage === "podcast") {
        const { POST } = await import("../../app/api/podcast/generate/route");
        const denied = await POST(new NextRequest("http://127.0.0.1/api/podcast/generate", {
          method: "POST", headers: c.wrongTenantHeaders,
          body: JSON.stringify({ articleId, duration: "1-2 minutes" }),
        }));
        assert.ok([403, 404].includes(denied.status));
        assert.equal(run.entry.calls.length, 0);
        evidence.tenantGenerationDenial = denied.status;
        const response = await POST(new NextRequest("http://127.0.0.1/api/podcast/generate", {
          method: "POST", headers: c.authHeaders,
          body: JSON.stringify({ articleId, duration: "1-2 minutes", tone: "Conversational" }),
        }));
        assert.equal(response.status, 200);
        const queued = await response.json();
        const { getQueue, PODCAST_GENERATION_QUEUE } = await import("../../lib/queue");
        const job = await getQueue(PODCAST_GENERATION_QUEUE).getJob(queued.jobId);
        assert.ok(job);
        const { generatePodcastScript } = await import("../../lib/podcast-generator");
        const { generateArticlePodcast } = await import("../../lib/podcast-worker");
        await c.runWithAuthenticatedTeamContext({ userId, teamId, role: "team_member" }, () =>
          generateArticlePodcast(job!.data, {
            generatePodcastScript: async (title, content, options) =>
              generatePodcastScript(title, content, { ...options, enableFactValidation: false }),
            getPromptEnhancement: async () => ({ systemPromptAdditions: [], userPromptAdditions: [],
              suggestedParameters: {}, patternsUsed: [], variantArmId: undefined }),
            runGenerationOrchestrator: (async (input: any) => ({ content: input.content,
              repairs: 0, orchestrated: false, qualityScore: 75, patternsInjected: [], status: "ready", review: {} })) as any,
            recordContentGenerated: async () => 0,
            uploadPodcastToDrive: async () => null,
          }));
        const [article] = await db.select().from(s.articles).where(eq(s.articles.id, articleId));
        assert.equal(article.podcastStatus, "ready");
        assetUrl = article.podcastUrl;
      } else {
        const { POST } = await import("../../app/api/social/video/idea/[id]/generate/route");
        const params = { params: Promise.resolve({ id: String(ideaId) }) };
        const denied = await POST(new NextRequest(`http://127.0.0.1/api/social/video/idea/${ideaId}/generate`, {
          method: "POST", headers: c.wrongTenantHeaders,
        }), params);
        assert.ok([403, 404].includes(denied.status));
        assert.equal(run.entry.calls.length, 0);
        evidence.tenantGenerationDenial = denied.status;
        const response = await POST(new NextRequest(`http://127.0.0.1/api/social/video/idea/${ideaId}/generate`, {
          method: "POST", headers: c.authHeaders,
        }), params);
        assert.equal(response.status, 200);
        const queued = await response.json();
        const { getQueue, VIDEO_IDEA_GENERATION_QUEUE } = await import("../../lib/queue");
        const job = await getQueue(VIDEO_IDEA_GENERATION_QUEUE).getJob(queued.jobId);
        assert.ok(job);
        const { processVideoIdeaGenerationJob } = await import("../../workers/video-idea-worker");
        const { generateVeoScript } = await import("../../lib/veo-script-generator");
        const { generateVeoClip } = await import("../../lib/veo-video-generator");
        const { generateVeoTTS } = await import("../../lib/veo-video-tts-generator");
        const dependencies = { ...c.videoIdeaDependencies, orchestrationDependencies: {
          ...c.videoIdeaDependencies.orchestrationDependencies,
          generateIdeaVideoScript: (input: any) => generateVeoScript({
            teamId, topic: input.ideaTitle ?? "Community solar", title: input.ideaTitle ?? "Community solar",
            location: "Fixture City", companyName: "Fixture Media Co", industry: "Sustainable energy",
            tone: "Authoritative", mood: "Optimistic",
          }),
          generateVideoFromScript: undefined,
          videoGenerationDeps: {
            generateTTS: (input: any) => generateVeoTTS({ ...input, tone: "Authoritative" }),
            generateClip: (input: any) => generateVeoClip({ ...input, resolution: "720p",
              maxPolls: 30, pollIntervalMs: offline ? 0 : 10000 }),
          },
        } };
        await c.runWithAuthenticatedTeamContext({ userId, teamId, role: "team_member" }, () =>
          processVideoIdeaGenerationJob(job!, dependencies));
        const [idea] = await db.select().from(s.videoIdeas).where(eq(s.videoIdeas.id, ideaId));
        assert.equal(idea.status, "READY");
        assetUrl = idea.videoUrl;
      }
      assert.match(assetUrl!, /^\/api\/public-objects\//);
      const { origin, server } = await c.startPublicObjectsHttpServer();
      c.setPublicServer(server);
      const retrieved = await fetch(`${origin}${assetUrl!}`, { headers: { authorization: `Bearer ${c.token}` } });
      assert.equal(retrieved.status, 200);
      assert.match(retrieved.headers.get("content-type") ?? "",
        stage === "podcast" ? /^audio\/(?:mpeg|mp3)\b/ : /^video\/mp4\b/);
      const bytes = Buffer.from(await retrieved.arrayBuffer());
      const name = stage === "podcast" ? "delivered-podcast.mp3" : "delivered-video.mp4";
      run.writeBytes(name, bytes);
      const objectPath = assetUrl!.replace(/^\/api\/public-objects\//, "").split("/").map(decodeURIComponent);
      const storageParts = ["public", "private"].includes(objectPath[0] ?? "") ? objectPath : ["public", ...objectPath];
      assert.deepEqual(bytes, await readFile(join(c.owned.root, "durable-media-objects", ...storageParts)));
      const denied = await fetch(`${origin}${assetUrl!}`, { headers: { authorization: `Bearer ${c.wrongTenantToken}` } });
      assert.ok([401, 403, 404].includes(denied.status));
      const anonymous = await fetch(`${origin}${assetUrl!}`);
      assert.ok([401, 403, 404].includes(anonymous.status), "unpublished outputs must not be anonymously accessible");
      evidence.retrieval = { status: 200, deniedStatus: denied.status, sha256: hash(bytes), bytes: bytes.length, assetUrl };
      if (stage === "video") {
        // A second idea owner in another tenant must not turn an exact URL
        // into an access grant, regardless of which row the database finds first.
        const beforeConflict = run.entry.calls.length;
        await db.update(s.videoIdeas).set({ teamId: c.wrongTeamId, videoUrl: assetUrl! })
          .where(eq(s.videoIdeas.id, c.likeIdeaId));
        const conflicted = await fetch(`${origin}${assetUrl!}`, { headers: c.authHeaders });
        const foreign = await fetch(`${origin}${assetUrl!}`, { headers: c.wrongTenantHeaders });
        assert.equal(conflicted.status, 404);
        assert.equal(foreign.status, 404);
        assert.equal(run.entry.calls.length, beforeConflict, "ownership probes cannot create paid calls");
        evidence.conflictingOwnerDenied = true;
      }
      const playback = await probeAndDecode(join(run.directory, name), stage === "podcast" ? "audio" : "video");
      if (stage === "podcast") assert.ok(playback.duration >= 60 && playback.duration <= 122);
      else assert.ok(playback.duration >= 55 && playback.duration <= 70);
      evidence.playback = playback;
      for (const call of run.entry.calls.filter((v: any) => v.kind === "clip")) {
        const clip = await probeAndDecode(join(run.directory, `call-${call.number}-native.mp4`), "video");
        const video = clip.streams.find((v: any) => v.codec_type === "video");
        assert.equal(video.width, 1280); assert.equal(video.height, 720);
        assert.ok(clip.duration >= 5.9 && clip.duration <= 6.2);
        run.writeEvidence(`call-${call.number}-playback.json`, clip);
      }
      const receipts = await db.select().from(s.providerAttemptReceipts).where(eq(s.providerAttemptReceipts.teamId, teamId));
      const usage = await db.select().from(s.providerUsageLedger).where(eq(s.providerUsageLedger.teamId, teamId));
      for (const call of run.entry.calls) {
        const receipt = receipts.find((r: any) => r.sourceEventId === call.sourceEventId);
        assert.equal(receipt?.status, "accounted");
        assert.equal(receipt.providerRequestId, call.providerRequestId);
        const rows = usage.filter((u: any) => u.sourceEventId === call.sourceEventId);
        assert.equal(rows.length, 1);
        assert.equal(Number(rows[0].costMicrousd), call.costMicrousd);
      }
      assert.equal(run.entry.calls.filter((v: any) => v.kind === "script").length, 1);
      if (stage === "video") assert.equal(run.entry.calls.filter((v: any) => v.kind === "clip").length, 10);
      const [reservation] = await db.select().from(s.creditReservations)
        .where(eq(s.creditReservations.teamId, teamId)).orderBy(desc(s.creditReservations.id)).limit(1);
      assert.equal(reservation.status, "DEBITED");
      evidence.accounting = { receipts, usage, reservation };
      run.writeEvidence("acceptance.json", evidence);
      passed = true;
    } finally {
      run.finish(passed, evidence);
    }
  });
}
