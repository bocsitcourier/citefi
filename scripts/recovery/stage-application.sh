#!/usr/bin/env bash
# Only a validated prebuilt artifact is transferred; no host builds/cutover.
set -euo pipefail
source "$(dirname "$0")/ssh-session.sh"
sha="$(git -C "$RECOVERY_ROOT" rev-parse HEAD)"
artifact="${RUNNER_TEMP:?}/citefi-release.tgz"
test -s "$RECOVERY_ROOT/.next/BUILD_ID"
printf '%s\n' "$sha" > "$RECOVERY_ROOT/.release-sha"
tar -C "$RECOVERY_ROOT" --exclude=.git --exclude='.env*' --exclude='*.log' -czf "$artifact" .
digest="$(sha256sum "$artifact" | awk '{print $1}')"
bytes="$(stat -c '%s' "$artifact")"
id="${sha}-${digest:0:16}"
"${SSH[@]}" "set -eu; test \"\$(id -un)\" = citefi; test \"\$(stat -c %U /var/www/citefi)\" = citefi; umask 077; mkdir -p /var/www/citefi/.deploy/incoming /var/www/citefi/releases; cat > /var/www/citefi/.deploy/incoming/${id}.tgz" < "$artifact"
"${SSH[@]}" "env HOST_RELEASE_SOURCE_ONLY=1 DO_ARTIFACT_PATH=/var/www/citefi/.deploy/incoming/${id}.tgz DO_ARTIFACT_SHA256=$digest DO_ARTIFACT_SIZE=$bytes DO_RELEASE_SHA=$sha bash -s" <<'SH'
set -euo pipefail
cd /var/www/citefi
test "$(stat -c %U .deploy)" = citefi
exec 9>.deploy/release.lock
flock -n 9
# The runner has uploaded the exact checked-out script as part of its artifact.
python3 - "$DO_ARTIFACT_PATH" <<'PY'
import sys,tarfile
with tarfile.open(sys.argv[1]) as tar:
    member=tar.getmember("./scripts/host-release.sh")
    assert member.isfile() and member.size<100000
    data=tar.extractfile(member).read()
with open("/var/www/citefi/.deploy/incoming/stage-host-release.sh","wb") as f:f.write(data)
PY
source .deploy/incoming/stage-host-release.sh
prepare_candidate
cd "$CANDIDATE_RELEASE"
node --env-file=.env.local --import tsx/esm scripts/recovery/schema-diff.ts
printf 'Staged candidate: %s\n' "$CANDIDATE_RELEASE"
SH
