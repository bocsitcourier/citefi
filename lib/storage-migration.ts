import { createHash } from "node:crypto";

export type MediaKind = "image" | "video" | "audio" | "unknown";

export interface StorageOwner {
  source: string;
  recordId: string;
  teamId: number | null;
  url: string;
  kind: MediaKind;
}

export interface StoredObject {
  key: string;
  size: number;
}

export interface StorageIdentity {
  provider: "replit-object-storage" | "s3";
  endpoint: string;
  bucket: string;
  prefix: string;
}

export interface MigrationStore {
  identity: StorageIdentity;
  list(): Promise<StoredObject[]>;
  read(key: string, range?: { start: number; end: number }): Promise<Buffer>;
  write?(key: string, body: Buffer, contentType?: string): Promise<void>;
}

export interface ObjectMigrationResult {
  key: string;
  owners: Array<Pick<StorageOwner, "source" | "recordId" | "teamId" | "kind">>;
  sourceSize: number;
  sourceSha256: string | null;
  primarySize: number | null;
  primarySha256: string | null;
  status: "VERIFIED" | "COPIED_AND_VERIFIED" | "DRY_RUN" | "FAILED";
  error?: string;
}

export interface StorageMigrationEvidence {
  schemaVersion: "1.1";
  kind: "media-storage-migration-evidence";
  storage: { source: StorageIdentity; primary: StorageIdentity };
  mode: "inventory" | "copy" | "certify";
  certificationStatus: "PASS" | "FAIL" | "NOT_REQUESTED";
  startedAt: string;
  finishedAt: string;
  inventory: {
    databaseOwnerCount: number;
    referencedObjectCount: number;
    legacyObjectCount: number;
    primaryObjectCountBefore: number;
    missingObjects: StorageOwner[];
    orphanedLegacyObjects: StoredObject[];
  };
  objects: ObjectMigrationResult[];
  readChecks: Array<{
    kind: MediaKind;
    key: string;
    fullRead: "PASS" | "FAIL";
    byteRangeRead: "PASS" | "FAIL" | "NOT_APPLICABLE";
    error?: string;
  }>;
  blockers: string[];
  evidenceSha256: string;
}

export function objectKeyFromUrl(url: string): string | null {
  if (!url) return null;
  let pathname = url;
  try {
    if (/^https?:\/\//i.test(url)) pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const marker = "/api/public-objects/";
  const markerAt = pathname.indexOf(marker);
  if (markerAt >= 0) pathname = pathname.slice(markerAt + marker.length);
  else pathname = pathname.replace(/^\/+/, "");
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!pathname || pathname.includes("..") || pathname.includes("\\")) return null;
  return pathname.startsWith("private/") || pathname.startsWith("public/")
    ? pathname
    : `public/${pathname}`;
}

function digest(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function mimeFor(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase();
  return ({
    webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", mp4: "video/mp4", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function withoutEvidenceHash(report: Omit<StorageMigrationEvidence, "evidenceSha256">): string {
  return digest(Buffer.from(JSON.stringify(report)));
}

function isStorageIdentity(value: unknown): value is StorageIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as StorageIdentity;
  return ["replit-object-storage", "s3"].includes(identity.provider) &&
    typeof identity.endpoint === "string" &&
    typeof identity.bucket === "string" &&
    typeof identity.prefix === "string";
}

async function forEachConcurrent<T>(
  values: T[],
  concurrency: number,
  visit: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        await visit(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
}

export function validateStorageMigrationEvidence(value: unknown): value is StorageMigrationEvidence {
  if (!value || typeof value !== "object") return false;
  const report = value as StorageMigrationEvidence;
  if (
    report.schemaVersion !== "1.1" ||
    report.kind !== "media-storage-migration-evidence" ||
    !isStorageIdentity(report.storage?.source) ||
    !isStorageIdentity(report.storage?.primary) ||
    !["inventory", "copy", "certify"].includes(report.mode) ||
    !["PASS", "FAIL", "NOT_REQUESTED"].includes(report.certificationStatus) ||
    !Array.isArray(report.objects) ||
    !Array.isArray(report.blockers) ||
    !/^[a-f0-9]{64}$/.test(report.evidenceSha256 ?? "")
  ) return false;
  const { evidenceSha256, ...unsigned } = report;
  return withoutEvidenceHash(unsigned) === evidenceSha256;
}

function sameIdentity(left: StorageIdentity, right: StorageIdentity): boolean {
  const endpoint = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  const prefix = (value: string) => value.trim().replace(/^\/+|\/+$/g, "");
  return left.provider === right.provider &&
    endpoint(left.endpoint) === endpoint(right.endpoint) &&
    left.bucket === right.bucket &&
    prefix(left.prefix) === prefix(right.prefix);
}

export function isCertifiedStorageMigrationEvidence(
  value: unknown,
  expectedPrimary?: StorageIdentity,
): value is StorageMigrationEvidence {
  return validateStorageMigrationEvidence(value) &&
    (!expectedPrimary || sameIdentity(value.storage.primary, expectedPrimary)) &&
    value.mode === "certify" &&
    value.certificationStatus === "PASS" &&
    value.blockers.length === 0 &&
    value.inventory.missingObjects.length === 0 &&
    value.objects.every((object) =>
      object.status === "VERIFIED" || object.status === "COPIED_AND_VERIFIED"
    ) &&
    value.readChecks.every((check) =>
      check.fullRead === "PASS" && check.byteRangeRead !== "FAIL"
    );
}

export function shouldDisableLegacyStorageReads(options: {
  requested: boolean;
  isPrimaryConfigured: boolean;
  evidence: unknown;
  expectedPrimary: StorageIdentity;
}): boolean {
  return options.requested &&
    options.isPrimaryConfigured &&
    isCertifiedStorageMigrationEvidence(options.evidence, options.expectedPrimary);
}

export async function migrateHistoricalMedia(options: {
  owners: StorageOwner[];
  legacy: MigrationStore;
  primary: MigrationStore;
  mode: "inventory" | "copy" | "certify";
  concurrency?: number;
  now?: () => Date;
}): Promise<StorageMigrationEvidence> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const [legacyObjects, primaryObjects] = await Promise.all([
    options.legacy.list(),
    options.primary.list(),
  ]);
  const legacyByKey = new Map(legacyObjects.map((object) => [object.key, object]));
  const primaryByKey = new Map(primaryObjects.map((object) => [object.key, object]));
  const ownersByKey = new Map<string, StorageOwner[]>();
  const invalidOwners: StorageOwner[] = [];

  for (const owner of options.owners) {
    const key = objectKeyFromUrl(owner.url);
    if (!key) {
      invalidOwners.push(owner);
      continue;
    }
    ownersByKey.set(key, [...(ownersByKey.get(key) ?? []), owner]);
  }

  const missingObjects = [
    ...invalidOwners,
    ...[...ownersByKey.entries()]
      .filter(([key]) => !legacyByKey.has(key) && !primaryByKey.has(key))
      .flatMap(([, owners]) => owners),
  ];
  const orphanedLegacyObjects = legacyObjects.filter((object) => !ownersByKey.has(object.key));
  const primaryOnlyKeys = [...ownersByKey.keys()].filter(
    (key) => !legacyByKey.has(key) && primaryByKey.has(key),
  );
  const work = [
    ...legacyObjects.map((object) => ({ object, legacy: true })),
    ...primaryOnlyKeys.map((key) => ({ object: primaryByKey.get(key)!, legacy: false })),
  ];
  const objects = new Array<ObjectMigrationResult>(work.length);

  await forEachConcurrent(work, options.concurrency ?? 4, async ({ object: source, legacy }, index) => {
    const owners = (ownersByKey.get(source.key) ?? []).map(
      ({ source: sourceName, recordId, teamId, kind }) => ({
        source: sourceName, recordId, teamId, kind,
      }),
    );
    if (options.mode === "inventory") {
      objects[index] = {
        key: source.key, owners, sourceSize: source.size, sourceSha256: null,
        primarySize: primaryByKey.get(source.key)?.size ?? null,
        primarySha256: null, status: "DRY_RUN",
      };
      return;
    }
    try {
      const sourceBody = legacy ? await options.legacy.read(source.key) : null;
      const sourceSha256 = sourceBody ? digest(sourceBody) : null;
      let primaryBody: Buffer | null = null;
      let copied = false;
      if (primaryByKey.has(source.key)) {
        primaryBody = await options.primary.read(source.key);
      }
      if (sourceBody && (!primaryBody || primaryBody.length !== sourceBody.length || digest(primaryBody) !== sourceSha256)) {
        if (!options.primary.write) throw new Error("Primary storage adapter is read-only");
        await options.primary.write(source.key, sourceBody, mimeFor(source.key));
        primaryBody = await options.primary.read(source.key);
        copied = true;
      }
      if (!primaryBody) throw new Error("Primary object could not be read");
      const primarySha256 = digest(primaryBody);
      if (sourceBody && (primaryBody.length !== sourceBody.length || primarySha256 !== sourceSha256)) {
        throw new Error("Primary object failed size/SHA-256 verification after copy");
      }
      objects[index] = {
        key: source.key, owners, sourceSize: sourceBody?.length ?? 0, sourceSha256,
        primarySize: primaryBody.length, primarySha256,
        status: copied ? "COPIED_AND_VERIFIED" : "VERIFIED",
      };
    } catch (error) {
      objects[index] = {
        key: source.key, owners, sourceSize: source.size, sourceSha256: null,
        primarySize: primaryByKey.get(source.key)?.size ?? null, primarySha256: null,
        status: "FAILED", error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const blockers: string[] = [];
  const readChecks: StorageMigrationEvidence["readChecks"] = [];
  if (options.mode !== "inventory") {
    const referencedKinds = new Set(
      [...ownersByKey.values()]
        .flatMap((owners) => owners.map((owner) => owner.kind))
        .filter((kind) => kind !== "unknown"),
    );
    for (const kind of ["image", "video", "audio"] as const) {
      const sample = objects.find((object) =>
        object.status !== "FAILED" && object.owners.some((owner) => owner.kind === kind)
      );
      if (!sample) continue;
      try {
        const full = await options.primary.read(sample.key);
        if (full.length === 0) throw new Error("Full read returned zero bytes");
        if (kind === "video") {
          const end = Math.min(full.length - 1, 1023);
          const range = await options.primary.read(sample.key, { start: 0, end });
          if (!range.equals(full.subarray(0, end + 1))) throw new Error("Byte-range content mismatch");
        }
        readChecks.push({
          kind, key: sample.key, fullRead: "PASS",
          byteRangeRead: kind === "video" ? "PASS" : "NOT_APPLICABLE",
        });
      } catch (error) {
        readChecks.push({
          kind, key: sample.key, fullRead: "FAIL",
          byteRangeRead: kind === "video" ? "FAIL" : "NOT_APPLICABLE",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const kind of referencedKinds) {
      if (!readChecks.some((check) =>
        check.kind === kind &&
        check.fullRead === "PASS" &&
        (kind !== "video" || check.byteRangeRead === "PASS")
      )) blockers.push(`No passing primary-storage ${kind} read check was recorded`);
    }
  }

  if (missingObjects.length) blockers.push(`${missingObjects.length} database owner record(s) reference missing objects`);
  const failed = objects.filter((object) => object.status === "FAILED");
  if (failed.length) blockers.push(`${failed.length} legacy object(s) failed copy or verification`);
  if (readChecks.some((check) => check.fullRead === "FAIL" || check.byteRangeRead === "FAIL")) {
    blockers.push("One or more primary-storage media read checks failed");
  }
  if (options.mode === "certify" && objects.length !== legacyObjects.length + primaryOnlyKeys.length) {
    blockers.push("Not every legacy or referenced primary-only object was included in verification");
  }

  const unsigned: Omit<StorageMigrationEvidence, "evidenceSha256"> = {
    schemaVersion: "1.1",
    kind: "media-storage-migration-evidence",
    storage: { source: options.legacy.identity, primary: options.primary.identity },
    mode: options.mode,
    certificationStatus: options.mode === "certify"
      ? (blockers.length === 0 ? "PASS" : "FAIL")
      : "NOT_REQUESTED",
    startedAt,
    finishedAt: now().toISOString(),
    inventory: {
      databaseOwnerCount: options.owners.length,
      referencedObjectCount: ownersByKey.size,
      legacyObjectCount: legacyObjects.length,
      primaryObjectCountBefore: primaryObjects.length,
      missingObjects,
      orphanedLegacyObjects,
    },
    objects,
    readChecks,
    blockers,
  };
  return { ...unsigned, evidenceSha256: withoutEvidenceHash(unsigned) };
}