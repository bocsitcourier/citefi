---
name: Workspace configuration merges
description: Invalid merged Replit configuration can temporarily remove Nix toolchain commands.
---

Resolve conflict markers in `.replit` through the validated configuration replacement before attempting package or runtime installation.

**Why:** A source merge left invalid TOML and temporarily removed Node, npm and ripgrep from shell command resolution. Restoring valid configuration immediately restored the existing tools; no reinstall was needed.

**How to apply:** If these commands disappear directly after a merge, inspect the configuration first. Preserve workflow settings and private service mappings, use the required validated replacement, then check command availability again.
