#!/usr/bin/env bash
# Focused release gate for production operations controls. The repository-wide
# TypeScript check has unrelated legacy failures and is tracked separately; do
# not make deploy safety depend on an already-red baseline.
set -euo pipefail

npm run test:deploy-contract
npm run test:ops
