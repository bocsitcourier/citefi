#!/usr/bin/env bash
# Authoritative release gate. Artifact transport and CI both invoke this exact
# command before a production build can be transferred.
set -euo pipefail

npm run check
npm run test:deploy-contract
npm run test:ops
