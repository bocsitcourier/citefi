# Selected podcast/video pricing — preparation only

Official Google standard pricing retrieved 2026-10-08T21:43:43Z:
https://ai.google.dev/gemini-api/docs/pricing
First extracted markdown chunk SHA256:
`ba6beb376e0a3425831e7328402406fb47d1989d50ce13d9a554cf41fa3b76eb`.

Gemini 3.5 Flash: input **$1.50/M tokens**, output **$9.00/M tokens including
thinking**. Batch, Flex and Priority prices are not used. Grounding, tools,
caching, judges, expansion calls and auxiliary generation are prohibited.

Veo 3.1 Fast (`veo-3.1-fast-generate-preview`): **$0.10/second at 720p**,
$0.12/second at 1080p and $0.30/second at 4k. This test must explicitly request
720p, one video per submission, 6 seconds, and at most 10 distinct clips.
Selected operation completion is valued at requested seconds; downloaded
duration and resolution must independently match the request before acceptance.

Official Veo guide:
https://ai.google.dev/gemini-api/docs/veo
Retrieved 2026-10-08T21:43:43Z, extracted markdown SHA256:
`eb9bc75bc8888b0e0c7e48a46c99e1489e1087920217e8fbf4a47473ddd3f26e`.
The guide documents SDK `generateVideos` and REST `predictLongRunning`.

OpenAI TTS-1: **$15.00/M input characters**, at most **4096 characters per
submission**. Source and hashes are in `openai-bounded-speech-source.md`.
TTS-1 is deprecated. Any rejection stops the case without a replacement model.
This is selected-model QA, not default `gpt-4o-mini-tts` certification.

## Enforced ceilings

Each script: <=32768 UTF-8 request bytes, conservative input allowance of
65536 tokens (including wrapper margin), <=8192 total output/thinking tokens.
Maximum: $0.172032, covered by $0.20.

Podcast: one script and <=40 TTS submissions, <=30000 total input characters
and <=4096 per segment. Maximum $0.622032, reservation **$0.65**.

Video: one script, one <=4096-character TTS submission and <=10 clips of
6 seconds at 720p. Maximum $6.233472, reservation **$6.30**.

Combined reservations **$6.95**, exclusively within the retained USD30 ledger.
No paid permission follows from this document or the owner's scope choice.
Polls require the exact durably acknowledged operation name, <=30 polls per
clip and <=300 seconds elapsed per operation. Downloads must match a URI from
that operation's completed native result; no redirects or arbitrary URLs.
