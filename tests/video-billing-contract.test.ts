import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const queueSource = readFileSync(new URL("../lib/queue.ts", import.meta.url), "utf8");
const ideaRouteSource = readFileSync(
  new URL("../app/api/social/video/idea/[id]/generate/route.ts", import.meta.url),
  "utf8"
);
const socialRouteSource = readFileSync(
  new URL("../app/api/social/video/generate/route.ts", import.meta.url),
  "utf8"
);
const likeRouteSource = readFileSync(
  new URL("../app/api/social/video/like/[id]/generate/route.ts", import.meta.url),
  "utf8"
);
const batchRouteSource = readFileSync(
  new URL("../app/api/social/video/batch/route.ts", import.meta.url),
  "utf8"
);
const ideaWorkerSource = readFileSync(
  new URL("../workers/video-idea-worker.ts", import.meta.url),
  "utf8"
);
const socialWorkerSource = readFileSync(
  new URL("../lib/worker.ts", import.meta.url),
  "utf8"
);
const recoverySource = readFileSync(
  new URL("../lib/job-recovery.ts", import.meta.url),
  "utf8"
);
const sweeperSource = readFileSync(
  new URL("../lib/reservation-sweeper.ts", import.meta.url),
  "utf8"
);

test("idea and social video jobs carry the original cap hold", () => {
  assert.match(queueSource, /export interface SocialVideoJobData[\s\S]*capReservationId\?: number \| null/);
  assert.match(queueSource, /export interface VideoIdeaJobData[\s\S]*capReservationId\?: number \| null/);
  assert.match(ideaRouteSource, /addVideoIdeaJob\([\s\S]*capReservationId/);
  assert.match(likeRouteSource, /addVideoIdeaJob\([\s\S]*capReservationId/);
  assert.match(socialRouteSource, /addVideoGenerationJob\([\s\S]*capReservationId/);
  assert.match(batchRouteSource, /addVideoGenerationJob\([\s\S]*capReservationId/);
  assert.match(batchRouteSource, /let queueAccepted = false/);
  assert.match(batchRouteSource, /if \(!queueAccepted && capReservationId !== null\)/);
  assert.match(recoverySource, /addVideoGenerationJob\([\s\S]*capReservationId: post\.videoCapReservationId/);
  assert.match(recoverySource, /videoCapReservationId: videoIdeas\.videoCapReservationId/);
  assert.match(recoverySource, /videoCapReservationId\?: number \| null/);
  assert.match(sweeperSource, /capReservationId\?: number \| null/);
  assert.match(sweeperSource, /addVideoIdeaJob\([\s\S]*capReservationId: recovery\.capReservationId/);
});

test("video delivery settles the original cap row and checkpoints before retry", () => {
  assert.match(ideaWorkerSource, /completeCapReservation/);
  assert.match(ideaWorkerSource, /capReservationSettlementJobId\(effectiveCapReservationId\)/);
  assert.match(ideaWorkerSource, /settlementOnly[\s\S]*idea\.videoBillingSettledAt/);
  assert.match(socialWorkerSource, /completeCapReservation/);
  assert.match(socialWorkerSource, /capReservationSettlementJobId\(capReservationId\)/);
  assert.match(socialWorkerSource, /payloadVideoCreditRunId \?\? durableVideoBilling\?\.videoCreditRunId/);
  assert.match(socialWorkerSource, /videoBillingSettledAt[\s\S]*return;/);
  assert.ok(
    socialWorkerSource.indexOf("!checkpoint.videoBillingSettledAt") <
      socialWorkerSource.indexOf('const { generateSocialVideo }'),
    "social READY settlement must be handled before provider imports"
  );
  assert.ok(
    ideaWorkerSource.indexOf("settlementOnly && idea.videoUrl") <
      ideaWorkerSource.indexOf("await (dependencies.orchestrate ?? orchestrateVideoIdeaGeneration)"),
    "idea READY settlement must be handled before orchestration"
  );

  // The video workers retain the old completed-event path only for jobs with
  // no cap hold (legacy/unlimited). A capped delivery must not add a second
  // completed usage event after its pending row is converted in place.
  assert.match(ideaWorkerSource, /if \(effectiveCapReservationId != null\)[\s\S]*else \{[\s\S]*recordUsageEvent/);
  assert.match(socialWorkerSource, /if \(capReservationId != null\)[\s\S]*else \{[\s\S]*recordUsageEvent/);
});