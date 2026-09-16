import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runnerSource = readFileSync("scripts/run-versioned-migrations.ts", "utf8");
const fileListSource = runnerSource.match(/const files = \[(.*?)\];/s)?.[1] ?? "";
const migrationFiles = [...fileListSource.matchAll(/"([^"]+\.sql)"/g)].map(
  ([, file]) => file,
);

test("MIGRATION_START_VERSION preserves exact-file resumes and numeric version-family order", () => {
  const exactStartVersion = "0034_provider_attempt_receipts.sql";
  const numericStartVersion = "0034";
  const selectFiles = (startVersion) =>
    migrationFiles.filter((file) => file.localeCompare(startVersion, "en") >= 0);

  assert.deepEqual(
    selectFiles(exactStartVersion),
    [
      "0034_provider_attempt_receipts.sql",
      "0035_provider_attempt_receipt_state_hardening.sql",
    ],
    "resuming at an exact migration filename intentionally starts at that file",
  );
  assert.deepEqual(
    migrationFiles.filter((file) => file.startsWith("0034_")),
    [
      "0034_agency_report_period_unique.sql",
      "0034_provider_attempt_receipts.sql",
    ],
    "the duplicate numeric version family must retain its checked-in order",
  );
  assert.deepEqual(
    selectFiles(numericStartVersion),
    [
      "0034_agency_report_period_unique.sql",
      "0034_provider_attempt_receipts.sql",
      "0035_provider_attempt_receipt_state_hardening.sql",
    ],
    "a numeric version start intentionally selects every migration in that family",
  );
  assert.match(
    runnerSource,
    /files\.filter\(\(file\) => file\.localeCompare\(startVersion, "en"\) >= 0\)/,
    "regression must exercise the current filename-based selector",
  );
  assert.match(
    runnerSource,
    /MIGRATION_START_VERSION/,
    "regression must stay tied to the versioned migration runner",
  );
});