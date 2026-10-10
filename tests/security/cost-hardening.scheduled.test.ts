import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = readFileSync("lib/scheduled-content-worker.ts", "utf8");

describe("scheduled generation billing hardening", () => {
  test("keeps the cron claim serialized and reserves cap plus credits before provider calls", () => {
    assert.match(source, /systemDb\.transaction\(async \(tx\)/);
    assert.match(source, /\.for\("update", \{ skipLocked: true \}\)/);

    const capGate = source.indexOf("capReservationId = await checkUsageCap");
    const creditGate = source.indexOf("const creditReserve = await reserveCredits");
    const research = source.indexOf("smartResearch.researchTopic");
    const titleGeneration = source.indexOf("await generateTitlePool");
    assert.ok(capGate >= 0 && creditGate > capGate);
    assert.ok(research > creditGate, "research must not run before the billing gates");
    assert.ok(titleGeneration > creditGate, "title generation must not run before the billing gates");
    assert.match(source, /const maxBillableArticles = Math\.min\(schedule\.articlesPerRun, 50\)/);
    assert.match(source, /const maxReservedCredits = creditCostPerUnit \* maxBillableArticles/);
  });

  test("retains the deterministic schedule/run billing identity and shrinks short title pools safely", () => {
    assert.match(source, /const creditRunId = `scheduled:\$\{schedule\.id\}:\$\{run\.id\}`/);
    assert.match(source, /releaseKey: `scheduled-unused:\$\{run\.id\}`/);
    assert.match(source, /costEstimateCents: creditCostPerUnit \* selectedTitles\.length/);
    assert.match(source, /capReservationScope: "batch"/);
    assert.match(source, /creditRunId,\s*creditCostPerUnit,\s*capReservationId,/);
  });

  test("uncertain provider/accounting and enqueue outcomes preserve both holds", () => {
    assert.match(source, /isProviderAccountingError\(researchError\)[\s\S]*isProviderSubmissionUncertainError\(researchError\)[\s\S]*throw researchError/);
    assert.match(source, /BATCH_ENQUEUE_UNKNOWN/);
    assert.match(source, /queueSubmissionStarted && !\(error instanceof Error/);
    assert.match(source, /markReservationForReconciliation\(\{[\s\S]*runId: creditRunId/);
    assert.match(source, /if \(!queueAccepted && !providerOutcomeUncertain && !enqueueOutcomeUncertain[\s\S]*cancelCapReservation/);
    assert.match(source, /queueAccepted = true/);
    assert.match(source, /capReservationId=\$\{capReservationId \?\? "none"\}/);
  });
});
