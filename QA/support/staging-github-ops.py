"""Drive this task's reviewed staging workflow without exposing GitHub secrets."""
import argparse
import base64
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
import zipfile
import hashlib

BASE = "https://api.github.com/repos/" + os.environ.get("GITHUB_OWNER", "bocsitcourier") + "/" + os.environ.get("GITHUB_REPO", "citefi")
HEADERS = {
    "Authorization": "Bearer " + os.environ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
}
SERVER_FILES = [
    ".github/workflows/staging-publishing-server.yml",
    "scripts/staging-publishing-server.sh",
    "scripts/staging-publishing-server.cjs",
    "tests/deployment/staging-publishing-server.test.cjs",
]


def api(method, endpoint, body=None):
    request = urllib.request.Request(
        BASE + endpoint, headers=HEADERS, method=method,
        data=None if body is None else json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as error:
        raise SystemExit(f"GitHub {method} {endpoint}: HTTP {error.code}; no bypass attempted")


def publish(title, extra_files):
    parent = api("GET", "/git/ref/heads/main")["object"]["sha"]
    commit = api("GET", "/git/commits/" + parent)
    entries = []
    for filename in SERVER_FILES + extra_files:
        if not re.fullmatch(r"[A-Za-z0-9_./-]+", filename) or ".." in filename.split("/"):
            raise SystemExit("Invalid publication path")
        with open(filename, "rb") as source:
            content = base64.b64encode(source.read()).decode()
        blob = api("POST", "/git/blobs", {"content": content, "encoding": "base64"})
        entries.append({"path": filename, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    tree = api("POST", "/git/trees", {"base_tree": commit["tree"]["sha"], "tree": entries})
    new = api("POST", "/git/commits", {"message": title, "tree": tree["sha"], "parents": [parent]})
    sha = new["sha"]
    branch = "ops/staging-server-" + sha[:12]
    api("POST", "/git/refs", {"ref": "refs/heads/" + branch, "sha": sha})
    pr = api("POST", "/pulls", {
        "title": title, "head": branch, "base": "main",
        "body": "User-authorized isolated staging server work. Only explicitly listed staging workflow/scripts are included. Uses existing SSH credentials and pinned host verification, defaults to read-only inspection, and leaves production application/data/credentials unchanged. Required safety checks must pass; no bypass is attempted.",
    })
    print("PR:", pr["html_url"], flush=True)
    for attempt in range(20):
        checks = api("GET", "/commits/" + sha + "/check-runs?filter=latest")["check_runs"]
        required = [check for check in checks if check["name"] == "Offline deployment safety" and check["app"]["id"] == 15368]
        if required and all(check["status"] == "completed" and check["conclusion"] == "success" for check in required):
            break
        if any(check["status"] == "completed" and check["conclusion"] != "success" for check in required):
            raise SystemExit("Required safety check failed; not merging")
        if attempt == 19:
            raise SystemExit("Required check still pending; not merging")
        time.sleep(5)
    current = api("GET", "/pulls/" + str(pr["number"]))
    if current["head"]["sha"] != sha or current["mergeable_state"] != "clean" or current["base"]["sha"] != api("GET", "/git/ref/heads/main")["object"]["sha"]:
        raise SystemExit("PR blocked or base changed; no bypass attempted")
    result = api("PUT", "/pulls/" + str(pr["number"]) + "/merge", {"sha": sha, "merge_method": "squash"})
    if not result.get("merged"):
        raise SystemExit("PR was not merged")
    print("Merged:", pr["html_url"], flush=True)


def run(operation):
    workflow = api("GET", "/actions/workflows/staging-publishing-server.yml")
    prior = api("GET", "/actions/workflows/" + str(workflow["id"]) + "/runs?event=workflow_dispatch&per_page=1")["workflow_runs"]
    prior_id = prior[0]["id"] if prior else None
    api("POST", "/actions/workflows/" + str(workflow["id"]) + "/dispatches", {"ref": "main", "inputs": {"operation": operation}})
    run_result = None
    for attempt in range(140):
        runs = api("GET", "/actions/workflows/" + str(workflow["id"]) + "/runs?event=workflow_dispatch&per_page=1")["workflow_runs"]
        if runs and runs[0]["id"] != prior_id:
            run_result = runs[0]
            if run_result["status"] == "completed":
                break
        if attempt == 139:
            raise SystemExit("Workflow still running; inspect the existing run, do not redispatch")
        time.sleep(4)
    print("Workflow:", run_result["conclusion"], run_result["html_url"], flush=True)
    request = urllib.request.Request(BASE + "/actions/runs/" + str(run_result["id"]) + "/logs", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    for filename in archive.namelist():
        if not filename.endswith(".txt") or "Operate only" not in filename:
            continue
        lines = [re.sub(r"^\d{4}-\d\d-\d\dT\S+\s+", "", line) for line in archive.read(filename).decode("utf8", "replace").splitlines()]
        for index, line in enumerate(lines):
            if line.strip().startswith("{"):
                try:
                    report, _ = json.JSONDecoder().raw_decode("\n".join(lines[index:]))
                    if isinstance(report, dict) and "operation" in report:
                        print(json.dumps(report, indent=2))
                except ValueError:
                    pass
            elif any(marker in line for marker in ("Permission denied", "Host key verification failed", "Process completed with exit code")):
                print("Workflow failure:", line[:300])
    if run_result["conclusion"] != "success":
        raise SystemExit(1)


def upload_source():
    filename = "/tmp/citefi-staging-source.tar.gz"
    with open(filename, "rb") as source:
        content = source.read()
    if len(content) > 32 * 1024 * 1024:
        raise SystemExit("Staging source archive exceeds allowed size")
    digest = hashlib.sha256(content).hexdigest()
    parent = api("GET", "/git/ref/heads/main")["object"]["sha"]
    commit = api("GET", "/git/commits/" + parent)
    blob = api("POST", "/git/blobs", {"content": base64.b64encode(content).decode(), "encoding": "base64"})
    tree = api("POST", "/git/trees", {
        "base_tree": commit["tree"]["sha"],
        "tree": [{"path": "QA/staging-source/application.tar.gz", "mode": "100644", "type": "blob", "sha": blob["sha"]}],
    })
    snapshot = api("POST", "/git/commits", {
        "message": "Immutable staging-only source snapshot; not production promotion",
        "tree": tree["sha"], "parents": [parent],
    })
    branch = "staging/source-" + digest[:16]
    api("POST", "/git/refs", {"ref": "refs/heads/" + branch, "sha": snapshot["sha"]})
    print(json.dumps({"branch": branch, "gitBlob": blob["sha"], "sha256": digest, "bytes": len(content), "productionPromotion": False}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["publish", "run", "upload-source"])
    parser.add_argument("--title", default="Maintain isolated staging publishing server")
    parser.add_argument("--files", nargs="*", default=[])
    parser.add_argument("--operation", choices=["inspect", "inspect-root", "setup", "verify"], default="inspect")
    args = parser.parse_args()
    if args.action == "publish":
        publish(args.title, args.files)
    elif args.action == "upload-source":
        upload_source()
    else:
        run(args.operation)
