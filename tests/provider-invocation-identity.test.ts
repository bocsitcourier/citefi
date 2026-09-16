import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateProviderAttemptIdentity,
  runWithProviderInvocationIdentity,
} from "../lib/provider-invocation-identity";
import {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
  runWithProviderAttempt,
} from "../lib/provider-attempt-receipts";
import { createPipelineHandler } from "../lib/pipeline-worker";

function job(id: string, invocationKey?: string) {
  return {
    id,
    data: { teamId: 7, ...(invocationKey ? { invocationKey } : {}) },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as any;
}

test("allocation reserves one logical slot and retries vary only by attempt", () => {
  const allocations = runWithProviderInvocationIdentity("worker-invocation", () => [
    allocateProviderAttemptIdentity({
      attemptKey: "article:42:hero",
      provider: "gemini",
      operationType: "article_generation",
      model: "gemini-2.5-flash",
    }),
    allocateProviderAttemptIdentity({
      attemptKey: "article:42:hero",
      provider: "gemini",
      operationType: "article_generation",
      model: "gemini-2.5-flash",
    }),
  ]);
  assert.equal(allocations[0]?.attemptKey, "article:42:hero");
  assert.equal(allocations[0]?.invocationKey.endsWith(":call:0"), true);
  assert.equal(allocations[1]?.invocationKey.endsWith(":call:1"), true);
  assert.notEqual(allocations[0]?.invocationKey, allocations[1]?.invocationKey);
});

test("nested allocated calls under one worker are distinct and replay is blocked", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  let providerCalls = 0;
  const run = (identity: { invocationKey: string; attemptKey: string }) =>
    runWithProviderInvocationIdentity(identity.invocationKey, () =>
      runWithProviderAttempt({
        context: {
          teamId: 7,
          operationType: "article_generation",
          provider: "gemini",
          model: "gemini-2.5-flash",
          attempt: 1,
          invocationKey: identity.invocationKey,
          attemptKey: identity.attemptKey,
        },
        request: { model: "gemini-2.5-flash", maxOutputTokens: 32 },
        submit: async ({ captureResponse }) => {
          providerCalls++;
          await captureResponse({
            usage: { unitType: "tokens", unitCount: 1, known: true },
          });
          return "ok";
        },
        _deps: {
          store,
          spool,
          validateOwnership: async () => undefined,
          recordUsage: async () => ({ id: providerCalls }),
        },
      }),
    );

  const identities = await runWithProviderInvocationIdentity("worker-nested", async () => {
    const first = allocateProviderAttemptIdentity({
      provider: "gemini",
      operationType: "article_generation",
      model: "gemini-2.5-flash",
      attemptKey: "hero",
    });
    const second = allocateProviderAttemptIdentity({
      provider: "gemini",
      operationType: "article_generation",
      model: "gemini-2.5-flash",
      attemptKey: "hero",
    });
    await run(first);
    await run(second);
    return { first, second };
  });
  assert.notEqual(identities.first.invocationKey, identities.second.invocationKey);
  assert.equal(providerCalls, 2);
  await assert.rejects(() => run(identities.first));
  assert.equal(providerCalls, 2);
});

test("worker redelivery keeps one provider receipt identity after a crash boundary", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  let providerCalls = 0;
  let ledgerWrites = 0;
  let crashAfterPaidCall = true;
  const handler = createPipelineHandler(
    "article-generation",
    async () => {
      const result = await runWithProviderAttempt({
        context: {
          teamId: 7,
          operationType: "article_generation",
          provider: "gemini",
          model: "gemini-2.5-flash",
          attempt: 1,
          attemptKey: "article:42:hero",
        },
        request: { model: "gemini-2.5-flash", maxOutputTokens: 32 },
        submit: async ({ captureResponse }) => {
          providerCalls++;
          await captureResponse({
            usage: { unitType: "tokens", unitCount: 3, known: true },
          });
          return "provider-result";
        },
        _deps: {
          store,
          spool,
          validateOwnership: async () => undefined,
          recordUsage: async () => {
            ledgerWrites++;
            return { id: ledgerWrites };
          },
        },
      });
      if (crashAfterPaidCall) {
        crashAfterPaidCall = false;
        throw new Error("worker crashed after paid call committed");
      }
      return result;
    },
    {
      stage: "text_gen",
      _deps: { recordProviderFailure: async () => undefined },
    } as any,
  );

  await assert.rejects(() => handler(job("redelivered-job", "invocation-42")));
  await assert.rejects(() => handler(job("redelivered-job", "invocation-42")));
  assert.equal(providerCalls, 1);
  assert.equal(ledgerWrites, 1);
});

test("distinct logical jobs on one resource receive distinct provider identities", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  let providerCalls = 0;
  const handler = createPipelineHandler(
    "article-generation",
    async () => runWithProviderAttempt({
      context: {
        teamId: 7,
        operationType: "article_generation",
        provider: "gemini",
        model: "gemini-2.5-flash",
        attempt: 1,
        attemptKey: "article:42:hero",
      },
      request: { model: "gemini-2.5-flash", maxOutputTokens: 32 },
      submit: async ({ captureResponse }) => {
        providerCalls++;
        await captureResponse({
          usage: { unitType: "tokens", unitCount: 3, known: true },
        });
        return "provider-result";
      },
      _deps: {
        store,
        spool,
        validateOwnership: async () => undefined,
        recordUsage: async () => ({ id: providerCalls }),
      },
    }),
    {
      stage: "text_gen",
      _deps: { recordProviderFailure: async () => undefined },
    } as any,
  );

  assert.equal(await handler(job("logical-job-a")), "provider-result");
  assert.equal(await handler(job("logical-job-b")), "provider-result");
  assert.equal(providerCalls, 2);
  assert.equal(store.rows.size, 2);
});
