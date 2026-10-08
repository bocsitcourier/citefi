# Current authoritative media pricing

Fetched 2026-10-08T20:14:23Z from
https://ai.google.dev/gemini-api/docs/pricing using the official page, not search
snippets. These are standard paid-tier prices, not batch prices.
Extracted markdown chunk hashes: first 50,000-character chunk
`ba6beb376e0a3425831e7328402406fb47d1989d50ce13d9a554cf41fa3b76eb`;
continuation
`511b05e5a1444167b7466e74b2f6a49849c6b2b167d6df19be3537fca3f03581`.
The extracts below are retained separately from the earlier article pricing
capture; no historical evidence is overwritten.

## Gemini 3.1 Flash Image

Model: `gemini-3.1-flash-image`.

| Input | Output |
| --- | --- |
| $0.50 (text/image) per million tokens | $3 (text and thinking), $60.00 (images) per million tokens |

Official footnote: "Output images at 4K (4096x4096px) consume 2520 tokens and
are equivalent to $0.151 per image." 1K images consume 1120 tokens ($0.067).
Grounding is separately priced and is prohibited in this QA.
The image run caps the entire output at 2520 tokens and conservatively
reserves them all at the higher image rate: 16000 * $0.50/M +
2520 * $60/M = $0.1592, covered by $0.16.

## Gemini 2.5 Flash Preview TTS

Model: `gemini-2.5-flash-preview-tts`.
Input $0.50 per million text tokens; output $10.00 per million audio tokens.
This is source research only, not approval to substitute this model for the
application's OpenAI TTS pipeline.

## Veo 3.1

| Model | Paid-tier price per generated second |
| --- | --- |
| `veo-3.1-generate-preview` | $0.40 (720p and 1080p), $0.60 (4k) |
| `veo-3.1-fast-generate-preview` | $0.10 (720p), $0.12 (1080p), $0.30 (4k) |
| `veo-3.1-lite-generate-preview` | $0.05 (720p), $0.08 (1080p), 4k unsupported |

Video with audio is the default. No video run is authorized merely by this
pricing capture. The selected model, duration, resolution and every auxiliary
call must first have a reviewed manifest and shared-ledger reservation.
