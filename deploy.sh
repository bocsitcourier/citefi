#!/usr/bin/env bash
# Deprecated compatibility entrypoint. Production releases are immutable and
# must use the validated artifact transport; this file intentionally performs
# no checkout mutation, dependency installation, build, or broad PM2 action.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "NOTICE: deploy.sh delegates to the immutable artifact release transport." >&2
exec "$ROOT/scripts/deploy-to-do.sh" "$@"