#!/usr/bin/env bash
# Push current main branch to GitHub.
# Run from Replit Shell or via the "Push to GitHub" workflow button.
#
# Requires GITHUB_PERSONAL_ACCESS_TOKEN to be set as a Replit Secret.
# The token is only used in memory — it is never written to .git/config.
set -euo pipefail

: "${GITHUB_PERSONAL_ACCESS_TOKEN:?GITHUB_PERSONAL_ACCESS_TOKEN secret is missing — add it in Replit Secrets}"

REPO="https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/bocsitcourier/citefi.git"

cd "$(git rev-parse --show-toplevel)"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git log -1 --pretty=format:"%h %s")

echo "Pushing branch '${BRANCH}' to GitHub..."
echo "  Latest commit: ${COMMIT}"
echo ""

git push "${REPO}" "${BRANCH}"

echo ""
echo "Done. GitHub will now trigger the deploy workflow automatically."
echo "  Monitor at: https://github.com/bocsitcourier/citefi/actions"
