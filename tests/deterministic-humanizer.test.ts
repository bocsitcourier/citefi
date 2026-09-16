import assert from "node:assert/strict";
import { test } from "node:test";

import { renderArticleMarkdown } from "../lib/article-markdown";
import { validateArticleOutput } from "../lib/article-output-safety";
import { humanizeArticle } from "../lib/deterministic-humanizer";

test("article humanization preserves Markdown blocks and rendered body", () => {
  const fencedCode = [
    "```ts",
    "const unchanged = `It's worth noting that this is code.`;",
    "console.log(unchanged);",
    "```",
  ].join("\n");
  const markdown = [
    "# Durable article title",
    "",
    "Residents can compare local options. It's worth noting that Written details help readers choose.",
    "",
    "## Planning checklist",
    "",
    "- Keep the destination clear",
    "- Ask for written timing and cost details",
    "",
    "> A quoted planning reminder stays exactly as supplied.",
    "",
    "| Option | Timing |",
    "| :--- | :--- |",
    "| Local team | Flexible |",
    "",
    fencedCode,
    "",
    "A final paragraph gives readers a practical next step and ends with a complete sentence.",
  ].join("\n");

  const result = humanizeArticle(markdown);

  // This fixture deliberately keeps entity vocabulary stable so the
  // integrity-pass path is exercised rather than the safe original fallback.
  assert.equal(result.metrics.integrityPassed, true);
  assert.match(result.content, /\n\n/);
  assert.match(result.content, /^# Durable article title/m);
  assert.match(result.content, /^## Planning checklist/m);
  assert.match(result.content, /^- Keep the destination clear$/m);
  assert.match(result.content, /^\| Option \| Timing \|$/m);
  assert.equal(
    result.content.match(/```ts\n[\s\S]*?\n```/)?.[0],
    fencedCode,
    "fenced code must not be humanized",
  );

  const sourceValidation = validateArticleOutput(result.content, {
    format: "markdown",
    minWords: 25,
    maxWords: 100,
  });
  assert.equal(sourceValidation.valid, true, sourceValidation.reasons.join("; "));

  const rendered = renderArticleMarkdown(result.content);
  const renderedValidation = validateArticleOutput(rendered, {
    format: "html",
    minWords: 25,
    maxWords: 100,
  });
  assert.equal(renderedValidation.valid, true, renderedValidation.reasons.join("; "));
  assert.match(rendered, /<h1>Durable article title<\/h1>/);
  assert.match(rendered, /<p>Residents can compare local options\./);
  assert.match(rendered, /<pre><code>/);
});