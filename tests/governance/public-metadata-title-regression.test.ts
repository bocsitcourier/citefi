import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public metadata preserves current agency/local-business positioning and human-controlled external action", () => {
  const layoutSource = readFileSync(
    new URL("../../app/layout.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    layoutSource,
    /local marketing campaign engine for agencies and local businesses/i,
    "current agency and local-business positioning must remain discoverable in public metadata",
  );
  assert.match(
    layoutSource,
    /grounded in business context, reviewable work, and clearly separated external action/i,
    "external action must remain clearly separated from generated work",
  );
  assert.doesNotMatch(
    layoutSource,
    /Create complete local marketing campaigns from one business URL/i,
    "the deferred one-URL campaign claim must not return to public metadata",
  );
});