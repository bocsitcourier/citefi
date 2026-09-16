import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const { createProviderAttemptObjectSpool } = await import(
  "../lib/provider-attempt-object-spool"
);

type FakeObject = {
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
};

class FakeFile {
  constructor(
    private readonly objects: Map<string, FakeObject>,
    private readonly key: string,
    private readonly events: Array<{ type: string; key: string }>,
  ) {}

  async save(
    data: Buffer,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<void> {
    this.events.push({ type: "save", key: this.key });
    this.objects.set(this.key, {
      body: Buffer.from(data),
      contentType: options?.contentType,
      metadata: options?.metadata,
    });
  }

  createReadStream(): NodeJS.ReadableStream {
    this.events.push({ type: "read", key: this.key });
    const object = this.objects.get(this.key);
    if (!object) {
      const error = Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" });
      return Readable.from(
        (async function* () {
          throw error;
        })(),
      );
    }
    return Readable.from([object.body]);
  }

  async delete(): Promise<void> {
    this.events.push({ type: "delete", key: this.key });
    this.objects.delete(this.key);
  }
}

function fakeStorage() {
  const objects = new Map<string, FakeObject>();
  const events: Array<{ type: string; key: string }> = [];
  return {
    objects,
    events,
    storage: {
      bucket: (_name: string) => ({
        file: (key: string) => new FakeFile(objects, key, events),
      }),
    },
  };
}

function record(sourceEventId = "provider-attempt:test-123") {
  return {
    spoolVersion: 1 as const,
    sourceEventId,
    teamId: 7,
    resourceType: "article",
    resourceId: "42",
    operationType: "article_generation",
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    attempt: 1,
    requestMetadata: {
      model: "gemini-2.5-flash",
      maxOutputTokens: 512,
      timeoutMs: 20_000,
    },
    status: "submitted" as const,
    preparedAt: new Date("2025-01-01T00:00:00.000Z"),
    submittedAt: new Date("2025-01-01T00:00:01.000Z"),
  };
}

function codecs() {
  return {
    serialize: (value: object) => JSON.stringify(value),
    parse: (value: unknown) => {
      if (!value || typeof value !== "object") {
        throw new Error("invalid receipt");
      }
      const parsed = value as ReturnType<typeof record> & {
        preparedAt: string;
        submittedAt?: string;
      };
      return {
        ...parsed,
        preparedAt: new Date(parsed.preparedAt),
        submittedAt: parsed.submittedAt
          ? new Date(parsed.submittedAt)
          : undefined,
      };
    },
  };
}

test("object spool writes and reads private receipt objects", async () => {
  const fixture = fakeStorage();
  const spool = createProviderAttemptObjectSpool({
    ...codecs(),
    storage: fixture.storage,
    bucketName: "shared-receipts",
  });
  const receipt = record();

  await spool.write(receipt);
  const keys = [...fixture.objects.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0]!, /^private\/provider-attempt-receipts\/provider-attempt:test-123\.json$/);
  assert.equal(fixture.objects.get(keys[0]!)?.contentType, "application/json");
  assert.equal(
    fixture.objects.get(keys[0]!)?.metadata?.cacheControl,
    "private, no-store",
  );
  assert.deepEqual(await spool.read(receipt.sourceEventId), receipt);
});

test("object spool treats missing objects as absent and surfaces parser failures", async () => {
  const fixture = fakeStorage();
  const spool = createProviderAttemptObjectSpool({
    ...codecs(),
    storage: fixture.storage,
  });

  assert.equal(await spool.read("provider-attempt:missing"), null);

  const malformedKey =
    "private/provider-attempt-receipts/provider-attempt:malformed.json";
  fixture.objects.set(malformedKey, {
    body: Buffer.from("{not-json", "utf8"),
  });
  await assert.rejects(
    spool.read("provider-attempt:malformed"),
    /invalid JSON/,
  );
});

test("object spool readiness probes write, read, and delete without public URLs", async () => {
  const fixture = fakeStorage();
  const spool = createProviderAttemptObjectSpool({
    ...codecs(),
    storage: fixture.storage,
    prefix: "private/receipt-probes",
  });

  await spool.ensureReady?.();
  assert.deepEqual(
    fixture.events.map((event) => event.type),
    ["save", "read", "delete"],
  );
  assert.equal(fixture.objects.size, 0);
  assert.ok(fixture.events.every((event) => event.key.startsWith("private/")));
  assert.ok(
    fixture.events.every(
      (event) =>
        !event.key.includes("http://") && !event.key.includes("https://"),
    ),
  );
});

test("object spool rejects public and traversal prefixes or source ids", async () => {
  const fixture = fakeStorage();
  assert.throws(
    () =>
      createProviderAttemptObjectSpool({
        ...codecs(),
        storage: fixture.storage,
        prefix: "public/receipts",
      }),
    /under private/,
  );

  const spool = createProviderAttemptObjectSpool({
    ...codecs(),
    storage: fixture.storage,
  });
  await assert.rejects(
    spool.write(record("provider-attempt:../escape")),
    /unsafe object key/,
  );
});