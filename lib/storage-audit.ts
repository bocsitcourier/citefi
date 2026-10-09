import { createHash } from "node:crypto";
import { objectKeyFromUrl, type StorageIdentity, type StorageOwner, type StoredObject } from "./storage-migration";

/** Deliberately excludes read/write/delete: this is inventory, not certification. */
export interface InventoryStore {
  identity: StorageIdentity;
  list(): Promise<StoredObject[]>;
}

export interface StorageAuditReport {
  schemaVersion: 1;
  kind: "media-storage-audit";
  startedAt: string;
  finishedAt: string;
  scopeId: string | null;
  status: "PASS" | "DRIFT" | "INCOMPLETE";
  issues: string[];
  counts: {
    databaseOwners: number | null;
    referencedObjects: number | null;
    missingOwnedObjects: number | null;
    invalidOwners: number | null;
    primaryObjects: number | null;
    legacyObjects: number | null;
    legacyOnlyObjects: number | null;
    orphanedPrimaryObjects: number | null;
    orphanedLegacyObjects: number | null;
  };
  /** SHA-256 identifiers only; never raw keys, owner URLs, or provider errors. */
  samples: {
    missingOwnedObjects: string[];
    legacyOnlyObjects: string[];
    orphanedPrimaryObjects: string[];
    orphanedLegacyObjects: string[];
  };
}

export const STORAGE_AUDIT_SAMPLE_LIMIT = 20;
const DEPENDENCY_TIMEOUT_MS = 120_000;
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

async function bounded<T>(load: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(load),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Inventory deadline exceeded")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function keys(objects: StoredObject[]): Set<string> {
  if (!Array.isArray(objects) || objects.some((object) =>
    typeof object.key !== "string" || !object.key ||
    !Number.isFinite(object.size) || object.size < 0
  )) throw new Error("Invalid inventory");
  return new Set(objects.map((object) => object.key));
}

function ownedKey(url: string): string | null {
  const unsigned = url.split(/[?#]/, 1)[0] ?? "";
  // Error screenshots use the older literal ".private/" namespace, unlike
  // generated media's "private/". Preserve the bucket key, not its public alias.
  try {
    const path = /^https?:\/\//i.test(unsigned) ? new URL(unsigned).pathname : unsigned;
    const marker = "/api/public-objects/";
    const index = path.indexOf(marker);
    if (index >= 0) {
      const key = decodeURIComponent(path.slice(index + marker.length));
      if (key.startsWith(".private/")) {
        return !key.includes("..") && !key.includes("\\") ? key : null;
      }
    }
  } catch {
    return null;
  }
  return objectKeyFromUrl(unsigned);
}

/**
 * Compare independent inventories. A failed listing stays unknown (null), not
 * an empty bucket. All legacy-only objects are unexpected after parity; no
 * baseline can accidentally grandfather a new legacy write into a passing run.
 * Existing migration evidence is never changed or treated as a live inventory.
 */
export async function runStorageAudit(options: {
  owners: () => Promise<StorageOwner[]>;
  primary: () => InventoryStore;
  legacy: () => InventoryStore;
  now?: () => Date;
  timeoutMs?: number;
}): Promise<StorageAuditReport> {
  const now = options.now ?? (() => new Date());
  const report: StorageAuditReport = {
    schemaVersion: 1, kind: "media-storage-audit",
    startedAt: now().toISOString(), finishedAt: "", scopeId: null,
    status: "PASS", issues: [],
    counts: {
      databaseOwners: null, referencedObjects: null, missingOwnedObjects: null,
      invalidOwners: null, primaryObjects: null, legacyObjects: null,
      legacyOnlyObjects: null, orphanedPrimaryObjects: null, orphanedLegacyObjects: null,
    },
    samples: { missingOwnedObjects: [], legacyOnlyObjects: [], orphanedPrimaryObjects: [], orphanedLegacyObjects: [] },
  };
  // Tests may shorten the deadline; callers cannot increase the upper bound.
  const timeoutMs = Math.min(DEPENDENCY_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? DEPENDENCY_TIMEOUT_MS));
  const [ownersResult, primaryResult, legacyResult] = await Promise.allSettled([
    bounded(options.owners, timeoutMs),
    bounded(async () => {
      const store = options.primary();
      return { identity: store.identity, keys: keys(await store.list()) };
    }, timeoutMs),
    bounded(async () => {
      const store = options.legacy();
      return { identity: store.identity, keys: keys(await store.list()) };
    }, timeoutMs),
  ]);
  let owned: Set<string> | null = null;
  if (ownersResult.status === "fulfilled") {
    owned = new Set();
    report.counts.databaseOwners = ownersResult.value.length;
    report.counts.invalidOwners = 0;
    for (const owner of ownersResult.value) {
      // Strip signatures before parsing relative paths as well as absolute URLs.
      const key = ownedKey(owner.url);
      if (key) owned.add(key);
      else report.counts.invalidOwners++;
    }
    report.counts.referencedObjects = owned.size;
    if (report.counts.invalidOwners) report.issues.push("INVALID_OWNER_REFERENCES");
  } else report.issues.push("OWNER_INVENTORY_UNAVAILABLE");
  const primary = primaryResult.status === "fulfilled" ? primaryResult.value.keys : null;
  const legacy = legacyResult.status === "fulfilled" ? legacyResult.value.keys : null;
  if (!primary) report.issues.push("PRIMARY_INVENTORY_UNAVAILABLE");
  else {
    report.counts.primaryObjects = primary.size;
    // Never expose endpoints, bucket names, prefixes, or credentials in reports.
    report.scopeId = fingerprint(JSON.stringify([
      primaryResult.status === "fulfilled" ? primaryResult.value.identity : null,
      legacyResult.status === "fulfilled" ? legacyResult.value.identity : null,
    ]));
  }
  if (!legacy) report.issues.push("LEGACY_INVENTORY_UNAVAILABLE");
  else report.counts.legacyObjects = legacy.size;

  const difference = (
    left: Set<string>, right: Set<string>,
    field: keyof StorageAuditReport["samples"],
  ) => {
    let count = 0;
    for (const key of left) if (!right.has(key)) {
      count++;
      if (report.samples[field].length < STORAGE_AUDIT_SAMPLE_LIMIT) {
        report.samples[field].push(fingerprint(key));
      }
    }
    report.counts[field] = count;
  };
  if (owned && primary) {
    difference(owned, primary, "missingOwnedObjects");
    difference(primary, owned, "orphanedPrimaryObjects");
    if (report.counts.missingOwnedObjects) report.issues.push("MISSING_OWNED_OBJECTS");
  }
  if (legacy && primary) {
    difference(legacy, primary, "legacyOnlyObjects");
    if (report.counts.legacyOnlyObjects) report.issues.push("LEGACY_ONLY_OBJECTS");
  }
  if (owned && legacy) difference(legacy, owned, "orphanedLegacyObjects");
  report.status = [ownersResult, primaryResult, legacyResult].some((result) => result.status === "rejected")
    ? "INCOMPLETE" : report.issues.length ? "DRIFT" : "PASS";
  report.finishedAt = now().toISOString();
  return report;
}

export function auditAlertMessage(report: StorageAuditReport): string | null {
  if (report.status === "PASS") return null;
  const count = (value: number | null) => value === null ? "unknown" : String(value);
  return `Media storage audit ${report.status}: missing owned objects ${count(report.counts.missingOwnedObjects)}; ` +
    `legacy-only objects ${count(report.counts.legacyOnlyObjects)}; invalid owner references ${count(report.counts.invalidOwners)}. ` +
    `Coverage: owners ${report.counts.databaseOwners === null ? "unavailable" : "checked"}, ` +
    `primary ${report.counts.primaryObjects === null ? "unavailable" : "checked"}, ` +
    `legacy ${report.counts.legacyObjects === null ? "unavailable" : "checked"}. ` +
    "Inspect the media-storage audit history. No objects were modified or deleted.";
}