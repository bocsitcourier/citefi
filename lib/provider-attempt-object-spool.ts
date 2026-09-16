/**
 * Object-storage fallback for provider-attempt receipts.
 *
 * This module deliberately imports the receipt contract as types only.  The
 * receipt core can therefore select this fallback without creating a runtime
 * dependency cycle.  Serialization and validation remain owned by the core:
 * callers must provide the core's strict serializer/parser functions.
 */
import { randomUUID } from "node:crypto";

import {
  isStorageConfigured,
  objectStorageClient,
} from "./storage";
import type {
  ProviderAttemptReceiptSpool,
  ReceiptSpoolRecord,
} from "./provider-attempt-receipts";

const DEFAULT_PREFIX = "private/provider-attempt-receipts";
const PROBE_CONTENT = "provider-attempt-spool-ready\n";

export interface ProviderAttemptObjectStorageFile {
  save(
    data: Buffer,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<void>;
  createReadStream(): NodeJS.ReadableStream;
  delete(): Promise<void>;
}

export interface ProviderAttemptObjectStorageBucket {
  file(key: string): ProviderAttemptObjectStorageFile;
}

export interface ProviderAttemptObjectStorage {
  bucket(name: string): ProviderAttemptObjectStorageBucket;
}

export interface ProviderAttemptObjectSpoolOptions {
  /**
   * Strictly allow-listed core serializer. It must not include customer
   * content, credentials, prompts, or provider payloads.
   */
  serialize: (record: ReceiptSpoolRecord) => string;
  /**
   * Strictly validating core parser. It receives only parsed JSON from the
   * private object and must reject malformed or unsafe records.
   */
  parse: (value: unknown) => ReceiptSpoolRecord;
  /**
   * Optional injection point for tests. Production uses the DO Spaces-backed
   * objectStorageClient from storage.ts.
   */
  storage?: ProviderAttemptObjectStorage;
  bucketName?: string;
  /**
   * Must remain under private/. A custom private subdirectory is useful for
   * tests and isolated deployments, but public object paths are forbidden.
   */
  prefix?: string;
}

function normalizePrefix(prefix: string | undefined): string {
  const value = (prefix ?? DEFAULT_PREFIX)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!value || value === "private" || !value.startsWith("private/")) {
    throw new Error("provider attempt object spool prefix must be under private/");
  }
  if (value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("provider attempt object spool prefix contains an unsafe path segment");
  }
  return value;
}

function safeSourceEventId(sourceEventId: string): string {
  if (
    !sourceEventId ||
    sourceEventId.length > 255 ||
    sourceEventId.includes("/") ||
    sourceEventId.includes("\\") ||
    sourceEventId.includes("..") ||
    !/^[A-Za-z0-9:_-]+$/.test(sourceEventId)
  ) {
    throw new Error("provider attempt sourceEventId contains an unsafe object key");
  }
  return sourceEventId;
}

function objectKey(prefix: string, sourceEventId: string): string {
  return `${prefix}/${safeSourceEventId(sourceEventId)}.json`;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.once("error", reject);
  });
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const code = String(candidate.code ?? "").toLowerCase();
  if (
    code === "enoent" ||
    code === "nosuchkey" ||
    code === "notfound" ||
    code === "not_found"
  ) {
    return true;
  }
  if (candidate.statusCode === 404 || candidate.status === 404) return true;
  const message = String(candidate.message ?? "").toLowerCase();
  return (
    message.includes("no such key") ||
    message.includes("not found") ||
    message.includes("nosuchkey")
  );
}

function configuredProductionStorage(): ProviderAttemptObjectStorage {
  if (!isStorageConfigured) {
    throw new Error(
      "provider attempt object spool requires configured DO Spaces storage",
    );
  }
  return objectStorageClient as unknown as ProviderAttemptObjectStorage;
}

/**
 * Build a shared object-storage receipt spool. Objects are always written
 * below private/ and are never converted into public URLs.
 */
export function createProviderAttemptObjectSpool(
  options: ProviderAttemptObjectSpoolOptions,
): ProviderAttemptReceiptSpool {
  const prefix = normalizePrefix(options.prefix);
  const storage = options.storage ?? configuredProductionStorage();
  const bucketName =
    options.bucketName ??
    process.env.DO_SPACES_BUCKET ??
    "";

  function fileFor(sourceEventId: string): ProviderAttemptObjectStorageFile {
    return storage.bucket(bucketName).file(objectKey(prefix, sourceEventId));
  }

  return {
    async ensureReady(): Promise<void> {
      const probeKey = `${prefix}/.probe-${randomUUID()}.txt`;
      const probe = storage.bucket(bucketName).file(probeKey);
      try {
        await probe.save(Buffer.from(PROBE_CONTENT, "utf8"), {
          contentType: "text/plain",
          metadata: { cacheControl: "private, no-store" },
        });
        const readBack = await streamToBuffer(probe.createReadStream());
        if (!readBack.equals(Buffer.from(PROBE_CONTENT, "utf8"))) {
          throw new Error("provider attempt object spool readiness probe mismatch");
        }
      } finally {
        await probe.delete();
      }
    },

    async write(record: ReceiptSpoolRecord): Promise<void> {
      const serialized = options.serialize(record);
      if (typeof serialized !== "string") {
        throw new Error("provider attempt object spool serializer must return a string");
      }
      await fileFor(record.sourceEventId).save(Buffer.from(serialized, "utf8"), {
        contentType: "application/json",
        metadata: { cacheControl: "private, no-store" },
      });
    },

    async read(sourceEventId: string): Promise<ReceiptSpoolRecord | null> {
      const file = fileFor(sourceEventId);
      try {
        const serialized = await streamToBuffer(file.createReadStream());
        let parsed: unknown;
        try {
          parsed = JSON.parse(serialized.toString("utf8"));
        } catch (error) {
          throw new Error(
            "provider attempt object spool contained invalid JSON",
            { cause: error },
          );
        }
        return options.parse(parsed);
      } catch (error) {
        if (isMissingObjectError(error)) return null;
        throw error;
      }
    },
  };
}

/** Explicit alias for callers that name the backing provider in their wiring. */
export const createObjectStorageProviderAttemptSpool =
  createProviderAttemptObjectSpool;