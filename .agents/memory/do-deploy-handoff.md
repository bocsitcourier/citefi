---
name: DigitalOcean release expectations
description: Owner expects agent-run releases from the workspace; verify credential provenance rather than asserting missing access.
---
The owner expects DigitalOcean production releases to be initiated from this
workspace through established SSH access, as previous deployments were. Sending
the owner manual GitHub merge and workflow instructions does not meet that request.

**Why:** The owner repeatedly stated that previous deployments used credentials
in Secrets and that they have never performed the proposed GitHub handoff steps.

**How to apply:** Consult the current deployment runbook and the permissions
actually applicable to the session. Distinguish source submission, host-pin
verification, staging acceptance, and completed production cutover.

Verify secret existence through the approved secrets interface without exposing
values. Distinguish workspace secrets, GitHub-held secrets and secure transient
SSH credentials; absence of a particular local variable is not proof that SSH
access is unavailable. Do not claim a key was removed or moved without evidence,
or infer a secret's actual contents solely from its name.

**Why:** Earlier handoff assertions claimed that the private key was absent and
had moved to GitHub without proving either claim.

**How to apply:** Report precisely which inventory was checked and what remains
unverified. Do not request replacement credentials prematurely, use the unsafe
legacy deployment trigger, bypass protected source review, or inherit an earlier
session's asserted permission limits without checking the current instructions.
