import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAlertMessage, runStorageAudit, STORAGE_AUDIT_SAMPLE_LIMIT, type InventoryStore } from "../lib/storage-audit";
import type { StorageOwner } from "../lib/storage-migration";

const owner = (url: string): StorageOwner => ({
  source: "article_assets.storage_url", recordId: "private-record",
  teamId: 7, url, kind: "image",
});
const store = (keys: string[], provider: "s3" | "replit-object-storage" = "s3"): InventoryStore => ({
  identity: { provider, endpoint: "https://credential:secret@storage.invalid", bucket: "private-bucket", prefix: "" },
  list: async () => keys.map((key) => ({ key, size: 100 })),
});
const audit = (urls: string[], primary: string[], legacy: string[]) => runStorageAudit({
  owners: async () => urls.map(owner),
  primary: () => store(primary),
  legacy: () => store(legacy, "replit-object-storage"),
});

test("deduplicates owners and compares primary, not fallback availability", async () => {
  const report = await audit([
    "/api/public-objects/one.png",
    "https://app.invalid/api/public-objects/one.png?signature=credential",
    "/api/public-objects/two.mp4",
  ], ["public/one.png"], ["public/one.png", "public/two.mp4", "public/new-legacy.mp3"]);
  assert.equal(report.status, "DRIFT");
  assert.equal(report.counts.databaseOwners, 3);
  assert.equal(report.counts.referencedObjects, 2);
  assert.equal(report.counts.missingOwnedObjects, 1);
  assert.equal(report.counts.legacyOnlyObjects, 2);
  assert.equal(report.counts.orphanedLegacyObjects, 1);
  assert.match(auditAlertMessage(report)!, /missing owned objects 1; legacy-only objects 2/);
});

test("orphan counts are observational, never a deletion plan or failed parity", async () => {
  const report = await audit(["/api/public-objects/one.png"],
    ["public/one.png", "private/backup"], ["public/one.png", "private/backup"]);
  assert.equal(report.status, "PASS");
  assert.equal(report.counts.orphanedPrimaryObjects, 1);
  assert.equal(report.counts.orphanedLegacyObjects, 1);
  assert.equal(auditAlertMessage(report), null);
});

test("provider failures remain unknown, preserve independent primary checks, and redact errors", async () => {
  const report = await runStorageAudit({
    owners: async () => [owner("/api/public-objects/missing.png")],
    primary: () => store(["public/orphan"]),
    legacy: () => { throw new Error("https://credential:secret@storage.invalid?signature=credential"); },
  });
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.counts.missingOwnedObjects, 1);
  assert.equal(report.counts.legacyOnlyObjects, null);
  assert.equal(report.counts.orphanedLegacyObjects, null);
  assert.match(auditAlertMessage(report)!, /legacy unavailable/);
  assert.doesNotMatch(JSON.stringify(report), /secret|credential|https:/);
});

test("owner inventory failure cannot label all objects orphaned", async () => {
  const report = await runStorageAudit({
    owners: async () => { throw new Error("postgres://secret"); },
    primary: () => store(["public/one"]), legacy: () => store(["public/legacy-only"]),
  });
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.counts.orphanedPrimaryObjects, null);
  assert.equal(report.counts.orphanedLegacyObjects, null);
  assert.equal(report.counts.legacyOnlyObjects, 1);
});

test("primary failure does not manufacture missing owners or legacy-only writes", async () => {
  const report = await runStorageAudit({
    owners: async () => [owner("/api/public-objects/one")],
    primary: () => ({ ...store([]), list: async () => { throw new Error("secret"); } }),
    legacy: () => store(["public/one", "public/two"]),
  });
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.scopeId, null);
  assert.equal(report.counts.missingOwnedObjects, null);
  assert.equal(report.counts.legacyOnlyObjects, null);
  assert.equal(report.counts.orphanedLegacyObjects, 1);
});

test("signed relative URLs and encoded literal key characters are normalized safely", async () => {
  const report = await audit([
    "/api/public-objects/test.png?X-Amz-Signature=secret#fragment",
    "/api/public-objects/private/a%3Fb%23c",
    "/api/public-objects/%E0%A4%A",
  ], ["public/test.png", "private/a?b#c"], []);
  assert.equal(report.counts.missingOwnedObjects, 0);
  assert.equal(report.counts.invalidOwners, 1);
  assert.equal(report.status, "DRIFT");
});

test("inventory is read-only and output stays bounded and secret-free as inventories grow", async () => {
  const sensitiveKeys = Array.from({ length: 1000 }, (_, i) => `public/secret-${i}?signature=credential`);
  const report = await runStorageAudit({
    owners: async () => sensitiveKeys.map((key) => owner(`/api/public-objects/${encodeURIComponent(key)}`)),
    primary: () => store([]),
    legacy: () => store(sensitiveKeys),
  });
  assert.equal(report.counts.missingOwnedObjects, 1000);
  assert.equal(report.counts.legacyOnlyObjects, 1000);
  assert.equal(report.samples.missingOwnedObjects.length, STORAGE_AUDIT_SAMPLE_LIMIT);
  assert.equal(report.samples.legacyOnlyObjects.length, STORAGE_AUDIT_SAMPLE_LIMIT);
  assert.ok(report.samples.legacyOnlyObjects.every((key) => /^[a-f0-9]{64}$/.test(key)));
  assert.ok(JSON.stringify(report).length < 8_000);
  assert.doesNotMatch(JSON.stringify(report), /credential|secret|private-record|private-bucket|https:/);
});

test("hung inventory has a deadline and never reports parity passed", async () => {
  const report = await runStorageAudit({
    owners: async () => [],
    primary: () => store([]),
    legacy: () => ({ ...store([]), list: () => new Promise(() => {}) }),
    timeoutMs: 5,
  });
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.counts.legacyObjects, null);
});

test("scope fingerprints change with bucket identity, not object counts", async () => {
  const first = await audit([], [], []);
  const second = await audit([], ["public/new"], []);
  assert.equal(first.scopeId, second.scopeId);
  const moved = await runStorageAudit({
    owners: async () => [], legacy: () => store([], "replit-object-storage"),
    primary: () => ({ ...store([]), identity: { ...store([]).identity, bucket: "another" } }),
  });
  assert.notEqual(first.scopeId, moved.scopeId);
});