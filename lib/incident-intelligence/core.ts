import { createHash, randomUUID } from "node:crypto";

export type TelemetrySeverity = "warning" | "error" | "critical";
export type IncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";

export interface TelemetryEvent {
  eventId: string;
  occurredAt: string;
  environment: string;
  release?: string;
  process: string;
  severity: TelemetrySeverity;
  category: string;
  fingerprint: string;
  message: string;
  stack?: string;
  correlation: { requestId?: string; jobId?: string; deployId?: string };
  metadata: Record<string, unknown>;
}

export interface TelemetryInput {
  eventId?: string;
  occurredAt?: Date | string;
  environment?: string;
  release?: string;
  process?: string;
  severity: TelemetrySeverity;
  category: string;
  message: string;
  stack?: string;
  fingerprint?: string;
  requestId?: string;
  jobId?: string;
  deployId?: string;
  metadata?: Record<string, unknown>;
}

export const TELEMETRY_LIMITS = {
  metadataBytes: 16_384,
  metadataDepth: 6,
  metadataKeys: 100,
  stringLength: 2_000,
  messageLength: 8_000,
  stackLength: 32_000,
} as const;

const SECRET_KEY = /(?:pass(?:word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|session|credential)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE = /(?<!\w)(?:\+?\d[\s().-]*){8,15}\d(?!\w)/g;
const COOKIE = /\b(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi;
const CREDENTIAL_ASSIGNMENT = /\b(pass(?:word)?|secret|token|authorization|api[-_]?key|private[-_]?key|session|credential|client[-_]?secret)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    // Query strings frequently contain OAuth credentials and object-storage
    // signatures. Keep only the non-sensitive location of the resource.
    if (url.search) url.search = "?[REDACTED_QUERY]";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

export function redactString(value: string, maxLength: number = TELEMETRY_LIMITS.stringLength): string {
  return value
    .replace(COOKIE, "cookie: [REDACTED_SECRET]")
    .replace(BEARER, "[REDACTED_TOKEN]")
    .replace(JWT, "[REDACTED_TOKEN]")
    .replace(CREDENTIAL_ASSIGNMENT, (_match, key, separator) => `${key}${separator}[REDACTED_SECRET]`)
    .replace(URL_PATTERN, (url) => sanitizeUrl(url))
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(CARD, "[REDACTED_NUMBER]")
    .replace(PHONE, "[REDACTED_PHONE]")
    .slice(0, maxLength);
}

export function sanitizeMetadata(input: unknown): Record<string, unknown> {
  let keys = 0;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number, key?: string): unknown => {
    if (key && SECRET_KEY.test(key)) return "[REDACTED_SECRET]";
    if (depth > TELEMETRY_LIMITS.metadataDepth) return "[TRUNCATED_DEPTH]";
    if (typeof value === "string") return redactString(value);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (typeof value === "bigint") return String(value);
    if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
    if (typeof value !== "object") return String(value).slice(0, 100);
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => visit(item, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (++keys > TELEMETRY_LIMITS.metadataKeys) {
        output._truncated = true;
        break;
      }
      output[childKey.slice(0, 100)] = visit(child, depth + 1, childKey);
    }
    return output;
  };
  const sanitized = visit(input ?? {}, 0) as Record<string, unknown>;
  const encoded = JSON.stringify(sanitized);
  if (Buffer.byteLength(encoded) <= TELEMETRY_LIMITS.metadataBytes) return sanitized;
  return {
    _truncated: true,
    preview: encoded.slice(0, TELEMETRY_LIMITS.metadataBytes - 100),
  };
}

function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeFingerprint(input: Pick<TelemetryInput, "category" | "message" | "stack" | "process">): string {
  const stackFrames = (input.stack ?? "")
    .split("\n")
    .slice(0, 6)
    .map(normalizeForFingerprint)
    .join("|");
  return createHash("sha256")
    .update([input.category, input.process ?? "", normalizeForFingerprint(input.message), stackFrames].join("\n"))
    .digest("hex");
}

export function createTelemetryEvent(input: TelemetryInput): TelemetryEvent {
  const processName = redactString(input.process ?? (process.env.WORKER_PROCESS === "true" ? "worker" : "web"), 100);
  const safeMessage = redactString(input.message, TELEMETRY_LIMITS.messageLength);
  const safeStack = input.stack ? redactString(input.stack, TELEMETRY_LIMITS.stackLength) : undefined;
  return {
    eventId: input.eventId ?? randomUUID(),
    occurredAt: new Date(input.occurredAt ?? Date.now()).toISOString(),
    environment: redactString(input.environment ?? process.env.NODE_ENV ?? "unknown", 50),
    release: input.release ?? process.env.RELEASE_SHA ?? process.env.GIT_SHA
      ? redactString(input.release ?? process.env.RELEASE_SHA ?? process.env.GIT_SHA ?? "", 100)
      : undefined,
    process: processName,
    severity: input.severity,
    category: redactString(input.category, 80),
    fingerprint: redactString(input.fingerprint ?? computeFingerprint({ ...input, message: safeMessage, stack: safeStack, process: processName }), 64),
    message: safeMessage,
    stack: safeStack,
    correlation: {
      requestId: input.requestId ? redactString(input.requestId, 128) : undefined,
      jobId: input.jobId ? redactString(input.jobId, 128) : undefined,
      deployId: input.deployId ?? process.env.DEPLOYMENT_ID
        ? redactString(input.deployId ?? process.env.DEPLOYMENT_ID ?? "", 128)
        : undefined,
    },
    metadata: sanitizeMetadata(input.metadata),
  };
}

/** Re-sanitize typed events at durable/transport boundaries (including replay). */
export function sanitizeTelemetryEvent(event: TelemetryEvent): TelemetryEvent {
  return {
    ...event,
    environment: redactString(event.environment, 50),
    release: event.release ? redactString(event.release, 100) : undefined,
    process: redactString(event.process, 100),
    category: redactString(event.category, 80),
    fingerprint: redactString(event.fingerprint, 64),
    message: redactString(event.message, TELEMETRY_LIMITS.messageLength),
    stack: event.stack ? redactString(event.stack, TELEMETRY_LIMITS.stackLength) : undefined,
    correlation: {
      requestId: event.correlation.requestId ? redactString(event.correlation.requestId, 128) : undefined,
      jobId: event.correlation.jobId ? redactString(event.correlation.jobId, 128) : undefined,
      deployId: event.correlation.deployId ? redactString(event.correlation.deployId, 128) : undefined,
    },
    metadata: sanitizeMetadata(event.metadata),
  };
}