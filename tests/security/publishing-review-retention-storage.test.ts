import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Unusable offline sentinels, set before module import. The offline harness
// also blocks networking and supplies a dead fixture database URL.
process.env.DO_SPACES_KEY = "qa-offline-review-key";
process.env.DO_SPACES_SECRET = "qa-offline-review-secret";
process.env.DO_SPACES_ENDPOINT = "https://storage.invalid";
process.env.DO_SPACES_BUCKET = "qa-review-bucket";
process.env.STORAGE_PREFIX = "qa-owned/retention";
process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "";
const {
  inventoryPublishingReviewCopies, deletePublishingReviewCopy, deleteFromStorage, objectStorageClient,
} = await import("../../lib/storage");
const key = `private/publishing-reviewed/1/${"b".repeat(64)}.png`;
const etag = `"${"c".repeat(32)}"`;
const date = new Date("2026-09-01T00:00:00.000Z");
const copy = { key, etag, size: 10, lastModified: date.toISOString() };
const originalSend = S3Client.prototype.send;
let handler: (command: any) => Promise<any> = async () => { throw new Error("Unexpected storage call"); };
S3Client.prototype.send = (async function(command: any) { return handler(command); }) as typeof originalSend;
after(() => { S3Client.prototype.send = originalSend; });

test("primary inventory paginates the exact prefixed namespace and strips only configured prefix", async () => {
  let pages = 0;
  handler = async command => {
    assert.ok(command instanceof ListObjectsV2Command);
    assert.equal(command.input.Bucket, "qa-review-bucket");
    assert.equal(command.input.Prefix, "qa-owned/retention/private/publishing-reviewed/");
    assert.equal(command.input.ContinuationToken, pages === 0 ? undefined : "page-two");
    pages++;
    return pages === 1 ? { IsTruncated: true, NextContinuationToken: "page-two", Contents: [
      { Key: `qa-owned/retention/${key}`, Size: 10, ETag: etag, LastModified: date },
    ] } : { IsTruncated: false, Contents: [] };
  };
  assert.deepEqual(await inventoryPublishingReviewCopies(), [copy]);
  assert.equal(pages, 2);
});

test("incomplete pagination and storage inventory failures never return a partial orphan list", async () => {
  handler = async () => ({ IsTruncated: true, Contents: [] });
  await assert.rejects(inventoryPublishingReviewCopies(), /Incomplete inventory pagination/);
  handler = async () => { throw new Error("Inventory unavailable"); };
  await assert.rejects(inventoryPublishingReviewCopies(), /Inventory unavailable/);
});

test("review deletion checks current metadata then sends exact If-Match without legacy fallback", async () => {
  const calls: string[] = [];
  handler = async command => {
    assert.equal(command.input.Bucket, "qa-review-bucket");
    assert.equal(command.input.Key, `qa-owned/retention/${key}`);
    if (command instanceof HeadObjectCommand) {
      calls.push("HEAD");
      return { ETag: etag, ContentLength: 10, LastModified: date };
    }
    assert.ok(command instanceof DeleteObjectCommand);
    assert.equal(command.input.IfMatch, etag);
    calls.push("DELETE");
    return {};
  };
  await deletePublishingReviewCopy(copy);
  assert.deepEqual(calls, ["HEAD", "DELETE"]);
});

test("changed metadata, unsafe keys and wildcard ETags prevent deletion", async () => {
  for (const metadata of [
    { ETag: '"changed"', ContentLength: 10, LastModified: date },
    { ETag: etag, ContentLength: 11, LastModified: date },
    { ETag: etag, ContentLength: 10, LastModified: new Date("2026-09-02T00:00:00Z") },
  ]) {
    handler = async command => { assert.ok(command instanceof HeadObjectCommand); return metadata; };
    await assert.rejects(deletePublishingReviewCopy(copy), /object changed/);
  }
  handler = async () => { assert.fail("Invalid input must not reach storage"); };
  await assert.rejects(deletePublishingReviewCopy({ ...copy, key: "private/articles/1/foo.png" }));
  await assert.rejects(deletePublishingReviewCopy({ ...copy, etag: "*" }));
});

test("conditional delete failures propagate and never retry unconditionally", async () => {
  let deletes = 0;
  handler = async command => {
    if (command instanceof HeadObjectCommand) return { ETag: etag, ContentLength: 10, LastModified: date };
    assert.ok(command instanceof DeleteObjectCommand);
    deletes++;
    throw Object.assign(new Error("Precondition failed"), { $metadata: { httpStatusCode: 412 } });
  };
  await assert.rejects(deletePublishingReviewCopy(copy), /Precondition failed/);
  assert.equal(deletes, 1);
});

test("generic deletion and the bucket shim cannot bypass reserved namespace governance", async () => {
  handler = async () => { assert.fail("Generic cleanup must never reach storage"); };
  await assert.rejects(deleteFromStorage(`/api/public-objects/${key}`), /governed retention/);
  await assert.rejects(objectStorageClient.bucket("ignored").file(key).delete(), /governed retention/);
});
