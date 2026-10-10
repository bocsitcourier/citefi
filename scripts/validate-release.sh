#!/usr/bin/env bash
# Authoritative release gate. Artifact transport and CI both invoke this exact
# command before a production build can be transferred.
set -euo pipefail

npm run check
node --import tsx tests/public-article-trial.test.ts
node --test tests/deployment/release-lockfile-normalization.test.cjs
node --test tests/deployment/release-build-environment.test.cjs
node --test tests/deployment/production-runtime-config.test.cjs
npm run test:deploy-contract
npm run test:ops
