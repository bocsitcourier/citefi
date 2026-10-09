#!/usr/bin/env bash
# Publish committed changes through a PR; never update the protected base.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node scripts/github-sync.mjs "$@"
