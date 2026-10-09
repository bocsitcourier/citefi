import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, desc } from "drizzle-orm";
import { NextRequest } from "next/server";
import { EVIDENCE_ROOT, hash } from "../../QA/support/selected-media-plan.mjs";
import { reserveVideoRecoveryRun } from "../../QA/support/video-recovery-run.mjs";
import { loadRecoverySources } from "../../QA/support/video-recovery-plan.mjs";
import { probeAndDecode, seedOwnedRates, fixtureTransport } from "./selected-media-acceptance";

export function registerVideoRecoveryAcceptance(c: any) {
  if (!process.env.VIDEO_RECOVERY_QA) return;
  test("video recovery: sealed source reuse, ordered single-flight clips, route and playback", async () => {
    const offline = process.env.SELECTED_MEDIA_OFFLINE === "1";
    const source = loadRecoverySources();
    const root = offline ? join(c.owned.root, "isolated-video-recovery") : EVIDENCE_ROOT;
    if (offline) {
      await mkdir(root);
      for (const file of ["budget-baseline.json", "budget-ledger.json", "budget.lock"]) {
        await cp(join(EVIDENCE_ROOT, file), join(root, file));
      }
    }
    const parentProof = offline ? { runId: source.inventory.originalRunId, simulated: true,
      controllerTerminated: true, ownedProcessTreeStopped: true, matchingProcessesAbsent: true } :
      JSON.parse(await readFile(join(root, "video-recovery-parent-termination.json"), "utf8"));
    const { currentProviderAttempt } = await import("../../lib/provider-attempt-receipts");
    const { generateVeoClip, uploadVeoVideo } = await import("../../lib/veo-video-generator");
    const { optimizeVeoPrompt } = await import("../../lib/veo-social-video-generator");
    const { sanitizeVeoPrompt } = await import("../../types/video-schema");
    c.setReceiptGetter(() => currentProviderAttempt()?.receipt);
    if (offline) c.setFixtureFetch(await fixtureTransport(c, "video"));
    await seedOwnedRates(c, process.env.SELECTED_MEDIA_RUN_ID!);
    const prompts: Record<number, string> = {};
    const optimized: Record<number, string> = {};
    for (const clip of source.script.clips) {
      optimized[clip.sceneNumber] = optimizeVeoPrompt(clip.prompt,
        clip.sceneNumber <= 3 ? "hook" : clip.sceneNumber <= 7 ? "solution" : "cta");
      prompts[clip.sceneNumber] = sanitizeVeoPrompt(optimized[clip.sceneNumber]!);
    }
    const phases = process.env.VIDEO_RECOVERY_QA === "both" ? ["pilot", "completion"] : [process.env.VIDEO_RECOVERY_QA!];
    let pilotClip: any;
    for (const [phaseIndex, phase] of phases.entries()) {
      const id = `${process.env.SELECTED_MEDIA_RUN_ID}-${phase}`;
      const run: any = reserveVideoRecoveryRun(phase, id, { root, offline, parentProof,
        startedAt: phaseIndex === 0 ? Number(process.env.VIDEO_RECOVERY_STARTED_AT || Date.now()) : Date.now() });
      Object.defineProperty(run, "frozenPrompts", { value: Object.freeze(prompts) });
      Object.defineProperty(run, "ownedTeamId", { value: c.teamId });
      c.setRun(run);
      let passed = false;
      const evidence: any = { offline, certification: "NOT CERTIFIED", sourceInventorySha256: source.inventorySha256,
        historicalScriptSpeechMicrousd: 46806, historicalCostsChargedAgain: false,
        customerDatabaseAccessed: false, originalHoldReleased: false,
        storageBoundary: "owned durable filesystem, NOT cloud storage" };
      try {
        const { schema: s, systemDb: db, teamId, userId, ideaId } = c;
        // Queue and ownership acceptance use the same real production route for both phases.
        const { POST } = await import("../../app/api/social/video/idea/[id]/generate/route");
        const params = { params: Promise.resolve({ id: String(ideaId) }) };
        const makeRequest = (headers: any) => new NextRequest(`http://127.0.0.1/api/social/video/idea/${ideaId}/generate`, {
          method: "POST", headers });
        const denial = await POST(makeRequest(c.wrongTenantHeaders), params);
        assert.ok([403, 404].includes(denial.status)); assert.equal(run.entry.calls.length, 0);
        evidence.tenantGenerationDenial = denial.status;
        const response = await POST(makeRequest(c.authHeaders), params);
        assert.equal(response.status, 200);
        const { getQueue, VIDEO_IDEA_GENERATION_QUEUE } = await import("../../lib/queue");
        const job = await getQueue(VIDEO_IDEA_GENERATION_QUEUE).getJob((await response.json()).jobId);
        assert.ok(job);
        const reservations = await db.select().from(s.creditReservations)
          .where(eq(s.creditReservations.teamId, teamId)).orderBy(desc(s.creditReservations.id)).limit(1);
        assert.equal(reservations[0].status, "RESERVED");
        const generate = async (input: any) => {
          assert.equal(input.attempt ?? 1, 1, "retry attempts are denied before transport");
          assert.equal(input.prompt, optimized[input.sceneNumber]);
          const clip = await generateVeoClip({ ...input, resolution: "720p", maxPolls: 30, pollIntervalMs: offline ? 0 : 10000 });
          const call = run.entry.calls.at(-1);
          const probe = await probeAndDecode(clip.localPath, "video");
          const video = probe.streams.find((s: any) => s.codec_type === "video");
          const rows = await db.select().from(s.providerUsageLedger).where(eq(s.providerUsageLedger.sourceEventId, call.sourceEventId));
          const receipts = await db.select().from(s.providerAttemptReceipts).where(eq(s.providerAttemptReceipts.sourceEventId, call.sourceEventId));
          assert.equal(rows.length, 1); assert.equal(receipts.length, 1);
          run.acceptClip(call, { ...probe, width: video.width, height: video.height }, {
            sourceEventId: call.sourceEventId, costMicrousd: Number(rows[0].costMicrousd),
            status: receipts[0].status, creditReservationId: reservations[0].id });
          return clip;
        };
        let assetUrl: string;
        await c.runWithAuthenticatedTeamContext({ userId, teamId, role: "team_member" }, async () => {
          if (phase === "pilot") {
            pilotClip = await generate({ teamId, socialPostId: ideaId, resourceType: "video_idea",
              resourceId: ideaId, sceneNumber: 1, duration: 6, prompt: optimized[1],
              attemptKey: "veo-idea-video:scene-1", invocationKey: id });
            assetUrl = await uploadVeoVideo(pilotClip.localPath, ideaId);
            await db.update(s.videoIdeas).set({ videoUrl: assetUrl, status: "READY" }).where(eq(s.videoIdeas.id, ideaId));
            evidence.rawClipDiagnosticOnly = true;
          } else {
            const pilot = run.pilot;
            const pilotPath = join(root, pilot.runId, "call-1-native.mp4");
            assert.equal(hash(await readFile(pilotPath)), pilot.calls[0].nativeSha256);
            pilotClip = { sceneNumber: 1, targetDuration: 6, prompt: optimized[1], localPath: pilotPath };
            const audioPath = join(c.owned.root, "reused-native-narration.mp3");
            await cp(source.audioPath, audioPath);
            assert.equal(hash(await readFile(audioPath)), source.inventory.speech.nativeSha256);
            let tail = Promise.resolve<any>(null);
            const { processVideoIdeaGenerationJob } = await import("../../workers/video-idea-worker");
            await processVideoIdeaGenerationJob(job, {
              ...c.videoIdeaDependencies, orchestrationDependencies: {
                ...c.videoIdeaDependencies.orchestrationDependencies,
                generateIdeaVideoScript: async () => structuredClone(source.script),
                generateVideoFromScript: undefined,
                videoGenerationDeps: {
                  generateTTS: async () => ({ localPath: audioPath, audioUrl: "", duration: 79.584, voice: "retained-native" }),
                  generateClip: (input: any) => {
                    if (input.sceneNumber === 1) return Promise.resolve(pilotClip);
                    // The production orchestrator remains unchanged; this recovery seam
                    // serializes its parallel requests and rejects all remaining work on failure.
                    tail = tail.then(() => generate(input));
                    return tail;
                  },
                },
              },
            });
            const [idea] = await db.select().from(s.videoIdeas).where(eq(s.videoIdeas.id, ideaId));
            assert.equal(idea.status, "READY"); assetUrl = idea.videoUrl;
            const [credit] = await db.select().from(s.creditReservations).where(eq(s.creditReservations.id, reservations[0].id));
            assert.equal(credit.status, "DEBITED"); evidence.credit = credit;
            evidence.inheritedPilotCostChargedAgain = false;
          }
        });
        const { origin, server } = await c.startPublicObjectsHttpServer(); c.setPublicServer(server);
        const delivered = await fetch(`${origin}${assetUrl!}`, { headers: c.authHeaders });
        assert.equal(delivered.status, 200);
        const bytes = Buffer.from(await delivered.arrayBuffer()); run.writeBytes("delivered-video.mp4", bytes);
        const objectParts = assetUrl!.replace(/^\/api\/public-objects\//, "").split("/").map(decodeURIComponent);
        const storageParts = ["public", "private"].includes(objectParts[0] ?? "") ? objectParts : ["public", ...objectParts];
        assert.deepEqual(bytes, await readFile(join(c.owned.root, "durable-media-objects", ...storageParts)));
        const denialGet = await fetch(`${origin}${assetUrl!}`, { headers: c.wrongTenantHeaders });
        const anonymous = await fetch(`${origin}${assetUrl!}`);
        assert.ok([401, 403, 404].includes(denialGet.status)); assert.ok([401, 403, 404].includes(anonymous.status));
        evidence.retrieval = { sha256: hash(bytes), bytes: bytes.length, deniedStatus: denialGet.status, anonymousStatus: anonymous.status };
        evidence.playback = await probeAndDecode(join(run.directory, "delivered-video.mp4"), "video");
        if (phase === "completion") {
          assert.ok(evidence.playback.duration >= 55 && evidence.playback.duration <= 60);
          evidence.completeNarration = { sourceSha256: source.inventory.speech.nativeSha256,
            sourceDuration: 79.584, localTempo: 79.584 / evidence.playback.duration,
            maximumTempo: 1.5, sourceRegenerated: false, sourceTruncated: false };
          assert.ok(evidence.completeNarration.localTempo <= 1.5);
          await db.update(s.videoIdeas).set({ teamId: c.wrongTeamId, videoUrl: assetUrl! }).where(eq(s.videoIdeas.id, c.likeIdeaId));
          for (const headers of [c.authHeaders, c.wrongTenantHeaders]) {
            assert.equal((await fetch(`${origin}${assetUrl!}`, { headers })).status, 404);
          }
          evidence.conflictingOwnerDenied = true;
        }
        assert.deepEqual(run.entry.calls.map((call: any) => call.scene), phase === "pilot" ? [1] : [2,3,4,5,6,7,8,9,10]);
        evidence.calls = run.entry.calls; run.writeEvidence("acceptance.json", evidence); passed = true;
        // Close the phase's public HTTP server before creating another phase.
        await new Promise<void>(resolve => server.close(() => resolve()));
      } finally {
        if (!passed) run.stop("Recovery phase acceptance failed; no next phase");
        await c.exportEvidence();
        assert.equal(run.finish(passed, evidence), passed);
        // Retain post-export settlement/outcome files before switching the
        // selected run or allowing the owned temporary root to be deleted.
        await c.exportEvidence();
      }
    }
    assert.equal(hash(await readFile(join(root, "budget.lock"))), source.inventory.originalLockSha256);
  });
}
