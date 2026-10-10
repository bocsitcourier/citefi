import assert from "node:assert/strict";
import test from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import type { Pool } from "pg";
import {
  createLegacyInventory,
  createPrimaryInventory,
  loadStorageOwners,
} from "../lib/storage-inventory";
import { runStorageAudit } from "../lib/storage-audit";

test("loadStorageOwners includes durable owners and preserves canonical raw keys", async () => {
  let statement = "";
  const pool = {
    async query(sql: string) {
      statement = sql;
      return {
        rows: [
          {
            source: "article_assets.storage_url",
            record_id: "41",
            team_id: 7,
            url: "private/articles/41/image/literal?# name.webp",
            kind: "image",
          },
          {
            source: "campaign_exports.object_url",
            record_id: "9",
            team_id: 7,
            url: "/api/public-objects/private/exports/report.zip?download=1",
            kind: "unknown",
          },
        ],
      };
    },
  } as unknown as Pick<Pool, "query">;

  const owners = await loadStorageOwners(pool);

  assert.match(statement, /article_assets\.storage_url/);
  assert.match(statement, /article_assets aa LEFT JOIN articles/);
  assert.match(statement, /social_post_assets spa LEFT JOIN social_posts/);
  assert.match(statement, /campaign_exports\.object_url/);
  assert.match(statement, /audience_personas\.avatar_url/);
  assert.deepEqual(owners, [
    {
      source: "article_assets.storage_url",
      recordId: "41",
      teamId: 7,
      url: "/api/public-objects/private/articles/41/image/literal%3F%23%20name.webp",
      kind: "image",
    },
    {
      source: "campaign_exports.object_url",
      recordId: "9",
      teamId: 7,
      url: "/api/public-objects/private/exports/report.zip?download=1",
      kind: "unknown",
    },
  ]);
});

test("private error screenshot owner maps to its literal bucket key and missing is drift", async () => {
  const pool = {
    async query() {
      return {
        rows: [{
          source: "error_logs.screenshot_url",
          record_id: "73",
          team_id: null,
          url: "[private]error-screenshots/1700000000000-12.png",
          kind: "image",
        }],
      };
    },
  } as unknown as Pick<Pool, "query">;
  const owners = await loadStorageOwners(pool);

  assert.equal(
    owners[0]?.url,
    "/api/public-objects/.private/error-screenshots/1700000000000-12.png",
  );
  const report = await runStorageAudit({
    owners: async () => owners,
    primary: () => ({
      identity: {
        provider: "s3",
        endpoint: "primary",
        bucket: "bucket",
        prefix: "",
      },
      list: async () => [],
    }),
    legacy: () => ({
      identity: {
        provider: "replit-object-storage",
        endpoint: "legacy",
        bucket: "bucket",
        prefix: "",
      },
      list: async () => [{
        key: ".private/error-screenshots/1700000000000-12.png",
        size: 100,
      }],
    }),
  });

  assert.equal(report.status, "DRIFT");
  assert.equal(report.counts.invalidOwners, 0);
  assert.equal(report.counts.missingOwnedObjects, 1);
  assert.ok(report.issues.includes("MISSING_OWNED_OBJECTS"));
});

test("storage inventory adapters request and combine 500-key pages", async () => {
  const savedEnv = { ...process.env };
  const originalS3Send = S3Client.prototype.send;
  const originalS3Destroy = S3Client.prototype.destroy;
  const originalBucket = Storage.prototype.bucket;
  const s3Tokens: Array<string | undefined> = [];
  const legacyTokens: Array<string | undefined> = [];
  let destroyedClients = 0;
  try {
    Object.assign(process.env, {
      DO_SPACES_ENDPOINT: "https://inventory.example.invalid",
      DO_SPACES_BUCKET: "primary",
      DO_SPACES_KEY: "test-key",
      DO_SPACES_SECRET: "test-secret",
      STORAGE_PREFIX: "/tenant-media/",
      DEFAULT_OBJECT_STORAGE_BUCKET_ID: "legacy",
    });
    (S3Client.prototype as any).send = async (command: any) => {
      assert.equal(command.input.MaxKeys, 500);
      assert.equal(command.input.Prefix, "tenant-media/");
      s3Tokens.push(command.input.ContinuationToken);
      return command.input.ContinuationToken
        ? {
            IsTruncated: false,
            Contents: [{ Key: "tenant-media/private/two.mp4", Size: 22 }],
          }
        : {
            IsTruncated: true,
            NextContinuationToken: "s3-page-2",
            Contents: [{ Key: "tenant-media/public/one.webp", Size: 11 }],
          };
    };
    (S3Client.prototype as any).destroy = () => {
      destroyedClients++;
    };
    (Storage.prototype as any).bucket = () => ({
      getFiles: async (query: any) => {
        assert.equal(query.autoPaginate, false);
        assert.equal(query.maxResults, 500);
        assert.equal(query.fields, "items(name,size),nextPageToken");
        legacyTokens.push(query.pageToken);
        return query.pageToken
          ? [[{ name: "private/two.mp4", metadata: { size: "22" } }], null]
          : [[{ name: "public/one.webp", metadata: { size: "11" } }], { pageToken: "legacy-page-2" }];
      },
    });

    assert.deepEqual(await createPrimaryInventory().list(), [
      { key: "public/one.webp", size: 11 },
      { key: "private/two.mp4", size: 22 },
    ]);
    assert.deepEqual(await createLegacyInventory().list(), [
      { key: "public/one.webp", size: 11 },
      { key: "private/two.mp4", size: 22 },
    ]);
    assert.deepEqual(s3Tokens, [undefined, "s3-page-2"]);
    assert.deepEqual(legacyTokens, [undefined, "legacy-page-2"]);
    assert.equal(destroyedClients, 1);

    (S3Client.prototype as any).send = async () => ({
      IsTruncated: false,
      Contents: [{ Key: "another-tenant/private/leak.webp", Size: 1 }],
    });
    await assert.rejects(
      createPrimaryInventory().list(),
      /outside prefix tenant-media/,
    );
    assert.equal(destroyedClients, 2);
  } finally {
    S3Client.prototype.send = originalS3Send;
    S3Client.prototype.destroy = originalS3Destroy;
    Storage.prototype.bucket = originalBucket;
    process.env = savedEnv;
  }
});