#!/usr/bin/env bash
# Push local main branch to GitHub.
#
# Strategy: GitHub REST API first (force-moves the ref pointer without needing
# git pull/merge/rebase), with a fallback object-upload step when the local
# commit SHA is not yet known to GitHub.
#
# Requires: GITHUB_PERSONAL_ACCESS_TOKEN secret in Replit.
set -euo pipefail

: "${GITHUB_PERSONAL_ACCESS_TOKEN:?GITHUB_PERSONAL_ACCESS_TOKEN secret is missing — add it in Replit Secrets}"

OWNER="${GITHUB_OWNER:-bocsitcourier}"
REPO="${GITHUB_REPO:-citefi}"
BRANCH="${GITHUB_BRANCH:-main}"
API="https://api.github.com/repos/${OWNER}/${REPO}"

cd "$(git rev-parse --show-toplevel)"
LOCAL_SHA="$(git rev-parse HEAD)"
LOCAL_SHORT="$(git rev-parse --short HEAD)"
LOCAL_MSG="$(git log -1 --pretty=%s)"

auth_hdr=(
  -H "Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}"
  -H "Accept: application/vnd.github+json"
  -H "X-GitHub-Api-Version: 2022-11-28"
)

call_api() {
  local method="$1" url="$2" data="${3:-}"
  local raw
  if [[ -n "$data" ]]; then
    raw="$(curl -sS -X "$method" "${API}${url}" "${auth_hdr[@]}" -d "$data" -w $'\n%{http_code}')"
  else
    raw="$(curl -sS -X "$method" "${API}${url}" "${auth_hdr[@]}" -w $'\n%{http_code}')"
  fi
  HTTP_CODE="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

echo "Pushing ${OWNER}/${REPO}:${BRANCH}"
echo "  Local HEAD : ${LOCAL_SHORT} — ${LOCAL_MSG}"
echo ""

# Step 1: Read the current remote ref
call_api GET "/git/ref/heads/${BRANCH}"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error reading remote ref (HTTP ${HTTP_CODE}):"
  echo "$HTTP_BODY"
  exit 1
fi
REMOTE_SHA="$(printf '%s' "$HTTP_BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["object"]["sha"])')"
echo "  Remote HEAD: ${REMOTE_SHA:0:7}"
echo ""

# Step 2: No-op if already in sync
if [[ "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
  echo "Already up to date — nothing to push."
  exit 0
fi

# Step 3: Try force-moving the ref via API
PAYLOAD="{\"sha\":\"${LOCAL_SHA}\",\"force\":true}"
call_api PATCH "/git/refs/heads/${BRANCH}" "$PAYLOAD"

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "Done. ${BRANCH} updated to ${LOCAL_SHORT}."
  echo ""
  echo "  https://github.com/${OWNER}/${REPO}/actions"
  exit 0
fi

# Step 4: If GitHub doesn't know the commit yet (422), upload objects first
if [[ "$HTTP_CODE" == "422" ]]; then
  echo "GitHub doesn't have the commit yet — uploading objects via temp branch..."
  TMP_BRANCH="replit-sync-$(date +%s)"
  PUSH_URL="https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/${OWNER}/${REPO}.git"
  git push "${PUSH_URL}" "${LOCAL_SHA}:refs/heads/${TMP_BRANCH}"
  echo "  Objects uploaded via ${TMP_BRANCH}, moving ref..."

  call_api PATCH "/git/refs/heads/${BRANCH}" "$PAYLOAD"

  # Delete the temp branch regardless of outcome
  curl -sS -X DELETE "${API}/git/refs/heads/${TMP_BRANCH}" "${auth_hdr[@]}" > /dev/null || true

  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "Done. ${BRANCH} updated to ${LOCAL_SHORT}."
    echo ""
    echo "  https://github.com/${OWNER}/${REPO}/actions"
    exit 0
  fi
fi

echo "Failed to update ref (HTTP ${HTTP_CODE}):"
echo "$HTTP_BODY"
exit 1
