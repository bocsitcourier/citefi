import { createHash } from "node:crypto";

/**
 * Provider responses and exceptions can contain customer content, credentials,
 * or the complete payload.  Diagnostics deliberately retain identity only:
 * a digest, byte/character length, and the bounded path that failed.
 */
export interface ProviderOutputDigest {
  sha256: string;
  length: number;
}

export function digestProviderOutput(output: unknown): ProviderOutputDigest {
  const text =
    typeof output === "string"
      ? output
      : (() => {
          try {
            return JSON.stringify(output) ?? String(output);
          } catch {
            return String(output);
          }
        })();
  return {
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    length: text.length,
  };
}

function errorIdentity(error: unknown): {
  type: string;
  code: string | null;
  digest: ProviderOutputDigest;
} {
  const errorObject =
    error && typeof error === "object"
      ? (error as { constructor?: { name?: string }; code?: unknown })
      : null;
  const type =
    errorObject?.constructor?.name ||
    (error instanceof Error ? error.name : typeof error);
  const code =
    typeof errorObject?.code === "string" ? errorObject.code : null;
  const message = error instanceof Error ? error.message : String(error);
  return { type, code, digest: digestProviderOutput(message) };
}

/**
 * Safe error diagnostics for logs/telemetry.  Never include the exception
 * message itself because SDK errors commonly embed provider response bodies.
 */
export function redactProviderError(
  error: unknown,
  output?: unknown,
  path = "provider",
): string {
  const identity = errorIdentity(error);
  const outputDigest = output === undefined ? null : digestProviderOutput(output);
  return [
    `path=${path}`,
    `errorType=${identity.type}`,
    `errorCode=${identity.code ?? "none"}`,
    `errorSha256=${identity.digest.sha256}`,
    `errorLength=${identity.digest.length}`,
    ...(outputDigest
      ? [
          `outputSha256=${outputDigest.sha256}`,
          `outputLength=${outputDigest.length}`,
        ]
      : []),
  ].join(" ");
}

export function redactProviderOutput(
  output: unknown,
  path = "provider_output",
): string {
  const digest = digestProviderOutput(output);
  return `path=${path} outputSha256=${digest.sha256} outputLength=${digest.length}`;
}