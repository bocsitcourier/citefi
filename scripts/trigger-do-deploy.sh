#!/usr/bin/env bash
# Trigger a DigitalOcean deploy via GitHub Actions workflow_dispatch.
# No SSH keys or DO_HOST needed — uses the same GitHub token as push-to-github.sh.
#
# First pushes any un-pushed local commits, then fires the deploy workflow.
set -euo pipefail

: "${GITHUB_PERSONAL_ACCESS_TOKEN:?GITHUB_PERSONAL_ACCESS_TOKEN secret is missing}"

OWNER="${GITHUB_OWNER:-bocsitcourier}"
REPO="${GITHUB_REPO:-citefi}"
BRANCH="${GITHUB_BRANCH:-main}"
WORKFLOW="${GITHUB_DEPLOY_WORKFLOW:-deploy.yml}"
API="https://api.github.com/repos/${OWNER}/${REPO}"

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

# ── Step 1: Push any new commits to GitHub ────────────────────────────────────
cd "$(git rev-parse --show-toplevel)"
LOCAL_SHA="$(git rev-parse HEAD)"
LOCAL_SHORT="$(git rev-parse --short HEAD)"
LOCAL_MSG="$(git log -1 --pretty=%s)"

echo "Deploying ${OWNER}/${REPO}:${BRANCH} to DigitalOcean"
echo "  Local HEAD : ${LOCAL_SHORT} — ${LOCAL_MSG}"

call_api GET "/git/ref/heads/${BRANCH}"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error reading remote ref (HTTP ${HTTP_CODE})"; echo "$HTTP_BODY"; exit 1
fi
REMOTE_SHA="$(printf '%s' "$HTTP_BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["object"]["sha"])')"
echo "  Remote HEAD: ${REMOTE_SHA:0:7}"

if [[ "$REMOTE_SHA" != "$LOCAL_SHA" ]]; then
  echo "  Pushing new commits..."
  PAYLOAD="{\"sha\":\"${LOCAL_SHA}\",\"force\":true}"
  call_api PATCH "/git/refs/heads/${BRANCH}" "$PAYLOAD"

  if [[ "$HTTP_CODE" == "422" ]]; then
    TMP_BRANCH="replit-sync-$(date +%s)"
    PUSH_URL="https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/${OWNER}/${REPO}.git"
    git push "${PUSH_URL}" "${LOCAL_SHA}:refs/heads/${TMP_BRANCH}"
    call_api PATCH "/git/refs/heads/${BRANCH}" "$PAYLOAD"
    curl -sS -X DELETE "${API}/git/refs/heads/${TMP_BRANCH}" "${auth_hdr[@]}" >/dev/null || true
  fi

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "Failed to push (HTTP ${HTTP_CODE}):"; echo "$HTTP_BODY"; exit 1
  fi
  echo "  Pushed ${LOCAL_SHORT} to GitHub."
else
  echo "  GitHub already has ${LOCAL_SHORT} — skipping push."
fi

# ── Step 2: Trigger the GitHub Actions deploy workflow ────────────────────────
echo ""
echo "Triggering GitHub Actions deploy workflow..."
DISPATCH_PAYLOAD="{\"ref\":\"${BRANCH}\"}"
call_api POST "/actions/workflows/${WORKFLOW}/dispatches" "$DISPATCH_PAYLOAD"

if [[ "$HTTP_CODE" == "204" ]]; then
  echo "  Deploy triggered."
else
  echo "  Failed to trigger workflow (HTTP ${HTTP_CODE}):"; echo "$HTTP_BODY"; exit 1
fi

# ── Step 3: Wait for the run to appear and show its URL ───────────────────────
echo ""
echo "Waiting for the run to appear..."
sleep 4
call_api GET "/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&per_page=1"
if [[ "$HTTP_CODE" == "200" ]]; then
  RUN_URL="$(printf '%s' "$HTTP_BODY" | python3 -c 'import sys,json; runs=json.load(sys.stdin)["workflow_runs"]; print(runs[0]["html_url"] if runs else "n/a")')"
  echo "  Run: ${RUN_URL}"
fi

echo ""
echo "Done — GitHub Actions is building and deploying to your DigitalOcean droplet."
echo "Watch progress: https://github.com/${OWNER}/${REPO}/actions"
