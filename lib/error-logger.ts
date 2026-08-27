import { db } from "./db";
import { errorLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { redactString, sanitizeMetadata } from "./incident-intelligence/core";
import { ingestTelemetry } from "./incident-intelligence/service";

export type ErrorType =
  | "GEMINI"
  | "GPT4"
  | "DALLE"
  | "SCHEMA"
  | "UPLOAD"
  | "QUEUE"
  | "HERO_IMAGE"
  | "PODCAST"
  | "VIDEO"
  | "PUBLISHING"
  | "SOCIAL"
  | "NETWORK"
  | "AUTH"
  | "SYSTEM";

export type Severity = "warning" | "error" | "critical";

export interface LogErrorParams {
  errorType: ErrorType;
  errorMessage: string;
  stackTrace?: string;
  severity?: Severity;
  batchId?: number;
  articleId?: number;
  component?: string;
  context?: Record<string, unknown>;
  screenshotUrl?: string;
  requestId?: string;
  jobId?: string;
  deployId?: string;
  fingerprint?: string;
}

// ─── Slack / webhook notification ────────────────────────────────────────────
const SEVERITY_EMOJI: Record<Severity, string> = {
  warning: ":warning:",
  error: ":x:",
  critical: ":rotating_light:",
};

async function sendSlackNotification(params: LogErrorParams & { severity: Severity }): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = SEVERITY_EMOJI[params.severity];
  const component = params.component ? ` [${redactString(params.component, 100)}]` : "";
  const contextText =
    params.context && Object.keys(params.context).length > 0
      ? `\`\`\`${JSON.stringify(params.context, null, 2).slice(0, 1500)}\`\`\``
      : "";

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${params.severity.toUpperCase()}: ${params.errorType}${component}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: redactString(params.errorMessage, 2000),
      },
    },
  ];

  if (params.batchId || params.articleId) {
    const fields: { type: string; text: string }[] = [];
    if (params.batchId) fields.push({ type: "mrkdwn", text: `*Batch ID:* ${params.batchId}` });
    if (params.articleId) fields.push({ type: "mrkdwn", text: `*Article ID:* ${params.articleId}` });
    blocks.push({ type: "section", fields });
  }

  if (contextText) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Context Snapshot:*\n${contextText}` },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Citefi • ${new Date().toISOString()}`,
      },
    ],
  });

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
  } catch {
    console.error("[ERROR_LOG] Failed to send Slack notification");
  }
}

// ─── Core logger ─────────────────────────────────────────────────────────────
export async function logError(params: LogErrorParams): Promise<void> {
  const severity = params.severity ?? "error";
  const safeContext = sanitizeMetadata(params.context);
  const safeMessage = redactString(params.errorMessage, 8_000);
  const safeStack = params.stackTrace ? redactString(params.stackTrace, 32_000) : undefined;

  const enrichedMessage = params.component
    ? `[${redactString(params.component, 100)}] ${safeMessage}`
    : safeMessage;

  const contextSuffix =
    Object.keys(safeContext).length > 0
      ? `\n\n--- Context Snapshot ---\n${JSON.stringify(safeContext, null, 2)}`
      : "";

  const fullStack = safeStack
    ? safeStack + contextSuffix
    : contextSuffix || undefined;

  try {
    await db.insert(errorLogs).values({
      errorType: params.errorType,
      errorMessage: enrichedMessage,
      stackTrace: fullStack,
      severity,
      batchId: params.batchId,
      articleId: params.articleId,
      // Signed object-storage URLs are credentials and must never be durable.
      screenshotUrl: null,
      resolved: 0,
    });
  } catch {
    console.error("[ERROR_LOG] Failed to persist error to database");
  }

  console.error(
    `[ERROR_LOG] ${severity.toUpperCase()} ${params.errorType}: ${enrichedMessage}`
  );

  // Durable structured store is additive: legacy error_logs and callers remain
  // fully compatible while incident consumers migrate independently.
  await ingestTelemetry({
    severity,
    category: params.errorType,
    message: enrichedMessage,
    stack: safeStack,
    process: params.component,
    requestId: params.requestId,
    jobId: params.jobId,
    deployId: params.deployId,
    fingerprint: params.fingerprint,
    metadata: {
      ...safeContext,
      batchId: params.batchId,
      articleId: params.articleId,
    },
  });

  // Fire Slack notification for all error severities (warning, error, critical)
  void sendSlackNotification({ ...params, errorMessage: safeMessage, stackTrace: safeStack, screenshotUrl: undefined, context: safeContext, severity });
}

// ─── Convenience helpers ──────────────────────────────────────────────────────
export function logCritical(
  errorType: ErrorType,
  errorMessage: string,
  opts: Omit<LogErrorParams, "errorType" | "errorMessage" | "severity"> = {}
): Promise<void> {
  return logError({ ...opts, errorType, errorMessage, severity: "critical" });
}

export function logWarning(
  errorType: ErrorType,
  errorMessage: string,
  opts: Omit<LogErrorParams, "errorType" | "errorMessage" | "severity"> = {}
): Promise<void> {
  return logError({ ...opts, errorType, errorMessage, severity: "warning" });
}

// ─── Query helpers ────────────────────────────────────────────────────────────
export async function getRecentErrors(limit: number = 100) {
  return await db
    .select()
    .from(errorLogs)
    .orderBy(errorLogs.createdAt)
    .limit(limit);
}

export async function getUnresolvedErrors() {
  return await db
    .select()
    .from(errorLogs)
    .where(eq(errorLogs.resolved, 0))
    .orderBy(errorLogs.createdAt);
}
