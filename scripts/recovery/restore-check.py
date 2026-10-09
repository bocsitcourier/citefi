"""Restore only on a disposable GitHub runner. Never print SQL/customer data."""
import datetime
import gzip
import json
import os
import subprocess
import sys
from pathlib import Path

DATABASE = "citefi_restore_verify"
ENV = {**os.environ, "PGHOST": "/var/run/postgresql", "PGPORT": "5432",
       "PGDATABASE": DATABASE, "PGUSER": os.environ.get("USER", "runner")}
ENV.pop("PGPASSWORD", None)
ENV.pop("PGSERVICE", None)


def query(sql):
    result = subprocess.run(
        ["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env=ENV, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError("Isolated verification query failed")
    return result.stdout.strip().splitlines()[-1]


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Disposable GitHub runner required")
    if query("SELECT current_database()='citefi_restore_verify' AND inet_server_addr() IS NULL") != "t":
        raise RuntimeError("Isolated local-socket target required")
    if query("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')") != "0":
        raise RuntimeError("Restore target must be empty")
    dump = Path(sys.argv[1])
    # ON_ERROR_STOP plus private stderr prevents a failing SQL statement from
    # leaking credentials/customer row data into public Actions logs.
    with open(dump.parent / "restore-private.log", "wb") as errors:
        process = subprocess.Popen(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1"],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, env=ENV)
        try:
            with gzip.open(dump, "rb") as source:
                while chunk := source.read(1024 * 1024):
                    process.stdin.write(chunk)
            process.stdin.close()
            if process.wait(timeout=600):
                raise RuntimeError("Backup restore failed")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    checks = {
        "tenantRoleSafe": """SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='citefi_tenant'
          AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin
          AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)""",
        "tenantRoleMembership": "SELECT pg_has_role(current_user,'citefi_tenant','MEMBER')",
        "tableGrantsVerified": """SELECT bool_and(has_table_privilege('citefi_tenant','public.'||name,'SELECT'))
          FROM (VALUES('teams'),('team_members'),('articles')) AS required(name)""",
        "schemaGrantsVerified": """SELECT has_schema_privilege('citefi_tenant','public','USAGE')
          AND has_schema_privilege('citefi_tenant','citefi_rls','USAGE')""",
        "sequenceGrantsVerified": """SELECT bool_and(has_sequence_privilege('citefi_tenant',c.oid,'USAGE,SELECT'))
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='S'""",
        "helperGrantsVerified": """SELECT bool_and(has_function_privilege('citefi_tenant',p.oid,'EXECUTE'))
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='citefi_rls'""",
        "unscopedRowsDenied": """BEGIN; SET LOCAL ROLE citefi_tenant;
          SELECT count(*)=0 FROM teams; ROLLBACK;""",
    }
    for name, sql in checks.items():
        if query(sql) != "t":
            raise RuntimeError(f"Restore verification failed: {name}")
    counts = {
        "schemaTableCount": "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
        "userRowCount": "SELECT count(*) FROM users",
        "rlsTableCount": """SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relrowsecurity""",
        "tenantPolicyCount": "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND 'citefi_tenant'=ANY(roles)",
    }
    actual = {name: int(query(sql)) for name, sql in counts.items()}
    if not all(actual[name] > 0 for name in counts):
        raise RuntimeError("Restored schema/security evidence is empty")
    member = query("""SELECT m.team_id::text||','||m.user_id::text FROM team_members m JOIN teams t ON t.id=m.team_id
      WHERE m.role IN ('owner','admin','member') AND t.deleted_at IS NULL AND t.client_status='active'
      ORDER BY m.id LIMIT 1""")
    if not member or not all(part.isdigit() for part in member.split(",")):
        raise RuntimeError("No restored membership for tenant isolation verification")
    team, user = map(int, member.split(","))
    scoped = f"""BEGIN; SET LOCAL ROLE citefi_tenant;
      SELECT set_config('citefi.actor_type','web',true),set_config('citefi.team_id','{team}',true),
        set_config('citefi.user_id','{user}',true),set_config('citefi.member_role','admin',true);
      SELECT (SELECT count(*) FROM teams WHERE id={team})=1
        AND (SELECT count(*) FROM teams WHERE name='Citefi System Canary Accounting')=0
        AND (SELECT count(*) FROM articles WHERE team_id<>{team})=0;
      ROLLBACK;"""
    if query(scoped) != "t":
        raise RuntimeError("Restored tenant isolation failed")
    evidence = {
        "state": "success", "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "targetDatabase": DATABASE, "schemaVerified": True, "rolesVerified": True,
        "rlsVerified": True, "tenantIsolationVerified": True,
        **{name: True for name in checks}, **actual,
    }
    Path(sys.argv[2]).write_text(json.dumps(evidence))
    print(json.dumps(evidence))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Isolated backup restore/security verification failed; no success evidence published.", file=sys.stderr)
        sys.exit(1)
