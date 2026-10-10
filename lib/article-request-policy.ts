/** Gemini 3 uses levels, while 2.5 uses a token budget. Keep reasoning bounded. */
export function articleThinkingConfig(model: string) {
  if (/^gemini-3(?:\.|-)/.test(model)) return { thinkingLevel: "LOW" as const };
  if (/^gemini-2\.5-/.test(model)) return { thinkingBudget: 1024 };
  return undefined;
}

export function articleThinkingOptions(model: string) {
  const thinking = articleThinkingConfig(model);
  if (thinking?.thinkingLevel) {
    // The installed SDK predates thinkingLevel. Its documented deep-merge
    // extraBody transport preserves schema/output limits while sending this API field.
    return { httpOptions: { extraBody: { generationConfig: { thinkingConfig: thinking } } } };
  }
  return thinking ? { thinkingConfig: thinking } : {};
}

export function articleLengthInstruction(min: number, max: number): string {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    throw new Error("Invalid article word-count bounds");
  }
  return `The ${min}-${max} word limit applies to the COMPLETE article including headings and FAQs.
Aim near ${Math.floor((min + max) / 2)} total words, leaving room for FAQ answers.
Include the FAQ section in articleText and return matching entries in faq; do not duplicate it.
Use real Markdown hyperlinks in articleText, including at least two naturally anchored links to the supplied target URL.
Do not return only unlinked phrases for a later hyperlinker. Never invent source URLs.`;
}
