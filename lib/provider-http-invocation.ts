import { createHash, randomUUID } from "node:crypto";
import {
  currentProviderInvocationIdentity,
  runWithProviderInvocationIdentity,
} from "./provider-invocation-identity";

/**
 * One HTTP action is one logical invocation. A client idempotency key survives
 * request redelivery; an unkeyed request is deliberately a new action. Never
 * derive identity from prompts, request bodies, cookies, or Authorization.
 */
export function providerHttpInvocationKey(
  request: Pick<Request, "headers" | "url" | "method">,
  owner: { teamId: number; userId: number },
): string {
  const clientKey = request.headers.get("x-idempotency-key")?.trim();
  if (clientKey && clientKey.length > 255) {
    throw Object.assign(new Error("Idempotency key exceeds 255 characters"), { statusCode: 400 });
  }
  // A worker/job identity is stronger than an unkeyed HTTP delivery. Do not
  // replace it with a fresh UUID when an internal route happens to call this
  // helper while processing a durable job.
  const ambientInvocationKey = currentProviderInvocationIdentity()?.invocationKey;
  if (!clientKey && ambientInvocationKey) return ambientInvocationKey;
  const digest = createHash("sha256").update(JSON.stringify([
    owner.teamId,
    owner.userId,
    request.method,
    new URL(request.url).pathname,
    clientKey || randomUUID(),
  ])).digest("hex");
  return `http:${digest}`;
}

export function runWithProviderHttpInvocation<T>(
  request: Pick<Request, "headers" | "url" | "method">,
  owner: { teamId: number; userId: number },
  callback: () => T,
): T {
  return runWithProviderInvocationIdentity(providerHttpInvocationKey(request, owner), callback);
}