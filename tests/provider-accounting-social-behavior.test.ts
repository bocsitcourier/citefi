import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const {
  ProviderAttemptAccountingError,
  ProviderAttemptAlreadySubmittedError,
  ProviderAttemptNotDurableError,
  ProviderAttemptSubmissionUncertainError,
  ProviderAttemptUsageUnavailableError,
} = await import("../lib/provider-attempt-receipts");
const {
  ProviderAccountingError,
  isProviderAccountingError,
} = await import("../lib/cost-telemetry");
const { awaitAllSocialPlatformTasks } = await import("../lib/social-worker");

type RetryWithBackoff = <T>(
  callback: () => Promise<T>,
  maxRetries?: number,
  platform?: string,
) => Promise<T>;

function extractActualRetryWithBackoff(): RetryWithBackoff {
  const path = "lib/social-worker.ts";
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let retryInitializer: ts.Expression | undefined;
  let nonRetryableFunction: ts.FunctionDeclaration | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === "retryWithBackoff"
    ) {
      retryInitializer = node.initializer;
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.getText(sourceFile) === "isNonRetryableSocialOutputError"
    ) {
      nonRetryableFunction = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(retryInitializer, "production retryWithBackoff initializer must exist");
  assert.ok(nonRetryableFunction, "production social retry classifier must exist");

  // Compile the production AST nodes themselves. This deliberately avoids a
  // handwritten retry clone: the behavioral test remains coupled to the code
  // that executes inside the platform task.
  const isolatedSource = `
    const createRetryWithBackoff = (isProviderAccountingError) => {
      ${nonRetryableFunction.getText(sourceFile)}
      const retryWithBackoff = ${retryInitializer.getText(sourceFile)};
      return retryWithBackoff;
    };
  `;
  const compiled = ts.transpileModule(isolatedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const createRetryWithBackoff = new Function(
    `${compiled}\nreturn createRetryWithBackoff;`,
  )() as (guard: typeof isProviderAccountingError) => RetryWithBackoff;
  return createRetryWithBackoff(isProviderAccountingError);
}

function extractActualSocialAggregation(): (
  platformPromises: readonly Promise<unknown>[],
  platforms: readonly string[],
  settle: typeof awaitAllSocialPlatformTasks,
) => Promise<unknown> {
  const path = "lib/social-worker.ts";
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let settledStatement: ts.Statement | undefined;
  let terminalStatement: ts.Statement | undefined;
  let parentBlock: ts.Block | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === "settledPlatformTasks"
    ) {
      const statement = node.parent.parent;
      if (ts.isVariableStatement(statement) && ts.isBlock(statement.parent)) {
        settledStatement = statement;
        parentBlock = statement.parent;
      }
    }
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(sourceFile).includes("terminalPlatformFailure?.terminalError")
    ) {
      const statement = node.parent;
      if (ts.isBlock(statement)) {
        terminalStatement = node;
        parentBlock = statement;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(settledStatement, "production platform settlement block must exist");
  assert.ok(terminalStatement, "production terminal aggregation guard must exist");
  assert.ok(parentBlock, "production settlement statements must have a block owner");
  const start = parentBlock.statements.indexOf(settledStatement);
  const end = parentBlock.statements.indexOf(terminalStatement);
  assert.ok(start >= 0 && end >= start, "production settlement statement range must be ordered");
  const imageStageIndex = source.indexOf("// STAGE 3: Attach image", terminalStatement.getEnd());
  assert.ok(
    imageStageIndex > terminalStatement.getEnd(),
    "production image stage must follow terminal aggregation",
  );
  // Reservation release is owned by the outer pipeline handler rather than
  // this worker, so it cannot run in this compiled worker continuation.

  // As above, compile the exact production statements through terminal
  // aggregation. Image generation and billing settlement are intentionally
  // after this range in the worker and therefore cannot run on this reject.
  const isolatedSource = `
    async function aggregateSocialPlatforms(
      platformPromises,
      platforms,
      awaitAllSocialPlatformTasks,
    ) {
      ${parentBlock.statements
        .slice(start, end + 1)
        .map((statement) => statement.getText(sourceFile))
        .join("\n")}
      return { platformResults, successfulPlatforms, failedPlatforms };
    }
  `;
  const compiled = ts.transpileModule(isolatedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  return new Function(
    `${compiled}\nreturn aggregateSocialPlatforms;`,
  )() as (
    platformPromises: readonly Promise<unknown>[],
    platforms: readonly string[],
    settle: typeof awaitAllSocialPlatformTasks,
  ) => Promise<unknown>;
}

const terminalErrors = [
  new ProviderAccountingError(
    "immutable accounting rejected the provider response",
    new Error("ledger unavailable"),
  ),
  new ProviderAttemptNotDurableError("provider response was not durable"),
  new ProviderAttemptUsageUnavailableError("provider usage was unavailable"),
  new ProviderAttemptAccountingError("provider receipt accounting failed"),
  new ProviderAttemptSubmissionUncertainError("provider submission outcome is uncertain"),
  new ProviderAttemptAlreadySubmittedError("social-attempt:fixture"),
];

test("actual social retry executor makes one attempt for every accounting/receipt terminal error", async () => {
  const retryWithBackoff = extractActualRetryWithBackoff();

  for (const terminalError of terminalErrors) {
    assert.equal(
      isProviderAccountingError(terminalError),
      true,
      `${terminalError.name} must be in the immutable no-replay class`,
    );
    let attempts = 0;
    const delays: number[] = [];
    const globalTimer = globalThis as typeof globalThis & {
      setTimeout: typeof setTimeout;
    };
    const originalSetTimeout = globalTimer.setTimeout;
    globalTimer.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
      delays.push(delay ?? 0);
      callback(...args);
      return 0 as any;
    }) as typeof setTimeout;

    try {
      await assert.rejects(
        retryWithBackoff(
          async () => {
            attempts++;
            throw terminalError;
          },
          3,
          "fixture",
        ),
        (error) => error === terminalError,
      );
    } finally {
      globalTimer.setTimeout = originalSetTimeout;
    }

    assert.equal(attempts, 1, `${terminalError.name} must not resubmit the provider callback`);
    assert.deepEqual(delays, [], `${terminalError.name} must not enter exponential backoff`);
  }
});

test("actual social terminal aggregation waits for siblings and skips images/release", async () => {
  const retryWithBackoff = extractActualRetryWithBackoff();
  const aggregateSocialPlatforms = extractActualSocialAggregation();

  for (const terminalError of terminalErrors) {
    let providerAttempts = 0;
    let siblingFinished = false;
    let imageCalls = 0;
    let releaseCalls = 0;
    let resolveSibling!: (value: unknown) => void;

    const failedPlatform = (async () => {
      try {
        await retryWithBackoff(
          async () => {
            providerAttempts++;
            throw terminalError;
          },
          3,
          "x",
        );
        return { platform: "x", success: true };
      } catch (error) {
        return {
          platform: "x",
          success: false,
          error: error instanceof Error ? error.message : String(error),
          terminalError: error,
        };
      }
    })();
    const sibling = new Promise((resolve) => {
      resolveSibling = (value) => {
        siblingFinished = true;
        resolve(value);
      };
    });

    let parentError: unknown;
    const parentSettled = aggregateSocialPlatforms(
      [failedPlatform, sibling],
      ["x", "linkedin"],
      awaitAllSocialPlatformTasks,
    ).then(
      () => undefined,
      (error) => {
        parentError = error;
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    assert.equal(parentError, undefined, `${terminalError.name} must wait for the sibling`);
    assert.equal(siblingFinished, false, `${terminalError.name} sibling must still be in flight`);
    assert.equal(providerAttempts, 1, `${terminalError.name} provider callback must run once`);
    assert.equal(imageCalls, 0, "image generation must not run before terminal aggregation");
    assert.equal(releaseCalls, 0, "reservation release must not run before terminal aggregation");

    resolveSibling({ platform: "linkedin", success: true });
    await parentSettled;
    assert.equal(parentError, terminalError, `${terminalError.name} must aggregate unchanged`);
    assert.equal(siblingFinished, true, `${terminalError.name} sibling must settle first`);
    assert.equal(providerAttempts, 1);
    assert.equal(imageCalls, 0);
    assert.equal(releaseCalls, 0);
  }
});