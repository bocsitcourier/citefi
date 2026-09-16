/**
 * Durable evidence for one physical provider submission.
 *
 * This module intentionally accepts only a typed, allow-listed request and
 * response shape.  It must never be handed a prompt, customer content,
 * credential, audio/video bytes, or an unbounded provider response.  A receipt
 * is prepared and ownership-checked before `submit` is invoked.  The response
 * usage is persisted independently, then the immutable usage ledger is
 * reconciled with the receipt's deterministic source event.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq } from "drizzle-orm";

import { getTxDb } from "./db";
import {
  providerAttemptReceipts,
  type ProviderAttemptReceipt as SchemaProviderAttemptReceipt,
} from "@/shared/schema";
import {
  recordProviderUsage,
  validateProviderUsageOwnership,
  type ProviderUsageInput,
} from "./provider-usage-ledger";
import { createProviderAttemptObjectSpool } from "./provider-attempt-object-spool";
import { providerAttemptInvocationKey } from "./provider-invocation-identity";
export {
  allocateProviderAttemptIdentity,
  currentProviderInvocationIdentity,
  providerInvocationIdentityForJob,
  runWithProviderInvocationIdentity,
} from "./provider-invocation-identity";
export type {
  ProviderAttemptIdentityAllocation,
  ProviderAttemptIdentityOptions,
  ProviderInvocationIdentity,
} from "./provider-invocation-identity";

const RECEIPT_SPOOL_ENV = "PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR";
const MAX_METADATA_STRING = 255;
const MAX_FAILURE_MESSAGE = 255;
const SAFE_RAW_USAGE_KEYS = new Set([
  "promptTokenCount",
  "candidatesTokenCount",
  "totalTokenCount",
  "thoughtsTokenCount",
  "cachedContentTokenCount",
  "toolUsePromptTokenCount",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "prompt_cached_tokens",
  "prompt_audio_tokens",
  "completion_reasoning_tokens",
  "completion_audio_tokens",
  "completion_accepted_prediction_tokens",
  "completion_rejected_prediction_tokens",
  "inputTokens",
  "outputTokens",
  "input_tokens",
  "output_tokens",
  "videoSeconds",
  "imageCount",
  "characters",
  "requestCount",
]);

export type ProviderAttemptStatus =
  | "prepared"
  | "submitted"
  | "usage_captured"
  | "accounted"
  | "provider_rejected"
  | "uncertain"
  | "reconciliation_required"
  | "accounting_failed";

export type SafeProviderProvider = "gemini" | "openai" | "brave";

/**
 * Request fields wrappers may persist.  Keep this list deliberately boring:
 * model and bounded limits are useful for later reconciliation and contain no
 * customer input.
 */
export interface SafeProviderRequest {
  model: string;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  candidateCount?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  seed?: number | null;
  responseMimeType?: string | null;
  responseModalities?: string[] | null;
  imageAspectRatio?: string | null;
  imageSize?: string | null;
  thinkingBudget?: number | null;
  maxDurationSeconds?: number | null;
  maxImages?: number | null;
  maxRequests?: number | null;
  maxCharacters?: number | null;
  timeoutMs?: number | null;
  adapterVersion?: string | null;
  requestKey?: string | null;
}

export interface ProviderAttemptContext {
  teamId: number;
  /**
   * Stable logical invocation supplied by a route/job idempotency boundary.
   * When omitted, the ambient worker invocation scope is authoritative.
   */
  invocationKey?: string | null;
  userId?: number | null;
  campaignId?: number | null;
  runId?: string | null;
  jobId?: string | null;
  resourceType?: string | null;
  resourceId?: string | number | null;
  contentId?: number | null;
  operationType: string;
  provider: SafeProviderProvider;
  model: string;
  attempt?: number | null;
  /**
   * Stable caller/run identity.  A timestamp or random value is not a
   * substitute: retries must resolve to the same receipt.
   */
  attemptKey?: string | null;
}

export interface KnownProviderUsage {
  unitType: string;
  unitCount?: number | null;
  inputUnits?: number | null;
  outputUnits?: number | null;
  /** Explicit marker prevents an absent SDK usage object becoming zero usage. */
  known: boolean;
  /**
   * Provider-native numeric fields retained verbatim for reconciliation and
   * invoice evidence.  This is intentionally metadata, not prompt/content.
   */
  raw?: Record<string, number>;
}

export interface SafeProviderResponseMetadata {
  providerRequestId?: string | null;
  operationId?: string | null;
  actualModel?: string | null;
  finishReason?: string | null;
  httpStatus?: number | null;
  latencyMs?: number | null;
}

export interface ProviderResponseCapture {
  usage: KnownProviderUsage;
  providerRequestId?: string | null;
  metadata?: SafeProviderResponseMetadata | null;
}

export interface ProviderAttemptReceiptRecord {
  sourceEventId: string;
  teamId: number;
  userId?: number | null;
  campaignId?: number | null;
  resourceType?: string | null;
  resourceId?: string | number | null;
  contentId?: number | null;
  runId?: string | null;
  jobId?: string | null;
  operationType: string;
  provider: SafeProviderProvider;
  model: string;
  attempt: number;
  requestMetadata: SafeProviderRequest;
  providerRequestId?: string | null;
  responseUsage?: KnownProviderUsage | null;
  responseMetadata?: SafeProviderResponseMetadata | null;
  status: ProviderAttemptStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  preparedAt: Date;
  submittedAt?: Date | null;
  usageCapturedAt?: Date | null;
  accountedAt?: Date | null;
}

export class ProviderAttemptNotDurableError extends Error {
  readonly code = "PROVIDER_ATTEMPT_NOT_DURABLE";
  readonly retryable = false;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderAttemptNotDurableError";
  }
}

export class ProviderAttemptUsageUnavailableError extends Error {
  readonly code = "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE";
  readonly retryable = false;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderAttemptUsageUnavailableError";
  }
}

export class ProviderAttemptAccountingError extends Error {
  readonly code = "PROVIDER_ATTEMPT_ACCOUNTING_FAILED";
  readonly retryable = false;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderAttemptAccountingError";
  }
}

export class ProviderAttemptSubmissionUncertainError extends Error {
  readonly code = "PROVIDER_ATTEMPT_SUBMISSION_UNCERTAIN";
  readonly retryable = false;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderAttemptSubmissionUncertainError";
  }
}

export class ProviderAttemptAlreadySubmittedError extends Error {
  readonly code = "PROVIDER_ATTEMPT_ALREADY_SUBMITTED";
  readonly retryable = false;

  constructor(sourceEventId: string) {
    super(`provider attempt ${sourceEventId} already has a physical submission; reconcile instead of replaying`);
    this.name = "ProviderAttemptAlreadySubmittedError";
  }
}

export type ProviderAttemptTerminalError =
  | ProviderAttemptNotDurableError
  | ProviderAttemptUsageUnavailableError
  | ProviderAttemptAccountingError
  | ProviderAttemptSubmissionUncertainError
  | ProviderAttemptAlreadySubmittedError;

export function isProviderAttemptTerminalError(error: unknown): error is ProviderAttemptTerminalError {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && (
    code === "PROVIDER_ATTEMPT_NOT_DURABLE" ||
    code === "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE" ||
    code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED" ||
    code === "PROVIDER_ATTEMPT_SUBMISSION_UNCERTAIN" ||
    code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED"
  );
}

function boundedString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > MAX_METADATA_STRING) {
    throw new Error(`${label} exceeds the safe metadata limit`);
  }
  return normalized;
}

function boundedOptionalString(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return boundedString(value, label);
}

function boundedNonNegativeInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function boundedNonNegativeNumber(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function boundedOptionalStringArray(
  value: string[] | null | undefined,
  label: string,
): string[] | null {
  if (value == null) return null;
  if (value.length > 8) throw new Error(`${label} has too many values`);
  return value.map((item) => boundedString(item, label));
}

function boundedPositiveInteger(value: number | null | undefined, label: string): number {
  if (value == null) return 1;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function safeResourceId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("resourceId must be a safe integer");
    return String(value);
  }
  return boundedString(value, "resourceId");
}

function normalizeRequest(request: SafeProviderRequest, context: ProviderAttemptContext): SafeProviderRequest {
  const model = boundedString(request.model || context.model, "provider model");
  if (model !== boundedString(context.model, "provider model")) {
    throw new Error("provider request model does not match attempt context");
  }
  return {
    model,
    maxInputTokens: boundedNonNegativeInteger(request.maxInputTokens, "maxInputTokens"),
    maxOutputTokens: boundedNonNegativeInteger(request.maxOutputTokens, "maxOutputTokens"),
    candidateCount: boundedNonNegativeInteger(request.candidateCount, "candidateCount"),
    temperature: boundedNonNegativeNumber(request.temperature, "temperature"),
    topP: boundedNonNegativeNumber(request.topP, "topP"),
    topK: boundedNonNegativeInteger(request.topK, "topK"),
    seed: boundedNonNegativeInteger(request.seed, "seed"),
    responseMimeType: boundedOptionalString(request.responseMimeType, "responseMimeType"),
    responseModalities: boundedOptionalStringArray(request.responseModalities, "responseModalities"),
    imageAspectRatio: boundedOptionalString(request.imageAspectRatio, "imageAspectRatio"),
    imageSize: boundedOptionalString(request.imageSize, "imageSize"),
    thinkingBudget: boundedNonNegativeInteger(request.thinkingBudget, "thinkingBudget"),
    maxDurationSeconds: boundedNonNegativeInteger(request.maxDurationSeconds, "maxDurationSeconds"),
    maxImages: boundedNonNegativeInteger(request.maxImages, "maxImages"),
    maxRequests: boundedNonNegativeInteger(request.maxRequests, "maxRequests"),
    maxCharacters: boundedNonNegativeInteger(request.maxCharacters, "maxCharacters"),
    timeoutMs: boundedNonNegativeInteger(request.timeoutMs, "timeoutMs"),
    adapterVersion: boundedOptionalString(request.adapterVersion, "adapterVersion"),
    requestKey: boundedOptionalString(request.requestKey, "requestKey"),
  };
}

function normalizeContext(
  context: ProviderAttemptContext,
  request: SafeProviderRequest,
): Omit<ProviderAttemptReceiptRecord, "preparedAt" | "status"> {
  if (!Number.isSafeInteger(context.teamId) || context.teamId <= 0) {
    throw new Error("provider attempt requires a positive teamId");
  }
  const provider = boundedString(context.provider, "provider") as SafeProviderProvider;
  if (!["gemini", "openai", "brave"].includes(provider)) {
    throw new Error(`unsupported provider ${provider}`);
  }
  const operationType = boundedString(context.operationType, "operationType");
  const model = boundedString(context.model, "provider model");
  const attempt = boundedPositiveInteger(context.attempt, "attempt");
  const attemptKey = providerAttemptInvocationKey(
    context.attemptKey,
    operationType,
    attempt,
    provider,
    model,
    context.invocationKey,
  );
  const userId = context.userId == null ? null : boundedPositiveInteger(context.userId, "userId");
  const contentId = context.contentId == null ? null : boundedPositiveInteger(context.contentId, "contentId");
  const resourceId = safeResourceId(context.resourceId);
  const sourceMaterial = [
    "task179",
    context.teamId,
    attemptKey,
    context.runId ?? "",
    context.jobId ?? "",
    context.campaignId ?? "",
    context.resourceType ?? "",
    resourceId ?? "",
    context.userId ?? "",
    context.contentId ?? "",
    operationType,
    provider,
    model,
    attempt,
    JSON.stringify(request),
  ].join("|");
  const sourceEventId = `provider-attempt:${createHash("sha256").update(sourceMaterial).digest("hex")}`;
  return {
    sourceEventId,
    teamId: context.teamId,
    userId,
    campaignId: context.campaignId ?? null,
    resourceType: context.resourceType == null ? null : boundedString(context.resourceType, "resourceType"),
    resourceId,
    contentId,
    runId: context.runId == null ? null : boundedString(context.runId, "runId"),
    jobId: context.jobId == null ? null : boundedString(context.jobId, "jobId"),
    operationType,
    provider,
    model,
    attempt,
    requestMetadata: request,
  };
}

function normalizeResponseCapture(capture: ProviderResponseCapture): ProviderResponseCapture {
  if (!capture) {
    throw new ProviderAttemptUsageUnavailableError("provider response capture is required");
  }
  const usage = capture.usage ?? ({ known: false } as KnownProviderUsage);
  const unitType = typeof usage.unitType === "string" && usage.unitType.trim()
    ? boundedString(usage.unitType, "usage unitType")
    : "unknown";
  const unitCount = boundedNonNegativeInteger(usage.unitCount, "usage unitCount");
  const inputUnits = boundedNonNegativeInteger(usage.inputUnits, "usage inputUnits");
  const outputUnits = boundedNonNegativeInteger(usage.outputUnits, "usage outputUnits");
  if (usage.known === true && unitCount == null) {
    // Preserve the response facts as partial evidence, but make the receipt
    // explicitly non-reconcilable until a provider-returned aggregate exists.
    usage.known = false;
  }
  const raw = usage.raw == null ? undefined : Object.fromEntries(
    Object.entries(usage.raw).filter(([key, value]) =>
      SAFE_RAW_USAGE_KEYS.has(key) &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0,
    ),
  );
  const providerRequestId = boundedOptionalString(
    capture.providerRequestId ?? capture.metadata?.providerRequestId,
    "providerRequestId",
  );
  const metadata = capture.metadata == null ? null : {
    providerRequestId: boundedOptionalString(capture.metadata.providerRequestId, "providerRequestId"),
    operationId: boundedOptionalString(capture.metadata.operationId, "operationId"),
    actualModel: boundedOptionalString(capture.metadata.actualModel, "actualModel"),
    finishReason: boundedOptionalString(capture.metadata.finishReason, "finishReason"),
    httpStatus: boundedNonNegativeInteger(capture.metadata.httpStatus, "httpStatus"),
    latencyMs: boundedNonNegativeInteger(capture.metadata.latencyMs, "latencyMs"),
  };
  return {
    usage: {
      unitType,
      unitCount,
      inputUnits,
      outputUnits,
      known: usage.known === true && unitCount != null,
      ...(raw && Object.keys(raw).length > 0 ? { raw } : {}),
    },
    providerRequestId,
    metadata,
  };
}

function stableUsageEqual(a: KnownProviderUsage | null | undefined, b: KnownProviderUsage): boolean {
  return Boolean(
    a &&
    a.known === true &&
    a.unitType === b.unitType &&
    a.unitCount === b.unitCount &&
    (a.inputUnits ?? null) === (b.inputUnits ?? null) &&
    (a.outputUnits ?? null) === (b.outputUnits ?? null) &&
    (a.raw == null || b.raw == null ||
      JSON.stringify(a.raw) === JSON.stringify(b.raw)),
  );
}

function rowToReceipt(row: SchemaProviderAttemptReceipt): ProviderAttemptReceiptRecord {
  return {
    sourceEventId: row.sourceEventId,
    teamId: row.teamId,
    userId: row.userId,
    campaignId: row.campaignId,
    contentId: row.contentId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    runId: row.runId,
    jobId: row.jobId,
    operationType: row.operationType,
    provider: row.provider as SafeProviderProvider,
    model: row.model,
    attempt: row.attempt,
    requestMetadata: row.requestMetadata as SafeProviderRequest,
    providerRequestId: row.providerRequestId,
    responseUsage: row.responseUsage as KnownProviderUsage | null,
    responseMetadata: row.responseMetadata as SafeProviderResponseMetadata | null,
    status: row.status as ProviderAttemptStatus,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    preparedAt: row.preparedAt,
    submittedAt: row.submittedAt,
    usageCapturedAt: row.usageCapturedAt,
    accountedAt: row.accountedAt,
  };
}

export interface ProviderAttemptReceiptStore {
  prepare(receipt: ProviderAttemptReceiptRecord): Promise<ProviderAttemptReceiptRecord>;
  markSubmitted(sourceEventId: string, submittedAt: Date): Promise<void>;
  captureResponse(
    sourceEventId: string,
    capture: ProviderResponseCapture,
    capturedAt: Date,
  ): Promise<void>;
  markStatus(
    sourceEventId: string,
    status: ProviderAttemptStatus,
    failure?: { code?: string; message?: string },
  ): Promise<void>;
  find(sourceEventId: string): Promise<ProviderAttemptReceiptRecord | null>;
}

const databaseStore: ProviderAttemptReceiptStore = {
  async prepare(receipt) {
    const txDb = getTxDb();
    return txDb.transaction(async (tx: any) => {
      const values = {
        sourceEventId: receipt.sourceEventId,
        teamId: receipt.teamId,
        userId: receipt.userId ?? null,
        campaignId: receipt.campaignId ?? null,
        contentId: receipt.contentId ?? null,
        resourceType: receipt.resourceType ?? null,
        resourceId: receipt.resourceId == null ? null : String(receipt.resourceId),
        runId: receipt.runId ?? null,
        jobId: receipt.jobId ?? null,
        operationType: receipt.operationType,
        provider: receipt.provider,
        model: receipt.model,
        attempt: receipt.attempt,
        requestMetadata: receipt.requestMetadata,
        status: "prepared" as const,
        preparedAt: receipt.preparedAt,
        updatedAt: receipt.preparedAt,
      };
      const [inserted] = await tx.insert(providerAttemptReceipts)
        .values(values)
        .onConflictDoNothing({ target: providerAttemptReceipts.sourceEventId })
        .returning();
      const row = inserted ?? (await tx.select().from(providerAttemptReceipts)
        .where(eq(providerAttemptReceipts.sourceEventId, receipt.sourceEventId)).limit(1))[0];
      if (!row) throw new Error("provider attempt receipt idempotency conflict did not resolve");
      const existing = rowToReceipt(row);
      if (
        existing.teamId !== receipt.teamId ||
        existing.provider !== receipt.provider ||
        existing.model !== receipt.model ||
        existing.operationType !== receipt.operationType
      ) {
        throw new Error("provider attempt sourceEventId is already bound to different metadata");
      }
      return existing;
    });
  },

  async markSubmitted(sourceEventId, submittedAt) {
    const txDb = getTxDb();
    const [updated] = await txDb.update(providerAttemptReceipts).set({
      status: "submitted",
      submittedAt,
      updatedAt: submittedAt,
    }).where(and(
      eq(providerAttemptReceipts.sourceEventId, sourceEventId),
      eq(providerAttemptReceipts.status, "prepared"),
    )).returning({ sourceEventId: providerAttemptReceipts.sourceEventId });
    if (!updated) {
      throw new Error("provider attempt submission CAS failed; refusing physical submission");
    }
  },

  async captureResponse(sourceEventId, capture, capturedAt) {
    const txDb = getTxDb();
    const [updated] = await txDb.update(providerAttemptReceipts).set({
      providerRequestId: capture.providerRequestId ?? null,
      responseUsage: capture.usage,
      responseMetadata: capture.metadata ?? null,
      status: "usage_captured",
      usageCapturedAt: capturedAt,
      updatedAt: capturedAt,
    }).where(eq(providerAttemptReceipts.sourceEventId, sourceEventId))
      .returning({ sourceEventId: providerAttemptReceipts.sourceEventId });
    if (!updated) throw new ProviderAttemptNotDurableError("Receipt response update affected no owned receipt");
  },

  async markStatus(sourceEventId, status, failure) {
    const txDb = getTxDb();
    const [updated] = await txDb.update(providerAttemptReceipts).set({
      status,
      failureCode: failure?.code ?? null,
      failureMessage: failure?.message?.slice(0, MAX_FAILURE_MESSAGE) ?? null,
      ...(status === "accounted" ? { accountedAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(eq(providerAttemptReceipts.sourceEventId, sourceEventId))
      .returning({ sourceEventId: providerAttemptReceipts.sourceEventId });
    if (!updated) throw new ProviderAttemptNotDurableError("Receipt status update affected no owned receipt");
  },

  async find(sourceEventId) {
    const txDb = getTxDb();
    const [row] = await txDb.select().from(providerAttemptReceipts)
      .where(eq(providerAttemptReceipts.sourceEventId, sourceEventId)).limit(1);
    return row ? rowToReceipt(row) : null;
  },
};

export interface ReceiptSpoolRecord extends ProviderAttemptReceiptRecord {
  spoolVersion: 1;
}

export interface ProviderAttemptReceiptSpool {
  write(record: ReceiptSpoolRecord): Promise<void>;
  read(sourceEventId: string): Promise<ReceiptSpoolRecord | null>;
  /** Verify fallback persistence before a paid call is admitted. */
  ensureReady(): Promise<void>;
}

const SPOOL_STATUSES = new Set<ProviderAttemptStatus>([
  "prepared",
  "submitted",
  "usage_captured",
  "accounted",
  "provider_rejected",
  "uncertain",
  "reconciliation_required",
  "accounting_failed",
]);
const SPOOL_FAILURE_CODES = new Set([
  "PROVIDER_REJECTED",
  "RATE_LIMITED",
  "AUTHENTICATION_FAILED",
  "INVALID_REQUEST",
  "QUOTA_EXCEEDED",
  "TRANSIENT_PROVIDER_ERROR",
  "PROVIDER_USAGE_UNAVAILABLE",
  "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
  "PROVIDER_SUBMISSION_UNCERTAIN",
  "PROVIDER_RESULT_NOT_DURABLE",
  "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
]);
const SAFE_REQUEST_METADATA_KEYS = new Set([
  "model",
  "maxInputTokens",
  "maxOutputTokens",
  "candidateCount",
  "temperature",
  "topP",
  "topK",
  "seed",
  "responseMimeType",
  "responseModalities",
  "thinkingBudget",
  "imageAspectRatio",
  "imageSize",
  "maxDurationSeconds",
  "maxImages",
  "maxRequests",
  "maxCharacters",
  "timeoutMs",
  "adapterVersion",
  "requestKey",
]);
const SAFE_RESPONSE_METADATA_KEYS = new Set([
  "providerRequestId",
  "operationId",
  "actualModel",
  "finishReason",
  "httpStatus",
  "latencyMs",
]);
const SAFE_RESPONSE_USAGE_KEYS = new Set([
  "unitType",
  "unitCount",
  "inputUnits",
  "outputUnits",
  "known",
  "raw",
]);
const SPOOL_RECORD_KEYS = new Set([
  "spoolVersion",
  "sourceEventId",
  "teamId",
  "userId",
  "campaignId",
  "contentId",
  "resourceType",
  "resourceId",
  "runId",
  "jobId",
  "operationType",
  "provider",
  "model",
  "attempt",
  "requestMetadata",
  "providerRequestId",
  "responseUsage",
  "responseMetadata",
  "status",
  "failureCode",
  "failureMessage",
  "preparedAt",
  "submittedAt",
  "usageCapturedAt",
  "accountedAt",
]);

function spoolInvalid(): never {
  throw new ProviderAttemptNotDurableError(
    "provider attempt receipt spool record failed strict validation",
  );
}

function spoolOptionalString(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return spoolInvalid();
  return boundedString(value, label);
}

function spoolOptionalPositiveInteger(value: unknown, label: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return spoolInvalid();
  return value;
}

function spoolDate(value: unknown, label: string, required: boolean): Date | null {
  if (value == null) {
    if (required) return spoolInvalid();
    return null;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return spoolInvalid();
    return value;
  }
  if (typeof value !== "string") return spoolInvalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return spoolInvalid();
  return parsed;
}

function spoolRecordFromUnknown(
  value: unknown,
  expectedSourceEventId?: string,
): ReceiptSpoolRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return spoolInvalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !SPOOL_RECORD_KEYS.has(key))) return spoolInvalid();
  if (raw.spoolVersion !== 1 || typeof raw.sourceEventId !== "string") return spoolInvalid();
  const sourceEventId = boundedString(raw.sourceEventId, "sourceEventId");
  if (!sourceEventId.startsWith("provider-attempt:")) return spoolInvalid();
  if (expectedSourceEventId != null && sourceEventId !== expectedSourceEventId) return spoolInvalid();
  if (!Number.isSafeInteger(raw.teamId) || (raw.teamId as number) <= 0) return spoolInvalid();
  const userId = spoolOptionalPositiveInteger(raw.userId, "userId");
  const campaignId = spoolOptionalPositiveInteger(raw.campaignId, "campaignId");
  const contentId = spoolOptionalPositiveInteger(raw.contentId, "contentId");
  const resourceType = spoolOptionalString(raw.resourceType, "resourceType");
  const resourceId = raw.resourceId == null
    ? null
    : typeof raw.resourceId === "string"
      ? boundedString(raw.resourceId, "resourceId")
      : typeof raw.resourceId === "number" && Number.isSafeInteger(raw.resourceId) && raw.resourceId >= 0
        ? String(raw.resourceId)
      : spoolInvalid();
  const runId = spoolOptionalString(raw.runId, "runId");
  const jobId = spoolOptionalString(raw.jobId, "jobId");
  const operationType = typeof raw.operationType === "string"
    ? boundedString(raw.operationType, "operationType")
    : spoolInvalid();
  const provider = typeof raw.provider === "string" && ["gemini", "openai", "brave"].includes(raw.provider)
    ? raw.provider as SafeProviderProvider
    : spoolInvalid();
  const model = typeof raw.model === "string" ? boundedString(raw.model, "provider model") : spoolInvalid();
  if (!Number.isSafeInteger(raw.attempt) || (raw.attempt as number) <= 0) return spoolInvalid();
  if (!raw.requestMetadata || typeof raw.requestMetadata !== "object" || Array.isArray(raw.requestMetadata)) {
    return spoolInvalid();
  }
  if (Object.keys(raw.requestMetadata as object).some((key) => !SAFE_REQUEST_METADATA_KEYS.has(key))) {
    return spoolInvalid();
  }
  const requestMetadata = normalizeRequest(
    raw.requestMetadata as SafeProviderRequest,
    { teamId: raw.teamId as number, provider, model, operationType, attempt: raw.attempt as number },
  );
  const providerRequestId = spoolOptionalString(raw.providerRequestId, "providerRequestId");
  if (
    raw.responseMetadata != null &&
    (
      typeof raw.responseMetadata !== "object" ||
      Array.isArray(raw.responseMetadata) ||
      Object.keys(raw.responseMetadata as object).some((key) => !SAFE_RESPONSE_METADATA_KEYS.has(key))
    )
  ) return spoolInvalid();
  if (
    raw.responseUsage != null &&
    (
      typeof raw.responseUsage !== "object" ||
      Array.isArray(raw.responseUsage) ||
      Object.keys(raw.responseUsage as object).some((key) => !SAFE_RESPONSE_USAGE_KEYS.has(key)) ||
      (
        (raw.responseUsage as Record<string, unknown>).raw != null &&
        (
          typeof (raw.responseUsage as Record<string, unknown>).raw !== "object" ||
          Array.isArray((raw.responseUsage as Record<string, unknown>).raw) ||
          Object.keys((raw.responseUsage as Record<string, unknown>).raw as object)
            .some((key) => !SAFE_RAW_USAGE_KEYS.has(key))
          ||
          Object.values((raw.responseUsage as Record<string, unknown>).raw as object)
            .some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        )
      )
    )
  ) return spoolInvalid();
  const responseMetadata = raw.responseMetadata == null
    ? null
    : normalizeResponseCapture({
      usage: { unitType: "unknown", known: false },
      providerRequestId,
      metadata: raw.responseMetadata as SafeProviderResponseMetadata,
    }).metadata;
  const responseUsage = raw.responseUsage == null
    ? null
    : normalizeResponseCapture({
      usage: raw.responseUsage as KnownProviderUsage,
      providerRequestId,
      metadata: responseMetadata,
    }).usage;
  const status = typeof raw.status === "string" && SPOOL_STATUSES.has(raw.status as ProviderAttemptStatus)
    ? raw.status as ProviderAttemptStatus
    : spoolInvalid();
  if ((status === "usage_captured" || status === "accounted") && responseUsage == null) return spoolInvalid();
  if (status === "accounted" && (responseUsage?.known !== true || responseUsage.unitCount == null)) {
    return spoolInvalid();
  }
  const failureCode = spoolOptionalString(raw.failureCode, "failureCode");
  if (failureCode != null && !SPOOL_FAILURE_CODES.has(failureCode)) return spoolInvalid();
  const failureMessage = spoolOptionalString(raw.failureMessage, "failureMessage");
  if (failureMessage != null && failureMessage !== failureCode) return spoolInvalid();
  const preparedAt = spoolDate(raw.preparedAt, "preparedAt", true);
  const submittedAt = spoolDate(raw.submittedAt, "submittedAt", false);
  const usageCapturedAt = spoolDate(raw.usageCapturedAt, "usageCapturedAt", false);
  const accountedAt = spoolDate(raw.accountedAt, "accountedAt", false);
  return {
    spoolVersion: 1,
    sourceEventId,
    teamId: raw.teamId as number,
    userId,
    campaignId,
    contentId,
    resourceType,
    resourceId,
    runId,
    jobId,
    operationType,
    provider,
    model,
    attempt: raw.attempt as number,
    requestMetadata,
    providerRequestId,
    responseUsage,
    responseMetadata,
    status,
    failureCode,
    failureMessage,
    preparedAt: preparedAt as Date,
    submittedAt,
    usageCapturedAt,
    accountedAt,
  };
}

/** Strict boundary shared by file and private-object durable spools. */
export function validateProviderAttemptReceiptSpoolRecord(
  value: unknown,
  expectedSourceEventId?: string,
): ReceiptSpoolRecord {
  return spoolRecordFromUnknown(value, expectedSourceEventId);
}

export function serializeProviderAttemptReceiptSpoolRecord(
  record: ReceiptSpoolRecord,
): string {
  return spoolRecordToJson(spoolRecordFromUnknown(record, record.sourceEventId));
}

export function parseProviderAttemptReceiptSpoolRecord(
  serialized: string,
  expectedSourceEventId?: string,
): ReceiptSpoolRecord {
  try {
    return spoolRecordFromUnknown(JSON.parse(serialized) as unknown, expectedSourceEventId);
  } catch (error) {
    if (error instanceof ProviderAttemptNotDurableError) throw error;
    throw new ProviderAttemptNotDurableError(
      "provider attempt receipt spool JSON could not be parsed",
      error,
    );
  }
}

function spoolDirectory(): string | null {
  const configured = process.env[RECEIPT_SPOOL_ENV]?.trim();
  if (!configured) return null;
  if (!isAbsolute(configured)) {
    throw new Error(`${RECEIPT_SPOOL_ENV} must be an absolute durable path`);
  }
  return resolve(configured);
}

function spoolFileName(sourceEventId: string): string {
  const digest = createHash("sha256").update(sourceEventId).digest("hex");
  return `${digest}.json`;
}

function spoolRecordToJson(record: ReceiptSpoolRecord): string {
  // JSON.stringify receives an already normalized record.  No caller object
  // (and therefore no prompt/content) is copied into this document.
  return JSON.stringify({
    spoolVersion: 1,
    sourceEventId: record.sourceEventId,
    teamId: record.teamId,
    userId: record.userId ?? null,
    campaignId: record.campaignId ?? null,
    contentId: record.contentId ?? null,
    resourceType: record.resourceType ?? null,
    resourceId: record.resourceId == null ? null : String(record.resourceId),
    runId: record.runId ?? null,
    jobId: record.jobId ?? null,
    operationType: record.operationType,
    provider: record.provider,
    model: record.model,
    attempt: record.attempt,
    requestMetadata: record.requestMetadata,
    providerRequestId: record.providerRequestId ?? null,
    responseUsage: record.responseUsage ?? null,
    responseMetadata: record.responseMetadata ?? null,
    status: record.status,
    failureCode: record.failureCode ?? null,
    failureMessage: record.failureMessage ?? null,
    preparedAt: record.preparedAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    usageCapturedAt: record.usageCapturedAt?.toISOString() ?? null,
    accountedAt: record.accountedAt?.toISOString() ?? null,
  });
}

const fileSpool: ProviderAttemptReceiptSpool = {
  async ensureReady() {
    const directory = spoolDirectory();
    if (!directory) {
      throw new Error(`${RECEIPT_SPOOL_ENV} is not configured`);
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const probe = join(directory, `.provider-attempt-receipt-probe-${process.pid}`);
    await writeFile(probe, "ready", { encoding: "utf8", mode: 0o600 });
    await chmod(probe, 0o600);
    await unlink(probe);
  },
  async write(record) {
    const directory = spoolDirectory();
    if (!directory) {
      throw new Error(`${RECEIPT_SPOOL_ENV} is not configured`);
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, spoolFileName(record.sourceEventId));
    const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
    const serialized = serializeProviderAttemptReceiptSpoolRecord({ ...record, spoolVersion: 1 });
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      fileHandle = await open(temporary, "wx", 0o600);
      await fileHandle.writeFile(serialized, "utf8");
      await fileHandle.sync();
    } finally {
      await fileHandle?.close().catch(() => {});
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    // The receipt is not considered durable until both file contents and the
    // directory entry survive a crash.
    let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      directoryHandle = await open(directory, "r");
      await directoryHandle.sync();
    } finally {
      await directoryHandle?.close().catch(() => {});
    }
  },

  async read(sourceEventId) {
    const directory = spoolDirectory();
    if (!directory) return null;
    try {
       return parseProviderAttemptReceiptSpoolRecord(
         await readFile(join(directory, spoolFileName(sourceEventId)), "utf8"),
         sourceEventId,
       );
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  },
};

let defaultObjectSpool: ProviderAttemptReceiptSpool | null = null;

function defaultProviderAttemptReceiptSpool(): ProviderAttemptReceiptSpool {
  // An explicit local path is authoritative. Otherwise use the shared,
  // private object spool; its factory fails closed when DO Spaces is absent.
  if (spoolDirectory()) return fileSpool;
  if (!defaultObjectSpool) {
    defaultObjectSpool = createProviderAttemptObjectSpool({
      serialize: serializeProviderAttemptReceiptSpoolRecord,
      parse: validateProviderAttemptReceiptSpoolRecord,
    });
  }
  return defaultObjectSpool;
}

function toSpoolRecord(
  receipt: ProviderAttemptReceiptRecord,
): ReceiptSpoolRecord {
  return { ...receipt, spoolVersion: 1 };
}

interface AttemptRuntime {
  receipt: ProviderAttemptReceiptRecord;
  store: ProviderAttemptReceiptStore;
  spool: ProviderAttemptReceiptSpool;
  recordUsage?: (input: ProviderUsageInput) => Promise<unknown>;
  validateOwnership?: (context: ProviderAttemptContext) => Promise<unknown>;
  captured: ProviderResponseCapture | null;
  durableLocation: "database" | "spool";
}

const attemptStorage = new AsyncLocalStorage<AttemptRuntime>();
const responseAttemptSourceIds = new WeakMap<object, string>();

/**
 * A provider response may be handed to cost telemetry after the async attempt
 * context has ended. Keep this non-serialized identity bridge on the response
 * object itself; it contains no prompt or provider payload.
 */
export function registerProviderAttemptResponse(
  response: unknown,
  sourceEventId: string,
): void {
  if (response && typeof response === "object") {
    responseAttemptSourceIds.set(response, sourceEventId);
  }
}

export function providerAttemptSourceEventIdForResponse(
  response: unknown,
): string | undefined {
  return response && typeof response === "object"
    ? responseAttemptSourceIds.get(response)
    : undefined;
}

export interface ProviderAttemptHandle {
  readonly receipt: Readonly<ProviderAttemptReceiptRecord>;
  captureResponse(capture: ProviderResponseCapture): Promise<void>;
}

export function currentProviderAttempt(): ProviderAttemptHandle | null {
  const runtime = attemptStorage.getStore();
  if (!runtime) return null;
  return {
    receipt: runtime.receipt,
    captureResponse: (capture) => captureRuntimeResponse(runtime, capture),
  };
}

export async function markCurrentProviderAttemptAccounted(): Promise<void> {
  const runtime = attemptStorage.getStore();
  if (!runtime) return;
  await markRuntimeStatus(runtime, "accounted");
}

export async function markCurrentProviderAttemptAccountingFailed(): Promise<void> {
  const runtime = attemptStorage.getStore();
  if (!runtime) return;
  await markRuntimeStatus(runtime, "accounting_failed", {
    code: "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
    message: "immutable provider accounting failed",
  });
}

/** Reconcile using the receipt's persisted usage, never a caller's payload. */
export async function reconcileCurrentProviderAttempt(): Promise<void> {
  const runtime = attemptStorage.getStore();
  if (!runtime) return;
  await reconcileProviderAttempt(
    { sourceEventId: runtime.receipt.sourceEventId },
    {
      store: runtime.store,
      spool: runtime.spool,
      recordUsage: runtime.recordUsage,
      validateOwnership: runtime.validateOwnership,
    },
  );
  await markRuntimeStatus(runtime, "accounted");
}

/** Alias used by provider adapters that intercept an SDK response. */
export async function captureProviderSdkResponse(capture: ProviderResponseCapture): Promise<void> {
  const current = currentProviderAttempt();
  if (!current) throw new Error("captureProviderSdkResponse requires an active provider attempt");
  await current.captureResponse(capture);
}

async function persistSpool(runtime: AttemptRuntime): Promise<void> {
  await runtime.spool.write(toSpoolRecord(runtime.receipt));
  runtime.durableLocation = "spool";
}

async function markRuntimeStatus(
  runtime: AttemptRuntime,
  status: ProviderAttemptStatus,
  failure?: { code?: string; message?: string },
): Promise<void> {
  runtime.receipt.status = status;
  if (failure) {
    runtime.receipt.failureCode = failure.code ?? null;
    runtime.receipt.failureMessage = failure.message?.slice(0, MAX_FAILURE_MESSAGE) ?? null;
  }
  if (status === "accounted") runtime.receipt.accountedAt = new Date();
  try {
    await runtime.store.markStatus(runtime.receipt.sourceEventId, status, failure);
  } catch (error) {
    try {
      await persistSpool(runtime);
    } catch (spoolError) {
      throw new ProviderAttemptNotDurableError(
        "provider attempt receipt status could not be durably persisted",
        spoolError,
      );
    }
  }
}

async function captureRuntimeResponse(
  runtime: AttemptRuntime,
  rawCapture: ProviderResponseCapture,
): Promise<void> {
  const capture = normalizeResponseCapture(rawCapture);
  if (runtime.captured) {
    // Async providers first acknowledge an operation, then return usage.
    // Upgrade only that same operation's unknown checkpoint; known usage is
    // immutable and cannot be overwritten by a later response.
    if (runtime.captured.usage.known !== true &&
        runtime.captured.providerRequestId === capture.providerRequestId &&
        runtime.captured.usage.unitType === capture.usage.unitType) {
      // Continue to persist the provider's later, exact response below.
    } else if (!stableUsageEqual(runtime.captured.usage, capture.usage)) {
      throw new ProviderAttemptUsageUnavailableError(
        "provider response usage changed during one physical attempt",
      );
    } else {
      return;
    }
  }
  runtime.captured = capture;
  runtime.receipt.providerRequestId = capture.providerRequestId ?? null;
  runtime.receipt.responseUsage = capture.usage;
  runtime.receipt.responseMetadata = capture.metadata ?? null;
  runtime.receipt.usageCapturedAt = new Date();
  runtime.receipt.status = "usage_captured";
  try {
    await runtime.store.captureResponse(runtime.receipt.sourceEventId, capture, runtime.receipt.usageCapturedAt);
  } catch (error) {
    // A database response-write outage is recoverable only if the independent
    // configured durable spool accepts this safe metadata.
    try {
      await persistSpool(runtime);
    } catch (spoolError) {
      throw new ProviderAttemptNotDurableError(
        "known provider response usage could not be durably persisted",
        spoolError,
      );
    }
  }
  if (capture.usage.known !== true || capture.usage.unitCount == null) {
    await markRuntimeStatus(runtime, "reconciliation_required", {
      code: "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
      message: "provider response usage is partial or unknown",
    });
  }
}

function isAmbiguousSubmissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : "";
  return message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    code === "econnreset" ||
    code === "etimedout";
}

export type ProviderFailureClassification =
  | "PROVIDER_REJECTED"
  | "RATE_LIMITED"
  | "AUTHENTICATION_FAILED"
  | "INVALID_REQUEST"
  | "QUOTA_EXCEEDED"
  | "TRANSIENT_PROVIDER_ERROR";

/**
 * Receipt failures are an operational taxonomy, never a copy of provider
 * errors.  Provider messages can contain prompts, account identifiers, or
 * response fragments, so only these fixed classifications are persisted.
 */
export function classifyProviderFailureCode(error: unknown): ProviderFailureClassification {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : "";
  if (code === "429" || message.includes("rate limit") || message.includes("too many requests")) {
    return "RATE_LIMITED";
  }
  if (code === "401" || code === "403" || message.includes("unauthorized") || message.includes("forbidden")) {
    return "AUTHENTICATION_FAILED";
  }
  if (code === "400" || message.includes("invalid request") || message.includes("bad request")) {
    return "INVALID_REQUEST";
  }
  if (message.includes("quota")) return "QUOTA_EXCEEDED";
  if (isAmbiguousSubmissionError(error)) return "TRANSIENT_PROVIDER_ERROR";
  return "PROVIDER_REJECTED";
}

export interface ProviderAttemptReceiptDependencies {
  store?: ProviderAttemptReceiptStore;
  spool?: ProviderAttemptReceiptSpool;
  validateOwnership?: (context: ProviderAttemptContext) => Promise<unknown>;
  recordUsage?: (input: ProviderUsageInput) => Promise<unknown>;
}

export interface RunWithProviderAttemptOptions<TResponse> {
  context: ProviderAttemptContext;
  request: SafeProviderRequest;
  submit: (attempt: ProviderAttemptHandle) => Promise<TResponse>;
  _deps?: ProviderAttemptReceiptDependencies;
}

/**
 * The single wrapper contract for paid SDK calls:
 *
 *   runWithProviderAttempt({ context, request, submit: async ({captureResponse}) => {
 *     const response = await sdk.generate(...);
 *     await captureResponse({ providerRequestId, usage, metadata });
 *     return response;
 *   }});
 *
 * Existing post-call logCostTelemetry is also wired to the AsyncLocalStorage
 * handle, so wrappers may let that call capture the normalized usage.
 */
export async function runWithProviderAttempt<TResponse>(
  options: RunWithProviderAttemptOptions<TResponse>,
): Promise<TResponse> {
  const request = normalizeRequest(options.request, options.context);
  const identity = normalizeContext(options.context, request);
  const deps = options._deps ?? {};
  const store = deps.store ?? databaseStore;
  const spool = deps.spool ?? defaultProviderAttemptReceiptSpool();
  const validateOwnership = deps.validateOwnership ?? (async (context: ProviderAttemptContext) => {
    await validateProviderUsageOwnership({
      teamId: context.teamId,
      userId: context.userId ?? null,
      campaignId: context.campaignId,
      contentId: context.contentId,
      resourceType: context.resourceType,
      resourceId: context.resourceId,
    } as Parameters<typeof validateProviderUsageOwnership>[0] & {
      userId?: number | null;
    });
  });
  await validateOwnership(options.context);

  const prepared: ProviderAttemptReceiptRecord = {
    ...identity,
    preparedAt: new Date(),
    status: "prepared",
  };
  const existingPrimary = await safeFind(store, prepared.sourceEventId);
  const existingSpool = await safeFindSpool(spool, prepared.sourceEventId);
  const existing = existingSpool && (
    !existingPrimary ||
    existingPrimary.responseUsage == null ||
    existingSpool.responseUsage != null ||
    existingSpool.status === "accounted"
  ) ? existingSpool : existingPrimary;
  if (existing && existing.status !== "prepared") {
    throw new ProviderAttemptAlreadySubmittedError(prepared.sourceEventId);
  }
  let durableLocation: AttemptRuntime["durableLocation"] = "database";
  try {
    const persisted = await store.prepare(prepared);
    if (persisted.status !== "prepared") {
      throw new ProviderAttemptAlreadySubmittedError(persisted.sourceEventId);
    }
  } catch (error) {
    if (error instanceof ProviderAttemptAlreadySubmittedError) throw error;
    // A spool is allowed only after a response persistence failure.  It must
    // never turn a pre-call database outage into permission to spend.
    throw new ProviderAttemptNotDurableError(
      "provider attempt could not be durably prepared before submission",
      error,
    );
  }
  try {
    await spool.ensureReady();
  } catch (error) {
    throw new ProviderAttemptNotDurableError(
      "independent provider attempt fallback was not ready; refusing physical submission",
      error,
    );
  }

  const runtime: AttemptRuntime = {
    receipt: prepared,
    store,
    spool,
    recordUsage: deps.recordUsage,
    validateOwnership,
    captured: null,
    durableLocation,
  };
  try {
    try {
      await store.markSubmitted(prepared.sourceEventId, new Date());
    } catch (error) {
      const current = await safeFind(store, prepared.sourceEventId);
      if (current && current.status !== "prepared") {
        throw new ProviderAttemptAlreadySubmittedError(prepared.sourceEventId);
      }
      // Submission admission is a compare-and-set.  If it cannot be proven
      // committed, fail closed: no spool fallback and no provider call.
      throw new ProviderAttemptNotDurableError(
        "provider attempt submission admission was not durably committed; refusing physical submission",
        error,
      );
    }
    runtime.receipt.status = "submitted";
    runtime.receipt.submittedAt ??= new Date();
  } catch (error) {
    if (error instanceof ProviderAttemptAlreadySubmittedError) throw error;
    throw new ProviderAttemptNotDurableError(
      "provider attempt could not be durably marked before submission",
      error,
    );
  }

  return attemptStorage.run(runtime, async () => {
    try {
      const response = await options.submit({
        receipt: runtime.receipt,
        captureResponse: (capture) => captureRuntimeResponse(runtime, capture),
      });
      // Post-call telemetry often runs after this async scope has ended. Keep
      // only the deterministic receipt identity on the response object; never
      // serialize or retain provider payloads here.
      registerProviderAttemptResponse(response, runtime.receipt.sourceEventId);
      if (!runtime.captured) {
        await markRuntimeStatus(runtime, "reconciliation_required", {
          code: "PROVIDER_USAGE_UNAVAILABLE",
          message: "provider returned without known usage metadata",
        });
        throw new ProviderAttemptUsageUnavailableError(
          "provider returned without known usage metadata; refusing replay",
        );
      }
      if (runtime.captured.usage.known !== true) {
        await markRuntimeStatus(runtime, "reconciliation_required", {
          code: "PROVIDER_USAGE_UNAVAILABLE",
          message: "provider returned without known usage metadata",
        });
        throw new ProviderAttemptUsageUnavailableError(
          "provider returned without known usage metadata; refusing replay",
        );
      }

      // Reconcile immediately from the persisted response usage.  This is
      // idempotent on sourceEventId and does not call the provider.
      try {
        await reconcileProviderAttempt(
          { sourceEventId: runtime.receipt.sourceEventId },
          {
            store,
            spool,
            recordUsage: deps.recordUsage,
            validateOwnership,
          },
        );
      } catch (error) {
        await markRuntimeStatus(runtime, "accounting_failed", {
          code: "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
          message: "known usage could not be inserted into the immutable ledger",
        });
        throw new ProviderAttemptAccountingError(
          "provider response is durable but immutable accounting failed; refusing replay",
          error,
        );
      }
      return response;
    } catch (error) {
      if (
        !runtime.captured &&
        error &&
        typeof error === "object" &&
        (error as { code?: unknown }).code === "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE"
      ) {
        await markRuntimeStatus(runtime, "reconciliation_required", {
          code: "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
          message: "provider response did not expose known usage metadata",
        });
      }
      if (runtime.captured && !isProviderAttemptTerminalError(error)) {
        await markRuntimeStatus(runtime, "reconciliation_required", {
          code: "PROVIDER_RESULT_NOT_DURABLE",
          message: "provider response was returned but downstream persistence failed",
        });
        throw new ProviderAttemptNotDurableError(
          "provider response persistence is uncertain; refusing replay",
          error,
        );
      }
      if (!runtime.captured && isAmbiguousSubmissionError(error)) {
        await markRuntimeStatus(runtime, "uncertain", {
          code: "PROVIDER_SUBMISSION_UNCERTAIN",
          message: "provider submission outcome is uncertain",
        });
        throw new ProviderAttemptSubmissionUncertainError(
          "provider submission outcome is uncertain; refusing replay",
          error,
        );
      }
      if (!runtime.captured && !isProviderAttemptTerminalError(error)) {
        const classification = classifyProviderFailureCode(error);
        await markRuntimeStatus(runtime, "provider_rejected", {
          code: classification,
          message: classification,
        });
      }
      throw error;
    }
  });
}

async function safeFind(
  store: ProviderAttemptReceiptStore,
  sourceEventId: string,
): Promise<ProviderAttemptReceiptRecord | null> {
  try {
    return await store.find(sourceEventId);
  } catch {
    return null;
  }
}

async function safeFindSpool(
  spool: ProviderAttemptReceiptSpool,
  sourceEventId: string,
): Promise<ReceiptSpoolRecord | null> {
  const record = await spool.read(sourceEventId);
  return record == null ? null : spoolRecordFromUnknown(record, sourceEventId);
}

export interface ReconcileProviderAttemptInput {
  sourceEventId: string;
}

export interface ReconcileProviderAttemptDependencies {
  store?: ProviderAttemptReceiptStore;
  spool?: ProviderAttemptReceiptSpool;
  recordUsage?: (input: ProviderUsageInput) => Promise<unknown>;
  validateOwnership?: (context: ProviderAttemptContext) => Promise<unknown>;
}

/**
 * Insert exactly the usage already returned and durably captured for a
 * receipt.  No provider operation is polled/replayed here and no zero usage
 * is synthesized when the response omitted usage.
 */
export async function reconcileProviderAttempt(
  input: ReconcileProviderAttemptInput,
  deps: ReconcileProviderAttemptDependencies = {},
): Promise<{ receipt: ProviderAttemptReceiptRecord; ledger: unknown }> {
  const sourceEventId = boundedString(input.sourceEventId, "sourceEventId");
  const store = deps.store ?? databaseStore;
  const spool = deps.spool ?? defaultProviderAttemptReceiptSpool();
  let primaryReceipt: ProviderAttemptReceiptRecord | null = null;
  try {
    primaryReceipt = await store.find(sourceEventId);
  } catch {
    // The independent spool is specifically for recovery while the primary
    // receipt store is unavailable.
  }
  let spooledReceipt: ReceiptSpoolRecord | null = null;
  const rawSpooledReceipt = await spool.read(sourceEventId);
  spooledReceipt = rawSpooledReceipt == null
    ? null
    : spoolRecordFromUnknown(rawSpooledReceipt, sourceEventId);
  // A stale prepared/submitted database row must not hide a newer response
  // checkpoint written to the fallback spool.
  const receipt = spooledReceipt && (
    !primaryReceipt ||
    primaryReceipt.responseUsage == null ||
    spooledReceipt.responseUsage != null ||
    spooledReceipt.status === "accounted"
  ) ? spooledReceipt : primaryReceipt;
  if (!receipt) throw new ProviderAttemptNotDurableError("provider attempt receipt was not found");
  const validateOwnership = deps.validateOwnership ?? (async (context: ProviderAttemptContext) => {
    await validateProviderUsageOwnership({
      teamId: context.teamId,
      userId: context.userId ?? null,
      campaignId: context.campaignId,
      contentId: context.contentId,
      resourceType: context.resourceType,
      resourceId: context.resourceId,
    } as Parameters<typeof validateProviderUsageOwnership>[0] & {
      userId?: number | null;
    });
  });
  // Reconciliation is tenant-sensitive even when no ledger insert remains.
  // Validate before the accounted fast path so a copied sourceEventId/spool
  // cannot be used as a cross-tenant existence oracle.
  await validateOwnership({
    teamId: receipt.teamId,
    userId: receipt.userId ?? null,
    campaignId: receipt.campaignId ?? null,
    contentId: receipt.contentId ?? null,
    resourceType: receipt.resourceType ?? null,
    resourceId: receipt.resourceId ?? null,
    runId: receipt.runId ?? null,
    jobId: receipt.jobId ?? null,
    operationType: receipt.operationType,
    provider: receipt.provider,
    model: receipt.model,
    attempt: receipt.attempt,
    attemptKey: receipt.sourceEventId,
  });
  if (receipt.status === "accounted") {
    return { receipt, ledger: null };
  }
  if (!receipt.responseUsage || receipt.responseUsage.known !== true) {
    throw new ProviderAttemptUsageUnavailableError(
      "reconciliation requires known provider-returned usage; no zero event was fabricated",
    );
  }
  const usage = receipt.responseUsage;
  if (usage.unitCount == null) {
    throw new ProviderAttemptUsageUnavailableError(
      "reconciliation requires a provider-reported aggregate usage count",
    );
  }
  const recordUsage = deps.recordUsage ?? (recordProviderUsage as (input: ProviderUsageInput) => Promise<unknown>);
  const ledger = await recordUsage({
    sourceEventId: receipt.sourceEventId,
    teamId: receipt.teamId,
    campaignId: receipt.campaignId ?? null,
    runId: receipt.runId ?? null,
    jobId: receipt.jobId ?? null,
    contentId: receipt.contentId ?? null,
    resourceType: receipt.resourceType ?? null,
    resourceId: receipt.resourceId ?? null,
    operationType: receipt.operationType,
    provider: receipt.provider,
    model: receipt.model,
    unitType: usage.unitType,
    inputUnits: usage.inputUnits ?? null,
    outputUnits: usage.outputUnits ?? null,
    unitCount: usage.unitCount,
    // The immutable ledger resolves its locked rate card; this value is never
    // used as an estimate of unknown usage.
    costMicrousd: 0,
    occurredAt: receipt.usageCapturedAt ?? receipt.submittedAt ?? receipt.preparedAt,
    providerRequestId: receipt.providerRequestId ?? null,
    providerMetadata: receipt.responseMetadata
      ? { ...receipt.responseMetadata }
      : null,
    attempt: receipt.attempt,
  });
  const updated = { ...receipt, status: "accounted" as const, accountedAt: new Date() };
  try {
    await store.markStatus(receipt.sourceEventId, "accounted");
  } catch {
    await spool.write(toSpoolRecord(updated));
  }
  return { receipt: updated, ledger };
}

/**
 * Convert a normalized cost-telemetry usage object into the safe receipt
 * shape.  `known` is intentionally false when an SDK omitted its usage block.
 */
export function providerAttemptUsageFromTelemetry(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    characters?: number;
    imageCount?: number;
    videoSeconds?: number;
    requestCount?: number;
    known?: boolean;
  },
): KnownProviderUsage {
  if ("requestCount" in usage) {
    return {
      unitType: "requests",
      unitCount: usage.requestCount ?? null,
      known: usage.known !== false && usage.requestCount != null,
    };
  }
  if ("characters" in usage) {
    return {
      unitType: "characters",
      unitCount: usage.characters ?? null,
      known: usage.known !== false && usage.characters != null,
    };
  }
  if ("imageCount" in usage) {
    return {
      unitType: "images",
      unitCount: usage.imageCount ?? null,
      known: usage.known !== false && usage.imageCount != null,
    };
  }
  if ("videoSeconds" in usage) {
    return {
      unitType: "seconds",
      unitCount: usage.videoSeconds ?? null,
      known: usage.known !== false && usage.videoSeconds != null,
    };
  }
  const inputUnits = usage.inputTokens ?? null;
  const outputUnits = usage.outputTokens ?? null;
  const usageFieldsPresent = usage.totalTokens != null;
  return {
    unitType: "tokens",
    unitCount: usage.totalTokens ?? null,
    inputUnits,
    outputUnits,
    known: usage.known !== false && usageFieldsPresent,
  };
}

export function deterministicProviderAttemptSourceEventId(
  context: ProviderAttemptContext,
  request: SafeProviderRequest,
): string {
  const normalizedRequest = normalizeRequest(request, context);
  return normalizeContext(
    {
      ...context,
      invocationKey: context.invocationKey ?? context.attemptKey ?? "deterministic-provider-attempt",
    },
    normalizedRequest,
  ).sourceEventId;
}

/**
 * Tiny in-memory store useful for deterministic fault tests and adapter
 * contract tests. Production code uses the RLS-backed database store.
 */
export class MemoryProviderAttemptReceiptStore implements ProviderAttemptReceiptStore {
  readonly rows = new Map<string, ProviderAttemptReceiptRecord>();
  failPrepare = false;
  failCapture = false;
  failStatus = false;

  async prepare(receipt: ProviderAttemptReceiptRecord): Promise<ProviderAttemptReceiptRecord> {
    if (this.failPrepare) throw new Error("receipt prepare outage");
    const existing = this.rows.get(receipt.sourceEventId);
    if (existing) return existing;
    this.rows.set(receipt.sourceEventId, { ...receipt });
    return receipt;
  }

  async markSubmitted(sourceEventId: string, submittedAt: Date): Promise<void> {
    if (this.failStatus) throw new Error("receipt status outage");
    const row = this.rows.get(sourceEventId);
    if (!row) throw new Error("receipt missing");
    if (row.status !== "prepared") throw new Error("receipt submission CAS failed");
    row.status = "submitted";
    row.submittedAt = submittedAt;
  }

  async captureResponse(sourceEventId: string, capture: ProviderResponseCapture, capturedAt: Date): Promise<void> {
    if (this.failCapture) throw new Error("receipt response outage");
    const row = this.rows.get(sourceEventId);
    if (!row) throw new Error("receipt missing");
    row.providerRequestId = capture.providerRequestId ?? null;
    row.responseUsage = capture.usage;
    row.responseMetadata = capture.metadata ?? null;
    row.status = "usage_captured";
    row.usageCapturedAt = capturedAt;
  }

  async markStatus(sourceEventId: string, status: ProviderAttemptStatus, failure?: { code?: string; message?: string }): Promise<void> {
    if (this.failStatus) throw new Error("receipt status outage");
    const row = this.rows.get(sourceEventId);
    if (!row) throw new Error("receipt missing");
    row.status = status;
    row.failureCode = failure?.code ?? null;
    row.failureMessage = failure?.message ?? null;
    if (status === "accounted") row.accountedAt = new Date();
  }

  async find(sourceEventId: string): Promise<ProviderAttemptReceiptRecord | null> {
    return this.rows.get(sourceEventId) ?? null;
  }
}

/** Small deterministic spool for tests; production uses the 0600 disk spool. */
export class MemoryProviderAttemptReceiptSpool implements ProviderAttemptReceiptSpool {
  readonly rows = new Map<string, ReceiptSpoolRecord>();
  failWrite = false;

  async ensureReady(): Promise<void> {
    if (this.failWrite) throw new Error("spool outage");
  }

  async write(record: ReceiptSpoolRecord): Promise<void> {
    if (this.failWrite) throw new Error("spool outage");
    this.rows.set(record.sourceEventId, { ...record });
  }

  async read(sourceEventId: string): Promise<ReceiptSpoolRecord | null> {
    return this.rows.get(sourceEventId) ?? null;
  }
}
