---
name: Critical security and reliability fixes
description: P0/P1 bugs found by architect review — privilege escalation, status corruption, cross-tenant leaks
---

## Rule: Invite acceptance must hardcode users.role = 'team_member'

**Why:** invite.role carries team-level intent ('admin'|'member'), not platform-level intent.
Setting users.role = invite.role lets a team-admin invite mint a platform admin.

**How to apply:** Any future invite-accept route must always set `role: 'team_member'`
for the users row. Only teamMembers.role gets the elevated team privilege.

---

## Rule: Worker outer catch must preserve all checkpoint statuses, not just GEMINI_COMPLETE

**Why:** COMPLETE/GPT4_ENHANCED/CHATGPT_REVIEWED articles that hit a post-success error
(e.g., billing debit failure) would be overwritten to FAILED, losing completed work.

**How to apply:** `PRESERVED_CHECKPOINTS = ["COMPLETE","GPT4_ENHANCED","GEMINI_COMPLETE","CHATGPT_REVIEWED"]`
Only mark FAILED when status is not in that list.

---

## Rule: Never call releaseReservation on DEBIT_FAILED errors

**Why:** DEBIT_FAILED means the article generated successfully but billing failed.
Releasing the reservation refunds credits for completed work. pg-boss will retry
the debit automatically — the reservation must stay until debit succeeds.

**How to apply:** `const isDebitFailure = errorMessage.includes("DEBIT_FAILED");`
Guard the release call with `&& !isDebitFailure`.

---

## Rule: updatePatternWithEMA must scope WHERE to (id AND teamId)

**Why:** patternsUsedJson can theoretically contain pattern IDs from any team.
Without a team boundary, one team's metric can mutate another team's patterns.

**How to apply:** Always pass teamId explicitly. Both SELECT and UPDATE must have
`and(eq(learningPatterns.id, patternId), eq(learningPatterns.teamId, teamId))`.
Guard call site: if !metricTeamId return early before iterating patterns.

---

## Rule: Social worker outer catch must use teamId-scoped WHERE

**Why:** id-only WHERE on socialPosts.update in the catch path bypasses tenant isolation.
**How to apply:** Use the same `(id AND teamId)` pattern as the success path.

---

## Rule: Bayesian selectArm must re-sample when existing non-holdout armId is null

**Why:** Arm deletion sets FK to null via CASCADE SET NULL. Returning armId=null as a
treatment causes downstream null-content crashes.
**How to apply:** `if (!existing.isHoldout && existing.armId === null)` → fall through
to fresh Thompson Sampling rather than returning the cached null assignment.
