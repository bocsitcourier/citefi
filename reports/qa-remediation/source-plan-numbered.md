# Citefi QA remediation plan — numbered source extraction

## Extraction manifest

- **Source:** `attached_assets/citefi_qa_remediation_plan_1789565275462.docx`
- **Raw attachment SHA-256:** `c78791c02408e0da9b6e6c01f58f5f68a57fcf5d49270e4d92dda5e1943631fb`
- **Extraction rule:** body paragraphs are numbered in document order, including empty `w:p` positions. The source contains 84 body paragraphs: 77 non-empty and 7 empty. Line breaks inside a paragraph are retained as line breaks inside its fenced block.
- **Table rule:** tables are retained separately, in document order, with every row and every cell. Table-cell paragraphs are represented by their visible cell text and do not consume body paragraph IDs.
- **Architect mapping:** architect IDs `P1`–`P84` map exactly to extraction IDs `P1`–`P84`; there is no source-ID mismatch to repair. Empty positions are explicitly retained at P3, P8, P25, P35, P44, P53, and P71 rather than silently removed.
- **Visible-text convention:** XML entities are decoded to the same visible text (for example, `&#39;` is rendered as `'`). No source wording is paraphrased in the blocks below.

## Numbered body paragraphs

### P1
```text
Citefi — QA Remediation Plan & Agent Prompts
```

### P2
```text
Input: audit of 40 features — 7 passed, 7 partial, 5 failed, 3 blocked, 12 not run, 6 unsupported. Recorded provider cost $0.517071 across 99 ledger events, 2 calls unreconciled.
```

### P3
```text

```

### P4
```text
0. Scope reality check (read before promising “all A+”)
```

### P5
```text
“Every feature passes A+” is not achievable as stated, and the plan should say why rather than quietly fail:
```

### P6
```text
Addressable now: 27 features (5 failed + 7 partial + 3 blocked + 12 not run). The 6 unsupported items (landing pages, AI email campaigns, live ad publishing/spend, provider image inpainting, one-atomic-article-to-all-channels, Threads/YouTube contracts) are roadmap decisions, not remediation. Either scope them as new builds or formally mark them out-of-scope. Do not let an agent “fix” them — it will hallucinate implementations.
```

### P7
```text
Also note: external publishing and email delivery were never authorized during the audit. Those cannot be certified without an explicit authorization decision and test accounts.
```

### P8
```text

```

### P9
```text
1. Root-cause map — 15 symptoms, ~6 defects
```

### P10
```text
Fix these, and most of the failure list resolves together.
```

### P11
```text
RC-1 — Queue job-ID contract is broken
```

### P12
```text
Symptoms: Daily brief blocked (queue rejected colon-containing job ID); Idea video attempt 1 failed on invalid queue ID. Diagnosis: job names/IDs are being built by string concatenation with characters the queue rejects (:), and there is no validation at enqueue. Fix: one canonical makeJobId() / makeQueueName() helper with a strict charset ([a-z0-9_-]), applied everywhere; reject-and-throw at enqueue with a clear error; unit tests for every job type’s generated name.
```

### P13
```text
RC-2 — No platform-spec enforcement layer
```

### P14
```text
Symptoms: X post 403 chars (limit is 280); social images failed required aspect ratios; no article-hero reuse. Diagnosis: generation returns whatever the model produced; nothing validates against per-platform hard constraints before persisting. Fix: a single platformSpecs table (char limits, aspect ratios, image dimensions, hashtag caps) + a validator that runs before an asset is saved. On violation: auto-trim (text) or re-render (image) once, then fail loudly — never persist an out-of-spec asset.
```

### P15
```text
RC-3 — Output quality gates are not blocking
```

### P16
```text
Symptoms: article with prompt/debug residue; 844-word article (under target); promotional claims; malformed URL; missing brand-policy error; 2 unverifiable claims; unsupported claim in social. Diagnosis: the quality/anti-hallucination gates either run advisory-only or run after persistence. Debug residue in output means prompt scaffolding is leaking into the response and nothing scans for it. Fix: gates become blocking preconditions to persistence: min/max word count, prompt-residue regex scan, URL validity check, claim-verifiability check, brand-policy check. Failure → reject + one automatic regeneration → hard fail with reason. Never store a failing artifact as “finished.”
```

### P17
```text
RC-4 — Duration/metadata is estimated, not measured
```

### P18
```text
Symptoms: podcast requested 1–2 min, produced 3:24; card displayed 4:20 (a third, wrong number). Diagnosis: two separate bugs. (a) No length control on script generation. (b) Display duration is estimated (probably from character count) instead of read from the actual audio file. Fix: (a) target duration → target word count → enforce on script before TTS, and verify actual duration after render, re-cut if out of tolerance (±15%). (b) Read true duration from file metadata (ffprobe) and store it; the UI must render the stored measured value, never an estimate.
```

### P19
```text
RC-5 — Export integrity & concurrency defects
```

### P20
```text
Symptoms: ZIP downloaded with valid integrity but manifest hash verification failed; agency report concurrent generation failed against the DB schema; SEO “create articles” export failed. Diagnosis: manifest hashes are computed over different bytes than what is written (ordering, encoding, or post-hash mutation). Concurrency failure is a schema/constraint issue (likely missing unique key or a race on insert). Fix: hash exactly the bytes written, in a deterministic order, and verify round-trip in a test. For concurrency: reproduce with 2+ simultaneous generations, fix the schema/constraint, add a regression test that runs them in parallel.
```

### P21
```text
RC-6 — Compilation defect in export library (already fixed, unverified)
```

### P22
```text
Symptoms: Journey orchestration and Learning/corpus/decisioning both blocked by the same compilation error. Status: source defects fixed and app restarted, but never rerun end to end. Fix: no code change assumed — these simply must be executed and evidenced.
```

### P23
```text
RC-7 (financial) — Unreconciled provider calls
```

### P24
```text
Symptoms: 2 of 99 ledger events unreconciled (original article call; first audio-verification call — model/limits unknown). The $6 reserve is an assumption, not confirmed coverage. Fix: every provider call must write a complete provider_usage_events row (provider, model, operation, tokens/units, cost, status) — no exceptions. Backfill or explicitly mark the 2 unknown events. Note: the released 10-credit reservation on the failed article was correct behavior, but the provider cost was still incurred — that is the silent-leak case the cost model warns about, and it must appear in the ledger.
```

### P25
```text

```

### P26
```text
2. Definition of “A+” (the gate, stated in advance)
```

### P27
```text
An agent may only mark a feature PASS when all of these exist:
```

### P28
```text
A real run against real providers (not a mock, not a TypeScript check).
```

### P29
```text
A persisted artifact with its identifier, byte size, and — for media — measured duration/dimensions.
```

### P30
```text
Persistence proven across refresh + logout/login where the feature stores data.
```

### P31
```text
Spec compliance proven where a spec exists (char limit, aspect ratio, word count, schema validity).
```

### P32
```text
Ledger proven: the provider call(s) appear in provider_usage_events with model and cost; credits reserved/debited/released correctly.
```

### P33
```text
A regression test committed that would catch this exact failure again.
```

### P34
```text
“TypeScript compiles” and “targeted regression checks passed” do not constitute a pass. The audit already flagged this: repairs passing type checks does not establish that generation passes with real providers.
```

### P35
```text

```

### P36
```text
3. Fix order (dependency-aware)
```

### P37
```text
Do not parallelize these across agents until Wave 1 is done — later waves depend on it.
```

### P38
```text
Wave 1 — Foundations (blocks everything): RC-1 job IDs, RC-7 ledger completeness, RC-3 gate framework wiring.
```

### P39
```text
Wave 2 — Content correctness: article pipeline (RC-3 applied), social text + image (RC-2), podcast duration (RC-4).
```

### P40
```text
Wave 3 — Video: idea video (depends on RC-1 fix), then the other video routes.
```

### P41
```text
Wave 4 — Export/reporting: manifest hash, concurrency, PDF gap for agency reports.
```

### P42
```text
Wave 5 — Rerun blocked + run the 12 never-run features.
```

### P43
```text
Wave 6 — Scope decision on the 6 unsupported features.
```

### P44
```text

```

### P45
```text
4. Sub-agent orchestration model
```

### P46
```text
Replit’s agent will not spontaneously run a multi-agent team. You get the behavior you want by imposing the structure yourself: one Lead agent, specialized workers, and a shared state file that is the only channel of communication. This is what makes it persistent and prevents an agent from declaring victory early.
```

### P47
```text
The shared state file — /QA_REMEDIATION_STATE.md
```

### P48
```text
Every agent reads it before acting and writes to it after acting. It is the single source of truth.
```

### P49
```text
# QA REMEDIATION STATE
## Root causes
RC-1 job-id contract      | status: OPEN | owner: — | evidence: —
RC-2 platform specs       | status: OPEN | owner: — | evidence: —
...
## Features (27 addressable)
F-01 batch article gen    | status: FAIL | blocked_by: RC-3 | evidence: —
F-02 single article regen | status: FAIL | blocked_by: RC-3 | evidence: —
...
## Handoff log (append-only, newest last)
[timestamp] AGENT: <name> | DID: <what> | RESULT: <pass/fail + evidence> | NEXT: <who/what>
## Blockers needing human decision
- <item>
```

### P50
```text
Rules enforced on every agent: - Status values are only: OPEN / IN_PROGRESS / FIXED_UNVERIFIED / VERIFIED_PASS / BLOCKED_HUMAN. - Nothing moves to VERIFIED_PASS without evidence meeting §2. - An agent that cannot finish must write a BLOCKED_HUMAN entry with the exact question — never guess and never silently skip. - Append to the handoff log; never delete another agent’s entry.
```

### P51
```text
The agent roles
```

### P52
```text
The VERIFIER must be a different pass than the fixer. The single biggest cause of false “A+” is the same agent judging its own work.
```

### P53
```text

```

### P54
```text
5. Copy-paste prompts
```

### P55
```text
5.1 LEAD — session opener (run this first, every session)
```

### P56
```text
You are LEAD agent for the Citefi QA remediation. You coordinate; you do not write feature code.

1. Read /QA_REMEDIATION_STATE.md. If it does not exist, create it from /QA_REMEDIATION_PLAN.md
   listing all 7 root causes and all 27 addressable features with status OPEN.
2. Print a status table: how many VERIFIED_PASS / FIXED_UNVERIFIED / IN_PROGRESS / OPEN / BLOCKED_HUMAN.
3. Pick the next task using this strict order: Wave 1 foundations first (RC-1, RC-7, RC-3 framework),
   then Wave 2 content, Wave 3 video, Wave 4 export, Wave 5 reruns.
   Never start a Wave-N task while any Wave-(N-1) task is not VERIFIED_PASS.
4. Output the exact prompt to hand to the responsible worker agent, including:
   - the root cause ID, the files you believe are involved, and the acceptance evidence required.
5. Do not mark anything VERIFIED_PASS yourself unless the handoff log contains VERIFIER evidence
   meeting the Definition of A+ (real provider run + persisted artifact + spec compliance + ledger row
   + regression test). If evidence is missing, set it back to FIXED_UNVERIFIED and re-assign to VERIFIER.

Rules: Do not summarize progress optimistically. Report only what the state file proves.
If you are uncertain whether something passed, it did not pass.
```

### P57
```text
5.2 INFRA — RC-1 job-ID contract
```

### P58
```text
You are INFRA agent. Task: RC-1 — the job queue rejects malformed job IDs.

Evidence from QA: the Daily Brief was BLOCKED because the queue rejected a job ID containing a colon.
The Idea Video first attempt failed on an invalid queue ID. Treat these as ONE defect.

Do this:
1. Find every place a queue job name or job ID is constructed. Search for template literals and
   concatenation feeding the queue enqueue calls. List every call site before changing anything.
2. Create ONE canonical helper (e.g. makeJobId / makeQueueName) that:
   - produces only [a-z0-9_-]
   - replaces or strips any other character (colons, spaces, slashes, dots)
   - has a max length consistent with the queue's limit
   - throws a clear, typed error if the input cannot produce a valid ID
3. Replace EVERY call site with the helper. Do not leave a single ad-hoc construction.
4. Add validation at the enqueue boundary that rejects an invalid ID loudly rather than failing
   deep in the worker.
5. Write unit tests that generate a job ID for EVERY job type in the system and assert validity,
   including a test with a colon-containing input.

Persistence requirement: do not stop until `npm run typecheck` passes AND the new tests pass.
If a call site is ambiguous, list it in /QA_REMEDIATION_STATE.md under blockers — do not guess.

When done, append to the handoff log:
[time] INFRA | DID: RC-1 canonical job id helper, N call sites migrated | RESULT: typecheck+tests pass |
NEXT: VERIFIER to rerun Daily Brief and Idea Video end to end.
Set RC-1 to FIXED_UNVERIFIED (not VERIFIED_PASS — you do not grade your own work).
```

### P59
```text
5.3 QUALITY — RC-3 blocking gates
```

### P60
```text
You are QUALITY agent. Task: RC-3 — generated content is being persisted despite failing quality rules.

Evidence from QA: a retained article had 844 words, a malformed URL, promotional claims, a missing
brand-policy error, and 2 unverifiable claims. Historical batch output contained prompt/debug residue.
A social post contained an unsupported claim.

The core defect: quality gates are advisory or run after persistence. Make them BLOCKING PRECONDITIONS.

Do this:
1. Locate the content generation → persistence path for articles and social posts. Map exactly where
   an artifact is written to the database/storage.
2. Implement a gate pipeline that runs BEFORE persistence and returns pass/fail with reasons:
   - word count within the requested target range (fail 844 when target is higher)
   - prompt/debug residue scan (system-prompt fragments, role markers, JSON scaffolding, "As an AI")
   - URL validation on every link (well-formed + resolvable shape)
   - promotional/unsupported-claim detection
   - brand-policy check must EXECUTE, and a missing/errored policy check is itself a FAIL, never a skip
3. On failure: automatically regenerate ONCE with the failure reasons fed back into the prompt.
   If it fails again, hard-fail the job with a structured reason. Never persist a failing artifact.
4. Ensure the failure path releases the credit reservation AND still writes the provider cost to
   provider_usage_events (cost was incurred even though the customer was not charged).
5. Add tests using the actual failing article as a fixture: assert it is REJECTED by the gate.

Do not weaken any threshold to make a test pass. If a threshold seems wrong, write it in the state
file as a human decision. Set RC-3 to FIXED_UNVERIFIED when tests pass.
```

### P61
```text
5.4 PLATFORM — RC-2 platform specs
```

### P62
```text
You are PLATFORM agent. Task: RC-2 — assets are produced that violate platform hard limits.

Evidence from QA: an X post was 403 characters (limit 280). Social images were 5 distinct PNGs but
did not meet required aspect ratios. Article-hero image reuse did not occur.

Do this:
1. Create ONE source of truth for platform constraints — a typed specs map covering, per platform:
   max characters, required/allowed aspect ratios, min/max image dimensions, hashtag limits.
   Cover every platform the product generates for.
2. Add a validator that runs BEFORE an asset is persisted:
   - text over limit → attempt ONE automatic trim that preserves meaning and required hashtags, then
     re-validate; if still over, fail with reason. Never persist an over-limit post.
   - image wrong ratio → re-render/crop to the required ratio, then re-validate; never persist wrong ratio.
3. Implement article-hero reuse: when a social asset needs an image and a valid article hero exists,
   reuse it (correctly re-cropped per platform) instead of generating a new one. This is also a cost fix.
4. Tests: a 403-character X post fixture must be rejected or trimmed to <=280; each platform's image
   output must assert exact expected dimensions.

Set RC-2 to FIXED_UNVERIFIED when tests pass. Do not change which model generates content.
```

### P63
```text
5.5 MEDIA — RC-4 duration + video
```

### P64
```text
You are MEDIA agent. Task: RC-4 — media duration is uncontrolled and misreported, and video does not render.

Evidence from QA:
- Podcast: requested 1–2 minutes, actual 204.384 seconds (3:24), and the UI card displayed 4:20.
  That is THREE different numbers — a generation-length bug AND a display bug.
- Idea video: 2 attempts, no Veo submission and no MP4. Attempt 1 failed on invalid queue ID
  (fixed by INFRA under RC-1); attempt 2 failed during script/JSON processing.

Do this:
1. Length control: map requested duration → target word count (use a measured words-per-minute
   constant for your TTS voice) and enforce it on the SCRIPT before TTS.
2. After render, measure TRUE duration with ffprobe. If outside ±15% of the request, re-cut or
   regenerate once, then fail with a reason.
3. Store the MEASURED duration on the asset record. The UI must display the stored measured value.
   Find and delete any code that estimates duration for display — that is the source of the 4:20.
4. Video: fix the script/JSON processing failure from attempt 2. Log the exact payload that fails,
   validate the JSON contract before submission, and make parse failures explicit rather than silent.
5. Do NOT mark video fixed without an actual playable MP4 artifact with byte size and measured duration.

Set to FIXED_UNVERIFIED. Video verification requires a real render — budget for it (see LEDGER note).
```

### P65
```text
5.6 LEDGER — RC-7 cost accountability
```

### P66
```text
You are LEDGER agent. Task: RC-7 — provider cost accounting is incomplete.

Evidence from QA: $0.517071 recorded across 99 unique ledger events, but TWO calls are unreconciled —
the original article call and the first audio-verification call (model/limits unknown for the latter).
The $6 reserve is an assumption, not confirmed cost coverage.

Do this:
1. Audit every provider call path (text, image, audio/TTS, video). For each, confirm it writes a
   provider_usage_events row with: provider, model, operation, input/output units, cost, status,
   workspace/job reference, timestamp.
2. Find the paths that produced the 2 unreconciled events. Make the model and limits explicit and
   logged. If a historical event's model cannot be determined, mark it explicitly as UNKNOWN rather
   than leaving it blank.
3. CRITICAL: failed jobs must still log incurred provider cost, even when the credit reservation is
   released to the customer. A released reservation with no cost row is a silent margin leak.
4. Add an assertion in tests: no provider call may complete without a corresponding ledger row.
5. Produce a cost-per-feature summary from the ledger so the team knows the real cost of a verification run.

Set to FIXED_UNVERIFIED when the assertion test passes.
```

### P67
```text
5.7 VERIFIER — the pass/fail judge (use a fresh session)
```

### P68
```text
You are VERIFIER agent. You do NOT fix code. You run real tests and record evidence.

Read /QA_REMEDIATION_STATE.md. Take the next item with status FIXED_UNVERIFIED.

For that feature, run it END TO END against REAL providers through the UI or real API — not mocks,
not type checks. Then collect evidence:
- artifact identifier, byte size, and for media the ffprobe-measured duration/dimensions
- proof of persistence across refresh and logout/login (if the feature stores data)
- spec compliance numbers (character counts, aspect ratios, word counts, JSON-LD validity)
- the provider_usage_events row(s): model and cost
- credit behavior: reserved, debited or released, correctly

Then:
- If ALL evidence is present and correct → set VERIFIED_PASS and paste the evidence into the handoff log.
- If ANYTHING is missing or wrong → set back to OPEN, write the exact failure and the numbers observed,
  and name which agent should take it.

You must not mark VERIFIED_PASS based on "typecheck passed" or "the code looks correct."
The audit already proved repairs can pass type checks while real generation still fails.
If a run would exceed the approved spend cap, STOP and write a BLOCKED_HUMAN entry requesting budget.
```

### P69
```text
5.8 The persistence wrapper (append to any worker prompt)
```

### P70
```text
PERSISTENCE RULES — apply to this entire task:
- Do not stop at the first obstacle. Diagnose, attempt a fix, re-run, and repeat up to 5 cycles.
- After each attempt, print: what you changed, the command you ran, and the actual output.
- Never report success without pasting the command output that proves it.
- If you are blocked by a missing credential, an unclear requirement, or a spend limit, write a
  BLOCKED_HUMAN entry in /QA_REMEDIATION_STATE.md with the precise question and stop — do not invent
  a workaround, do not stub the feature, do not disable the test.
- Never delete, skip, or weaken a test to achieve a pass.
- Before finishing, re-read the task's acceptance evidence and confirm each item line by line.
```

### P71
```text

```

### P72
```text
6. Retest protocol
```

### P73
```text
Lock the passes. Write regression tests for the 7 already-passing features first, so remediation cannot silently break them.
```

### P74
```text
Fix by wave (§3), never feature-by-feature.
```

### P75
```text
Verify with a separate agent pass (§5.7) — the fixer never grades itself.
```

### P76
```text
Rerun the 3 blocked features end to end; their defects are already fixed but unproven.
```

### P77
```text
Run the 12 never-run features — expect new failures; they have never been executed.
```

### P78
```text
Budget the verification run. The whole audit cost ~$0.52, but that was without successful video. A real Veo render is materially more expensive than everything else combined — set an explicit cap before Wave 3 and put it in the state file.
```

### P79
```text
Re-audit all 27 in one final clean pass and publish the same table format for comparison.
```

### P80
```text
7. Human decisions needed before starting
```

### P81
```text
Authorize (or formally defer) external publishing and email delivery — otherwise those adapters can never be certified.
```

### P82
```text
Set the verification spend cap, especially for video.
```

### P83
```text
Decide the 6 unsupported features: build, defer, or remove from the product claim. (Note: the marketing site currently implies some of these — that gap matters.)
```

### P84
```text
Confirm the agency-report PDF gap — the route has no PDF capability at all; that is a build, not a fix.
```

## Original tables

### T1 — Scope reality-check table (7 rows × 3 cells)

| Row | Cell 1 | Cell 2 | Cell 3 |
|---|---|---|---|
| T1.R1 | Bucket | Count | Can it reach “pass”? |
| T1.R2 | Passed | 7 | Already there — needs regression lock only |
| T1.R3 | Failed | 5 | Yes — fix + retest |
| T1.R4 | Partial | 7 | Yes — close the specific gap + retest |
| T1.R5 | Blocked | 3 | Yes — defects already fixed; must be rerun end to end |
| T1.R6 | Not run | 12 | Unknown — must actually be executed before any grade exists |
| T1.R7 | Unsupported | 6 | No — these are missing product scope, not bugs |

### T2 — Agent-ownership table (8 rows × 3 cells)

| Row | Cell 1 | Cell 2 | Cell 3 |
|---|---|---|---|
| T2.R1 | Agent | Owns | Must not |
| T2.R2 | LEAD | Reads state, assigns next task, verifies evidence, refuses unproven passes | Write feature code |
| T2.R3 | INFRA | RC-1 job IDs, RC-6 rerun, concurrency, schema | Touch prompts/content logic |
| T2.R4 | QUALITY | RC-3 gates, prompt-residue, claim checks, word counts | Loosen a gate to make a test pass |
| T2.R5 | PLATFORM | RC-2 specs: char limits, aspect ratios, image reuse | Change generation models |
| T2.R6 | MEDIA | RC-4 duration control + measured metadata, video pipeline | Skip real renders |
| T2.R7 | LEDGER | RC-7 complete cost logging, credit reserve/release correctness | Estimate costs |
| T2.R8 | VERIFIER | Runs the real end-to-end tests, collects artifacts, writes evidence | Fix code (must hand back) |

## Ancillary structural OOXML paragraphs

These two paragraphs are in `word/footnotes.xml`, not the document body. They
carry separator elements and no visible text; they are listed so the extraction
does not silently omit any paragraph node. They are not assigned architect
`P` IDs.

| Extraction ID | OOXML location | Source paragraph content |
|---|---|---|
| F0 | `w:footnote[@w:type="continuationSeparator"]` | *(empty visible text; `w:continuationSeparator` marker)* |
| F-1 | `w:footnote[@w:type="separator"]` | *(empty visible text; `w:separator` marker)* |

## Extraction coverage

- Body paragraphs: **84 total** (`P1`–`P84`), including **7 empty positions** and **77 non-empty source paragraphs**.
- Tables: **2** (`T1`, `T2`), **15 rows**, **45 cells**.
- Each table cell contains one source paragraph; its visible paragraph text is
  retained in the corresponding cell, without consuming a body `P` ID. The
  DOCX also contains two OOXML-only footnote separator paragraphs
  (`continuationSeparator`, `separator`) with no visible text and no comments;
  they are structural markers, not architect source paragraphs.
- Architect review coverage: all **77 non-empty paragraph IDs** are mapped by the architect line review; the seven empty IDs remain explicit extraction positions and have no disposition line there.
- No paragraph, table row, or table cell was dropped or reassigned.