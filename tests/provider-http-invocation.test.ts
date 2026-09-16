import assert from "node:assert/strict";
import test from "node:test";
import { providerHttpInvocationKey } from "../lib/provider-http-invocation";
import { runWithProviderInvocationIdentity } from "../lib/provider-invocation-identity";

const owner = { teamId: 7, userId: 11 };
const request = (key?: string, path = "/api/media/41/regenerate") =>
  new Request(`https://example.test${path}`, {
    method: "POST",
    headers: key ? { "x-idempotency-key": key } : {},
  });

test("HTTP redelivery keeps logical identity while intentional regenerations differ", () => {
  assert.equal(providerHttpInvocationKey(request("one"), owner), providerHttpInvocationKey(request("one"), owner));
  assert.notEqual(providerHttpInvocationKey(request("one"), owner), providerHttpInvocationKey(request("two"), owner));
  assert.notEqual(providerHttpInvocationKey(request(), owner), providerHttpInvocationKey(request(), owner));
});

test("HTTP identity is owner/path scoped and retains no raw header or content", () => {
  const key = "non-secret-client-operation";
  const id = providerHttpInvocationKey(request(key), owner);
  assert.match(id, /^http:[a-f0-9]{64}$/);
  assert.equal(id.includes(key), false);
  assert.notEqual(id, providerHttpInvocationKey(request(key), { teamId: 8, userId: 11 }));
  assert.notEqual(id, providerHttpInvocationKey(request(key, "/api/media/42/regenerate"), owner));
  assert.throws(() => providerHttpInvocationKey(request("x".repeat(256)), owner), /exceeds/);
});

test("unkeyed HTTP helper inherits an ambient worker identity instead of randomizing", () => {
  const identity = runWithProviderInvocationIdentity(
    "queue:article-generation:job:42",
    () => providerHttpInvocationKey(request(), owner),
  );
  assert.equal(identity, "queue:article-generation:job:42");
});