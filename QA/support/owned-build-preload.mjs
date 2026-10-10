// Node preload used only by the isolated production-build harness. Turbopack's
// generated evaluator receives its private loopback IPC port as argv[2].
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OWNED_BUILD_ROOT_ENV = "QA_OWNED_BUILD_ROOT";
export const OWNED_BUILD_TOKEN_ENV = "QA_OWNED_BUILD_TOKEN";
export const OWNED_BUILD_MARKER = ".qa-owned-build-marker";

function realpathOrUndefined(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

export function ownedBuildIpcDecision({
  env = process.env,
  cwd = process.cwd(),
  argv = process.argv,
} = {}) {
  const rootValue = env[OWNED_BUILD_ROOT_ENV];
  const token = env[OWNED_BUILD_TOKEN_ENV];
  if (!rootValue || !isAbsolute(rootValue) || !/^[\da-f-]{36}$/i.test(token ?? "")) {
    return { reason: "missing-or-invalid-marker-environment" };
  }

  const root = realpathOrUndefined(rootValue);
  const workingDirectory = realpathOrUndefined(cwd);
  if (!root || root !== rootValue) return { reason: "scratch-root-not-canonical-or-missing" };
  if (!workingDirectory) return { reason: "working-directory-unavailable" };
  if (workingDirectory !== root) return { reason: "working-directory-not-scratch-root" };
  const workspaceRoot = resolve(root, "..", "..", "..", "..");
  if (
    basename(root).startsWith("owned-build-") === false ||
    relative(workspaceRoot, root) !== join("QA", "evidence", "platinum-master", basename(root))
  ) {
    return { reason: "scratch-root-outside-owned-build-evidence-directory" };
  }

  const modulesPath = join(root, "node_modules");
  try {
    const modulesInfo = lstatSync(modulesPath);
    if (!modulesInfo.isDirectory() || modulesInfo.isSymbolicLink() || realpathOrUndefined(modulesPath) !== modulesPath) {
      return { reason: "owned-node-modules-not-a-local-directory" };
    }
  } catch {
    return { reason: "owned-node-modules-missing" };
  }

  const marker = join(root, OWNED_BUILD_MARKER);
  try {
    if (!lstatSync(marker).isFile() || readFileSync(marker, "utf8").trim() !== token) {
      return { reason: "scratch-marker-missing-or-mismatched" };
    }
  } catch {
    return { reason: "scratch-marker-unreadable" };
  }

  if (typeof argv[0] !== "string" || !/(^|[/\\])node(?:\.exe)?$/i.test(argv[0])) {
    return { reason: "argv0-not-node" };
  }

  const scriptArgument = argv[1];
  if (typeof scriptArgument !== "string" || !scriptArgument) {
    return { reason: "missing-script-argument" };
  }
  const scriptPath = realpathOrUndefined(
    isAbsolute(scriptArgument) ? scriptArgument : resolve(workingDirectory, scriptArgument),
  );
  const chunksDirectory = realpathOrUndefined(join(root, ".next", "build", "chunks"));
  if (!scriptPath) return { reason: "script-argument-does-not-resolve-to-file" };
  if (!chunksDirectory) return { reason: "owned-build-chunks-directory-missing" };

  const scriptRelativePath = relative(chunksDirectory, scriptPath);
  if (
    !scriptRelativePath ||
    scriptRelativePath === ".." ||
    scriptRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(scriptRelativePath) ||
    !/^pool_entry-\[turbopack-node\]_transforms_postcss_ts_[a-z0-9]{7}\._\.js$/.test(scriptRelativePath)
  ) {
    return { reason: "script-is-not-the-owned-postcss-pool-entry" };
  }

  // next-swc's embedded child_process/evaluate.ts defines PORT as argv[2].
  const rawPort = argv[2];
  if (typeof rawPort !== "string" || !/^[1-9]\d{0,4}$/.test(rawPort)) {
    return { reason: "argv2-is-not-a-valid-port" };
  }
  const port = Number(rawPort);
  return port <= 65_535 ? { port } : { reason: "argv2-port-out-of-range" };
}

export function ownedBuildIpcPort(options) {
  return ownedBuildIpcDecision(options).port;
}

export function seedOwnedBuildIpcPort(options = {}) {
  const port = ownedBuildIpcPort(options);
  if (port === undefined) return undefined;

  const env = options.env ?? process.env;
  const existingPorts = (env.QA_TEST_ALLOWED_PORTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  env.QA_TEST_ALLOWED_PORTS = [...new Set([...existingPorts, String(port)])].join(",");
  return port;
}

// Diagnostic output is limited to the evaluator's command paths, cwd, and port;
// no environment values (including the ownership token) are printed.
const decision = ownedBuildIpcDecision();
const candidateScript = process.argv[1];
const candidateScriptPath = typeof candidateScript === "string"
  ? realpathOrUndefined(isAbsolute(candidateScript) ? candidateScript : resolve(process.cwd(), candidateScript))
  : undefined;
const hasScriptPath = candidateScriptPath !== undefined;
if (hasScriptPath || /^\d+$/.test(process.argv[2] ?? "")) {
  const safeScript = hasScriptPath ? candidateScript : "<not-a-script-path>";
  const safePort = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "<not-numeric>";
  process.stderr.write(
    `QA_OWNED_BUILD_PRELOAD: cwd=${JSON.stringify(process.cwd())} ` +
    `argv0=${JSON.stringify(process.argv[0])} argv1=${JSON.stringify(safeScript)} ` +
    `argv2=${JSON.stringify(safePort)} decision=${decision.reason ?? `allow-port-${decision.port}`}\n`,
  );
}
if (decision.port !== undefined) {
  const existingPorts = (process.env.QA_TEST_ALLOWED_PORTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  process.env.QA_TEST_ALLOWED_PORTS =
    [...new Set([...existingPorts, String(decision.port)])].join(",");
}

// This preload replaces offline-guard only in the owned build's NODE_OPTIONS.
// For every ordinary process it loads the unchanged guard without widening it.
await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "offline-guard.mjs")));
