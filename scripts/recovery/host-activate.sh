#!/usr/bin/env bash
# Approved first immutable cutover from an unchanged, degraded legacy layout.
set -Eeuo pipefail
umask 077
root=/var/www/citefi
[[ "${CANDIDATE_ID:-}" =~ ^[a-f0-9]{40}-[a-f0-9]{16}$ ]]
test "$(id -un)" = citefi
test "$(stat -c %U "$root")" = citefi
export HOST_RELEASE_SOURCE_ONLY=1
source "$root/.deploy/recovery-tools/scripts/host-release.sh"
acquire_release_lock
CANDIDATE_RELEASE="$root/releases/$CANDIDATE_ID"
plan="$root/.deploy/recovery-plans/$CANDIDATE_ID"
NEW_SHA="${CANDIDATE_ID%-*}"
test "$(cat "$CANDIDATE_RELEASE/.release-sha")" = "$NEW_SHA"
test -s "$CANDIDATE_RELEASE/.next/BUILD_ID"
test -r "$root/ops-recovery/recovery.env"
# Stop if a different operator has already migrated the legacy layout.
test ! -e "$DO_CURRENT_LINK"
test ! -L "$DO_CURRENT_LINK"
digest="$(sha256sum "$plan/additions-protected.sql" | awk '{print $1}')"
EXPECTED_PLAN_HASH="$digest" node - "$plan/isolated-verification.json" <<'JS'
const fs=require("fs"), evidence=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(evidence.isolatedAdditionsVerified!==true || evidence.planSha256!==process.env.EXPECTED_PLAN_HASH) process.exit(1);
JS
cd "$CANDIDATE_RELEASE"
node --env-file=.env.local --import tsx/esm scripts/recovery/schema-diff.ts > "$plan/current-schema.json"
cmp "$plan/schema.json" "$plan/current-schema.json"
# Private process descriptors never leave the host; original code stays intact.
pm2 jlist | ROLLBACK_FILE="$plan/legacy-pm2.json" node -e '
let source="";process.stdin.on("data",s=>source+=s);process.stdin.on("end",()=>{
 const names=["citefi-web","citefi-worker"], items=JSON.parse(source);
 const apps=names.map(name=>{
  const e=items.find(p=>p.name===name)?.pm2_env;
  if(!e || e.pm_cwd!=="/var/www/citefi" || e.status!=="online") throw new Error("Legacy process context changed");
  return {name,script:e.pm_exec_path,args:e.args,cwd:e.pm_cwd,interpreter:e.exec_interpreter,
   interpreter_args:e.node_args,env:e.env,instances:1,exec_mode:"fork",autorestart:true,
   out_file:e.pm_out_log_path,error_file:e.pm_err_log_path,kill_timeout:10000,restart_delay:10000};
 });
 require("fs").writeFileSync(process.env.ROLLBACK_FILE,JSON.stringify({apps}),{mode:384,flag:"wx"});
});'
node --env-file="$root/.env.local" "$root/.deploy/recovery-tools/scripts/recovery/apply-additions.mjs" "$plan/additions-protected.sql" "$digest"
export DO_CURRENT_DIR="$DO_CURRENT_LINK"
CANDIDATE_RELEASE="$CANDIDATE_RELEASE" RECOVERY_CONFIG="$plan/ecosystem-recovery.json" node <<'JS'
const fs=require("fs"), path=require("path"), candidate=process.env.CANDIDATE_RELEASE;
const config=require(path.join(candidate,"ecosystem.config.cjs"));
if(config.apps.length!==2 || config.apps.some(a=>!["citefi-web","citefi-worker"].includes(a.name))) process.exit(1);
for(const app of config.apps) {
 if(app.cwd!=="/var/www/citefi/current" || app.script!=="scripts/process-bootstrap.ts") process.exit(1);
 app.interpreter_args += " --env-file=/var/www/citefi/ops-recovery/recovery.env";
}
fs.writeFileSync(process.env.RECOVERY_CONFIG,JSON.stringify(config),{mode:384,flag:"wx"});
JS
OLD_SHA="$(git -C "$root" rev-parse HEAD)"
PHASE=cutover
export PHASE
write_status deploying "Approved additive recovery; unchanged legacy tree retained for rollback"
cutover=false
rollback_legacy() {
 local result=$?
 trap - ERR
 if [[ "$cutover" == true ]]; then
  pm2 delete citefi-web >/dev/null 2>&1 || true
  pm2 delete citefi-worker >/dev/null 2>&1 || true
  if [[ -L "$DO_CURRENT_LINK" && "$(readlink -f "$DO_CURRENT_LINK")" == "$CANDIDATE_RELEASE" ]]; then
   unlink "$DO_CURRENT_LINK"
  fi
  pm2 start "$plan/legacy-pm2.json" --only citefi-web >/dev/null 2>&1 || true
  pm2 start "$plan/legacy-pm2.json" --only citefi-worker >/dev/null 2>&1 || true
 fi
 ACTIVE_RELEASE="$root"
 write_status recovery_failed "Legacy degraded processes restored; additive schema and all backup/release files retained"
 echo "Recovery failed; original legacy application restored. No backup or release deleted." >&2
 exit "$result"
}
trap rollback_legacy ERR
switch_current "$CANDIDATE_RELEASE"
cutover=true
for name in citefi-web citefi-worker; do
 pm2 delete "$name" >/dev/null
 pm2 start "$plan/ecosystem-recovery.json" --only "$name" --update-env >/dev/null
done
web_before="$(restart_count citefi-web)"
worker_before="$(restart_count citefi-worker)"
health_check "$web_before" "$worker_before"
DO_PUBLIC_HEALTHCHECK_URL=https://citefi.co/api/health
public_listener_check
pm2 save >/dev/null
ACTIVE_RELEASE="$CANDIDATE_RELEASE"
KNOWN_GOOD_SHA="$NEW_SHA"
KNOWN_GOOD_RELEASE="$CANDIDATE_RELEASE"
PHASE=complete
write_status success "Public and local full health passed; legacy rollback tree and backups retained"
trap - ERR
echo "Approved recovery activated; public health HTTP 200."
