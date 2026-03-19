import { db } from "./db";
import { errorLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";

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
  const component = params.component ? ` [${params.component}]` : "";
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
        text: params.errorMessage.slice(0, 2000),
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

  if (params.screenshotUrl) {
    blocks.push({
      type: "image",
      title: { type: "plain_text", text: "UI Screenshot at time of error" },
      image_url: params.screenshotUrl,
      alt_text: "Error screenshot",
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `ApexContent Engine • ${new Date().toISOString()}`,
      },
    ],
  });

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
  } catch (err) {
    console.error("[ERROR_LOG] Failed to send Slack notification:", err);
  }
}

// ─── Core logger ─────────────────────────────────────────────────────────────
export async function logError(params: LogErrorParams): Promise<void> {
  const severity = params.severity ?? "error";

  const enrichedMessage = params.component
    ? `[${params.component}] ${params.errorMessage}`
    : params.errorMessage;

  const contextSuffix =
    params.context && Object.keys(params.context).length > 0
      ? `\n\n--- Context Snapshot ---\n${JSON.stringify(params.context, null, 2)}`
      : "";

  const fullStack = params.stackTrace
    ? params.stackTrace + contextSuffix
    : contextSuffix || undefined;

  try {
    await db.insert(errorLogs).values({
      errorType: params.errorType,
      errorMessage: enrichedMessage,
      stackTrace: fullStack,
      severity,
      batchId: params.batchId,
      articleId: params.articleId,
      screenshotUrl: params.screenshotUrl,
      resolved: 0,
    });
  } catch (dbError) {
    console.error("[ERROR_LOG] Failed to persist error to database:", dbError);
  }

  console.error(
    `[ERROR_LOG] ${severity.toUpperCase()} ${params.errorType}: ${enrichedMessage}`
  );

  // Fire Slack notification for all error severities (warning, error, critical)
  void sendSlackNotification({ ...params, severity });
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
