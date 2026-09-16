import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
const {
  ProviderAccountingError,
  isProviderAccountingError,
  throwIfProviderAccountingFailed,
} = await import(
  "../lib/cost-telemetry"
);
const { ProviderAttemptAccountingError } = await import(
  "../lib/provider-attempt-receipts"
);
process.env.GEMINI_API_KEY ??= "offline-test-key";
process.env.GEMINI_RATE_LIMIT = "60000";
const { closeGeminiRateLimiter, throttledGeminiRequest } = await import("../lib/gemini");

function productionSources(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return productionSources(path);
    return /\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

const DIRECT_PROVIDER_SINKS = [
  // Google Gemini and Veo
  /\.models\.generateContent\s*\(/g,
  /\.models\.generateVideos\s*\(/g,
  // Direct OpenAI chat/responses/image/TTS SDK submissions
  /\.chat\.completions\.create\s*\(/g,
  /\.responses\.create\s*\(/g,
  /\.images\.(?:generate|edits)\s*\(/g,
  /\.audio\.speech\.create\s*\(/g,
  // Brave SDK/fetch submissions (including multiline fetch arguments)
  /fetch\s*\([\s\S]{0,500}?api\.search\.brave\.com/g,
];

const ACCOUNTED_BOUNDARY =
  /logCostTelemetry|logFailedProviderAttempt|trackedGeminiRequest|callOpenAI|recordBrandGeminiAttempt/;

const PROVIDER_SUBMISSION =
  /callOpenAI\s*\(|\.models\.generate(?:Content|Videos)\s*\(|\.images\.(?:generate|edits)\s*\(|api\.search\.brave\.com/;

function catchPreservesAccounting(
  catchClause: ts.CatchClause,
  sourceFile: ts.SourceFile
): boolean {
  const errorName = catchClause.variableDeclaration?.name.getText(sourceFile);
  const first = catchClause.block.statements[0];
  if (!errorName || !first || !ts.isIfStatement(first)) return false;
  const guard = first.expression.getText(sourceFile).replace(/\s/g, "");
  if (
    guard !== `isProviderAccountingError(${errorName})` &&
    guard !== `isProviderAccountingError(${errorName})||isProviderAttemptTerminalError(${errorName})`
  ) {
    return false;
  }
  return (
    ts.isThrowStatement(first.thenStatement) &&
    first.thenStatement.expression?.getText(sourceFile) === errorName
  );
}

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
        catchPreservesAccounting(node.catchClause!, sourceFile)
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

function socialRetryBoundaryViolations(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const expected = ["generateSocialPostWithGemini", "enhanceSocialPostWithGPT"];
  const found = new Set<string>();
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      expected.includes(node.expression.getText(sourceFile))
    ) {
      const helperName = node.expression.getText(sourceFile);
      found.add(helperName);
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
          `${path}:${line}: ${helperName} callback is not structurally owned by retryWithBackoff with accounting guard before backoff`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const helperName of expected) {
    if (!found.has(helperName)) {
      violations.push(`${path}: named provider helper ${helperName} not found`);
    }
  }
  return violations;
}

function dailyBriefDefaultProviderViolations(): string[] {
  const path = "lib/brief/generate-daily-brief.ts";
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  let runProviderDeclaration: ts.VariableDeclaration | undefined;
  const runProviderCalls: ts.CallExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === "runProvider"
    ) {
      runProviderDeclaration = node;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "runProvider"
    ) {
      runProviderCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const initializer = runProviderDeclaration?.initializer;
  if (
    !initializer ||
    !ts.isBinaryExpression(initializer) ||
    initializer.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
  ) {
    violations.push(`${path}: runProvider is not the default ?? dependency closure`);
  } else {
    const throttledCalls: ts.CallExpression[] = [];
    const findThrottledCall = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "throttledGeminiRequest"
      ) {
        throttledCalls.push(node);
      }
      ts.forEachChild(node, findThrottledCall);
    };
    findThrottledCall(initializer.right);
    if (throttledCalls.length !== 1) {
      violations.push(
        `${path}: default runProvider closure must call throttledGeminiRequest exactly once`,
      );
    } else {
      const throttledCall = throttledCalls[0]!;
      const callback = throttledCall.arguments[0];
      if (
        !callback ||
        (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
        !containsNamedCall(callback, "submitGeminiRequest", sourceFile)
      ) {
        violations.push(
          `${path}: default runProvider closure must submit through the receipt-aware provider boundary`,
        );
      }
    }
  }

  if (runProviderCalls.length !== 1) {
    violations.push(`${path}: expected one production runProvider call`);
  } else {
    const catchClause = enclosingProviderCatch(runProviderCalls[0]!, sourceFile);
    if (!catchClause || !catchPreservesAccounting(catchClause, sourceFile)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(runProviderCalls[0]!.getStart(sourceFile)).line + 1;
      violations.push(
        `${path}:${line}: runProvider catch does not preserve accounting failures before failed-attempt logging`,
      );
    }
  }
  return violations;
}

function geminiLimiterAccountingGuardViolations(): string[] {
  const path = "lib/gemini.ts";
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  let failedHandlers = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "geminiRateLimiter" &&
      node.expression.name.getText(sourceFile) === "on" &&
      node.arguments[0]?.getText(sourceFile) === `"failed"`
    ) {
      failedHandlers++;
      const callback = node.arguments[1];
      const body =
        callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          ? callback.body
          : undefined;
      const first = body && ts.isBlock(body) ? body.statements[0] : undefined;
      const errorName =
        callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          ? callback.parameters[0]?.name.getText(sourceFile)
          : undefined;
      const guard =
        errorName && first && ts.isIfStatement(first)
          ? first.expression.getText(sourceFile).replace(/\s/g, "")
          : "";
      const thenStatement = first && ts.isIfStatement(first) ? first.thenStatement : undefined;
      const stopsAccounting =
        thenStatement !== undefined &&
        ts.isReturnStatement(thenStatement) &&
        thenStatement.expression?.getText(sourceFile) === "undefined";
      if (
        !errorName ||
        guard !== `isProviderAccountingError(${errorName})` ||
        !stopsAccounting
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(
          `${path}:${line}: Bottleneck failed handler must stop accounting errors before message/code classification`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (failedHandlers !== 1) {
    violations.push(`${path}: expected exactly one geminiRateLimiter failed handler`);
  }
  return violations;
}

function providerCatchViolations(path: string): string[] {
  const source = readFileSync(path, "utf8");
  if (!PROVIDER_SUBMISSION.test(source)) return [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isTryStatement(node) && node.catchClause) {
      const submittedInTry = PROVIDER_SUBMISSION.test(node.tryBlock.getText(sourceFile));
      const catchText = node.catchClause.block.getText(sourceFile);
      const changesControlFlow =
        /\bthrow\s+new\s+\w*Error\b|\breturn\b|\bcontinue\b/.test(catchText);
      if (
        submittedInTry &&
        changesControlFlow &&
        !catchPreservesAccounting(node.catchClause, sourceFile)
      ) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.catchClause.getStart(sourceFile)).line + 1;
        violations.push(
          `${path}:${line}: provider catch changes control flow without preserving ProviderAccountingError first`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

const TRANSITIVE_PROVIDER_BOUNDARIES: Record<string, string[]> = {
  "lib/gemini.ts": [
    "critiqueAndRefineTitles",
    "critiqueArticle",
    "validateContentWithFacts",
  ],
  "lib/article-reflexive.ts": ["performReflexiveRewrite"],
  "lib/anti-hallucination.ts": ["callGeminiForValidation"],
  "lib/social-worker.ts": [
    "generateSocialPostWithGemini",
    "enhanceSocialPostWithGPT",
    "runGenerationOrchestrator",
  ],
  "lib/gemini-social.ts": ["validateContentWithFacts"],
  "lib/podcast-worker.ts": ["runGenerationOrchestrator"],
  "lib/brief/generate-daily-brief.ts": ["throttledGeminiRequest"],
  "lib/competitive-intelligence-service.ts": ["braveSearch"],
  "lib/worker.ts": [
    "generateArticleReflexive",
    "runGenerationOrchestrator",
    "batchedChatGPTReview",
    "injectLinksWithIntent",
    "generateVeoSocialVideo",
    "generateSocialVideo",
    "runIntelligenceResearch",
    "generateArticlePodcast",
    "generateDailyBrief",
  ],
};

function enclosingProviderCatch(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile
): ts.CatchClause | undefined {
  let node: ts.Node | undefined = call;
  while (node && node !== sourceFile) {
    if (
      ts.isTryStatement(node) &&
      node.catchClause &&
      call.getStart(sourceFile) >= node.tryBlock.getStart(sourceFile) &&
      call.getEnd() <= node.tryBlock.getEnd()
    ) {
      return node.catchClause;
    }
    node = node.parent;
  }
  return undefined;
}

void test("direct provider SDK submissions have adjacent centralized or immutable accounting", () => {
  const violations: string[] = [];
  for (const path of [...productionSources("lib"), ...productionSources("app")]) {
    const source = readFileSync(path, "utf8");
    for (const sinkPattern of DIRECT_PROVIDER_SINKS) {
      sinkPattern.lastIndex = 0;
      for (const match of source.matchAll(sinkPattern)) {
        const index = match.index;
        // Accounting may be in a catch/finalization path after a long SDK
        // options object, but must remain local to the provider boundary.
        const adjacent = source.slice(
          Math.max(0, index - 12_000),
          Math.min(source.length, index + 12_000)
        );
        if (!ACCOUNTED_BOUNDARY.test(adjacent)) {
          const line = source.slice(0, index).split("\n").length;
          violations.push(`${path}:${line}: direct provider submission has no adjacent accounting`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);

  const gemini = readFileSync("lib/gemini.ts", "utf8");
  const worker = readFileSync("lib/worker.ts", "utf8");
  const regenerateRoute = readFileSync("app/api/articles/[id]/regenerate/route.ts", "utf8");
  assert.match(
    gemini,
    /buildArticleGenerationTelemetryContext\([\s\S]*batchId: args\.batchId[\s\S]*articleId: args\.articleId[\s\S]*resourceId: args\.articleId/,
    "article telemetry must keep distinct batch and article ownership IDs",
  );
  assert.match(
    worker,
    /articlePersonaId,[\s\S]{0,200}shadowRunPlan,[\s\S]{0,200}articleId\s*\/\/ Immutable provider accounting content attribution/,
    "the production article worker must pass the trusted article ID to Gemini accounting",
  );
  assert.match(
    worker,
    /requiresProviderReconciliation[\s\S]*markReservationForReconciliation[\s\S]*checkBatchCompletion\(batchId\)/,
    "paid provider accounting failures must establish a billing hold before batch cleanup",
  );
  assert.match(
    regenerateRoute,
    /reserveCredits\([\s\S]*creditRunId[\s\S]*await addArticleJob\([\s\S]*creditRunId,[\s\S]*creditCostPerUnit: creditCost[\s\S]*capReservationId/,
    "article regeneration must reserve canonical credits and pass its own billing identity before enqueue",
  );
  assert.match(
    regenerateRoute,
    /X-Idempotency-Key[\s\S]*findArticleGenerationJob\(runId\)[\s\S]*ArticleEnqueueUncertainError[\s\S]*markReservationForReconciliation/,
    "article regeneration replay and ambiguous enqueue must preserve one billing owner",
  );
  assert.match(
    worker,
    /articleCapReservationId[\s\S]*completeCapReservation\([\s\S]*reservationId: articleCapReservationId/,
    "regeneration's pending spending-cap reservation must settle with worker delivery",
  );
});

void test("provider boundaries never swallow immutable accounting failures", () => {
  const violations: string[] = [];
  for (const path of [...productionSources("lib"), ...productionSources("app")]) {
    const source = readFileSync(path, "utf8");
    if (!source.includes("logCostTelemetry")) continue;

    // Promise catches attached to accounting are always best-effort logging.
    if (/logCostTelemetry\s*\([\s\S]{0,1200}?\)\s*\.catch\s*\(/m.test(source)) {
      violations.push(`${path}: promise catch attached to logCostTelemetry`);
    }

    // These phrases have historically marked intentionally swallowed ledger
    // failures. Keep the test mechanical and DB-free.
    if (
      /telemetry must never mask|failed to account for successful|failed to record provider usage|safeLogCostTelemetry/i.test(
        source
      )
    ) {
      violations.push(`${path}: best-effort accounting marker`);
    }
  }
  assert.deepEqual(violations, []);
});

void test("provider catches preserve accounting errors before rewrap, fallback, or retry", () => {
  const violations = [...productionSources("lib"), ...productionSources("app")].flatMap(
    providerCatchViolations
  );
  assert.deepEqual(violations, []);
});

void test("named transitive provider callers preserve accounting failures at outer boundaries", () => {
  const violations: string[] = [];
  for (const [path, helperNames] of Object.entries(TRANSITIVE_PROVIDER_BOUNDARIES)) {
    if (path === "lib/social-worker.ts") {
      violations.push(...socialRetryBoundaryViolations(path));
    }
    if (path === "lib/brief/generate-daily-brief.ts") {
      violations.push(...dailyBriefDefaultProviderViolations());
    }
    const outerBoundaryHelperNames =
      path === "lib/social-worker.ts"
        ? helperNames.filter(
            (helperName) =>
              helperName !== "generateSocialPostWithGemini" &&
              helperName !== "enhanceSocialPostWithGPT",
          )
        : path === "lib/brief/generate-daily-brief.ts"
          ? helperNames.filter((helperName) => helperName !== "throttledGeminiRequest")
        : helperNames;
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const found = new Map(outerBoundaryHelperNames.map((name) => [name, 0]));

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile);
        const helperName = outerBoundaryHelperNames.find(
          (name) => callee === name || callee.endsWith(`.${name}`)
        );
        if (helperName) {
          found.set(helperName, found.get(helperName)! + 1);
          const catchClause = enclosingProviderCatch(node, sourceFile);
          if (!catchClause || !catchPreservesAccounting(catchClause, sourceFile)) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            violations.push(
              `${path}:${line}: ${helperName} outer boundary can retry or fall back without preserving ProviderAccountingError`
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    for (const [helperName, count] of found) {
      if (count === 0) violations.push(`${path}: named provider helper ${helperName} not found`);
    }
  }
  violations.push(...geminiLimiterAccountingGuardViolations());
  assert.deepEqual(violations, []);
});

void test("OpenAI TTS helpers propagate accounting failures unchanged", () => {
  const expectedProviderCatches: Record<string, number> = {
    "lib/openai-tts.ts": 1,
    "lib/social-video-tts-generator.ts": 2,
    "lib/veo-video-tts-generator.ts": 1,
  };

  for (const [path, expected] of Object.entries(expectedProviderCatches)) {
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    let guardedProviderCatches = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isTryStatement(node) &&
        node.catchClause &&
        /callOpenAI\s*\(/.test(node.tryBlock.getText(sourceFile))
      ) {
        assert.equal(
          catchPreservesAccounting(node.catchClause, sourceFile),
          true,
          `${path} must rethrow ProviderAccountingError unchanged before TTS wrapping`
        );
        guardedProviderCatches++;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    assert.equal(guardedProviderCatches, expected, `${path} provider catch coverage changed`);
  }
});

void test("accounting failures are explicit, retain cause, and hold billing without retry", async () => {
  const providerError = new Error("provider timed out");
  const ledgerError = new Error("ledger unavailable");
  const error = new ProviderAccountingError(
    "Immutable provider accounting failed after request failed",
    ledgerError,
    providerError
  );

  assert.equal(isProviderAccountingError(error), true);
  assert.equal(error.cause, providerError);
  assert.equal(error.accountingError, ledgerError);
  assert.match(error.message, /accounting failed/i);

  const { createPipelineHandler } = await import("../lib/pipeline-worker");
  let holds = 0;
  let releases = 0;
  const handler = createPipelineHandler(
    "article-generation",
    async () => { throw error; },
    {
      stage: "text_gen",
      execution: undefined as never,
      getBilling: () => ({ teamId: 2535, runId: "batch:626:test", amount: 10 }),
      _deps: {
        recordProviderFailure: async () => {},
        markReservationForReconciliation: async () => { holds += 1; },
        releaseReservation: async () => { releases += 1; },
      },
    },
  );
  await assert.rejects(
    () => handler({ id: "article-2235", data: {}, attemptsMade: 0, opts: { attempts: 3 } } as any),
    /PROVIDER_ACCOUNTING_FAILED/,
  );
  assert.equal(holds, 1, "paid provider accounting failure must retain a reconciliation hold");
  assert.equal(releases, 0, "paid provider accounting failure must never release credits");

  let capCancellations = 0;
  const ordinaryFailureHandler = createPipelineHandler(
    "article-generation",
    async () => { throw new Error("generation rejected"); },
    {
      stage: "text_gen",
      execution: undefined as never,
      getBilling: () => ({
        teamId: 2535,
        runId: "article-regeneration:2235:test",
        amount: 10,
        capReservationId: 42,
      }),
      _deps: {
        recordProviderFailure: async () => {},
        releaseReservation: async () => { releases += 1; },
        cancelCapReservation: async () => { capCancellations += 1; },
      },
    },
  );
  await assert.rejects(
    () => ordinaryFailureHandler(
      { id: "article-2235-regeneration", data: {}, attemptsMade: 2, opts: { attempts: 3 } } as any
    ),
  );
  assert.equal(releases, 1, "final rejected regeneration must release only its own reservation");
  assert.equal(capCancellations, 1, "final rejected regeneration must release its pending cap hold");
});

void test("optional provider fallbacks rethrow immutable accounting failures", () => {
  const accountingError = new ProviderAccountingError(
    "provider completed but accounting failed",
    new Error("ledger unavailable")
  );
  assert.doesNotThrow(() =>
    throwIfProviderAccountingFailed([
      { status: "rejected", reason: new Error("ordinary optional provider failure") },
      { status: "fulfilled", value: null },
    ])
  );
  assert.throws(
    () =>
      throwIfProviderAccountingFailed([
        { status: "fulfilled", value: null },
        { status: "rejected", reason: accountingError },
      ]),
    (error) => error === accountingError
  );
});

void test("settled-result accounting helper preserves the exact transitive error object", async () => {
  const accountingError = new ProviderAccountingError(
    "transitive provider accounting failed",
    new Error("ledger unavailable")
  );
  const settled = await Promise.allSettled([
    Promise.reject(new Error("ordinary optional failure")),
    Promise.reject(accountingError),
  ]);

  assert.throws(
    () => throwIfProviderAccountingFailed(settled),
    (error) => error === accountingError
  );
});

void test("ChatGPT review cannot convert accounting failure into a successful fallback", () => {
  const source = readFileSync("app/api/review/chatgpt/route.ts", "utf8");
  const guardIndex = source.indexOf("throwIfProviderAccountingFailed([");
  const fallbackIndex = source.indexOf("// Extract values with safe fallbacks");
  assert.ok(guardIndex >= 0, "review route must guard settled accounting failures");
  assert.ok(
    fallbackIndex > guardIndex,
    "accounting guard must run before optional fallback values are constructed"
  );
});

void test("Gemini limiter stops typed accounting terminals before 429/network classification", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalRandom = Math.random;
  const retryDelays: number[] = [];
  Math.random = () => 0;
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    retryDelays.push(delay ?? 0);
    return originalSetTimeout(callback, 0, ...args);
  }) as typeof setTimeout;
  try {
    for (const terminalError of [
      new ProviderAccountingError(
        "429 network fetch failed after provider response",
        new Error("immutable ledger unavailable"),
      ),
      new ProviderAttemptAccountingError(
        "429 network fetch failed after provider response",
        new Error("immutable ledger unavailable"),
      ),
    ]) {
      let terminalCalls = 0;
      await assert.rejects(
        () =>
          throttledGeminiRequest(async () => {
            terminalCalls++;
            throw terminalError;
          }),
        (error) => error === terminalError,
      );
      assert.equal(
        terminalCalls,
        1,
        "typed receipt/accounting terminals must stop before message/code retry classification",
      );
    }

    for (const ordinaryError of [
      Object.assign(new Error("HTTP 429 rate limit"), { code: 429 }),
      Object.assign(new Error("transient provider network failure"), { code: "ECONNRESET" }),
    ]) {
      let ordinaryCalls = 0;
      await assert.rejects(
        () =>
          throttledGeminiRequest(async () => {
            ordinaryCalls++;
            throw ordinaryError;
          }),
        (error) => error === ordinaryError,
      );
      assert.equal(ordinaryCalls, 4, "ordinary 429/network failures retain three bounded retries");
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Math.random = originalRandom;
  }
  assert.ok(retryDelays.includes(1000));
  assert.ok(retryDelays.includes(2000));
  assert.ok(retryDelays.includes(4000));
  assert.ok(retryDelays.every((delay) => delay <= 10_000));
});

test.after(async () => {
  await closeGeminiRateLimiter();
});