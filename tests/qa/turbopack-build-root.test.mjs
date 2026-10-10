import assert from "node:assert/strict";
import test from "node:test";
import { commonBuildRoot } from "../../next.config.mjs";

test("local dependencies do not expand the app build root", () => {
  assert.equal(commonBuildRoot("/srv/app/release", "/srv/app/release/node_modules"), "/srv/app/release");
});

test("retained staging dependencies must remain inside the chosen build root", () => {
  assert.equal(commonBuildRoot("/srv/app/sources/new", "/srv/app/sources/retained/node_modules"), "/srv/app/sources");
});

test("a similarly named sibling is not mistaken for a contained dependency", () => {
  assert.equal(commonBuildRoot("/srv/app", "/srv/app-other/node_modules"), "/srv");
});

test("unrelated dependencies never expand tracing to the filesystem root", () => {
  assert.throws(() => commonBuildRoot("/srv/app", "/nix/store/dependencies"), /non-filesystem build root/);
});
