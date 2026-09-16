import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidArticleOutput,
  normalizeArticleTargetUrls,
  validateArticleOutput,
} from "../lib/article-output-safety";

const CLEAN_MARKDOWN = `## Winter checklist

A home energy audit starts with a room-by-room review of heating equipment, insulation, windows, doors, and visible drafts. Begin by recording the condition of each area and noting where rooms feel unusually cold. This baseline helps a homeowner prioritize practical work without making unsupported promises.

## What to inspect

Check attic insulation, weatherstripping, duct joints, and exhaust paths. A flashlight and incense stick can reveal likely leaks, but electrical equipment and combustion appliances require appropriate care. Write down observations, take measurements when safe, and consult local guidance before changing equipment.

## Next steps

Use the checklist to separate simple maintenance from work that needs a qualified professional. Compare recommendations, ask what each test measures, and keep the written results for future planning. A careful audit gives the household a clearer sequence of improvements.`;

// Redacted reproduction of the live defect: the model returned its prompt
// inspection and JSON-LD/debug discussion in the article field.
const REDACTED_REAL_BAD_OUTPUT = `Wait! Look at the prompt's input text:
\`[redacted question]\`
Wait, is there a cut-off in the JSON-LD or in the text?
Let's look at the JSON-LD:
\`\`\`json
{"@type":"Question","name":"[redacted]"}
\`\`\`
Wait, is there a missing closing tag or something? No, it's closed.
Wait, let's look at the prompt's instruction again:
"[redacted reviewer instruction]"`;

test("accepts clean structured article markdown", () => {
  const result = validateArticleOutput(CLEAN_MARKDOWN, { format: "markdown" });
  assert.equal(result.valid, true, result.reasons.join("; "));
  assert.doesNotThrow(() =>
    assertValidArticleOutput(CLEAN_MARKDOWN, { format: "markdown" }),
  );
});

test("rejects the redacted live reasoning/debug regression", () => {
  const result = validateArticleOutput(REDACTED_REAL_BAD_OUTPUT, {
    format: "markdown",
  });
  assert.equal(result.valid, false);
  assert.match(result.reasons.join("; "), /debug|heading|terminal|short/i);
  assert.throws(
    () => assertValidArticleOutput(REDACTED_REAL_BAD_OUTPUT, { format: "markdown" }),
    /INVALID_ARTICLE_OUTPUT/,
  );
});

test("allows JSON-LD in final HTML but never lets it replace visible article body", () => {
  const html = `<article><h2>Winter checklist</h2><p>${CLEAN_MARKDOWN.replace(
    /<[^>]*>/g,
    " ",
  )}</p><script type="application/ld+json">{"@type":"Article"}</script></article>`;
  const result = validateArticleOutput(html, { format: "html" });
  assert.equal(result.valid, true, result.reasons.join("; "));
  assert.doesNotMatch(result.visibleText, /application\/ld\+json|@type/);
});

test("ignores nested hashtag links when checking HTML terminal punctuation", () => {
  const result = validateArticleOutput(
    `<article><h1>Heading</h1><p>A real article body ends here.</p><div class="hashtags"><a href="#">#one</a><a href="#">#two</a></div></article>`,
    { format: "html", minWords: 1 },
  );
  assert.equal(result.valid, true, result.reasons.join("; "));
  assert.match(result.visibleText, /ends here\.$/);
});

test("enforces an explicit word-count ceiling without padding", () => {
  const result = validateArticleOutput(CLEAN_MARKDOWN, {
    format: "markdown",
    maxWords: 20,
  });
  assert.equal(result.valid, false);
  assert.match(result.reasons.join("; "), /too long.*maximum 20/i);
});

test("rejects the retained 844-word quality fixture at its requested 500-800 range", () => {
  // The retained live-run evidence records 844 words against a 500-800
  // request. Keep this exact count deterministic without reusing customer text.
  const retained844WordFixture = Array.from(
    // The visible H2 contributes three words, bringing the rendered total to 844.
    { length: 841 },
    (_, index) => `auditword${index + 1}`,
  ).join(" ") + ".";
  const result = validateArticleOutput(
    `<article><h2>Energy audit checklist</h2><p>${retained844WordFixture}</p></article>`,
    { format: "html", minWords: 500, maxWords: 800 },
  );
  assert.equal(result.wordCount, 844);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join("; "), /844 words; maximum 800/i);
});

test("rejects malformed and unsafe article link destinations", () => {
  const result = validateArticleOutput(
    `<article><h2>Checklist</h2><p>Read <a href="javascript:alert(1)">this guide</a>.</p></article>`,
    { format: "html", minWords: 1 },
  );
  assert.equal(result.valid, false);
  assert.match(result.reasons.join("; "), /invalid URL link/i);
});

test("repairs model-inserted whitespace in canonical target URLs", () => {
  const repaired = normalizeArticleTargetUrls(
    "[Energy checklist](https://www. Energy. Gov/energysaver)",
    "https://www.energy.gov/energysaver",
  );
  assert.equal(
    repaired,
    "[Energy checklist](https://www.energy.gov/energysaver)",
  );
});
