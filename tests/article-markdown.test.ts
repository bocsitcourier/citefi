import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "cheerio";
import { visibleArticleText, validateArticleOutput } from "../lib/article-output-safety";
import {
  ArticleMarkdownError,
  renderArticleMarkdown,
} from "../lib/article-markdown";

const TARGET_URL = "https://example.test/guide";

test("renders a 154-word Markdown article as semantic safe HTML", () => {
  const bodyWords = Array.from({ length: 142 }, (_, index) => `recovery${index + 1}`);
  bodyWords[bodyWords.length - 1] = "recovery.";
  const markdown = [
    "# Durable restart recovery",
    "",
    "A durable article includes a [project guide](https://example.test/guide).",
    "",
    "## Recovery checkpoints",
    "",
    bodyWords.join(" "),
  ].join("\n");

  const sourceValidation = validateArticleOutput(markdown, {
    format: "markdown",
    minWords: 120,
    maxWords: 160,
  });
  const html = renderArticleMarkdown(markdown);
  const parsed = load(html);
  const validation = validateArticleOutput(html, {
    format: "html",
    minWords: 120,
    maxWords: 160,
  });

  assert.equal(sourceValidation.valid, true, sourceValidation.reasons.join("; "));
  assert.equal(sourceValidation.wordCount, 154);
  assert.equal(validation.valid, true, validation.reasons.join("; "));
  assert.ok(validation.wordCount >= 120 && validation.wordCount <= 160);
  assert.equal(parsed("article").length, 1);
  assert.equal(parsed("h1").length, 1);
  assert.equal(parsed("h2").length, 1);
  assert.equal(parsed("p").length, 2);
  assert.equal(parsed(`a[href="${TARGET_URL}"]`).length, 1);
  assert.equal(parsed("script,style").length, 0);
  assert.match(parsed("article").text(), /Durable restart recovery/);
});

test("preserves Markdown emphasis, code, ordered and unordered lists", () => {
  const html = renderArticleMarkdown([
    "# Formatting",
    "",
    "A **strong** and *emphasized* word with `inline code`.",
    "",
    "- first item",
    "- second item",
    "",
    "1. one item",
    "2. two item",
  ].join("\n"));
  const parsed = load(html);

  assert.equal(parsed("strong").text(), "strong");
  assert.equal(parsed("em").text(), "emphasized");
  assert.equal(parsed("code").first().text(), "inline code");
  assert.equal(parsed("ul > li").length, 2);
  assert.equal(parsed("ol > li").length, 2);
});

test("escapes raw HTML and rejects unsafe Markdown destinations", () => {
  const html = renderArticleMarkdown(
    "# Safe text\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>",
  );
  const parsed = load(html);

  assert.equal(parsed("script, img").length, 0);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /onerror/);
  assert.throws(
    () => renderArticleMarkdown("[bad](javascript:alert(1))"),
    (error: unknown) => error instanceof ArticleMarkdownError && /unsafe/i.test(error.message),
  );
  assert.throws(
    () => renderArticleMarkdown("[bad](//evil.example.test/path)"),
    (error: unknown) => error instanceof ArticleMarkdownError && /unsafe/i.test(error.message),
  );
});