#!/usr/bin/env bash
#
# Run the bounded measured load/failure-injection audit in safe-local mode.
#
# This entrypoint intentionally does not compose PostgreSQL: the receipt/CAS
# measurements use the production in-memory store plus a local filesystem
# spool, and the queue measurements own Redis on 127.0.0.1:16386.  No
# application database, provider, customer data, or external network is
# permitted.  The separate PostgreSQL fixture remains available on port 55486
# for a future DB-specific load scenario without changing this entrypoint.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -n "${DATABASE_URL:-}" || -n "${NEON_DATABASE_URL:-}" ]]; then
  echo "load-local: refusing to run with an application database URL" >&2
  exit 1
fi
if [[ -n "${REDIS_URL:-}" && "${REDIS_URL}" != "redis://127.0.0.1:16386/15" ]]; then
  echo "load-local: refusing to run against a non-owned Redis URL" >&2
  exit 1
fi
command -v redis-server >/dev/null 2>&1 ||
  { echo "load-local: redis-server is required; refusing installation/network fallback" >&2; exit 1; }

unset \
  DATABASE_URL NEON_DATABASE_URL REDIS_URL \
  OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_GENERATIVE_AI_API_KEY \
  BRAVE_API_KEY BRAVE_SEARCH_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
  RESEND_API_KEY SENDGRID_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD \
  SMTP_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN \
  AWS_PROFILE AWS_DEFAULT_PROFILE GOOGLE_APPLICATION_CREDENTIALS

export QA_LOAD_SAFE_LOCAL=true
export QA_LOAD_NO_DATABASE=true
export QA_TEST_ALLOWED_PORTS=16386
export NODE_ENV=test
export CITEFI_DISABLE_PROVIDERS=true
export CITEFI_DISABLE_EMAIL=true
export CITEFI_DISABLE_PUBLISHING=true
export WORKER_PROCESS=true

exec node \
  --import "$ROOT/QA/support/qa-fixtures.mjs" \
  --import "$ROOT/QA/support/offline-guard.mjs" \
  --import tsx/esm \
  --test-concurrency=1 \
  --test-force-exit \
  --test \
  tests/qa/load-receipt-cas.test.ts \
  tests/qa/load-queue-processor.test.ts