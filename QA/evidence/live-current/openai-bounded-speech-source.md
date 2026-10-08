# Bounded speech model research — no paid authorization

Retrieved 2026-10-08T21:11:04Z from official sources:

- https://developers.openai.com/api/docs/models/tts-1
  extracted markdown SHA256:
  `d3d7a7d9b63406d457d7c53fcf7e74f4af2707a09a978f9838e27b3a05018279`
- https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
  extracted markdown SHA256:
  `5cad52c01ed8b182c7c4bb818dd1cc3b9cd15a0ff4a54c85cf07418cd683e00c`

The official TTS-1 model page prices speech generation at **$15.00 per
million characters**. The speech API documents a maximum input length of
**4096 characters** per call. With this character-priced model, total input
characters can establish a cost ceiling without estimating generated duration.
For example, 30,000 characters across explicitly bounded segments costs at most
$0.45; one 4096-character submission costs at most $0.06144.

The current official page labels TTS-1 **Deprecated**. A test might therefore
be rejected. Such a rejection must stop the case with no fallback/retry, not
silently submit to another model.

This model is **not** the application's default `gpt-4o-mini-tts`. That
default is priced at $0.60/M text-input tokens and $12/M audio-output tokens,
not $15/M characters. A selected TTS-1 QA result must not certify the default
model, prove its token accounting, or alter the production default.

No paid model call, model substitution or budget reservation was made to
collect this research. Owner scope choice, a runnable guarded manifest and
separate architect execution approval are still required.
