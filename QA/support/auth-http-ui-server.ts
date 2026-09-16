/**
 * Long-lived isolated Next UI fixture for one manual browser pass.
 *
 * It uses the checked-in app/page code through a private copied project root,
 * but keeps Next's dev output at /tmp/privatefixture/.next rather than
 * touching the app's .next directory or port 5000.
 *
 * The process owns:
 *   - Next UI: 127.0.0.1:5106
 *   - route-handler fixture: 127.0.0.1:5105
 *   - PostgreSQL: 127.0.0.1:55485
 *   - Redis: 127.0.0.1:16385
 *   - loopback-only SMTP capture
 *
 * Stop with SIGINT/SIGTERM. It writes synthetic browser credentials and the
 * captured SMTP path to /tmp/privatefixture/auth-http-ui-credentials.json.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  startAuthHttpFixture,
  type AuthHttpFixture,
} from "./auth-http-fixture.js";
import {
  AUTH_HTTP_UI_PASSWORD,
  cleanupAuthHttpUiUsers,
  seedAuthHttpUiUsers,
  type AuthHttpUiSeed,
} from "./auth-http-ui-seed.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PRIVATE_ROOT = "/tmp/privatefixture";
const UI_PORT = 5106;
const UI_URL = `http://127.0.0.1:${UI_PORT}`;
const OWNER_MARKER = ".auth-http-ui-fixture-owner";
const CREDENTIALS_FILE = join(PRIVATE_ROOT, "auth-http-ui-credentials.json");
const SMTP_CAPTURE_FILE = join(PRIVATE_ROOT, "smtp-capture.eml");
const NEXT_LOG_FILE = join(PRIVATE_ROOT, "next-dev.log");
const execFileAsync = promisify(execFile);

const networkDenyPreload = String.raw`"use strict";
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");

const allowedHost = (host) => {
  const normalized = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "fonts.googleapis.com" ||
    normalized === "fonts.gstatic.com";
};
const hostFrom = (options) => {
  if (typeof options === "string") {
    try { return new URL(options).hostname; } catch { return ""; }
  }
  if (options && typeof options === "object") {
    if (options.hostname) return options.hostname;
    if (options.host) return String(options.host).split(":")[0];
    if (options.servername) return options.servername;
  }
  return "";
};
const deny = (kind, options) => {
  const host = hostFrom(options);
  if (!allowedHost(host)) {
    throw new Error("AUTH_HTTP_UI_NETWORK_DENIED " + kind + " " + host);
  }
};

for (const name of ["connect", "createConnection"]) {
  const original = net[name];
  net[name] = function (options, ...rest) {
    deny("net", options);
    return original.call(this, options, ...rest);
  };
}
for (const [mod, name] of [[http, "request"], [https, "request"]]) {
  const original = mod[name];
  mod[name] = function (options, ...rest) {
    deny("http", options);
    return original.call(this, options, ...rest);
  };
}
const originalTls = tls.connect;
tls.connect = function (options, ...rest) {
  deny("tls", options);
  return originalTls.call(this, options, ...rest);
};
const originalFetch = globalThis.fetch;
if (originalFetch) {
  globalThis.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!allowedHost(url.hostname)) {
      throw new Error("AUTH_HTTP_UI_NETWORK_DENIED fetch " + url.hostname);
    }
    return originalFetch.call(this, input, init);
  };
}
`;

type UiCredentials = {
  uiUrl: string;
  routeFixtureUrl: string;
  admin: { email: string; password: string };
  member: { email: string; password: string };
  mfaMember: { email: string; password: string };
  smtpCapturePath: string;
  smtpReadCommand: string;
  networkPolicy: string;
};

async function preparePrivateProject(): Promise<void> {
  await mkdir(PRIVATE_ROOT, { recursive: true });
  await writeFile(join(PRIVATE_ROOT, OWNER_MARKER), "owned by auth-http-ui-server\n");
  const directories = [
    "app",
    "components",
    "hooks",
    "lib",
    "public",
    "shared",
    "types",
    "node_modules",
  ];
  for (const name of directories) {
    // Copy the source trees rather than symlinking them. Turbopack rejects
    // project-root symlinks that resolve outside its filesystem root; this
    // keeps the private project self-contained without touching app .next.
    await execFileAsync("cp", ["-a", join(ROOT, name), join(PRIVATE_ROOT, name)]);
  }
  // Turbopack rejects package metadata symlinks that resolve outside its
  // project root, so copy the small root files as well.
  await copyFile(join(ROOT, "package.json"), join(PRIVATE_ROOT, "package.json"));
  for (const name of ["package-lock.json", "postcss.config.js", "tailwind.config.ts", "proxy.ts"]) {
    await copyFile(join(ROOT, name), join(PRIVATE_ROOT, name));
  }
  await copyFile(join(ROOT, "next-env.d.ts"), join(PRIVATE_ROOT, "next-env.d.ts"));
  await copyFile(join(ROOT, "tsconfig.json"), join(PRIVATE_ROOT, "tsconfig.json"));
  await writeFile(
    join(PRIVATE_ROOT, "next.config.mjs"),
    `import baseConfig from ${JSON.stringify(join(ROOT, "next.config.mjs"))};\n\n` +
      `export default { ...baseConfig, distDir: ".next" };\n`,
  );
  await writeFile(
    join(PRIVATE_ROOT, ".env.local"),
    [
      "NODE_ENV=development",
      "NEXT_TELEMETRY_DISABLED=1",
      "DISABLE_WORKERS=true",
      "GOOGLE_DRIVE_ENABLED=false",
      `APP_URL=${UI_URL}`,
      `NEXT_PUBLIC_APP_URL=${UI_URL}`,
      "",
    ].join("\n"),
  );
  await writeFile(join(PRIVATE_ROOT, "network-deny.cjs"), networkDenyPreload);
}

async function waitForUi(nextProcess: ChildProcess, nextLog: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastStatus = "not contacted";
  while (Date.now() < deadline) {
    if (nextProcess.exitCode !== null) {
      const log = await readFile(nextLog, "utf8").catch(() => "");
      throw new Error(`isolated Next UI exited (${nextProcess.exitCode}) before readiness:\n${log.slice(-8_000)}`);
    }
    try {
      const response = await fetch(`${UI_URL}/login`, { redirect: "manual" });
      lastStatus = String(response.status);
      const body = await response.text();
      if (response.status === 200 && body.includes("Welcome Back")) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 500));
  }
  const log = await readFile(nextLog, "utf8").catch(() => "");
  throw new Error(`isolated Next UI did not render /login (last=${lastStatus}):\n${log.slice(-8_000)}`);
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveResult) => setTimeout(resolveResult, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function run(): Promise<void> {
  let fixture: AuthHttpFixture | undefined;
  let seed: AuthHttpUiSeed | undefined;
  let db: typeof import("../../lib/db.js") | undefined;
  let nextProcess: ChildProcess | null = null;
  let nextLogStream: WriteStream | undefined;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopProcess(nextProcess);
    nextLogStream?.end();
    if (seed) await cleanupAuthHttpUiUsers(seed).catch(() => undefined);
    await db?.closeDb().catch(() => undefined);
    await fixture?.stop().catch(() => undefined);
    await rm(PRIVATE_ROOT, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await rm(PRIVATE_ROOT, { recursive: true, force: true });
    await preparePrivateProject();
    fixture = await startAuthHttpFixture({ smtpCapturePath: SMTP_CAPTURE_FILE });
    db = await import("../../lib/db.js");
    seed = await seedAuthHttpUiUsers();
    const environment: NodeJS.ProcessEnv = {
      ...fixture.environment,
      NODE_ENV: "development",
      PORT: String(UI_PORT),
      HOSTNAME: "127.0.0.1",
      APP_URL: UI_URL,
      NEXT_PUBLIC_APP_URL: UI_URL,
      NEXTAUTH_URL: UI_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      DISABLE_WORKERS: "true",
      GOOGLE_DRIVE_ENABLED: "false",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "*",
      NODE_OPTIONS: `--require=${join(PRIVATE_ROOT, "network-deny.cjs")}`,
    };
    await writeFile(
      join(PRIVATE_ROOT, ".env.local"),
      Object.entries({
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
        DISABLE_WORKERS: "true",
        GOOGLE_DRIVE_ENABLED: "false",
        DATABASE_URL: environment.DATABASE_URL,
        DATABASE_POOLED_URL: environment.DATABASE_POOLED_URL,
        REDIS_URL: environment.REDIS_URL,
        JWT_SECRET: environment.JWT_SECRET,
        SESSION_SECRET: environment.SESSION_SECRET,
        CSRF_SECRET: environment.CSRF_SECRET,
        TOTP_ENCRYPTION_KEY: environment.TOTP_ENCRYPTION_KEY,
        TOTP_ENCRYPTION_KEY_VERSION: environment.TOTP_ENCRYPTION_KEY_VERSION,
        SMTP_HOST: environment.SMTP_HOST,
        SMTP_PORT: environment.SMTP_PORT,
        SMTP_USER: environment.SMTP_USER,
        SMTP_PASS: environment.SMTP_PASS,
        SMTP_FROM: environment.SMTP_FROM,
        APP_URL: UI_URL,
        NEXT_PUBLIC_APP_URL: UI_URL,
        NEXTAUTH_URL: UI_URL,
      }).map(([key, value]) => `${key}=${value ?? ""}`).join("\n") + "\n",
    );
    const credentials: UiCredentials = {
      uiUrl: UI_URL,
      routeFixtureUrl: fixture.baseUrl,
      admin: { email: seed.admin.email, password: AUTH_HTTP_UI_PASSWORD },
      member: { email: seed.member.email, password: AUTH_HTTP_UI_PASSWORD },
      mfaMember: { email: seed.mfaMember.email, password: AUTH_HTTP_UI_PASSWORD },
      smtpCapturePath: SMTP_CAPTURE_FILE,
      smtpReadCommand: `tail -f ${SMTP_CAPTURE_FILE}`,
      networkPolicy: "loopback plus Google Fonts only; all provider/customer hosts denied",
    };
    await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
    await chmod(CREDENTIALS_FILE, 0o600);

    nextLogStream = createWriteStream(NEXT_LOG_FILE, { flags: "a" });
    nextLogStream.write(`\n===== ${new Date().toISOString()} Next UI start =====\n`);
    const child = spawn(
      process.execPath,
      [join(ROOT, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(UI_PORT)],
      { cwd: PRIVATE_ROOT, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    nextProcess = child;
    child.stdout?.pipe(nextLogStream);
    child.stderr?.pipe(nextLogStream);
    await once(child, "spawn");
    await waitForUi(child, NEXT_LOG_FILE);
    console.log(`AUTH_HTTP_UI_READY ${UI_URL}`);
    console.log(`AUTH_HTTP_UI_CREDENTIALS ${CREDENTIALS_FILE}`);
    console.log(`AUTH_HTTP_UI_SMTP_CAPTURE ${SMTP_CAPTURE_FILE}`);
    await new Promise<void>((resolveResult) => {
      process.once("SIGINT", () => void shutdown().then(() => resolveResult()));
      process.once("SIGTERM", () => void shutdown().then(() => resolveResult()));
    });
  } catch (error) {
    await shutdown();
    throw error;
  }
}

await run();