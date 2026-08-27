import { redactString, sanitizeMetadata, TELEMETRY_LIMITS } from "./incident-intelligence/core";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const PROCESS_DIAGNOSTIC_MAX_LENGTH = 8_192;

export interface ChildTerminationDecision {
  planned: boolean;
  reason: "supervisor_signal" | "clean_exit" | "unexpected_exit" | "unexpected_signal";
  exitCode: number;
}

/** Pure policy used by process supervisors after a child emits `close`. */
export function classifyChildTermination(args: {
  supervisorSignal?: string | null;
  code: number | null;
  childSignal?: string | null;
}): ChildTerminationDecision {
  if (args.supervisorSignal) {
    return { planned: true, reason: "supervisor_signal", exitCode: 0 };
  }
  if (args.code === 0) {
    return { planned: true, reason: "clean_exit", exitCode: 0 };
  }
  if (args.childSignal) {
    return { planned: false, reason: "unexpected_signal", exitCode: 1 };
  }
  return {
    planned: false,
    reason: "unexpected_exit",
    exitCode: args.code && args.code > 0 ? args.code : 1,
  };
}

/** Convert an untrusted process/error value to one bounded, redacted string. */
export function sanitizeProcessDiagnostic(
  value: unknown,
  maxLength = PROCESS_DIAGNOSTIC_MAX_LENGTH,
): string {
  let text: string;
  if (value instanceof Error) {
    text = `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  } else if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(sanitizeMetadata(value));
    } catch {
      text = "[UNSERIALIZABLE_DIAGNOSTIC]";
    }
  }
  return redactString(text, Math.min(Math.max(maxLength, 0), TELEMETRY_LIMITS.stackLength));
}

export function processDiagnosticLog(
  level: "log" | "warn" | "error",
  message: string,
  detail?: unknown,
): void {
  const output = detail === undefined
    ? sanitizeProcessDiagnostic(message)
    : sanitizeProcessDiagnostic(`${message} ${sanitizeProcessDiagnostic(detail)}`);
  console[level](output);
}

/**
 * Buffers child output by line so secrets split across stream chunks cannot
 * bypass redaction. Overlong lines are truncated and discarded until newline.
 */
export function createSanitizedOutputForwarder(
  write: (safeText: string) => void,
  maxLineLength = PROCESS_DIAGNOSTIC_MAX_LENGTH,
) {
  let buffer = "";
  let truncated = false;

  const emit = () => {
    if (!buffer && !truncated) return;
    write(`${sanitizeProcessDiagnostic(buffer, maxLineLength)}${truncated ? " [TRUNCATED]" : ""}\n`);
    buffer = "";
    truncated = false;
  };

  return {
    write(chunk: unknown) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      for (const part of text.split(/(\r?\n)/)) {
        if (part === "\n" || part === "\r\n") {
          emit();
        } else if (!truncated) {
          const available = maxLineLength - buffer.length;
          buffer += part.slice(0, Math.max(available, 0));
          if (part.length > available) truncated = true;
        }
      }
    },
    end() {
      emit();
    },
  };
}

export function sanitizeProcessDiagnosticRecord(
  value: unknown,
): Record<string, unknown> {
  return sanitizeMetadata(value);
}

const PROCESS_SPOOL_MAX_BYTES = 1024 * 1024;
const PROCESS_SPOOL_MAX_RECORDS = 200;

/** Append one sanitized record to the owner-only, size-bounded process spool. */
export async function appendProcessDiagnosticRecord(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const line = `${JSON.stringify(sanitizeProcessDiagnosticRecord(value))}\n`;
  await appendFile(path, line, { mode: 0o600 });
  await chmod(path, 0o600);

  const contents = await readFile(path, "utf8");
  if (Buffer.byteLength(contents) <= PROCESS_SPOOL_MAX_BYTES) return;
  const lines = contents.split("\n").filter(Boolean).slice(-PROCESS_SPOOL_MAX_RECORDS);
  while (lines.length > 1 && Buffer.byteLength(`${lines.join("\n")}\n`) > PROCESS_SPOOL_MAX_BYTES) {
    lines.shift();
  }
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}