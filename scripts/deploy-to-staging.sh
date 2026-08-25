#!/usr/bin/env bash
# Isolated staging transport. The host runner independently verifies .env.local.
set -euo pipefail
: "${STAGING_DATABASE_NAME:?set the dedicated staging database name}"
: "${STAGING_REDIS_DB:?set the dedicated non-production Redis DB number}"
: "${STAGING_STORAGE_PREFIX:?set the dedicated staging object-storage prefix}"
: "${SYNTHETIC_DATA_ACKNOWLEDGEMENT:?explicit synthetic-data acknowledgement required}"

export DEPLOY_ENVIRONMENT=staging
export DO_APP_DIR="${DO_APP_DIR:-/var/www/citefi-staging}"
export DO_BRANCH="${DO_BRANCH:-staging}"
export DO_PM2_CONFIG="${DO_PM2_CONFIG:-ecosystem.staging.config.cjs}"
export DO_HEALTHCHECK_URL="${DO_HEALTHCHECK_URL:-http://127.0.0.1:5100/api/health?full=1}"
export DO_WEB_PROCESS="${DO_WEB_PROCESS:-citefi-staging-web}"
export DO_WORKER_PROCESS="${DO_WORKER_PROCESS:-citefi-staging-worker}"
export DO_RELEASE_STATE_DIR="${DO_RELEASE_STATE_DIR:-$DO_APP_DIR/.deploy}"
exec "$(dirname "$0")/deploy-to-do.sh"