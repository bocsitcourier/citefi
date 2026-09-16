/**
 * Disposable HTTP fixture for the authenticated-auth QA flows.
 *
 * This fixture deliberately does not load .env files and never discovers an
 * application database or Redis process. It owns:
 *   - PostgreSQL 127.0.0.1:55485
 *   - Redis 127.0.0.1:16385
 *   - route-handler HTTP 127.0.0.1:5105
 *   - an in-process SMTP sink on an ephemeral loopback port
 *
 * The HTTP server invokes the checked-in Next route handlers directly. This
 * keeps the test on the production auth/notification guards without sharing
 * the app's Next build output or port 5000.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection, createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { appendFile, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const AUTH_HTTP_PORT = 5105;
export const AUTH_HTTP_PG_PORT = 55485;
export const AUTH_HTTP_REDIS_PORT = 16385;
export const AUTH_HTTP_BASE_URL = `http://127.0.0.1:${AUTH_HTTP_PORT}`;

const TEST_DATABASE_URL =
  `postgresql://qa_auth_http@127.0.0.1:${AUTH_HTTP_PG_PORT}/postgres`;
const TEST_REDIS_URL = `redis://127.0.0.1:${AUTH_HTTP_REDIS_PORT}/0`;

type RouteHandler = (
  ...args: any[]
) => Promise<Response>;

interface RouteModule {
  GET?: RouteHandler;
  POST?: RouteHandler;
  DELETE?: RouteHandler;
  PATCH?: RouteHandler;
}

interface FixtureEnvironment {
  DATABASE_URL?: string;
  DATABASE_POOLED_URL?: string;
  NEON_DATABASE_URL?: string;
  REDIS_URL?: string;
  NODE_ENV?: string;
  JWT_SECRET?: string;
  SESSION_SECRET?: string;
  CSRF_SECRET?: string;
  TOTP_ENCRYPTION_KEY?: string;
  TOTP_ENCRYPTION_KEY_VERSION?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

const ENVIRONMENT_KEYS: Array<keyof FixtureEnvironment> = [
  "DATABASE_URL",
  "DATABASE_POOLED_URL",
  "NEON_DATABASE_URL",
  "REDIS_URL",
  "NODE_ENV",
  "JWT_SECRET",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "TOTP_ENCRYPTION_KEY_VERSION",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
];

// These must not leak into a disposable QA process even when the caller is
// running from a developer shell that has provider credentials configured.
const SENSITIVE_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "BRAVE_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "SENDGRID_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "SMTP_PASSWORD",
  "DO_SPACES_KEY",
  "DO_SPACES_SECRET",
  "DO_SPACES_ENDPOINT",
  "DO_SPACES_BUCKET",
  "DO_SPACES_CDN_ENDPOINT",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "APPROVAL_TOKEN_SECRET",
  "API_KEY_ENCRYPTION_SECRET",
  "STRIPE_PRICE_ID_PRO_MONTHLY",
  "STRIPE_PRICE_ID_PRO_ANNUAL",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "SLACK_WEBHOOK_URL",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY",
  "REDDIT_CLIENT_ID",
  "REDDIT_SECRET",
] as const;

export interface CapturedEmail {
  raw: string;
  receivedAt: string;
}

export interface AuthHttpFixture {
  baseUrl: string;
  databaseUrl: string;
  redisUrl: string;
  emailMessages: CapturedEmail[];
  smtpCapturePath?: string;
  environment: NodeJS.ProcessEnv;
  waitForEmail: (pattern: RegExp, timeoutMs?: number) => Promise<CapturedEmail>;
  stop: () => Promise<void>;
}

interface RunningProcesses {
  pgData: string;
  pgSocket: string;
  pgProcess: ChildProcess | null;
  redisProcess: ChildProcess | null;
  smtpServer: NetServer | null;
  httpServer: ReturnType<typeof createHttpServer> | null;
  fixtureRoot: string;
}

async function run(
  command: string,
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd: ROOT,
    env: env as NodeJS.ProcessEnv,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

function scrubbedEnvironment(extra: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    ...extra,
  } as NodeJS.ProcessEnv;
  for (const key of [
    ...SENSITIVE_KEYS,
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLMODE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) {
    delete environment[key];
  }
  return environment;
}

async function portIsOpen(port: number): Promise<boolean> {
  return await new Promise((resolveResult) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let finished = false;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolveResult(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsOpen(port)) return;
    await new Promise((resolveResult) => setTimeout(resolveResult, 50));
  }
  throw new Error(`Owned auth HTTP fixture port ${port} did not become ready`);
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => undefined);
}

function patchExportedSchema(ddl: string): string {
  // The source export contains every table, but a few composite foreign keys
  // generated by the declarative schema need their prerequisite unique keys
  // staged before the generated foreign-key ALTER TABLE block, matching the existing isolated
  // database composition pattern without touching the shared harness.
  const prerequisites = `
DO $qa_auth_fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qa_agency_client_reports_fk_key'
      AND conrelid = 'public.agency_client_reports'::regclass
  ) THEN
    ALTER TABLE agency_client_reports
      ADD CONSTRAINT qa_agency_client_reports_fk_key
      UNIQUE (id, agency_team_id, client_team_id);
  END IF;
END
$qa_auth_fixture$;
DO $qa_auth_fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qa_campaigns_fk_key'
      AND conrelid = 'public.campaigns'::regclass
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT qa_campaigns_fk_key
      UNIQUE (team_id, id);
  END IF;
END
$qa_auth_fixture$;
DO $qa_auth_fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qa_campaign_ads_fk_key'
      AND conrelid = 'public.campaign_ads'::regclass
  ) THEN
    ALTER TABLE campaign_ads
      ADD CONSTRAINT qa_campaign_ads_fk_key
      UNIQUE (team_id, id);
  END IF;
END
$qa_auth_fixture$;
`;
  // RLS enable statements are interleaved with table creation. Stage the
  // composite keys immediately before the generated foreign-key block instead
  // of before the first ALTER TABLE (which may precede campaigns itself).
  const firstAlter = ddl.search(/^ALTER TABLE .* ADD CONSTRAINT /m);
  const withPrerequisites =
    firstAlter >= 0 ? `${ddl.slice(0, firstAlter)}${prerequisites}${ddl.slice(firstAlter)}` : ddl;
  return withPrerequisites.replace(
    /^CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx".*$/m,
    'CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx" ON "telemetry_ai_requests" USING btree ("admin_user_id","incident_id","created_at" DESC);',
  );
}

async function composeSchema(environment: NodeJS.ProcessEnv): Promise<void> {
  await run("psql", [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    "127.0.0.1",
    "-p",
    String(AUTH_HTTP_PG_PORT),
    "-U",
    "qa_auth_http",
    "-d",
    "postgres",
    "-c",
    "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE ROLE citefi_tenant NOLOGIN;",
  ], environment).catch(async (error: unknown) => {
    // initdb can leave the role in place after a retry; only the duplicate-role
    // part is safe to ignore, while extension/connection failures are not.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already exists")) throw error;
  });

  const ddl = await run(
    join(ROOT, "node_modules/.bin/drizzle-kit"),
    ["export", "--dialect", "postgresql", "--schema", join(ROOT, "shared/schema.ts"), "--sql"],
    environment,
  );
  if (!ddl.trim()) throw new Error("Auth HTTP fixture source schema export was empty");
  const patched = patchExportedSchema(ddl);
  await new Promise<void>((resolveResult, reject) => {
    const child = spawn(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "127.0.0.1",
        "-p",
        String(AUTH_HTTP_PG_PORT),
        "-U",
        "qa_auth_http",
        "-d",
        "postgres",
      ],
      { cwd: ROOT, env: environment, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveResult();
      else reject(new Error(`Auth HTTP fixture schema composition failed (${code}): ${stderr}`));
    });
    child.stdin?.end(patched);
  });
}

function writeSmtpResponse(socket: Socket, response: string): void {
  socket.write(`${response}\r\n`);
}

function startSmtpSink(
  emailMessages: CapturedEmail[],
  trace: string[],
  smtpCapturePath?: string,
): Promise<NetServer> {
  const server = createNetServer();
  server.on("connection", (socket) => {
    let input = "";
    let dataMode = false;
    let message = "";
    writeSmtpResponse(socket, "220 qa-auth-http-fixture ESMTP");

    socket.on("data", (chunk: Buffer) => {
      input += chunk.toString("utf8");
      while (true) {
        const lineEnd = input.indexOf("\r\n");
        if (lineEnd < 0) break;
        const line = input.slice(0, lineEnd);
        input = input.slice(lineEnd + 2);
        trace.push(line.toUpperCase().startsWith("AUTH") ? "AUTH" : line.toUpperCase().split(" ")[0] ?? "");
        if (dataMode) {
          if (line === ".") {
            const receivedAt = new Date().toISOString();
            emailMessages.push({ raw: message, receivedAt });
            if (smtpCapturePath) {
              void appendFile(
                smtpCapturePath,
                `\n===== ${receivedAt} =====\n${message}`,
              ).catch(() => undefined);
            }
            message = "";
            dataMode = false;
            writeSmtpResponse(socket, "250 2.0.0 queued");
          } else {
            message += `${line}\r\n`;
          }
          continue;
        }

        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) {
          trace.push("RESP:EHLO");
          socket.write("250-qa-auth-http-fixture\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760\r\n");
        } else if (command.startsWith("AUTH")) {
          writeSmtpResponse(socket, "235 2.7.0 Authentication successful");
        } else if (command.startsWith("MAIL FROM") || command.startsWith("RCPT TO")) {
          writeSmtpResponse(socket, "250 2.1.0 accepted");
        } else if (command === "DATA") {
          dataMode = true;
          writeSmtpResponse(socket, "354 End data with <CR><LF>.<CR><LF>");
        } else if (command === "RSET") {
          writeSmtpResponse(socket, "250 2.0.0 reset");
        } else if (command === "QUIT") {
          writeSmtpResponse(socket, "221 2.0.0 bye");
          socket.end();
        } else {
          writeSmtpResponse(socket, "250 2.0.0 ok");
        }
      }
    });
    socket.on("error", () => undefined);
  });
  return new Promise((resolveResult, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveResult(server);
    });
  });
}

function smtpPort(server: NetServer): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SMTP sink did not expose a TCP address");
  return address.port;
}

async function closeServer(server: NetServer | ReturnType<typeof createHttpServer> | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolveResult) => {
    server.close(() => resolveResult());
  }).catch(() => undefined);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function dispatchRoute(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Map<string, RouteModule>,
): Promise<void> {
  const host = request.headers.host ?? `127.0.0.1:${AUTH_HTTP_PORT}`;
  const url = new URL(request.url ?? "/", `http://${host}`);
  const staticModule = routes.get(url.pathname);
  const forceLogout = /^\/api\/admin\/users\/(\d+)\/force-logout$/.exec(url.pathname);
  const module = staticModule ?? (forceLogout ? routes.get("/api/admin/users/:id/force-logout") : undefined);
  const method = request.method?.toUpperCase() ?? "GET";
  const handler = module?.[method as keyof RouteModule];
  if (typeof handler !== "function") {
    response.statusCode = module ? 405 : 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: module ? "Method not allowed" : "Not found" }));
    return;
  }

  const body = await readRequestBody(request);
  const headers = requestHeaders(request);
  const init: RequestInit = {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  };
  const webRequest = new Request(url, init);
  const context = forceLogout
    ? { params: Promise.resolve({ id: forceLogout[1]! }) }
    : undefined;

  try {
    const webResponse = await handler(webRequest, context);
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
    });
    const responseHeaders = webResponse.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const cookies = responseHeaders.getSetCookie?.();
    if (cookies?.length) response.setHeader("set-cookie", cookies);
    else {
      const cookieHeader = webResponse.headers.get("set-cookie");
      if (cookieHeader) response.setHeader("set-cookie", cookieHeader);
    }
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "Fixture route dispatch failed" }));
    // Keep the HTTP contract generic; the server process should not leak
    // credentials or route internals into a test response.
    console.error("[auth-http-fixture] route dispatch failed:", error);
  }
}

async function loadRoutes(): Promise<Map<string, RouteModule>> {
  const routes = new Map<string, RouteModule>();
  routes.set("/api/auth/login", await import("../../app/api/auth/login/route.js") as RouteModule);
  routes.set("/api/auth/verify-2fa", await import("../../app/api/auth/verify-2fa/route.js") as RouteModule);
  routes.set("/api/auth/me", await import("../../app/api/auth/me/route.js") as RouteModule);
  routes.set("/api/auth/logout", await import("../../app/api/auth/logout/route.js") as RouteModule);
  routes.set("/api/admin/users", await import("../../app/api/admin/users/route.js") as RouteModule);
  routes.set("/api/admin/sessions", await import("../../app/api/admin/sessions/route.js") as RouteModule);
  routes.set(
    "/api/admin/users/:id/force-logout",
    await import("../../app/api/admin/users/[id]/force-logout/route.js") as RouteModule,
  );
  routes.set("/api/notifications", await import("../../app/api/notifications/route.js") as RouteModule);
  return routes;
}

export async function startAuthHttpFixture(options: {
  smtpCapturePath?: string;
} = {}): Promise<AuthHttpFixture> {
  const previousEnvironment: FixtureEnvironment = {};
  for (const key of ENVIRONMENT_KEYS) previousEnvironment[key] = process.env[key];
  const previousSensitive: Partial<Record<(typeof SENSITIVE_KEYS)[number], string | undefined>> = {};
  for (const key of SENSITIVE_KEYS) {
    previousSensitive[key] = process.env[key];
    delete process.env[key];
  }
  const processes: RunningProcesses = {
    pgData: "",
    pgSocket: "",
    pgProcess: null,
    redisProcess: null,
    smtpServer: null,
    httpServer: null,
    fixtureRoot: "",
  };
  const emailMessages: CapturedEmail[] = [];
  const smtpTrace: string[] = [];

  try {
    for (const port of [AUTH_HTTP_PORT, AUTH_HTTP_PG_PORT, AUTH_HTTP_REDIS_PORT]) {
      if (await portIsOpen(port)) {
        throw new Error(`Auth HTTP fixture refuses to use an already-listening port ${port}`);
      }
    }

    processes.fixtureRoot = await mkdtemp("/tmp/citefi-auth-http.");
    processes.pgData = join(processes.fixtureRoot, "postgres");
    processes.pgSocket = join(processes.fixtureRoot, "socket");
    // PostgreSQL creates its TCP listener before it creates the Unix-socket
    // lock file. pg_ctl does not create -k's directory for us, so create it
    // explicitly or startup reports a misleading "port not ready" timeout.
    await mkdir(processes.pgSocket, { recursive: true });
    await run("initdb", [
      "-D",
      processes.pgData,
      "-A",
      "trust",
      "-U",
      "qa_auth_http",
      "--no-locale",
      "--encoding=UTF8",
    ], scrubbedEnvironment({}));
    processes.pgProcess = spawn(
      "pg_ctl",
      [
        "-D",
        processes.pgData,
        "-l",
        join(processes.fixtureRoot, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -k ${processes.pgSocket} -p ${AUTH_HTTP_PG_PORT} -c listen_addresses=127.0.0.1`,
        "-w",
        "start",
      ],
      { cwd: ROOT, env: scrubbedEnvironment({}), stdio: "ignore" },
    );
    await once(processes.pgProcess, "spawn");
    await waitForPort(AUTH_HTTP_PG_PORT);

    processes.redisProcess = spawn(
      "redis-server",
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(AUTH_HTTP_REDIS_PORT),
        "--save",
        "",
        "--appendonly",
        "no",
        "--daemonize",
        "no",
      ],
      { cwd: ROOT, env: scrubbedEnvironment({}), stdio: "ignore" },
    );
    await once(processes.redisProcess, "spawn");
    await waitForPort(AUTH_HTTP_REDIS_PORT);
    await run("redis-cli", ["-h", "127.0.0.1", "-p", String(AUTH_HTTP_REDIS_PORT), "ping"], scrubbedEnvironment({}));

    if (options.smtpCapturePath) {
      await mkdir(dirname(options.smtpCapturePath), { recursive: true }).catch(() => undefined);
    }
    const smtp = await startSmtpSink(emailMessages, smtpTrace, options.smtpCapturePath);
    processes.smtpServer = smtp;
    const environment = scrubbedEnvironment({
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_POOLED_URL: TEST_DATABASE_URL,
      NEON_DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      NODE_ENV: "test",
      JWT_SECRET: "qa-auth-http-fixture-jwt-secret",
      SESSION_SECRET: "qa-auth-http-fixture-session-secret",
      CSRF_SECRET: "qa-auth-http-fixture-csrf-secret",
      TOTP_ENCRYPTION_KEY: "qa-auth-http-fixture-totp-key",
      TOTP_ENCRYPTION_KEY_VERSION: "v1",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort(smtp)),
      SMTP_USER: "qa-auth-http",
      SMTP_PASS: "qa-auth-http",
      SMTP_FROM: "QA Auth HTTP <qa-auth-http@citefi.invalid>",
      APP_URL: AUTH_HTTP_BASE_URL,
      NEXT_PUBLIC_APP_URL: AUTH_HTTP_BASE_URL,
    });
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else (process.env as Record<string, string | undefined>)[key] = value;
    }
    await composeSchema(environment);

    const routes = await loadRoutes();
    const httpServer = createHttpServer((request, response) => {
      void dispatchRoute(request, response, routes);
    });
    processes.httpServer = httpServer;
    await new Promise<void>((resolveResult, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(AUTH_HTTP_PORT, "127.0.0.1", () => {
        httpServer.removeListener("error", reject);
        resolveResult();
      });
    });

    const stop = async () => {
      await appendFile(
        join(ROOT, "QA/evidence/auth-http-fixture-last-smtp.log"),
        `${new Date().toISOString()} ${smtpTrace.join(" | ")}\n`,
      ).catch(() => undefined);
      await closeServer(processes.httpServer);
      await closeServer(processes.smtpServer);
      await stopChild(processes.redisProcess);
      if (processes.pgData) {
        await run("pg_ctl", ["-D", processes.pgData, "-m", "fast", "-w", "stop"], scrubbedEnvironment({})).catch(() => undefined);
      }
      await rm(processes.fixtureRoot, { recursive: true, force: true });
      for (const key of ENVIRONMENT_KEYS) {
        const value = previousEnvironment[key];
        if (value === undefined) delete process.env[key];
        else (process.env as Record<string, string | undefined>)[key] = value;
      }
      for (const key of SENSITIVE_KEYS) {
        const value = previousSensitive[key];
        if (value === undefined) delete process.env[key];
        else (process.env as Record<string, string | undefined>)[key] = value;
      }
    };

    const waitForEmail = async (pattern: RegExp, timeoutMs = 5_000): Promise<CapturedEmail> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = emailMessages.find((email) => pattern.test(email.raw));
        if (found) return found;
        await new Promise((resolveResult) => setTimeout(resolveResult, 25));
      }
      throw new Error(`SMTP fixture did not capture an email matching ${pattern}`);
    };

    return {
      baseUrl: AUTH_HTTP_BASE_URL,
      databaseUrl: TEST_DATABASE_URL,
      redisUrl: TEST_REDIS_URL,
      emailMessages,
      smtpCapturePath: options.smtpCapturePath,
      environment: scrubbedEnvironment({ ...process.env }),
      waitForEmail,
      stop,
    };
  } catch (error) {
    await appendFile(
      join(ROOT, "QA/evidence/auth-http-fixture-last-smtp.log"),
      `${new Date().toISOString()} ${smtpTrace.join(" | ")}\n`,
    ).catch(() => undefined);
    // Keep the owned cluster's diagnostic log after teardown. It contains only
    // local PostgreSQL startup/catalog messages and no application credentials.
    if (processes.fixtureRoot && processes.pgData) {
      await copyFile(
        join(processes.fixtureRoot, "postgres.log"),
        join(ROOT, "QA/evidence/auth-http-fixture-last-postgres.log"),
      ).catch(() => undefined);
    }
    await closeServer(processes.httpServer);
    await closeServer(processes.smtpServer);
    await stopChild(processes.redisProcess);
    if (processes.pgData) {
      await run("pg_ctl", ["-D", processes.pgData, "-m", "immediate", "stop"], scrubbedEnvironment({})).catch(() => undefined);
    }
    if (processes.fixtureRoot) await rm(processes.fixtureRoot, { recursive: true, force: true });
    for (const key of ENVIRONMENT_KEYS) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else (process.env as Record<string, string | undefined>)[key] = value;
    }
    for (const key of SENSITIVE_KEYS) {
      const value = previousSensitive[key];
      if (value === undefined) delete process.env[key];
      else (process.env as Record<string, string | undefined>)[key] = value;
    }
    throw error;
  }
}