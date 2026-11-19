import test from "node:test";
import assert from "node:assert/strict";
import { generateTrial, getTrial, prepareTrialForGeneration, startTrial } from "../lib/trial/client";

test("trial RPC works when browser storage is denied and retains cookie authentication", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem() { throw new Error("Storage unavailable"); },
    setItem() { throw new Error("Storage unavailable"); },
  } });
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return Response.json({ status: "created", access: "preview", canExport: false, developmentToken: "fixture-only" });
  });
  assert.equal((await startTrial()).status, "created");
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.credentials, "include");
  assert.equal(new Headers(request.headers).get("X-Trial-Request"), "1");
});

test("server diagnostics, malformed bodies and unknown states are visible failures", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Service unavailable. Support reference: fixture-ref." }, { status: 503 }));
  await assert.rejects(getTrial(), /Support reference: fixture-ref/);
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Gateway failure</html>", { status: 502 }));
  await assert.rejects(getTrial(), /unreadable response/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "invented", access: "paid" }));
  await assert.rejects(getTrial(), /invalid status/);
});

test("a network timeout never repeats the generation request", async t => {
  let calls = 0;
  t.mock.method(globalThis, "setTimeout", ((fn: () => void) => {
    queueMicrotask(fn);
    return 1;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      if (options.signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
      else options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  await assert.rejects(generateTrial({ businessName: "Fixture", city: "Test city", audience: "Test audience", topic: "Fixture article question" }), /completion is unconfirmed/);
  assert.equal(calls, 1);
});

test("trial bootstrap GET has a bounded timeout and makes no hidden retry", async t => {
  let calls = 0;
  t.mock.method(globalThis, "setTimeout", ((fn: () => void) => {
    queueMicrotask(fn);
    return 1;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      if (options.signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
      else options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  await assert.rejects(getTrial(), /connection timed out/);
  assert.equal(calls, 1);
});

test("session creation must be confirmed by a status read before generation", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    return Response.json({ status: "created", access: "preview", canExport: false });
  });
  assert.equal((await prepareTrialForGeneration()).status, "created");
  assert.deepEqual(calls, ["POST /api/trial/session", "GET /api/trial"]);
});

test("a blocked cookie or a blocked service cannot start a generation request", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    return Response.json({ status: url.endsWith("/session") ? "created" : "empty", access: "preview", canExport: false });
  });
  await assert.rejects(prepareTrialForGeneration(), /couldn’t keep your private article session.*No article was requested/);
  assert.deepEqual(calls, ["/api/trial/session", "/api/trial"]);

  calls.length = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    return Response.json({ error: "Free article unavailable. Support reference: fixture-ref." }, { status: 503 });
  });
  await assert.rejects(prepareTrialForGeneration(), /Support reference: fixture-ref/);
  assert.deepEqual(calls, ["/api/trial/session"]);
});
