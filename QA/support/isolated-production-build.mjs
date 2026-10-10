// Invoke through with-isolated-database.sh --with-redis --direct.
// Builds the current tree without real dotenv files or the active .next cache.
import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OWNED_BUILD_MARKER,
  OWNED_BUILD_ROOT_ENV,
  OWNED_BUILD_TOKEN_ENV,
} from "./owned-build-preload.mjs";

if (process.env.QA_ISOLATED_DATABASE !== "true" || !process.env.NODE_OPTIONS?.includes("offline-guard")) {
  throw new Error("An owned isolated database and offline guard are required");
}
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const evidence = join(root, "QA/evidence/platinum-master");
await mkdir(evidence, { recursive: true });
const ownershipToken = randomUUID();
const offlineGuardOption = `--import=${join(root, "QA/support/offline-guard.mjs")}`;
const ownedPreloadOption = `--import=${join(root, "QA/support/owned-build-preload.mjs")}`;
const inheritedNodeOptions = process.env.NODE_OPTIONS ?? "";
if (inheritedNodeOptions.split(offlineGuardOption).length !== 2) {
  throw new Error("Expected exactly one offline-guard preload before starting the owned build");
}
const buildNodeOptions = inheritedNodeOptions.replace(offlineGuardOption, ownedPreloadOption);
const scratch = await mkdtemp(join(evidence, "owned-build-"));
const sourceModules = join(root, "node_modules");
const ownedModules = join(scratch, "node_modules");
let build;

function isWithin(directory, path) {
  const pathRelative = relative(directory, path);
  return pathRelative === "" ||
    (pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`) && !isAbsolute(pathRelative));
}

async function createLocalHardlinkTree(source, destination) {
  const sourceRoot = await realpath(source);
  await mkdir(destination);
  const destinationRoot = await realpath(destination);

  async function copyEntry(sourcePath, destinationPath) {
    const sourceInfo = await lstat(sourcePath);
    if (sourceInfo.isDirectory()) {
      await mkdir(destinationPath, { mode: sourceInfo.mode & 0o777 });
      for (const entry of await readdir(sourcePath)) {
        await copyEntry(join(sourcePath, entry), join(destinationPath, entry));
      }
      const destinationInfo = await lstat(destinationPath);
      if (destinationInfo.ino === sourceInfo.ino && destinationInfo.dev === sourceInfo.dev) {
        throw new Error(`Owned dependency directory was not independently created: ${relative(source, sourcePath)}`);
      }
      return;
    }

    if (sourceInfo.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      const resolvedTarget = await realpath(sourcePath);
      if (!isWithin(sourceRoot, resolvedTarget)) {
        throw new Error(`Dependency symlink escapes node_modules: ${relative(source, sourcePath)}`);
      }
      await symlink(target, destinationPath);
      const lexicalTarget = isAbsolute(target) ? target : resolve(dirname(destinationPath), target);
      if (!isWithin(destinationRoot, lexicalTarget)) {
        throw new Error(`Owned dependency symlink escapes its local tree: ${relative(source, sourcePath)}`);
      }
      return;
    }

    if (!sourceInfo.isFile()) {
      throw new Error(`Unsupported node_modules entry type: ${relative(source, sourcePath)}`);
    }
    await link(sourcePath, destinationPath);
    const [sourceStat, destinationStat] = await Promise.all([stat(sourcePath), stat(destinationPath)]);
    if (sourceStat.ino !== destinationStat.ino || sourceStat.dev !== destinationStat.dev) {
      throw new Error(`Dependency file was not hardlinked: ${relative(source, sourcePath)}`);
    }
  }

  for (const entry of await readdir(source)) {
    await copyEntry(join(source, entry), join(destination, entry));
  }

  async function verifyContainedSymlinks(directory) {
    for (const entry of await readdir(directory)) {
      const entryPath = join(directory, entry);
      const entryInfo = await lstat(entryPath);
      if (entryInfo.isSymbolicLink()) {
        const resolvedTarget = await realpath(entryPath);
        if (!isWithin(destinationRoot, resolvedTarget)) {
          throw new Error(`Owned dependency symlink resolves outside its local tree: ${relative(destination, entryPath)}`);
        }
      } else if (entryInfo.isDirectory()) {
        await verifyContainedSymlinks(entryPath);
      }
    }
  }
  await verifyContainedSymlinks(destination);
}

try {
  const sourceModulesInfo = await lstat(sourceModules);
  if (!sourceModulesInfo.isDirectory() || sourceModulesInfo.isSymbolicLink()) {
    throw new Error("Workspace node_modules must be a real directory before creating the owned build");
  }
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of files) {
    if (file.startsWith("QA/evidence/") || file.startsWith(".agents/") || file.startsWith(".local/") ||
        file.split("/").some(part => part.startsWith(".env")) || file === ".replit" || file === "tsconfig.tsbuildinfo") continue;
    const target = join(scratch, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(root, file), target);
  }
  await createLocalHardlinkTree(sourceModules, ownedModules);
  if (await realpath(ownedModules) !== ownedModules || (await lstat(ownedModules)).isSymbolicLink()) {
    throw new Error("Owned node_modules is not a physical directory inside the scratch root");
  }
  console.log("Owned node_modules locality verified: independent directories, hardlinked files, and contained package symlinks");
  await writeFile(join(scratch, OWNED_BUILD_MARKER), `${ownershipToken}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Owned build tree: ${relative(root, scratch)}; dotenv files excluded; actual production build command unchanged`);
  build = spawn("npm", ["run", "build"], {
    cwd: scratch, detached: true, stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_OPTIONS: buildNodeOptions,
      [OWNED_BUILD_ROOT_ENV]: scratch,
      [OWNED_BUILD_TOKEN_ENV]: ownershipToken,
    },
  });
  const timeout = setTimeout(() => {
    console.error("Owned production build exceeded 420 seconds");
    try { process.kill(-build.pid, "SIGTERM"); } catch {}
  }, 420000);
  const code = await new Promise(resolve => build.on("exit", (status) => resolve(status ?? 1)));
  clearTimeout(timeout);
  process.exitCode = code;
} finally {
  if (build?.pid) {
    try { process.kill(-build.pid, "SIGTERM"); } catch {}
  }
  await rm(scratch, { recursive: true, force: true });
  console.log("Owned build tree removed; active application cache unchanged");
}
