import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeFingerprint,
  createTelemetryEvent,
  redactString,
  sanitizeMetadata,
} from "../lib/incident-intelligence/core";
import { replaySpool, spoolEvent } from "../lib/incident-intelligence/spool";
import {
  generateIncidentAdvice,
  INSUFFICIENT_EVIDENCE_ADVICE,
} from "../lib/incident-intelligence/ai-analysis";
import {
  classifyIncidentChange,
  shouldNotifyAdmin,
} from "../lib/incident-intelligence/policy";

test("recursively redacts secret keys and PII with bounded metadata", () => {
  const output = sanitizeMetadata({
    password: "never-store-me",
    nested: {
      authorization: "Bearer abc.def",
      email: "person@example.com",
      card: "4242 4242 4242 4242",
    },
    huge: "x".repeat(10_000),
  });
  const encoded = JSON.stringify(output);
  assert.doesNotMatch(encoded, /never-store-me|person@example\.com|4242 4242/);
  assert.match(encoded, /REDACTED_SECRET|REDACTED_EMAIL/);
  assert.ok(Buffer.byteLength(encoded) <= 16_384);
});

test("redacts URL credentials, signed queries, cookies, and credential assignments", () => {
  const raw = [
    "https://alice:hunter2@example.com/private.png?X-Amz-Signature=abc&token=def",
    "Cookie: sid=super-secret; theme=dark",
    "client_secret=do-not-log password: also-secret apiKey='third-secret'",
  ].join("\n");
  const safe = redactString(raw, 10_000);
  assert.doesNotMatch(safe, /alice|hunter2|X-Amz-Signature|super-secret|do-not-log|also-secret|third-secret/);
  assert.match(safe, /REDACTED_QUERY|REDACTED_SECRET/);
});

test("telemetry sanitizes every string field and never retains a raw signed URL", () => {
  const event = createTelemetryEvent({
    severity: "error",
    category: "SYSTEM",
    process: "worker token=process-secret",
    message: "failed https://host/file?signature=raw-signature",
    stack: "password=stack-secret",
    requestId: "credential=request-secret",
    metadata: { screenshotUrl: "https://host/screenshot?X-Amz-Signature=signed-secret" },
  });
  const encoded = JSON.stringify(event);
  assert.doesNotMatch(encoded, /process-secret|raw-signature|stack-secret|request-secret|signed-secret/);
});

test("fingerprints normalize volatile ids and remain category-sensitive", () => {
  const a = computeFingerprint({
    category: "QUEUE", process: "worker",
    message: "Job 123 failed for 550e8400-e29b-41d4-a716-446655440000",
    stack: "at run (/app/task.ts:42:9)",
  });
  const b = computeFingerprint({
    category: "QUEUE", process: "worker",
    message: "Job 999 failed for 9b2c43aa-1111-4222-8333-abcdefabcdef",
    stack: "at run (/app/task.ts:91:2)",
  });
  assert.equal(a, b);
  assert.notEqual(a, computeFingerprint({ category: "AUTH", process: "worker", message: "Job 999 failed", stack: "" }));
});

test("dedup classification only escalates increasing severity", () => {
  assert.equal(classifyIncidentChange(false, "error", "critical"), "duplicate");
  assert.equal(classifyIncidentChange(true, undefined, "critical"), "new");
  assert.equal(classifyIncidentChange(true, "warning", "critical"), "escalated");
  assert.equal(classifyIncidentChange(true, "critical", "error"), "updated");
});

test("spool replay retains failures and replay is idempotent by event id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "incident-spool-"));
  const path = join(dir, "events.jsonl");
  const first = createTelemetryEvent({ eventId: "bd697c4d-d93d-47dd-b40f-89870086cead", severity: "error", category: "SYSTEM", message: "one" });
  const second = createTelemetryEvent({ eventId: "7dc34dc4-fb82-445c-a13e-c0bff0e270ad", severity: "error", category: "SYSTEM", message: "two" });
  await spoolEvent(first, path);
  await spoolEvent(second, path);
  const seen = new Set<string>();
  const initial = await replaySpool(async (event) => {
    if (event.eventId === second.eventId) throw new Error("db unavailable");
    seen.add(event.eventId);
  }, path);
  assert.deepEqual(initial, { replayed: 1, remaining: 1 });
  const final = await replaySpool(async (event) => { seen.add(event.eventId); }, path);
  assert.deepEqual(final, { replayed: 1, remaining: 0 });
  assert.equal(seen.size, 2);
  await rm(dir, { recursive: true, force: true });
});

test("AI advice validates evidence references and safely falls back", async () => {
  const evidence = [{ id: "event-1", occurredAt: new Date(0).toISOString(), message: "timeout" }];
  const valid = await generateIncidentAdvice(evidence, async () => ({
    summary: "A timeout occurred.",
    likelyCauses: [{ cause: "Upstream latency", evidenceRefs: ["event-1"] }],
    recommendedChecks: [{ check: "Inspect upstream latency", evidenceRefs: ["event-1"] }],
    confidence: 0.6,
    insufficientEvidence: false,
    missingEvidence: [],
    safetyNotice: "Advisory only; no fixes were executed.",
  }));
  assert.equal(valid.confidence, 0.6);
  const invalid = await generateIncidentAdvice(evidence, async () => ({
    ...valid,
    likelyCauses: [{ cause: "Invented", evidenceRefs: ["missing-event"] }],
  }));
  assert.deepEqual(invalid, INSUFFICIENT_EVIDENCE_ADVICE);
});

test("admin notification policy suppresses repeats and noncritical events", () => {
  assert.equal(shouldNotifyAdmin("new", "critical"), true);
  assert.equal(shouldNotifyAdmin("escalated", "critical"), true);
  assert.equal(shouldNotifyAdmin("regressed", "critical"), true);
  assert.equal(shouldNotifyAdmin("updated", "critical"), false);
  assert.equal(shouldNotifyAdmin("duplicate", "critical"), false);
  assert.equal(shouldNotifyAdmin("new", "error"), false);
});