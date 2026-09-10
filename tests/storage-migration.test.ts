import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateHistoricalMedia,
  isCertifiedStorageMigrationEvidence,
  objectKeyFromUrl,
  shouldDisableLegacyStorageReads,
  validateStorageMigrationEvidence,
  type MigrationStore,
} from "../lib/storage-migration";

function memoryStore(entries: Record<string, string>, writable = false): MigrationStore {
  const data = new Map(Object.entries(entries).map(([key, value]) => [key, Buffer.from(value)]));
  return {
    identity: {
      provider: "s3",
      endpoint: "https://primary.test",
      bucket: writable ? "primary" : "legacy",
      prefix: "",
    },
    async list() {
      return [...data].map(([key, body]) => ({ key, size: body.length }));
    },
    async read(key, range) {
      const body = data.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return range ? body.subarray(range.start, range.end + 1) : Buffer.from(body);
    },
    write: writable ? async (key, body) => { data.set(key, Buffer.from(body)); } : undefined,
  };
}

test("normalizes provider-neutral and absolute public object URLs", () => {
  assert.equal(objectKeyFromUrl("/api/public-objects/private/a.mp4"), "private/a.mp4");
  assert.equal(objectKeyFromUrl("https://app.test/api/public-objects/social-media/a.png"), "public/social-media/a.png");
  assert.equal(objectKeyFromUrl("../secret"), null);
});

test("inventory reports missing owners and orphaned legacy objects without deleting either", async () => {
  const report = await migrateHistoricalMedia({
    owners: [
      { source: "article_assets.storage_url", recordId: "1", teamId: 7, url: "/api/public-objects/private/owned.png", kind: "image" },
      { source: "articles.podcast_url", recordId: "2", teamId: 7, url: "/api/public-objects/private/missing.mp3", kind: "audio" },
    ],
    legacy: memoryStore({ "private/owned.png": "image", "private/orphan.bin": "orphan" }),
    primary: memoryStore({}),
    mode: "inventory",
  });
  assert.equal(report.inventory.missingObjects.length, 1);
  assert.deepEqual(report.inventory.orphanedLegacyObjects.map((item) => item.key), ["private/orphan.bin"]);
  assert.equal(report.objects.length, 2);
});

test("copy verifies SHA-256 and certification includes image, video range, and podcast reads", async () => {
  const owners = [
    { source: "article_assets.storage_url", recordId: "1", teamId: 1, url: "/api/public-objects/private/a.png", kind: "image" as const },
    { source: "social_posts.video_url", recordId: "2", teamId: 1, url: "/api/public-objects/private/v.mp4", kind: "video" as const },
    { source: "articles.podcast_url", recordId: "3", teamId: 1, url: "/api/public-objects/private/p.mp3", kind: "audio" as const },
  ];
  const report = await migrateHistoricalMedia({
    owners,
    legacy: memoryStore({
      "private/a.png": "image bytes",
      "private/v.mp4": "0123456789 video bytes",
      "private/p.mp3": "podcast bytes",
    }),
    primary: memoryStore({}, true),
    mode: "certify",
    now: () => new Date("2026-09-09T00:00:00.000Z"),
  });
  assert.equal(report.certificationStatus, "PASS");
  assert.equal(report.objects.every((item) => item.status === "COPIED_AND_VERIFIED"), true);
  assert.deepEqual(report.readChecks.map((item) => [item.kind, item.fullRead, item.byteRangeRead]), [
    ["image", "PASS", "NOT_APPLICABLE"],
    ["video", "PASS", "PASS"],
    ["audio", "PASS", "NOT_APPLICABLE"],
  ]);
  assert.equal(validateStorageMigrationEvidence(report), true);
  assert.equal(isCertifiedStorageMigrationEvidence(report), true);
  assert.equal(isCertifiedStorageMigrationEvidence(report, {
    provider: "s3", endpoint: "https://primary.test/", bucket: "primary", prefix: "",
  }), true);
  assert.equal(isCertifiedStorageMigrationEvidence(report, {
    provider: "s3", endpoint: "https://primary.test", bucket: "wrong", prefix: "",
  }), false);
  report.blockers.push("tampered");
  assert.equal(validateStorageMigrationEvidence(report), false);
  assert.equal(isCertifiedStorageMigrationEvidence(report), false);
});

test("certification fails when a referenced primary-only object is unreadable", async () => {
  const primary = memoryStore({ "private/p.mp3": "podcast bytes" }, true);
  primary.read = async () => { throw new Error("primary read failed"); };
  const report = await migrateHistoricalMedia({
    owners: [
      { source: "articles.podcast_url", recordId: "1", teamId: 1, url: "/api/public-objects/private/p.mp3", kind: "audio" },
    ],
    legacy: memoryStore({}),
    primary,
    mode: "certify",
  });
  assert.equal(report.certificationStatus, "FAIL");
  assert.equal(report.objects[0]?.status, "FAILED");
  assert.match(report.blockers.join(" "), /failed|No passing/);
  assert.equal(isCertifiedStorageMigrationEvidence(report, primary.identity), false);
});

test("cutover stays disabled when primary configuration is absent or destination differs", async () => {
  const primary = memoryStore({}, true);
  const report = await migrateHistoricalMedia({
    owners: [],
    legacy: memoryStore({}),
    primary,
    mode: "certify",
  });
  assert.equal(shouldDisableLegacyStorageReads({
    requested: true,
    isPrimaryConfigured: false,
    evidence: report,
    expectedPrimary: primary.identity,
  }), false);
  assert.equal(shouldDisableLegacyStorageReads({
    requested: true,
    isPrimaryConfigured: true,
    evidence: report,
    expectedPrimary: { ...primary.identity, bucket: "other" },
  }), false);
});