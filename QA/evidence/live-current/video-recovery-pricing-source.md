# Video recovery proposal — authoritative public sources

Consulted 2026-10-08 during preparation only. No generation, polling or native
account access was made to fetch these public documents. These excerpts are
not billing invoices and expire as execution authority after this UTC date.

## Official Google pricing

URL: https://ai.google.dev/gemini-api/docs/pricing

Section: Veo 3.1

Model identifier includes `veo-3.1-fast-generate-preview`.

| | Free Tier | Paid Tier, per second in USD |
| --- | --- | --- |
| Veo 3.1 Fast video with audio price (default) | Not available | $0.10 (720p), $0.12 (1080p), $0.30 (4k) |

Selected proposal: **720p, $0.10/second**, including native audio.
One 6s, one-sample clip is $0.60; ten clips are $6.00. This does not price
unknown historical attempts or authorize retries.

## Official Google generation documentation

URL: https://ai.google.dev/gemini-api/docs/veo

REST examples:

```text
BASE_URL="https://generativelanguage.googleapis.com/v1beta"
.../models/veo-3.1-generate-preview:predictLongRunning
```

Selected parameters from the model table:

- `durationSeconds`: `"4"`, `"6"`, `"8"`; 1080p/4k and reference-image or
  extension use cases impose additional 8s constraints.
- `resolution`: `"720p"` (default); higher resolutions have duration constraints.
- Veo 3.1 / Veo 3.1 Fast native audio: always on.

The proposal uses text-only 6s 720p generation, no references or extension.
The endpoint version discrepancy is a plausible historical failure cause,
not proof of why empty responses occurred or proof of zero provider charges.

## Exact Fast identifier and operation schema

The official Veo guide's **Veo 3.1 Fast Preview** model table lists:

```text
Gemini API model code: veo-3.1-fast-generate-preview
Input: Text, Image
Output: Video with audio
Output video limit: 1
```

Its parameter table groups **Veo 3.1 & Veo 3.1 Fast**, supports durations
`"4"`, `"6"`, `"8"` and `"720p"` resolution. SDK examples set
`numberOfVideos: 1`. The installed Google SDK maps that field to native
`parameters.sampleCount` (local adapter evidence, not a server acceptance claim).

Official REST reference:
https://ai.google.dev/api/models#method:-models.predictlongrunning

```text
POST https://generativelanguage.googleapis.com/v1beta/{model=models/*}:predictLongRunning
model: required, format models/{model}
instances[]: required input values
parameters: optional value
Successful response: Operation
```

Combining the exact documented Fast ID with this wildcard path gives the
proposed Fast REST path. The guide's Standard-model curl example alone is not
claimed as evidence of a successfully tested Fast request.
The guessed separate URL ending `/docs/models/veo-3.1-fast-generate-preview`
returned a 404; it is **not** used as authoritative model evidence.

The official guide's REST examples retain initial `.name`, poll
`"${BASE_URL}/${operation_name}"` and read:

```text
.response.generateVideoResponse.generatedSamples[0].video.uri
```

SDK examples instead use `operation.response.generatedVideos[0].video`,
and `ai.files.download(...)`. The native guard must validate the native REST
structure before SDK conversion, including exact result count, not merely
copy a sample's `[0]` indexing. File URLs are permitted only from this run's
durably acknowledged native result, never guessed or supplied externally.
