#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/ssh-session.sh"
"${SSH[@]}" 'node /var/www/citefi/ops-recovery/backup-metadata.mjs' > "$RECOVERY_TMP/metadata.json"
key="$(python3 - "$RECOVERY_TMP/metadata.json" <<'PY'
import json,re,sys
value=json.load(open(sys.argv[1]))
assert re.fullmatch(r'db-backups/citefi_[0-9]{8}_[0-9]{6}\.sql\.gz',value["backupObject"])
assert re.fullmatch(r'[0-9a-f]{64}',value["sha256"])
print(value["backupObject"])
PY
)"
"${SSH[@]}" "node --env-file=/var/www/citefi/.env.local /var/www/citefi/ops-recovery/spaces-cli.mjs s3 cp \"s3://\$(node --env-file=/var/www/citefi/.env.local -p 'process.env.DO_SPACES_BUCKET')/$key\" -" > "$RECOVERY_TMP/restore.sql.gz"
python3 - "$RECOVERY_TMP" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]); meta=json.loads((root/"metadata.json").read_text())
digest=hashlib.sha256()
with (root/"restore.sql.gz").open("rb") as f:
    while chunk:=f.read(1024*1024): digest.update(chunk)
assert digest.hexdigest()==meta["sha256"],"Cloud backup checksum mismatch"
assert (root/"restore.sql.gz").stat().st_size==meta["bytes"],"Cloud backup size mismatch"
PY
python3 "$RECOVERY_ROOT/scripts/recovery/restore-check.py" "$RECOVERY_TMP/restore.sql.gz" "$RECOVERY_TMP/evidence.json"
python3 - "$RECOVERY_TMP" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); result=json.loads((root/"evidence.json").read_text())
result.update(json.loads((root/"metadata.json").read_text()))
(root/"evidence.json").write_text(json.dumps(result))
PY
# Only the success evidence from the real isolated round trip returns to host.
"${SSH[@]}" 'python3 -c '"'"'import json,os,sys; from pathlib import Path; value=json.load(sys.stdin); assert value["state"]=="success" and value["tenantIsolationVerified"] and value["schemaVerified"] and value["rolesVerified"] and value["rlsVerified"]; root=Path("/var/www/citefi/ops-recovery/backups"); tmp=root/"restore-verification-status.json.tmp"; tmp.write_text(json.dumps(value)); os.chmod(tmp,0o644); os.replace(tmp,root/"restore-verification-status.json")'"'"'' < "$RECOVERY_TMP/evidence.json"
