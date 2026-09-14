import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

void describe("batch title regeneration authentication failures", () => {
  void test("does not write a generation failure event before authentication completes", async () => {
    const source = await readFile(
      new URL("../../app/api/batches/[id]/regenerate-titles/route.ts", import.meta.url),
      "utf8",
    );
    const catchBlock = source.slice(source.indexOf("} catch (error: any)"));

    assert.match(
      catchBlock,
      /if \(authenticatedAuth\) \{\s*await runWithAuthenticatedTeamContext\(authenticatedAuth, recordFailure\);\s*\}/,
    );
    assert.doesNotMatch(
      catchBlock,
      /else \{\s*await recordFailure\(\);\s*\}/,
      "an unauthenticated request must not create a TITLE_POOL_REGENERATION_FAILED event",
    );
  });
});