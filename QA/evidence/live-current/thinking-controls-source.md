# Gemini 3.5 Flash thinking controls — official source

Verified 2026-10-08 from Google's GenerateContent documentation:
https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5
(page last updated 2026-10-07 UTC).

The model-specific table supports `minimal`, `low`, `medium` (default), and
`high` for Gemini 3.5 Flash. The REST example places the enum at
`generationConfig.thinkingConfig.thinkingLevel`, using uppercase `"HIGH"`.
This QA configuration uses the supported uppercase `"MINIMAL"`.

Exact relevant excerpts:

> Matches the "no thinking" setting for most queries. Note, `minimal` does
> not guarantee that thinking is off, the model may reason very minimally for
> complex tasks.

> The raw numeric `thinking_budget` parameter is no longer recommended across
> all Gemini 3.x models. Use the `thinking_level` string enum instead.

> Yes, `thinking_budget` is still supported for backward compatibility, but we
> recommend migrating to `thinking_level` for more predictable performance.
> Don't use both in the same request.

This is a reasoning-effort control, **not a numeric thinking-token guarantee**.
The 16,384 total-output bound still covers candidate and thought tokens at the
standard output price. No `thinkingBudget`, sampling overrides, tools, cached
content, alternate model, candidate expansion, or auxiliary provider calls are
authorized. Guardian and the final paid judge remain mandatory.
