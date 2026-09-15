import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * This is intentionally a source-level route contract.  It does not touch a
 * live team, enqueue a provider job, or mutate billing fixtures.  The actual
 * route must keep its billing handoff intact because the worker owns final
 * debit/settlement.
 */
void test("batch requeue owns a fresh retry reservation and hands it to the worker", async () => {
  const source = await readFile(
    new URL("../../app/api/batches/[id]/requeue/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /X-Idempotency-Key/);
  assert.match(
    source,
    /creditRunId = `article-requeue:\$\{batchId\}:\$\{articleId\}:\$\{requestKey\}`/,
    "each batch retry needs an article-scoped billing owner",
  );
  assert.match(
    source,
    /checkUsageCap\([\s\S]*?reserveCredits\([\s\S]*?addArticleJob\(/,
    "cap and credit gates must precede queue admission",
  );
  assert.match(
    source,
    /creditRunId,[\s\S]*creditCostPerUnit: creditCost,[\s\S]*capReservationId/,
    "the queue payload must carry the retry billing metadata used by the worker",
  );
  assert.match(
    source,
    /existingReservation[\s\S]*findArticleGenerationJob\(runId\)[\s\S]*succeeded\.push\(articleId\)/,
    "an idempotent replay must acknowledge the existing attempt instead of reserving again",
  );
  assert.match(
    source,
    /ArticleEnqueueUncertainError[\s\S]*markReservationForReconciliation/,
    "ambiguous queue acceptance must keep the retry hold for reconciliation",
  );
  assert.doesNotMatch(
    source,
    /releaseReservation\(\{[\s\S]*runId:\s*batch(?:[A-Za-z]|:)/i,
    "requeue cleanup must never release the original batch reservation",
  );
});