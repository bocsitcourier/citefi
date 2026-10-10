---
name: Media QA live ledger and locks
description: How the retained USD30 QA ledger, parent budget.lock, child locks, and owner authorization files interact for paid media runs.
---
Rule: the historical video run's `budget.lock` and $6.30 hold are retained on purpose. Later paid runs use child locks (`image-child.lock`, `video-recovery.lock`) gated by an owner authorization file and explicit permission JSONs whose hashes bind the manifest, ledger and termination proof; the parent lock bytes are never touched.
**Why:** a stale PID is not proof of shutdown; the owner accepted a hashed, fresh "current absence" check as a labelled substitute for the lost shutdown log.
**How to apply:** offline budget tests replay the retained admission-time ledger snapshot (hash pinned in the source inventory), never the moving live ledger. Clean up fixture leftovers under /tmp (veo-output, veo-clips) before a current-absence check, or it fails closed. Run order matters: pilot admission needs the ledger unchanged, so run the video pilot before an image run.
