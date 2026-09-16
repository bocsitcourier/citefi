import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
  ProviderAttemptAccountingError,
  ProviderAttemptAlreadySubmittedError,
  ProviderAttemptNotDurableError,
  ProviderAttemptSubmissionUncertainError,
  ProviderAttemptUsageUnavailableError,
  reconcileProviderAttempt,
  runWithProviderAttempt,
} = await import("../lib/provider-attempt-receipts");
const { createProviderAttemptObjectSpool } = await import(
  "../lib/provider-attempt-object-spool"
);

function retryWithBackoffCallbackOwner(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.CallExpression | undefined {
  let node: ts.Node | undefined = call;
  while (node && node !== sourceFile) {
    const parent: ts.Node | undefined = node.parent;
    if (
      parent &&
      ts.isCallExpression(parent) &&
      parent.expression.getText(sourceFile) === "retryWithBackoff" &&
      parent.arguments[0] === node &&
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    ) {
      return parent;
    }
    node = parent;
  }
  return undefined;
}

function preservesAccountingAtCatch(
  catchClause: ts.CatchClause,
  sourceFile: ts.SourceFile,
): boolean {
  const errorName = catchClause.variableDeclaration?.name.getText(sourceFile);
  const first = catchClause.block.statements[0];
  if (!errorName || !first || !ts.isIfStatement(first)) return false;
  const guard = first.expression.getText(sourceFile).replace(/\s/g, "");
  if (guard !== `isProviderAccountingError(${errorName})`) return false;
  return (
    ts.isThrowStatement(first.thenStatement) &&
    first.thenStatement.expression?.getText(sourceFile) === errorName
  );
}

function containsNamedCall(
  node: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      child.expression.getText(sourceFile) === name
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isInsideNode(node: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function retryWithBackoffDeclaration(
  retryCall: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.VariableDeclaration | undefined {
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === "retryWithBackoff"
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!declaration || !declaration.initializer || !ts.isArrowFunction(declaration.initializer)) {
    return undefined;
  }

  let owner: ts.Node | undefined = declaration;
  while (owner && owner !== sourceFile) {
    if (ts.isArrowFunction(owner) || ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner)) {
      break;
    }
    owner = owner.parent;
  }
  return owner && isInsideNode(retryCall, owner) ? declaration : undefined;
}

function retryWithBackoffGuardsAccountingBeforeBackoff(
  declaration: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  if (!declaration.initializer || !ts.isArrowFunction(declaration.initializer)) return false;
  const callbackName = declaration.initializer.parameters[0]?.name.getText(sourceFile);
  if (!callbackName || !declaration.initializer.body) return false;

  let guarded = false;
  const visit = (node: ts.Node): void => {
    if (guarded || !ts.isTryStatement(node) || !node.catchClause) {
      ts.forEachChild(node, visit);
      return;
    }
    if (!containsNamedCall(node.tryBlock, callbackName, sourceFile)) {
      ts.forEachChild(node, visit);
      return;
    }
    const guardIndex = node.catchClause.block.statements.findIndex((statement) => {
      return (
        ts.isIfStatement(statement) &&
        statement === node.catchClause!.block.statements[0] &&
        preservesAccountingAtCatch(node.catchClause!, sourceFile)
      );
    });
    const backoffIndex = node.catchClause.block.statements.findIndex((statement) =>
      containsNamedCall(statement, "setTimeout", sourceFile),
    );
    if (guardIndex >= 0 && backoffIndex >= 0 && guardIndex < backoffIndex) {
      guarded = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.initializer.body);
  return guarded;
}

test("social provider retries structurally own provider callbacks and guard accounting before backoff", () => {
  const path = "lib/social-worker.ts";
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const expected = ["generateSocialPostWithGemini", "enhanceSocialPostWithGPT"];
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      expected.includes(node.expression.getText(sourceFile))
    ) {
      const retryCall = retryWithBackoffCallbackOwner(node, sourceFile);
      const declaration = retryCall
        ? retryWithBackoffDeclaration(retryCall, sourceFile)
        : undefined;
      if (
        !retryCall ||
        !declaration ||
        !retryWithBackoffGuardsAccountingBeforeBackoff(declaration, sourceFile)
      ) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(
          `${path}:${line}: provider callback is not structurally owned by retryWithBackoff with accounting guard before backoff`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.deepEqual(violations, []);
});

function attemptOptions(
  store: InstanceType<typeof MemoryProviderAttemptReceiptStore>,
  spool: InstanceType<typeof MemoryProviderAttemptReceiptSpool>,
  recordUsage: (input: any) => Promise<unknown>,
  submit: (attempt: any) => Promise<string>,
) {
  return {
    context: {
      teamId: 7,
      operationType: "article_generation",
      provider: "gemini" as const,
      model: "gemini-2.5-flash",
      attemptKey: "burst:article:42",
    },
    request: {
      model: "gemini-2.5-flash",
      maxOutputTokens: 128,
      timeoutMs: 20_000,
    },
    submit,
    _deps: {
      store,
      spool,
      validateOwnership: async () => undefined,
      recordUsage,
    },
  };
}

test("100 concurrent redeliveries admit one paid submission and one ledger event", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  let physicalSubmissions = 0;
  const ledgerEvents: any[] = [];
  const submit = async ({ captureResponse }: any) => {
    physicalSubmissions++;
    await captureResponse({
      providerRequestId: "burst-response-1",
      usage: {
        unitType: "tokens",
        inputUnits: 10,
        outputUnits: 2,
        unitCount: 12,
        known: true,
      },
    });
    return "burst-result";
  };
  const recordUsage = async (input: any) => {
    ledgerEvents.push(input);
    return { id: 1 };
  };

  const results = await Promise.allSettled(
    Array.from({ length: 100 }, () =>
      runWithProviderAttempt(attemptOptions(store, spool, recordUsage, submit)),
    ),
  );

  assert.equal(physicalSubmissions, 1);
  assert.equal(ledgerEvents.length, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        (result.reason as { code?: string })?.code ===
          "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
    ).length,
    99,
  );
});

test("accounting failure after a paid response is reconciled without provider replay", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  let physicalSubmissions = 0;
  let ledgerAttempts = 0;
  const recordUsage = async (input: any) => {
    ledgerAttempts++;
    if (ledgerAttempts === 1) throw new Error("isolated ledger outage");
    return { id: 42, sourceEventId: input.sourceEventId };
  };

  await assert.rejects(
    runWithProviderAttempt(
      attemptOptions(store, spool, recordUsage, async ({ captureResponse }) => {
        physicalSubmissions++;
        await captureResponse({
          providerRequestId: "accounting-fault-response",
          usage: {
            unitType: "tokens",
            inputUnits: 4,
            outputUnits: 3,
            unitCount: 7,
            known: true,
          },
        });
        return "paid-result";
      }),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );

  const sourceEventId = [...store.rows.keys()][0];
  assert.ok(sourceEventId);
  assert.equal(store.rows.get(sourceEventId)?.status, "accounting_failed");

  const reconciled = await reconcileProviderAttempt(
    { sourceEventId },
    {
      store,
      spool,
      recordUsage,
      validateOwnership: async () => undefined,
    },
  );
  assert.equal((reconciled.ledger as { id: number }).id, 42);
  assert.equal(physicalSubmissions, 1);
  assert.equal(ledgerAttempts, 2);
});

test("object spool readiness and shared-storage faults are surfaced without a false ready result", async () => {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  let failSave = false;
  let failRead = false;
  let failDelete = false;
  const storage = {
    bucket: () => ({
      file: (key: string) => ({
        async save(data: Buffer) {
          if (failSave) throw new Error("fixture object save outage");
          objects.set(key, Buffer.from(data));
        },
        createReadStream() {
          if (failRead) {
            return Readable.from(
              (async function* () {
                throw new Error("fixture object read outage");
              })(),
            );
          }
          return Readable.from([objects.get(key) ?? Buffer.alloc(0)]);
        },
        async delete() {
          if (failDelete) throw new Error("fixture object delete outage");
          deleted.push(key);
          objects.delete(key);
        },
      }),
    }),
  };
  const spool = createProviderAttemptObjectSpool({
    storage,
    serialize: (record) => JSON.stringify(record),
    parse: (value) => value as any,
    prefix: "private/qa-accounting-regressions",
  });

  await spool.ensureReady();
  assert.equal(objects.size, 0);
  assert.equal(deleted.length, 1);

  failSave = true;
  await assert.rejects(spool.ensureReady(), /fixture object save outage/);
  failSave = false;
  failRead = true;
  await assert.rejects(spool.ensureReady(), /fixture object read outage/);
  failRead = false;
  failDelete = true;
  await assert.rejects(spool.ensureReady(), /fixture object delete outage/);
});