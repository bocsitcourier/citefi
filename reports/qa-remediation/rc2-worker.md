# RC2 Worker Remediation — `FIXED_UNVERIFIED`

## Scope and root cause

RC2 is limited to social caption/image delivery integrity. The existing
`enforceSocialCaptionCompliance` function was a repair pass: it removed
unsupported-claim sentences, removed malformed URL text, and truncated an
over-limit caption. That made an invalid provider result appear valid and
allowed a changed/paid artifact to reach the final persistence boundary.
The social worker also carried separate platform geometry/limit literals and
only considered an HTTP article hero URL for reuse.

RC3 source behavior was preserved, including the final social reviewer/policy
gate, terminal quality errors, sibling-task settlement, and failed-variant
diagnostics. RC2 does not weaken or bypass those gates.

## Implemented changes

- `enforceSocialCaptionCompliance` is now a strict, no-repair validator.
  - Unsupported numeric savings/efficiency claims reject.
  - Invalid or malformed URL tokens, including Markdown destinations, reject.
  - Empty and over-limit captions reject.
  - The exact input caption is returned unchanged on failure.
  - No sentence deletion, URL stripping, rewording, or arbitrary truncation
    occurs.
- Hashtag fitting remains deterministic and only drops a trailing whole
  hashtag suffix when the combined caption budget is exceeded. It does not
  skip an over-limit tag to retain a later tag or mutate tag text.
- Added typed `PLATFORM_SPECS` as the canonical source for character limits,
  hashtag limits/ratios, persisted aspect ratios, Gemini-native ratios, image
  descriptions, and exact output dimensions. Existing limit/aspect/dimension
  exports are derived compatibility views. The hashtag strategy, social image
  normalizer, provider image generator, worker, and manual regeneration route
  consume this contract.
- Removed Gemini's pre-gate caption truncation so an over-limit provider
  result reaches the strict gate unchanged.
- Retained validation before variant `READY`, image attachment/provider image
  work, and final social-post success persistence. A bad caption raises the
  existing terminal `QUALITY_GATE_FAILED` path and cannot produce `READY`.
- Article hero reuse now requires an article selected for the requesting
  post's same team. Local object URLs preserve `private/` versus `public/`
  keys and read through the existing primary/legacy storage candidate
  boundary, then are cropped/resized locally with Sharp and persisted with
  actual normalized width, height, format, and aspect metadata. An eligible
  local hero therefore bypasses the paid social-image provider. Existing
  bounded remote-URL reads remain guarded by the established safe fetch
  boundary. No placeholder/fake asset is introduced.
- Durable same-attempt resume is keyed by the BullMQ job id recorded in
  `platformMetadata`. A READY variant is reused only when its marker, strict
  caption/link contract, and persisted output are valid. Image assets are
  resumed only through the owning same-attempt variant id and exact canonical
  dimensions. Cross-attempt READY rows and unmarked historical assets remain
  diagnostic and cannot be reused.
- On retry after a late parent DB/log failure, the worker resumes durable
  variants/assets before any LLM or image-provider call. Existing parent
  `READY` delivery still takes the settlement-only path and now completes the
  durable job checkpoint without replaying providers. RC3 `Promise.allSettled`
  sibling completion and terminal quality handling remain unchanged.
- The post-`READY` `PLATFORM_GENERATED` diagnostic write is now best-effort.
  An injected audit-log failure therefore retains the valid READY checkpoint;
  the next retry resumes it with zero Gemini/OpenAI calls instead of entering
  the platform failure catch and replaying paid generation.

## Regression coverage and commands

Added/updated no-DB tests cover:

- historical `403X`-shaped over-limit output rejected unchanged;
- malformed URL plus unsupported numeric claim rejected unchanged;
- bad caption rejected before worker `READY` and image-provider work;
- real local Sharp image bytes normalized to exact dimensions for X,
  Facebook, Instagram, LinkedIn, and Pinterest;
- same-team local hero selection, local normalization, and provider bypass
  source contract;
- private/public object-key resolution and primary/legacy storage fallback;
- same-attempt READY variant/asset resume, cross-attempt stale-row rejection,
  and late parent-failure provider-bypass source contract;
- injected `PLATFORM_GENERATED` diagnostic-log failure followed by a
  provider-free READY retry;
- central hashtag-limit consumption from `PLATFORM_SPECS`;
- deterministic trailing hashtag dropping and canonical platform aliases.

Executed successfully:

```sh
node --import tsx/esm --test tests/social-generation-contract.test.ts \
  tests/generation-finalization-gate.test.ts
npx tsc --noEmit --pretty false
git diff --check
```

Results: 17/17 targeted tests passed; TypeScript emitted no errors; diff check
emitted no whitespace errors. The retained historical fixture asserts its
exact 403-character length before validation.

## Limitations / approval boundary

`FIXED_UNVERIFIED` remains required. No provider, network, database-write,
object-storage-write, billing, export, dependency installation, workflow
restart, or model-change operation was performed. Test image bytes were
generated in memory with Sharp; external boundaries remain stubbed/guarded by
the test contract. The local hero read and upload paths were not live
exercised. Independent architect/principal approval is required before any
staged or live run.