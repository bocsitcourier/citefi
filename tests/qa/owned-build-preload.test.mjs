import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  OWNED_BUILD_MARKER,
  OWNED_BUILD_ROOT_ENV,
  OWNED_BUILD_TOKEN_ENV,
  ownedBuildIpcPort,
  seedOwnedBuildIpcPort,
} from "../../QA/support/owned-build-preload.mjs";
import {
  isAllowedSocketTarget,
  parseAllowedPorts,
} from "../../QA/support/offline-guard.mjs";

const token = "01234567-89ab-cdef-0123-456789abcdef";

async function createOwnedBuild() {
  const workspace = await mkdtemp(join(tmpdir(), "qa-owned-build-workspace-"));
  const root = join(workspace, "QA", "evidence", "platinum-master", "owned-build-fixture");
  const chunks = join(root, ".next", "build", "chunks");
  await mkdir(chunks, { recursive: true });
  await mkdir(join(root, "node_modules"));
  const script = join(
    chunks,
    "pool_entry-[turbopack-node]_transforms_postcss_ts_1ejqj14._.js",
  );
  await writeFile(script, "process.stdout.write(process.env.QA_TEST_ALLOWED_PORTS ?? '')\n");
  await writeFile(join(root, OWNED_BUILD_MARKER), `${token}\n`, { mode: 0o600 });
  return { workspace, root, chunks, script };
}

function childContext(build, overrides = {}) {
  return {
    env: {
      [OWNED_BUILD_ROOT_ENV]: build.root,
      [OWNED_BUILD_TOKEN_ENV]: token,
      QA_TEST_ALLOWED_PORTS: "55481,16389",
      ...overrides.env,
    },
    cwd: overrides.cwd ?? build.root,
    argv: overrides.argv ?? [process.execPath, build.script, "39807"],
  };
}

describe("owned production-build evaluator network capability", () => {
  test("seeds only the IPC port passed to an owned generated evaluator", async () => {
    const build = await createOwnedBuild();
    try {
      assert.equal(
        build.script.split(/[\\/]/).at(-1),
        "pool_entry-[turbopack-node]_transforms_postcss_ts_1ejqj14._.js",
      );
      const context = childContext(build);
      assert.equal(ownedBuildIpcPort(context), 39807);
      assert.equal(seedOwnedBuildIpcPort(context), 39807);
      assert.equal(context.env.QA_TEST_ALLOWED_PORTS, "55481,16389,39807");

      const ports = parseAllowedPorts(context.env.QA_TEST_ALLOWED_PORTS);
      assert.equal(isAllowedSocketTarget({ host: "127.0.0.1", port: 39807 }, ports), true);
      assert.equal(isAllowedSocketTarget({ host: "localhost", port: 39807 }, ports), true);
      assert.equal(isAllowedSocketTarget({ host: "example.com", port: 39807 }, ports), false);
      assert.equal(isAllowedSocketTarget({ host: "127.0.0.1", port: 39808 }, ports), false);
      assert.equal(isAllowedSocketTarget({ host: "127.0.0.1", port: 5000 }, ports), false);
    } finally {
      await rm(build.workspace, { recursive: true, force: true });
    }
  });

  test("missing, forged, and unowned scratch markers do not grant a port", async () => {
    const build = await createOwnedBuild();
    const otherBuild = await createOwnedBuild();
    const outside = await mkdtemp(join(tmpdir(), "qa-unowned-build-preload-"));
    try {
      assert.equal(
        ownedBuildIpcPort({
          cwd: build.root,
          argv: [process.execPath, build.script, "39807"],
          env: {},
        }),
        undefined,
      );

      assert.equal(
        ownedBuildIpcPort(
          childContext(build, {
            env: { [OWNED_BUILD_TOKEN_ENV]: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
          }),
        ),
        undefined,
      );

      const markerFromAnotherBuild = childContext(otherBuild, {
        argv: [process.execPath, build.script, "39807"],
      });
      assert.equal(ownedBuildIpcPort(markerFromAnotherBuild), undefined);
      assert.equal(ownedBuildIpcPort(childContext(build, { cwd: outside })), undefined);

      const noMarker = await createOwnedBuild();
      try {
        await rm(join(noMarker.root, OWNED_BUILD_MARKER));
        assert.equal(ownedBuildIpcPort(childContext(noMarker)), undefined);
      } finally {
        await rm(noMarker.workspace, { recursive: true, force: true });
      }
    } finally {
      await rm(build.workspace, { recursive: true, force: true });
      await rm(otherBuild.workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("ordinary or malformed processes cannot use a valid build marker to widen access", async () => {
    const build = await createOwnedBuild();
    const foreignBuild = await createOwnedBuild();
    try {
      const nestedDirectory = join(build.chunks, "nested");
      await mkdir(nestedDirectory);
      const nestedPoolEntry = join(
        nestedDirectory,
        "pool_entry-[turbopack-node]_transforms_postcss_ts_1ejqj14._.js",
      );
      const wrongPoolEntry = join(
        build.chunks,
        "pool_entry-[turbopack-node]_transforms_css_ts_1ejqj14._.js",
      );
      await writeFile(nestedPoolEntry, "");
      await writeFile(wrongPoolEntry, "");
      const unrelatedArgs = [
        [process.execPath, join(build.root, "ordinary-script.js"), "39807"],
        [process.execPath, join(build.chunks, "unrelated.js"), "39807"],
        [process.execPath, nestedPoolEntry, "39807"],
        [process.execPath, wrongPoolEntry, "39807"],
        [process.execPath, foreignBuild.script, "39807"],
        [process.execPath, build.script, "not-a-port"],
        [process.execPath, build.script, "65536"],
        ["/usr/bin/python", build.script, "39807"],
      ];
      for (const argv of unrelatedArgs) {
        const context = childContext(build, { argv });
        assert.equal(ownedBuildIpcPort(context), undefined, JSON.stringify(argv));
        const originalPorts = context.env.QA_TEST_ALLOWED_PORTS;
        assert.equal(seedOwnedBuildIpcPort(context), undefined);
        assert.equal(context.env.QA_TEST_ALLOWED_PORTS, originalPorts);
      }
    } finally {
      await rm(build.workspace, { recursive: true, force: true });
      await rm(foreignBuild.workspace, { recursive: true, force: true });
    }
  });

  test("a scratch root with external node_modules cannot grant evaluator IPC", async () => {
    const build = await createOwnedBuild();
    const externalModules = await mkdtemp(join(tmpdir(), "qa-external-node-modules-"));
    try {
      await rm(join(build.root, "node_modules"), { recursive: true });
      await symlink(externalModules, join(build.root, "node_modules"), "dir");
      assert.equal(ownedBuildIpcPort(childContext(build)), undefined);
    } finally {
      await rm(build.workspace, { recursive: true, force: true });
      await rm(externalModules, { recursive: true, force: true });
    }
  });
});
