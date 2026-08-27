import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendProcessDiagnosticRecord,
  classifyChildTermination,
  createSanitizedOutputForwarder,
  sanitizeProcessDiagnostic,
  sanitizeProcessDiagnosticRecord,
} from "../lib/process-diagnostics";

test("process diagnostics redact errors, signed URLs, cookies, PII, and credentials", () => {
  const error = new Error(
    "password=hunter2 user@example.com https://user:pass@host/file?X-Amz-Signature=raw",
  );
  error.stack = `Cookie: sid=session-secret\n${error.message}`;
  const safe = sanitizeProcessDiagnostic(error);
  assert.doesNotMatch(safe, /hunter2|user@example|session-secret|X-Amz-Signature|user:pass/);
  assert.match(safe, /REDACTED_SECRET|REDACTED_EMAIL|REDACTED_QUERY/);
});

test("child output redaction handles chunk-split secrets and bounds long lines", () => {
  let output = "";
  const forwarder = createSanitizedOutputForwarder((text) => output += text, 128);
  forwarder.write("startup token=");
  forwarder.write("split-secret https://host/file?");
  forwarder.write("signature=secret\n" + "x".repeat(1_000));
  forwarder.end();
  assert.doesNotMatch(output, /split-secret|signature=secret/);
  assert.match(output, /REDACTED_SECRET|REDACTED_QUERY|TRUNCATED/);
  assert.ok(output.length < 350);
});

test("structured process diagnostics recursively sanitize spool records", () => {
  const record = sanitizeProcessDiagnosticRecord({
    stderr: "authorization: Bearer raw-token",
    cookie: "sid=raw-cookie",
    screenshotUrl: "https://host/image?token=signed",
  });
  const encoded = JSON.stringify(record);
  assert.doesNotMatch(encoded, /raw-token|raw-cookie|token=signed/);
});

test("owner-only process spool receives only sanitized bounded records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "process-diagnostics-"));
  const path = join(directory, "exits.jsonl");
  await appendProcessDiagnosticRecord(path, {
    stderr: `cookie: sid=raw-cookie\n${"x".repeat(20_000)}`,
    url: "https://host/file?signature=raw-signature",
  });
  const contents = await readFile(path, "utf8");
  assert.doesNotMatch(contents, /raw-cookie|raw-signature/);
  assert.ok(Buffer.byteLength(contents) < 20_000);
  await rm(directory, { recursive: true, force: true });
});

test("termination policy suppresses planned reloads and clean exits only", () => {
  assert.deepEqual(
    classifyChildTermination({ supervisorSignal: "SIGTERM", code: null, childSignal: "SIGTERM" }),
    { planned: true, reason: "supervisor_signal", exitCode: 0 },
  );
  assert.deepEqual(
    classifyChildTermination({ code: 0, childSignal: null }),
    { planned: true, reason: "clean_exit", exitCode: 0 },
  );
  assert.deepEqual(
    classifyChildTermination({ code: null, childSignal: "SIGKILL" }),
    { planned: false, reason: "unexpected_signal", exitCode: 1 },
  );
  assert.deepEqual(
    classifyChildTermination({ code: 7, childSignal: null }),
    { planned: false, reason: "unexpected_exit", exitCode: 7 },
  );
});