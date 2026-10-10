#!/usr/bin/env bash
# No application environment, credential files, or network-backed installs.
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
TEMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/citefi-offline.XXXXXX")"
trap 'rm -rf -- "$TEMP_HOME"' EXIT
SAFE_ENV=(env -i "PATH=$PATH" "HOME=$TEMP_HOME" WORKER_PROCESS=true NODE_ENV=test
  "NODE_OPTIONS=--import=$ROOT/QA/support/qa-fixtures.mjs --import=$ROOT/QA/support/offline-guard.mjs")
case "${1:-}" in
  --deploy-contract)
    [[ $# == 1 ]] || { echo "deploy contract accepts no extra arguments" >&2; exit 2; }
    # This shell suite constructs its own synthetic staging URLs and validates
    # them in Node children. Do not overwrite those assertion inputs.
    "${SAFE_ENV[@]}" "NODE_OPTIONS=--import=$ROOT/QA/support/offline-guard.mjs" bash tests/deployment/deploy-contract.test.sh
    ;;
  --canary)
    [[ $# == 1 ]] || { echo "canary accepts no extra arguments" >&2; exit 2; }
    "${SAFE_ENV[@]}" QA_TEST_ALLOWED_PORTS=16379 node --import tsx/esm tests/pipeline/canary-worker.test.ts
    ;;
  --)
    shift
    [[ $# -gt 0 ]] || { echo "provide explicit offline test files after --" >&2; exit 2; }
    for file in "$@"; do
      [[ "$file" == tests/* && "$file" != *".."* && -f "$file" ]] ||
        { echo "expected a checked-in test file, not a Node option: $file" >&2; exit 2; }
    done
    "${SAFE_ENV[@]}" node --import tsx/esm --test-concurrency=1 --test "$@"
    ;;
  *)
    echo "Usage: bash QA/support/run-offline.sh -- tests/... | --canary | --deploy-contract" >&2
    exit 2
    ;;
esac