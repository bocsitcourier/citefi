import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as ts from "typescript";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const ledger = await import("../lib/provider-usage-ledger");
const {
  articles,
  articleAssets,
  campaigns,
  clientBrandProfiles,
  jobBatches,
  socialPosts,
  socialPostAssets,
  teamMembers,
  videoIdeas,
} = await import("../shared/schema");

const TEST_TEAM_ID = 7001;

type ResolvedValue = string | number | null;

interface SourceFileInfo {
  path: string;
  sourceFile: ts.SourceFile;
}

interface ReceiptContext {
  path: string;
  line: number;
  expression: ts.ObjectLiteralExpression;
  resourceType: Set<string | null>;
  resourceId: Set<ResolvedValue>;
  resourcePairs: Array<{ resourceType: string | null; resourceId: ResolvedValue }>;
  campaignId: Set<number | null>;
  contentId: Set<number | null>;
  userId: Set<number | null>;
}

function productionSources(root: string): SourceFileInfo[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return productionSources(path);
    if (!/\.[cm]?[jt]sx?$/.test(name)) return [];
    const source = readFileSync(path, "utf8");
    return [{
      path,
      sourceFile: ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    }];
  });
}

function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  wanted: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === wanted) {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === wanted) {
      return property.name;
    }
  }
  return undefined;
}

function objectExpression(expression: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!expression) return null;
  const resolved = unwrapped(expression);
  return ts.isObjectLiteralExpression(resolved) ? resolved : null;
}

function mergeValues<T>(values: Iterable<T>[]): Set<T> {
  const merged = new Set<T>();
  for (const valueSet of values) {
    for (const value of valueSet) merged.add(value);
  }
  return merged;
}

function expressionText(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return unwrapped(expression).getText(sourceFile);
}

/**
 * Values which are statically visible in the source are enough for this
 * contract.  Unknown runtime values are represented by a safe sentinel below;
 * the important property is that every literal sent to a receipt adapter is
 * exercised rather than copied into a hand-maintained test list.
 */
function staticValues(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  bindings: Map<string, Set<string | null>>,
  dynamicValues: Map<string, Set<string | null>>,
): Set<string | null> {
  const resolved = unwrapped(expression);
  if (ts.isStringLiteral(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) {
    return new Set([resolved.text]);
  }
  if (resolved.kind === ts.SyntaxKind.NullKeyword) return new Set([null]);
  if (ts.isIdentifier(resolved)) {
    if (resolved.text === "undefined") return new Set([null]);
    return new Set(bindings.get(resolved.text) ?? [null]);
  }
  if (ts.isPropertyAccessExpression(resolved)) {
    const text = resolved.getText(sourceFile);
    return new Set(dynamicValues.get(text) ?? [null]);
  }
  if (ts.isConditionalExpression(resolved)) {
    return mergeValues([
      staticValues(resolved.whenTrue, sourceFile, bindings, dynamicValues),
      staticValues(resolved.whenFalse, sourceFile, bindings, dynamicValues),
    ]);
  }
  if (ts.isBinaryExpression(resolved) && resolved.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return mergeValues([
      staticValues(resolved.left, sourceFile, bindings, dynamicValues),
      staticValues(resolved.right, sourceFile, bindings, dynamicValues),
    ]);
  }
  return new Set([null]);
}

function staticResourceIds(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  bindings: Map<string, Set<string | null>>,
  dynamicValues: Map<string, Set<string | null>>,
): Set<ResolvedValue> {
  if (!expression) return new Set([null]);
  const resolved = unwrapped(expression);
  if (resolved.kind === ts.SyntaxKind.NullKeyword) return new Set([null]);
  if (ts.isIdentifier(resolved) && resolved.text === "undefined") return new Set([null]);
  if (ts.isNumericLiteral(resolved)) return new Set([Number(resolved.text)]);
  if (ts.isStringLiteral(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) {
    return new Set([resolved.text]);
  }
  if (ts.isConditionalExpression(resolved)) {
    return mergeValues([
      staticResourceIds(resolved.whenTrue, sourceFile, bindings, dynamicValues),
      staticResourceIds(resolved.whenFalse, sourceFile, bindings, dynamicValues),
    ]);
  }
  if (ts.isIdentifier(resolved)) {
    // The ownership validator only needs an owned positive ID for dynamic
    // caller fields.  The fake transaction below supplies that owned row.
    return new Set([1]);
  }
  if (ts.isPropertyAccessExpression(resolved)) {
    return new Set([1]);
  }
  if (ts.isTemplateExpression(resolved) || ts.isBinaryExpression(resolved)) {
    // A composite resource ID must never be silently accepted for a
    // team-only resource.  Keep it visibly non-numeric so the real validator
    // rejects it when a caller accidentally supplies one.
    return new Set([`composite:${expressionText(resolved, sourceFile)}`]);
  }
  return new Set([1]);
}

function staticNumericIds(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  bindings: Map<string, Set<string | null>>,
  dynamicValues: Map<string, Set<string | null>>,
): Set<number | null> {
  return new Set(
    [...staticResourceIds(expression, sourceFile, bindings, dynamicValues)].map((value) => {
      if (value == null) return null;
      if (typeof value === "number") return value;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
    }),
  );
}

function resourcePairs(
  resourceType: ts.Expression | undefined,
  resourceId: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  bindings: Map<string, Set<string | null>>,
  dynamicValues: Map<string, Set<string | null>>,
): Array<{ resourceType: string | null; resourceId: ResolvedValue }> {
  const types = resourceType
    ? staticValues(resourceType, sourceFile, bindings, dynamicValues)
    : new Set<string | null>([null]);
  const ids = staticResourceIds(resourceId, sourceFile, bindings, dynamicValues);

  // Optional caller IDs and conditional resource labels are one logical
  // value, not independent dimensions.  Preserve that relationship for the
  // known adapter forms:
  //   resourceType: id != null ? "article" : undefined,
  //   resourceId: id
  // and the equivalent article/verified-content branch.  Without this
  // correlation a static cross-product would invent an untyped ID that can
  // never occur at runtime.
  const typeExpression = resourceType && unwrapped(resourceType);
  const idExpression = resourceId && unwrapped(resourceId);
  if (
    typeExpression &&
    idExpression &&
    ts.isConditionalExpression(typeExpression) &&
    expressionText(typeExpression.condition, sourceFile).includes("!=") &&
    expressionText(typeExpression.whenTrue, sourceFile) !== "undefined" &&
    ts.isPropertyAccessExpression(idExpression)
  ) {
    const conditionText = expressionText(typeExpression.condition, sourceFile);
    const idText = expressionText(idExpression, sourceFile);
    if (conditionText.includes(idText)) {
      const trueTypes = staticValues(typeExpression.whenTrue, sourceFile, bindings, dynamicValues);
      const falseTypes = staticValues(typeExpression.whenFalse, sourceFile, bindings, dynamicValues);
      return [
        ...[...trueTypes].map((value) => ({ resourceType: value, resourceId: 1 })),
        ...[...falseTypes].map((value) => ({ resourceType: value, resourceId: null })),
      ];
    }
  }

  return [...types].flatMap((type) =>
    [...ids].map((id) => ({ resourceType: type, resourceId: id })),
  );
}

function addBinding(
  bindings: Map<string, Set<string | null>>,
  name: string,
  values: Set<string | null>,
): void {
  const existing = bindings.get(name) ?? new Set<string | null>();
  for (const value of values) existing.add(value);
  bindings.set(name, existing);
}

function collectBindings(
  files: SourceFileInfo[],
): Map<string, Set<string | null>> {
  const bindings = new Map<string, Set<string | null>>();
  for (const { sourceFile } of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) {
          addBinding(bindings, node.name.text, staticValues(
            node.initializer,
            sourceFile,
            bindings,
            new Map(),
          ));
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue;
            if (element.initializer) {
              addBinding(bindings, element.name.text, staticValues(
                element.initializer,
                sourceFile,
                bindings,
                new Map(),
              ));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return bindings;
}

function collectDynamicResourceTypes(
  files: SourceFileInfo[],
  bindings: Map<string, Set<string | null>>,
): Map<string, Set<string | null>> {
  const dynamicValues = new Map<string, Set<string | null>>();
  const add = (key: string, values: Set<string | null>): void => {
    const existing = dynamicValues.get(key) ?? new Set<string | null>();
    for (const value of values) existing.add(value);
    dynamicValues.set(key, existing);
  };

  for (const { sourceFile } of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile).split(".").at(-1);
        if (callee === "generateSingleImage") {
          const argument = objectExpression(node.arguments[1]);
          const resourceType = argument && objectProperty(argument, "resourceType");
          if (resourceType) {
            add("telemetry.resourceType", staticValues(
              resourceType,
              sourceFile,
              bindings,
              dynamicValues,
            ));
          }
        }
        if (callee === "generateVeoClip") {
          const argument = objectExpression(node.arguments[0]);
          const resourceType = argument && objectProperty(argument, "resourceType");
          if (resourceType) {
            add("resourceType", staticValues(
              resourceType,
              sourceFile,
              bindings,
              dynamicValues,
            ));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return dynamicValues;
}

function collectObjectBindings(
  files: SourceFileInfo[],
): Map<string, ts.ObjectLiteralExpression> {
  const bindings = new Map<string, ts.ObjectLiteralExpression>();
  for (const { sourceFile } of files) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const object = objectExpression(node.initializer);
        if (object) bindings.set(node.name.text, object);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return bindings;
}

function contextObjectForCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  objectBindings: Map<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression | null {
  const callee = call.expression.getText(sourceFile).split(".").at(-1);
  const argumentIndex = callee === "callOpenAI" ? 3 :
    callee === "submitBraveSearchWithReceipt" || callee === "runWithProviderAttempt" ||
    callee === "generateVeoClip" ? 0 : 1;
  const argument = call.arguments[argumentIndex];

  if (callee === "submitBraveSearchWithReceipt") {
    return objectExpression(argument) && objectExpression(
      objectProperty(objectExpression(argument)!, "context"),
    );
  }
  if (callee === "throttledGeminiRequest") {
    return objectExpression(argument) && objectExpression(
      objectProperty(objectExpression(argument)!, "context"),
    );
  }
  if (callee === "runWithProviderAttempt") {
    const options = objectExpression(argument);
    if (!options) return null;
    const context = objectProperty(options, "context");
    if (!context) return null;
    const direct = objectExpression(context);
    if (direct) return direct;
    const resolved = unwrapped(context);
    if (ts.isIdentifier(resolved)) return objectBindings.get(resolved.text) ?? null;
    return null;
  }
  return objectExpression(argument);
}

function scanReceiptContexts(files: SourceFileInfo[]): ReceiptContext[] {
  const valueBindings = collectBindings(files);
  const objectBindings = collectObjectBindings(files);
  const dynamicValues = collectDynamicResourceTypes(files, valueBindings);
  const contexts: ReceiptContext[] = [];

  for (const { path, sourceFile } of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile).split(".").at(-1);
        if (
          callee === "submitGeminiRequest" ||
          callee === "throttledGeminiRequest" ||
          callee === "submitBraveSearchWithReceipt" ||
          callee === "callOpenAI" ||
          callee === "generateVeoClip" ||
          callee === "runWithProviderAttempt"
        ) {
          // Generic adapters forward caller-owned type/ID pairs. Evaluating
          // those two fields independently invents impossible combinations.
          // Exercise their actual submit*/callOpenAI/generateVeoClip inputs,
          // which this scan covers, rather than sentinel adapter parameters.
          if (callee === "runWithProviderAttempt" && [
            "lib/gemini-attempt-receipt.ts", "lib/openai-client.ts",
            "lib/veo-video-generator.ts", "lib/media-provider-boundary.ts",
          ].includes(path)) {
            ts.forEachChild(node, visit);
            return;
          }
            const expression = contextObjectForCall(node, sourceFile, objectBindings);
          if (expression) {
            const resourceType = objectProperty(expression, "resourceType");
            const resourceId = objectProperty(expression, "resourceId");
            const campaignId = objectProperty(expression, "campaignId");
            const contentId = objectProperty(expression, "contentId");
            const userId = objectProperty(expression, "userId");
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            contexts.push({
              path,
              line,
              expression,
              resourceType: resourceType
                ? staticValues(resourceType, sourceFile, valueBindings, dynamicValues)
                : new Set([null]),
              resourceId: staticResourceIds(resourceId, sourceFile, valueBindings, dynamicValues),
              resourcePairs: resourcePairs(
                resourceType,
                resourceId,
                sourceFile,
                valueBindings,
                dynamicValues,
              ),
              campaignId: staticNumericIds(campaignId, sourceFile, valueBindings, dynamicValues),
              contentId: staticNumericIds(contentId, sourceFile, valueBindings, dynamicValues),
              userId: staticNumericIds(userId, sourceFile, valueBindings, dynamicValues),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return contexts;
}

function fakeOwnedTx(): any {
  const rows = new Map<unknown, unknown[]>([
    [articles, [{ id: 1 }]],
    [articleAssets, [{ id: 1 }]],
    [campaigns, [{ id: 1 }]],
    [clientBrandProfiles, [{ id: 1 }]],
    [jobBatches, [{ id: 1 }]],
    [socialPosts, [{ id: 1 }]],
    [socialPostAssets, [{ id: 1 }]],
    [teamMembers, [{ id: 1 }]],
    [videoIdeas, [{ id: 1 }]],
  ]);
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => rows.get(table) ?? [],
        }),
      }),
    }),
  };
}

void test("all production receipt resource contexts pass real ownership admission", async () => {
  const files = [
    ...productionSources("lib"),
    ...productionSources("app"),
    ...productionSources("server"),
  ];
  const contexts = scanReceiptContexts(files);
  assert.ok(contexts.length > 0, "receipt AST scan found no production adapter contexts");
  assert.ok(
    contexts.some((context) => context.resourceType.has("media_asset")),
    "dynamic single-image resourceType context was not discovered",
  );
  assert.ok(
    contexts.some((context) => context.resourceType.has("video_idea")),
    "dynamic Veo resourceType context was not discovered",
  );

  const failures: string[] = [];
  for (const context of contexts) {
    for (const { resourceType, resourceId } of context.resourcePairs) {
      for (const campaignId of context.campaignId) {
        for (const contentId of context.contentId) {
          for (const userId of context.userId) {
              try {
                await ledger.validateProviderUsageAttribution(
                  fakeOwnedTx(),
                  TEST_TEAM_ID,
                  campaignId,
                  contentId,
                  resourceType,
                  resourceId,
                  userId,
                );
              } catch (error) {
                failures.push(
                  `${context.path}:${context.line} resourceType=${String(resourceType)} ` +
                  `resourceId=${String(resourceId)}: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
          }
        }
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

function volatileIdentityExpressions(path: string, sourceFile: ts.SourceFile): string[] {
  // The only deliberate random roots live in these entry-boundary modules.
  // Callers beneath them must use the established logical invocation.
  if (["lib/provider-invocation-identity.ts", "lib/provider-http-invocation.ts"].includes(path)) return [];
  const bindings = new Map<string, ts.Expression>();
  const bind = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, bind);
  };
  bind(sourceFile);
  const isVolatile = (node: ts.Node, seen = new Set<string>()): boolean => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(sourceFile);
      if (/(?:^|\.)(?:randomUUID|randomBytes|random|nanoid|uuidv4|uuidv7)$/.test(name) ||
          /^(?:Date|performance)\.now$/.test(name)) return true;
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "Date" &&
        !node.arguments?.length) return true;
    // A member name is not a reference to a same-named local variable.
    // For example deps.attemptId must not resolve to local const attemptId.
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === "attemptsMade") return true;
      return isVolatile(node.expression, seen);
    }
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const binding = bindings.get(node.text);
      if (binding) {
        const next = new Set(seen);
        next.add(node.text);
        if (isVolatile(binding, next)) return true;
      }
    }
    let found = false;
    ts.forEachChild(node, (child) => { if (isVolatile(child, seen)) found = true; });
    return found;
  };
  const failures: string[] = [];
  const inspect = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = propertyName(node.name);
      // runCanary's attemptId is supplied by the worker and historically
      // flowed into receipt invocationKey; inspect that cross-file handoff.
      const call = node.parent?.parent;
      const isCanaryIdentity = name === "attemptId" && call && ts.isCallExpression(call) &&
        call.expression.getText(sourceFile).split(".").at(-1) === "runCanary";
      if (name === "attemptKey" || name === "invocationKey" || isCanaryIdentity) {
        const expression = ts.isPropertyAssignment(node) ? node.initializer : node.name;
        if (isVolatile(expression)) {
          failures.push(`${path}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${name}`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return failures;
}

test("production receipt keys cannot contain random or wall-clock identity material", () => {
  const files = [...productionSources("lib"), ...productionSources("app"), ...productionSources("server")];
  const failures = files.flatMap(({ path, sourceFile }) => volatileIdentityExpressions(path, sourceFile));
  assert.deepEqual(failures, [], failures.join("\n"));
  for (const expression of ["randomUUID()", "Date.now()", "Math.random()", "new Date().getTime()", "job.attemptsMade + 1"]) {
    const fixture = ts.createSourceFile("fixture.ts",
      `const key = \`stage:\${${expression}}\`; submit({ attemptKey: key });`,
      ts.ScriptTarget.Latest, true);
    assert.equal(volatileIdentityExpressions("fixture.ts", fixture).length, 1, expression);
  }
});