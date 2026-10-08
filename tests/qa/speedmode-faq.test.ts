import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { load } from "cheerio";
import { appendFaqToArticleMarkdown, renderArticleMarkdown } from "../../lib/article-markdown";
import { auditArticle } from "../../lib/guardian-agent";

test("retained Gemini response FAQ metadata is rendered into speed-mode article before Guardian", async () => {
  const evidencePath = join(
    process.cwd(),
    "QA/evidence/live-current/live-article-output16384/article-output.json",
  );
  const providerResponse = JSON.parse(readFileSync(evidencePath, "utf8")) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const responseText = providerResponse.candidates?.[0]?.content?.parts?.find(
    (part) => typeof part.text === "string",
  )?.text;
  assert.ok(responseText, "retained provider response must contain its JSON text payload");

  const generated = JSON.parse(responseText) as {
    articleText: string;
    faq: Array<{ question: string; answer: string }>;
  };
  assert.ok(generated.articleText);
  assert.ok(generated.faq.length >= 3);

  const finalHtml = renderArticleMarkdown(
    appendFaqToArticleMarkdown(generated.articleText, generated.faq),
  );
  const html = load(finalHtml);
  assert.equal(html("h3").length, generated.faq.length);
  assert.equal(html("a").length, 5);
  assert.match(html("h2").last().text(), /Frequently Asked Questions/i);

  const report = await auditArticle(finalHtml, {
    minImages: 0,
    minHyperlinks: 3,
    minFaqQuestions: 3,
    minWordCount: 1000,
    persona: "professional",
    skipToneCheck: true,
  });
  assert.equal(report.passed, true, report.missingElements.join("; "));
  assert.equal(report.breakdown.hyperlinks.count, 5);
  assert.equal(report.breakdown.faq.questionCount, generated.faq.length);
});

test("FAQ augmentation preserves an existing section and ignores empty metadata", () => {
  const existing = "# Guide\n\n## Frequently Asked Questions\n\n### Existing question?\n\nExisting answer.";
  const faq = [{ question: "New question?", answer: "New answer." }];

  assert.equal(appendFaqToArticleMarkdown(existing, faq), existing);
  assert.equal(appendFaqToArticleMarkdown("# Guide\n\nBody.", []), "# Guide\n\nBody.");
});

test("FAQ questions are normalized as text and answers still use safe Markdown rendering", () => {
  const markdown = appendFaqToArticleMarkdown("# Guide\n\nBody.", [{
    question: "  What\nis <script>?",
    answer: "Use a [safe guide](https://example.test/guide).",
  }]);
  const html = load(renderArticleMarkdown(markdown));

  assert.equal(html("script").length, 0);
  assert.equal(html("h3").text(), "What is <script>?");
  assert.equal(html('a[href="https://example.test/guide"]').length, 1);
});
