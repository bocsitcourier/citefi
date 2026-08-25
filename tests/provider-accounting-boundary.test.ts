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
  if (
    first.expression.getText(sourceFile).replace(/\s/g, "") !==
    `isProviderAccountingError(${errorName})`
  ) {
    return false;
  }
  return (
    ts.isThrowStatement(first.thenStatement) &&
    first.thenStatement.expression?.getText(sourceFile) === errorName
  );
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
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const found = new Map(helperNames.map((name) => [name, 0]));

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile);
        const helperName = helperNames.find(
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

void test("accounting failures are explicit and retain provider failures as cause", () => {
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