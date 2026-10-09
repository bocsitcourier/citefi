import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? sources(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("generation request model literals cannot bypass central selection again", () => {
  const bypasses: string[] = [];
  for (const path of [...sources("lib"), ...sources("app"), ...sources("server")]) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        ["model", "modelName"].includes(node.name.text) &&
        (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
        /^(gpt-|gemini-|veo-|o[134]-)/.test(node.initializer.text)) {
        bypasses.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(bypasses, [], "Resolve one model at the operation boundary and reuse it in its receipt");
});
