/**
 * Owned HTTP fixture for the routine auth/admin QA suites.
 *
 * This is deliberately a small Node HTTP adapter around the application's
 * actual route handlers.  It does not boot Next.js, read Next config, spawn a
 * worker, or provide alternate auth behavior.  The harness owns the database
 * and starts this process on the fixed QA-only port before running the suites.
 *
 * Launch (the isolated harness uses the TypeScript entrypoint):
 *   node --import tsx/esm QA/support/http-fixture.ts
 *
 * The harness must also preload offline-guard.mjs and allow TCP port 15481 in
 * QA_TEST_ALLOWED_PORTS for the test process.  The server prints the contract
 * line below so a harness can assert that it started the expected fixture.
 */
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { NextRequest } from "next/server";

// Some existing route handlers still use a localized CommonJS `require`
// (signup currently loads node:crypto this way). Next normally supplies that
// compatibility when it compiles the route; this owned ESM runner must supply
// the equivalent without changing the production handler.
globalThis.require ??= createRequire(import.meta.url);

export const HTTP_FIXTURE_HOST = "127.0.0.1";
export const HTTP_FIXTURE_PORT = 15481;
export const HTTP_FIXTURE_URL = `http://${HTTP_FIXTURE_HOST}:${HTTP_FIXTURE_PORT}`;

const methodNotAllowed = (response) => {
  response.statusCode = 405;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: "Method not allowed" }));
};

const notFound = (response) => {
  response.statusCode = 404;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: "QA HTTP fixture route not found" }));
};

function incomingHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function routeRequest(request, body) {
  const host = request.headers.host || `${HTTP_FIXTURE_HOST}:${HTTP_FIXTURE_PORT}`;
  const url = new URL(request.url || "/", `http://${host}`);
  const headers = incomingHeaders(request);
  const options = {
    method: request.method,
    headers,
  };
  if (body !== undefined && request.method !== "GET" && request.method !== "HEAD") {
    // Node's Request implementation requires duplex for a streamed/body
    // request.  NextRequest passes the option through to undici.
    options.body = body;
    options.duplex = "half";
  }
  return new NextRequest(url, options);
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
}

function copyResponseHeaders(source, target) {
  let setCookies = [];
  if (typeof source.getSetCookie === "function") {
    setCookies = source.getSetCookie();
  } else {
    setCookies = splitSetCookie(source.get("set-cookie"));
  }

  for (const [name, value] of source.entries()) {
    if (name.toLowerCase() === "set-cookie") continue;
    target.setHeader(name, value);
  }
  if (setCookies.length > 0) target.setHeader("set-cookie", setCookies);
}

function routeContext(id) {
  return { params: Promise.resolve({ id }) };
}

async function installEmailStub() {
  // The fixture must never inherit SMTP credentials from a developer shell.
  // Route logic remains real; only the external delivery seam is inert.
  for (const key of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_PASSWORD",
    "SMTP_URL",
    "SMTP_FROM",
  ]) {
    delete process.env[key];
  }
  process.env.CITEFI_DISABLE_EMAIL = "true";

  const email = await import("../../lib/email.ts");
  for (const method of [
    "sendAccountApprovedEmail",
    "sendAccountRejectedEmail",
    "sendPendingReviewReminderEmail",
  ]) {
    if (typeof email.emailService?.[method] === "function") {
      email.emailService[method] = async () => {};
    }
  }
}

const routeLoaders = [
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    load: () => import("../../app/api/auth/login/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "GET",
    pattern: /^\/api\/auth\/me$/,
    load: () => import("../../app/api/auth/me/route.ts"),
    handler: (module) => module.GET,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/signup$/,
    load: () => import("../../app/api/auth/signup/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/verify-2fa$/,
    load: () => import("../../app/api/auth/verify-2fa/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/send-email-code$/,
    load: () => import("../../app/api/auth/send-email-code/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/setup-totp$/,
    load: () => import("../../app/api/auth/setup-totp/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/disable-totp$/,
    load: () => import("../../app/api/auth/disable-totp/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/reset-password-token$/,
    load: () => import("../../app/api/auth/reset-password-token/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/reset-password$/,
    load: () => import("../../app/api/auth/reset-password/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/change-password$/,
    load: () => import("../../app/api/auth/change-password/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/users$/,
    load: () => import("../../app/api/admin/users/route.ts"),
    handler: (module) => module.GET,
  },
  {
    method: "GET",
    pattern: /^\/api\/notifications$/,
    load: () => import("../../app/api/notifications/route.ts"),
    handler: (module) => module.GET,
  },
  {
    method: "POST",
    pattern: /^\/api\/notifications$/,
    load: () => import("../../app/api/notifications/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/client\/error-screenshot$/,
    load: () => import("../../app/api/client/error-screenshot/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/account\/delete$/,
    load: () => import("../../app/api/account/delete/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/users\/review$/,
    load: () => import("../../app/api/admin/users/review/route.ts"),
    handler: (module) => module.GET,
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/users\/review$/,
    load: () => import("../../app/api/admin/users/review/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/users\/([^/]+)\/approve$/,
    load: () => import("../../app/api/admin/users/[id]/approve/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/users\/([^/]+)\/reject$/,
    load: () => import("../../app/api/admin/users/[id]/reject/route.ts"),
    handler: (module) => module.POST,
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/users\/([^/]+)\/revoke-approval-token$/,
    load: () => import("../../app/api/admin/users/[id]/revoke-approval-token/route.ts"),
    handler: (module) => module.POST,
  },
];

async function resolveRoute(method, pathname) {
  let matchedPath = false;
  for (const definition of routeLoaders) {
    const match = definition.pattern.exec(pathname);
    if (!match) continue;
    matchedPath = true;
    if (definition.method !== method) continue;
    const module = await definition.load();
    return {
      handler: definition.handler(module),
      context: match[1] ? routeContext(match[1]) : undefined,
    };
  }
  if (matchedPath) return { methodNotAllowed: true };
  return undefined;
}

async function handleRequest(request, response) {
  if (request.url === "/__qa/health" && request.method === "GET") {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      ok: true,
      fixture: "owned-route-handler-http",
      url: HTTP_FIXTURE_URL,
    }));
    return;
  }

  const url = new URL(request.url || "/", HTTP_FIXTURE_URL);
  let route;
  try {
    route = await resolveRoute(request.method || "GET", url.pathname);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      error: "QA route module failed to load",
      detail: error instanceof Error ? error.message : String(error),
    }));
    return;
  }

  if (!route) {
    notFound(response);
    return;
  }
  if (route.methodNotAllowed) {
    methodNotAllowed(response);
    return;
  }

  const body = await readRequestBody(request);
  const nextRequest = routeRequest(request, body);
  try {
    const nextResponse = route.context
      ? await route.handler(nextRequest, route.context)
      : await route.handler(nextRequest);
    copyResponseHeaders(nextResponse.headers, response);
    response.statusCode = nextResponse.status;
    response.end(Buffer.from(await nextResponse.arrayBuffer()));
  } catch (error) {
    const status = Number(error?.statusCode || error?.status) || 500;
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : "QA route handler failed",
    }));
  }
}

export async function createHttpFixtureServer() {
  process.env.QA_HTTP_FIXTURE_URL ||= HTTP_FIXTURE_URL;
  process.env.NODE_ENV ||= "test";
  process.env.NEXT_PUBLIC_APP_URL ||= HTTP_FIXTURE_URL;
  process.env.APP_URL ||= HTTP_FIXTURE_URL;
  // Keep queue imports from falling back to a developer's Redis.  A harness
  // that owns Redis may provide its explicit URL; otherwise port 1 is an
  // intentional dead sentinel and the signup route's fire-and-forget queue
  // failure remains inside its existing error boundary.
  process.env.REDIS_URL ||= "redis://127.0.0.1:1/0";
  await installEmailStub();
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        error: "QA HTTP fixture failure",
        detail: error instanceof Error ? error.message : String(error),
      }));
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(HTTP_FIXTURE_PORT, HTTP_FIXTURE_HOST, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });
  return server;
}

export async function stopHttpFixtureServer(server) {
  await new Promise((resolveClose) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.close(() => resolveClose());
  });
  try {
    const { closeDb } = await import("../../lib/db.ts");
    await closeDb();
  } catch {
    // A route module may not have initialized the database before shutdown.
  }
}

async function main() {
  process.env.NEXT_PUBLIC_APP_URL ||= HTTP_FIXTURE_URL;
  process.env.APP_URL ||= HTTP_FIXTURE_URL;
  const server = await createHttpFixtureServer();
  console.log(`QA_HTTP_FIXTURE_URL=${HTTP_FIXTURE_URL}`);
  console.log(`QA_HTTP_FIXTURE_PORT=${HTTP_FIXTURE_PORT}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopHttpFixtureServer(server);
  };
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}