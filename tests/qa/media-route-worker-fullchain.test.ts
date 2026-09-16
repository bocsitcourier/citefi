/**
 * Route -> Redis queue -> exported worker acceptance for rows 9, 10, 15, 16
 * and 17.
 *
 * This file owns its PostgreSQL and Redis processes. Provider calls are
 * low-level fixture transports passed through the optional seams; route
 * authorization, credit reservation/debit, queue enqueue, worker persistence,
 * object storage, and receipt/accounting checkpoints remain production code.
 *
 * Run with:
 *   node --import tsx/esm --test tests/qa/media-route-worker-fullchain.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import test from "node:test";
import { NextRequest } from "next/server";
import ffmpegPath from "ffmpeg-static";
import { desc, eq } from "drizzle-orm";
import { Pool } from "pg";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PG_PORT = 55488;
const REDIS_PORT = 16388;
const DATABASE_URL = `postgresql://qa_media_acceptance@127.0.0.1:${PG_PORT}/postgres`;
const REDIS_URL = `redis://127.0.0.1:${REDIS_PORT}/0`;

type StoredObject = {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
};

class FixtureObjectStore {
  readonly objects = new Map<string, StoredObject>();

  bucket() {
    return {
      file: (key: string) => {
        const normalized = key.replace(/^\/+/, "");
        return {
          save: async (
            body: Buffer,
            options?: { contentType?: string; metadata?: Record<string, string> },
          ) => {
            this.objects.set(normalized, {
              body: Buffer.from(body),
              contentType: options?.contentType ?? "application/octet-stream",
              metadata: options?.metadata ?? {},
            });
          },
          download: async () => {
            const object = this.objects.get(normalized);
            if (!object) throw Object.assign(new Error("NoSuchKey"), { code: 404 });
            return [Buffer.from(object.body)];
          },
          getMetadata: async () => {
            const object = this.objects.get(normalized);
            if (!object) throw Object.assign(new Error("NoSuchKey"), { code: 404 });
            return [{
              contentType: object.contentType,
              size: object.body.length,
              md5Hash: createHash("md5").update(object.body).digest("hex"),
            }];
          },
          createReadStream: () => {
            const object = this.objects.get(normalized);
            return Readable.from(object?.body ?? []);
          },
        };
      },
    };
  }
}

async function waitForRedis(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await execFileAsync("redis-cli", ["-h", "127.0.0.1", "-p", String(port), "ping"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw new Error(`media acceptance fixture port ${port} did not become ready`);
}

async function waitForPostgres(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await execFileAsync("pg_isready", ["-h", "127.0.0.1", "-p", String(port)]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw new Error(`media acceptance PostgreSQL port ${port} did not become ready`);
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback();
    };
    socket.once("connect", () => finish(() => reject(
      new Error(`media acceptance refuses occupied owned port ${port}`),
    )));
    socket.once("error", () => finish(resolve));
    socket.setTimeout(400, () => finish(resolve));
    socket.connect(port, "127.0.0.1");
  });
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return execFileAsync(command, args, { cwd: ROOT, env, maxBuffer: 64 * 1024 * 1024 });
}

function patchExportedSchema(ddl: string): string {
  const prerequisites = `
DO $qa_media_fixture$
BEGIN
  IF to_regclass('public.agency_client_reports') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_agency_client_reports_fk_key') THEN
    ALTER TABLE agency_client_reports ADD CONSTRAINT qa_agency_client_reports_fk_key
      UNIQUE (id, agency_team_id, client_team_id);
  END IF;
  IF to_regclass('public.campaigns') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_campaigns_fk_key') THEN
    ALTER TABLE campaigns ADD CONSTRAINT qa_campaigns_fk_key UNIQUE (team_id, id);
  END IF;
  IF to_regclass('public.campaign_ads') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_campaign_ads_fk_key') THEN
    ALTER TABLE campaign_ads ADD CONSTRAINT qa_campaign_ads_fk_key UNIQUE (team_id, id);
  END IF;
END
$qa_media_fixture$;
`;
  const firstAlter = ddl.search(/^ALTER TABLE .* ADD CONSTRAINT /m);
  const staged = firstAlter >= 0
    ? `${ddl.slice(0, firstAlter)}${prerequisites}${ddl.slice(firstAlter)}`
    : ddl;
  return staged.replace(
    /^CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx".*$/m,
    'CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx" ON "telemetry_ai_requests" USING btree ("admin_user_id","incident_id","created_at" DESC);',
  );
}

async function applyCanonicalSecurityBootstrap(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const scriptEnvironment = {
    ...environment,
    WORKER_PROCESS: "true",
  };
  const runScript = async (
    script: string,
    extraEnvironment: NodeJS.ProcessEnv = scriptEnvironment,
  ) => {
    await runCommand(
      "node",
      ["--import", "tsx/esm", join(ROOT, "scripts", script)],
      extraEnvironment,
    );
  };
  const runMigration = async (migration: string) => {
    await runCommand(
      "psql",
      [
        "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(PG_PORT),
        "-U", "qa_media_acceptance", "-d", "postgres",
        "-f", join(ROOT, "migrations", migration),
      ],
      environment,
    );
  };

  // Use the canonical owner-controlled sequence. Never replace this with a
  // tenant bypass or broad GRANT: route/worker queries must prove the same
  // role, grant, and forced-RLS contract as production.
  await runScript("apply-tenant-rls.ts");
  await runScript("migrate-t151-campaigns.ts");
  await runMigration("0016_campaign_ads.sql");
  await runMigration("0017_provider_usage_ledger.sql");
  await runScript("migrate-t154-agency-reports.ts");
  await runScript("run-versioned-migrations.ts", {
    ...scriptEnvironment,
    MIGRATION_START_VERSION: "0020",
  });
}

async function assertExportedSchemaCatalog(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const result = await pool.query<{ index_name: string | null; index_def: string | null }>(`
      SELECT
        to_regclass('public.telemetry_ai_requests_admin_incident_created_idx')::text AS index_name,
        pg_get_indexdef('public.telemetry_ai_requests_admin_incident_created_idx'::regclass) AS index_def
    `);
    const catalog = result.rows[0];
    const indexDefinition = catalog?.index_def?.replace(/\s+/g, " ").toLowerCase() ?? "";
    if (
      catalog?.index_name !== "telemetry_ai_requests_admin_incident_created_idx" ||
      !indexDefinition.includes("admin_user_id") ||
      !indexDefinition.includes("incident_id") ||
      !indexDefinition.includes("created_at desc")
    ) {
      throw new Error(
        "Media full-chain source-schema catalog index is not the canonical DESC definition: " +
        JSON.stringify(catalog ?? null),
      );
    }
  } finally {
    await pool.end();
  }
}

async function assertCanonicalSecurityBootstrap(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const result = await pool.query<{
      login_can_set_tenant: boolean;
      public_usage: boolean;
      rls_usage: boolean;
      articles_dml: boolean;
      batches_update: boolean;
      reservations_dml: boolean;
      receipts_insert: boolean;
      batches_rls: boolean;
      receipts_rls: boolean;
    }>(`
      SELECT
        pg_has_role(current_user, 'citefi_tenant', 'member') AS login_can_set_tenant,
        has_schema_privilege('citefi_tenant', 'public', 'USAGE') AS public_usage,
        has_schema_privilege('citefi_tenant', 'citefi_rls', 'USAGE') AS rls_usage,
        has_table_privilege('citefi_tenant', 'public.articles', 'SELECT,INSERT,UPDATE,DELETE') AS articles_dml,
        has_table_privilege('citefi_tenant', 'public.job_batches', 'UPDATE') AS batches_update,
        has_table_privilege('citefi_tenant', 'public.credit_reservations', 'INSERT,UPDATE,DELETE') AS reservations_dml,
        has_table_privilege('citefi_tenant', 'public.provider_attempt_receipts', 'INSERT') AS receipts_insert,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class WHERE oid = 'public.job_batches'::regclass) AS batches_rls,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class WHERE oid = 'public.provider_attempt_receipts'::regclass) AS receipts_rls
    `);
    const checks = result.rows[0];
    if (
      !checks ||
      !checks.login_can_set_tenant ||
      !checks.public_usage ||
      !checks.rls_usage ||
      !checks.articles_dml ||
      !checks.batches_update ||
      !checks.reservations_dml ||
      !checks.receipts_insert ||
      !checks.batches_rls ||
      !checks.receipts_rls
    ) {
      throw new Error(
        "Media full-chain fixture canonical tenant bootstrap is incomplete: " +
        JSON.stringify(checks ?? null),
      );
    }
  } finally {
    await pool.end();
  }
}

function installOwnedNetworkGuard(): () => void {
  const originalSocketConnect = (Socket.prototype as any).connect;
  const originalFetch = globalThis.fetch;
  const isLoopback = (host: unknown): boolean => {
    const normalized = String(host ?? "").replace(/^\[|\]$/g, "").toLowerCase();
    return normalized === "" ||
      normalized === "127.0.0.1" ||
      normalized === "localhost" ||
      normalized === "::1";
  };
  const hostFromConnectArgs = (args: any[]): unknown => {
    const first = args[0];
    if (typeof first === "string") {
      return first.startsWith("/") ? "" : first;
    }
    if (first && typeof first === "object") return first.host;
    return "";
  };

  (Socket.prototype as any).connect = function (...args: any[]) {
    const host = hostFromConnectArgs(args);
    if (!isLoopback(host)) {
      throw new Error(`owned media acceptance network guard blocked external TCP host ${String(host)}`);
    }
    return originalSocketConnect.apply(this, args);
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://127.0.0.1",
    );
    if (!isLoopback(url.hostname)) {
      throw new Error(`owned media acceptance network guard blocked external fetch host ${url.hostname}`);
    }
    if (!originalFetch) throw new Error("owned media acceptance fetch is unavailable");
    return originalFetch(input, init);
  };
  return () => {
    (Socket.prototype as any).connect = originalSocketConnect;
    globalThis.fetch = originalFetch;
  };
}

async function startOwnedInfrastructure(): Promise<{
  root: string;
  pg: ChildProcess;
  redis: ChildProcess;
  environment: NodeJS.ProcessEnv;
}> {
  await assertPortAvailable(PG_PORT);
  await assertPortAvailable(REDIS_PORT);
  const root = await mkdtemp(join(tmpdir(), "media-route-worker-"));
  const pgData = join(root, "postgres");
  const socket = join(root, "socket");
  await mkdir(socket, { recursive: true });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL,
    DATABASE_POOLED_URL: DATABASE_URL,
    NEON_DATABASE_URL: DATABASE_URL,
    REDIS_URL,
    NODE_ENV: "test",
    JWT_SECRET: "qa-media-acceptance-jwt-secret",
    SESSION_SECRET: "qa-media-acceptance-session-secret",
    CSRF_SECRET: "qa-media-acceptance-csrf-secret",
    MEDIA_FEATURES_ENABLED: "true",
    WORKER_PROCESS: "true",
    // These values only make the storage policy pass. The client is replaced
    // below with FixtureObjectStore; no network-capable credential is used.
    DO_SPACES_KEY: "fixture-key",
    DO_SPACES_SECRET: "fixture-secret",
    DO_SPACES_ENDPOINT: "http://127.0.0.1:1",
    DO_SPACES_BUCKET: "fixture-bucket",
    DEFAULT_OBJECT_STORAGE_BUCKET_ID: "fixture-bucket",
    GEMINI_API_KEY: "fixture-no-network",
    OPENAI_API_KEY: "fixture-no-network",
  };
  await runCommand("initdb", [
    "-D", pgData, "-A", "trust", "-U", "qa_media_acceptance",
    "--no-locale", "--encoding=UTF8",
  ], environment);
  const pg = spawn("pg_ctl", [
    "-D", pgData, "-l", join(root, "postgres.log"),
    "-o", `-h 127.0.0.1 -k ${socket} -p ${PG_PORT} -c listen_addresses=127.0.0.1`,
    "-w", "start",
  ], { cwd: ROOT, env: environment, stdio: "ignore" });
  await once(pg, "spawn");
  await waitForPostgres(PG_PORT);

  const redis = spawn("redis-server", [
    "--bind", "127.0.0.1", "--port", String(REDIS_PORT),
    "--save", "", "--appendonly", "no", "--daemonize", "no",
  ], { cwd: ROOT, env: environment, stdio: "ignore" });
  await once(redis, "spawn");
  await waitForRedis(REDIS_PORT);

  await runCommand("psql", [
    "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(PG_PORT),
    "-U", "qa_media_acceptance", "-d", "postgres",
    "-c", "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE ROLE citefi_tenant NOLOGIN;",
  ], environment).catch((error: unknown) => {
    if (!String(error).includes("already exists")) throw error;
  });
  return { root, pg, redis, environment };
}

async function composeSchema(environment: NodeJS.ProcessEnv): Promise<void> {
  const { stdout: ddl } = await runCommand(
    join(ROOT, "node_modules/.bin/drizzle-kit"),
    ["export", "--dialect", "postgresql", "--schema", join(ROOT, "shared/schema.ts"), "--sql"],
    environment,
  );
  const patched = patchExportedSchema(ddl);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("psql", [
      "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(PG_PORT),
      "-U", "qa_media_acceptance", "-d", "postgres",
    ], { cwd: ROOT, env: environment, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`media acceptance schema composition failed (${code}): ${stderr}`)));
    child.stdin?.end(patched);
  });
}

async function stopOwnedInfrastructure(fixture: Awaited<ReturnType<typeof startOwnedInfrastructure>>) {
  for (const child of [fixture.redis, fixture.pg]) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => undefined);
    }
  }
  await rm(fixture.root, { recursive: true, force: true });
}

// Infrastructure and production modules are deliberately loaded only after
// the owned ports/environment exist; lib/db and lib/storage capture these at
// module initialization.
const owned = await startOwnedInfrastructure();
let receiptSpoolRoot: string | undefined;
let restoreNetworkGuard: (() => void) | undefined;
let closeImageTransport: (() => void) | undefined;
let closeProductionQueues: (() => Promise<void>) | undefined;
let closeProductionDb: (() => Promise<void>) | undefined;
test.after(async () => {
  closeImageTransport?.();
  // BullMQ owns the process Redis client. Close queues and that client while
  // owned Redis is still alive; stopping Redis first leaves ioredis retry
  // timers and can keep node:test alive past its timeout.
  await closeProductionQueues?.();
  await closeProductionDb?.();
  await stopOwnedInfrastructure(owned);
  // Keep the external-network guard active through all production-client and
  // owned-infrastructure teardown.
  restoreNetworkGuard?.();
  if (receiptSpoolRoot) {
    await rm(receiptSpoolRoot, { recursive: true, force: true });
  }
});
await composeSchema(owned.environment);
await assertExportedSchemaCatalog();
await applyCanonicalSecurityBootstrap(owned.environment);
await assertCanonicalSecurityBootstrap();
for (const [key, value] of Object.entries(owned.environment)) {
  if (value !== undefined) process.env[key] = value;
}
receiptSpoolRoot = await mkdtemp(join(tmpdir(), "media-route-receipts-"));
process.env.PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR = receiptSpoolRoot;
restoreNetworkGuard = installOwnedNetworkGuard();

const { db, systemDb, closeDb } = await import("../../lib/db");
closeProductionDb = closeDb;
const schema = await import("../../shared/schema");
const { generateAccessToken, hashToken } = await import("../../lib/auth");
const { runWithAuthenticatedTeamContext } = await import("../../lib/api/auth");
const { processVideoIdeaGenerationJob } = await import("../../workers/video-idea-worker");
const { generateArticlePodcast } = await import("../../lib/podcast-worker");
const { generateVideoFromScript } = await import("../../lib/veo-social-video-generator");
const { setSingleImageProviderTransportForTests } = await import("../../lib/gemini-image-generator");
const { executePaidMediaBoundary } = await import("../../lib/media-provider-boundary");
const {
  serializeProviderAttemptReceiptSpoolRecord,
  validateProviderAttemptReceiptSpoolRecord,
} = await import("../../lib/provider-attempt-receipts");
const { createProviderAttemptObjectSpool } = await import("../../lib/provider-attempt-object-spool");
const { closeQueues } = await import("../../lib/queue");
closeProductionQueues = closeQueues;
const storage = await import("../../lib/storage");
const fixtureStorage = new FixtureObjectStore();
(storage.objectStorageClient as any).bucket = () => fixtureStorage.bucket();

function filesystemReceiptSpool() {
  return createProviderAttemptObjectSpool({
    serialize: serializeProviderAttemptReceiptSpoolRecord,
    parse: validateProviderAttemptReceiptSpoolRecord,
    bucketName: "owned-media-route-receipts",
    storage: {
      bucket: () => ({
        file: (key: string) => {
          const path = join(receiptSpoolRoot!, key);
          return {
            save: async (body: Buffer) => {
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, body);
            },
            createReadStream: () => createReadStream(path),
            delete: async () => {
              await rm(path, { force: true });
            },
          };
        },
      }),
    },
  });
}

const userId = 811;
const teamId = 810;
const wrongUserId = 812;
const wrongTeamId = 817;
const token = generateAccessToken({ userId, email: "media-qa@example.invalid", role: "team_member" });
const wrongTenantToken = generateAccessToken({
  userId: wrongUserId,
  email: "media-wrong-tenant@example.invalid",
  role: "team_member",
});
const authHeaders = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const wrongTenantHeaders = {
  authorization: `Bearer ${wrongTenantToken}`,
  "content-type": "application/json",
};

await systemDb.insert(schema.users).values({
  id: userId,
  email: "media-qa@example.invalid",
  role: "team_member",
  accountStatus: "active",
});
await systemDb.insert(schema.teams).values({
  id: teamId,
  name: "Media Acceptance Fixture",
  createdBy: userId,
  billingPlan: "paid",
  billingStatus: "active",
});
await systemDb.update(schema.users)
  .set({ defaultTeamId: teamId })
  .where(eq(schema.users.id, userId));
await systemDb.insert(schema.teamMembers).values({ teamId, userId, role: "member" });
await systemDb.insert(schema.sessions).values({
  userId,
  tokenHash: hashToken(token),
  isActive: 1,
  expiresAt: new Date(Date.now() + 86_400_000),
  teamContextId: teamId,
});
await systemDb.insert(schema.creditBalances).values({
  teamId,
  balance: 500,
  allowanceCredits: 500,
});
await systemDb.insert(schema.users).values({
  id: wrongUserId,
  email: "media-wrong-tenant@example.invalid",
  role: "team_member",
  accountStatus: "active",
});
await systemDb.insert(schema.teams).values({
  id: wrongTeamId,
  name: "Media Acceptance Wrong Tenant",
  createdBy: wrongUserId,
  billingPlan: "paid",
  billingStatus: "active",
});
await systemDb.update(schema.users)
  .set({ defaultTeamId: wrongTeamId })
  .where(eq(schema.users.id, wrongUserId));
await systemDb.insert(schema.teamMembers).values({
  teamId: wrongTeamId,
  userId: wrongUserId,
  role: "member",
});
await systemDb.insert(schema.sessions).values({
  userId: wrongUserId,
  tokenHash: hashToken(wrongTenantToken),
  isActive: 1,
  expiresAt: new Date(Date.now() + 86_400_000),
  teamContextId: wrongTeamId,
});
await systemDb.insert(schema.creditBalances).values({
  teamId: wrongTeamId,
  balance: 500,
  allowanceCredits: 500,
});

const batchId = 809;
const articleId = 810;
await systemDb.insert(schema.jobBatches).values({
  id: batchId,
  userId,
  teamId,
  coreTopic: "Fixture media acceptance",
  targetUrl: "https://fixture.example.invalid",
  numArticlesRequested: 1,
  businessName: "Fixture Media Co",
  status: "COMPLETE",
});
await systemDb.insert(schema.articles).values({
  id: articleId,
  batchId,
  teamId,
  articleStatus: "COMPLETE",
  chosenTitle: "Fixture article",
  finalHtmlContent: '<figure><img src="/api/public-objects/public/fixture.png"><figcaption>remove this caption</figcaption></figure>',
  heroImageUrl: "/api/public-objects/public/fixture.png",
});
const [asset] = await systemDb.insert(schema.articleAssets).values({
  id: 811,
  articleId,
  teamId,
  storageUrl: "/api/public-objects/public/fixture.png",
  assetType: "image",
  fileFormat: "png",
}).returning();

const ideaId = 815;
const likeIdeaId = 816;
await systemDb.insert(schema.videoIdeas).values([
  {
    id: ideaId, userId, teamId, ideaTitle: "Fixture idea video",
    shortIdea: "A local fixture video", companyName: "Fixture Media Co",
    callToAction: "Get started", style: "cinematic", tone: "professional",
    status: "DRAFT", isLikeVideo: false,
  },
  {
    id: likeIdeaId, userId, teamId, ideaTitle: "Fixture like video",
    shortIdea: "A reference-led fixture video", companyName: "Fixture Media Co",
    callToAction: "Get started", style: "cinematic", tone: "professional",
    status: "DRAFT", isLikeVideo: true, stylePrompt: "Match the reference pacing",
    referenceVideoUrl: "/api/public-objects/public/reference.mp4",
  },
]);

let imageProviderSubmitCount = 0;
closeImageTransport = setSingleImageProviderTransportForTests({
  generateContent: async () => {
    imageProviderSubmitCount += 1;
    return {
      responseId: "fixture-image-route",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 16,
        totalTokenCount: 28,
      },
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              data: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                "base64",
              ).toString("base64"),
            },
          }],
        },
      }],
    };
  },
});

async function fixtureMp3(seconds: number): Promise<Buffer> {
  assert.ok(ffmpegPath);
  const root = await mkdtemp(join(tmpdir(), "media-qa-mp3-"));
  const output = join(root, "fixture.mp3");
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "libmp3lame",
      "-b:a", "32k", output,
    ]);
    return readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function fixtureMp4(): Promise<Buffer> {
  assert.ok(ffmpegPath);
  const root = await mkdtemp(join(tmpdir(), "media-qa-mp4-"));
  const output = join(root, "fixture.mp4");
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "color=c=blue:s=320x180:d=6", "-c:v", "libx264",
      "-pix_fmt", "yuv420p", output,
    ]);
    return readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const fixtureVideoBytes = await fixtureMp4();
const fixtureAudioBytes = await fixtureMp3(60);
const videoProvider = {
  submitCount: 0,
  pollCount: 0,
  downloadCount: 0,
  accountedReceipts: 0,
};
const podcastProvider = { submitCount: 0, accountedReceipts: 0 };
let fixtureReceiptSequence = 0;

async function runFixtureProviderReceipt(
  mediaKind: "audio" | "video",
  resourceType: string,
  resourceId: number,
  bytes: Buffer,
  counter: { accountedReceipts: number } = videoProvider,
): Promise<void> {
  const sequence = ++fixtureReceiptSequence;
  const providerRequestId = `fixture-${mediaKind}-${resourceId}-${sequence}`;
  const model = mediaKind === "video"
    ? "veo-3.1-generate-preview"
    : "gemini-2.5-flash";
  await executePaidMediaBoundary({
    mediaKind,
    submit: async () => ({
      id: providerRequestId,
      bytes: Buffer.from(bytes),
      usage: { unitType: "seconds" as const, unitCount: mediaKind === "video" ? 6 : 60 },
    }),
    persist: async () => `/api/public-objects/${providerRequestId}`,
    providerRequestId: (value) => value.id,
    receipt: {
      context: {
        teamId,
        operationType: mediaKind === "video" ? "veo_clip" : "podcast_tts",
        provider: "gemini" as const,
        model,
        resourceType,
        resourceId,
        attemptKey: `media-acceptance:${mediaKind}:${resourceType}:${resourceId}:${sequence}`,
        attempt: 1,
      },
      request: {
        model,
        timeoutMs: 30_000,
        adapterVersion: "media-route-worker-fixture-v1",
      },
      _deps: {
        spool: filesystemReceiptSpool(),
      },
      captureResponse: async (value) => ({
        providerRequestId: value.id,
        usage: {
          unitType: value.usage.unitType,
          unitCount: value.usage.unitCount,
          known: true,
        },
        metadata: { providerRequestId: value.id },
      }),
    },
  });
  const [receipt] = await db.select().from(schema.providerAttemptReceipts)
    .where(eq(schema.providerAttemptReceipts.providerRequestId, providerRequestId))
    .orderBy(desc(schema.providerAttemptReceipts.id)).limit(1);
  assert.equal(receipt?.status, "accounted");
  counter.accountedReceipts += 1;
}

const fixtureExpand = async () => ({
  overallNarrative: "A concise fixture narrative",
  hook: "A fixture hook",
  problem: "A fixture problem",
  solution: "A fixture solution",
  benefits: ["Reliable local output"],
  proof: "A durable local fixture",
  cta: "Get started",
});
const fixtureScript = async (input: any) => ({
  title: input.ideaTitle,
  totalDuration: 12,
  companyName: input.companyName,
  location: input.location ?? "Fixture City",
  clips: [1, 2].map((sceneNumber) => ({
    sceneNumber,
    targetDuration: 6,
    prompt: `Fixture scene ${sceneNumber}`,
    narration: `Fixture narration for scene ${sceneNumber}.`,
  })),
});
const fixtureIdeaVideo = async (request: any) => {
  const result = await generateVideoFromScript({
    ...request,
    _deps: {
      generateTTS: async () => {
        videoProvider.submitCount += 1;
        videoProvider.pollCount += 1;
        videoProvider.downloadCount += 1;
        await runFixtureProviderReceipt("audio", "video_idea", ideaId, fixtureAudioBytes);
        const root = await mkdtemp(join(tmpdir(), "media-qa-idea-audio-"));
        const path = join(root, "fixture.mp3");
        await writeFile(path, fixtureAudioBytes.subarray(0));
        return { audioUrl: "/api/public-objects/fixture-idea.mp3", localPath: path, duration: 6, voice: "fixture" };
      },
      generateClip: async (clip: any) => {
        videoProvider.submitCount += 1;
        videoProvider.pollCount += 1;
        videoProvider.downloadCount += 1;
        await runFixtureProviderReceipt("video", "video_idea", ideaId, fixtureVideoBytes);
        const root = await mkdtemp(join(tmpdir(), "media-qa-idea-video-"));
        const path = join(root, `scene-${clip.sceneNumber}.mp4`);
        await writeFile(path, fixtureVideoBytes);
        return { sceneNumber: clip.sceneNumber, prompt: clip.prompt, targetDuration: 6, localPath: path };
      },
      upload: async (path: string, id: number) => {
        const body = await readFile(path);
        await fixtureStorage.bucket().file(`public/video-ideas/${id}.mp4`).save(body, { contentType: "video/mp4" });
        return `/api/public-objects/video-ideas/${id}.mp4`;
      },
      cleanup: async () => undefined,
    },
  });
  return result;
};

const videoIdeaDependencies = {
  isStorageConfigured: true,
  assertRunBudget: async () => undefined,
  orchestrationDependencies: {
    expandVideoIdea: fixtureExpand,
    generateIdeaVideoScript: fixtureScript,
    generateVideoFromScript: fixtureIdeaVideo,
    getPromptEnhancement: async () => ({
      systemPromptAdditions: [],
      userPromptAdditions: [],
      suggestedParameters: {},
      patternsUsed: [],
      variantArmId: undefined,
    }),
    runGenerationOrchestrator: (async (input: any) => ({
      content: input.content, repairs: 0, orchestrated: false, qualityScore: 75,
      armId: undefined, patternsInjected: [], status: "ready",
      review: {},
    })) as any,
    recordContentGenerated: async () => 0,
  },
  notifyVideoComplete: async () => undefined,
  notifyVideoFailed: async () => undefined,
  debitReservation: undefined,
};

test("row 9: owned authenticated repair route persists production DB output", async () => {
  const { POST } = await import("../../app/api/batches/[id]/fix-image-captions/route");
  const response = await POST(
    new NextRequest("http://127.0.0.1/api/batches/809/fix-image-captions", {
      method: "POST", headers: authHeaders,
    }),
    { params: Promise.resolve({ id: String(batchId) }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.summary.fixed, 1);
  const [article] = await systemDb.select().from(schema.articles).where(eq(schema.articles.id, articleId));
  assert.match(article!.finalHtmlContent ?? "", /fixture\.example\.invalid/);
});

test("row 10: authenticated identity route runs provider transport, persists bytes, and settles billing", async () => {
  const { POST } = await import("../../app/api/media/assets/[identity]/regenerate/route");
  const identity = Buffer.from(`article_asset:${asset!.id}`, "utf8").toString("base64url");
  const response = await POST(
    new NextRequest(`http://127.0.0.1/api/media/assets/${identity}`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ prompt: "fixture identity image" }),
    }),
    { params: Promise.resolve({ identity }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.match(body.asset.storageUrl, /^\/api\/public-objects\//);
  const [reservation] = await systemDb.select().from(schema.creditReservations)
    .where(eq(schema.creditReservations.teamId, teamId))
    .orderBy(desc(schema.creditReservations.id)).limit(1);
  assert.equal(reservation?.status, "DEBITED");
  const [ledger] = await systemDb.select().from(schema.creditLedger)
    .where(eq(schema.creditLedger.teamId, teamId))
    .orderBy(desc(schema.creditLedger.id)).limit(1);
  assert.equal(ledger?.eventType, "debit");
  const [receipt] = await systemDb.select().from(schema.providerAttemptReceipts)
    .where(eq(schema.providerAttemptReceipts.teamId, teamId))
    .orderBy(desc(schema.providerAttemptReceipts.id)).limit(1);
  assert.equal(receipt?.status, "accounted");
  const providerCallsAfterOwnedRequest = imageProviderSubmitCount;
  const wrongTenantResponse = await POST(
    new NextRequest(`http://127.0.0.1/api/media/assets/${identity}`, {
      method: "POST", headers: wrongTenantHeaders,
      body: JSON.stringify({ prompt: "wrong tenant must not generate" }),
    }),
    { params: Promise.resolve({ identity }) },
  );
  assert.ok([403, 404].includes(wrongTenantResponse.status));
  assert.equal(imageProviderSubmitCount, providerCallsAfterOwnedRequest);
});

async function enqueueAndRunIdea(idea: number, routePath: string) {
  const route = routePath.includes("/like/")
    ? await import("../../app/api/social/video/like/[id]/generate/route")
    : await import("../../app/api/social/video/idea/[id]/generate/route");
  const { POST } = route;
  const response = await POST(
    new NextRequest(`http://127.0.0.1${routePath}`, {
      method: "POST", headers: authHeaders,
    }),
    { params: Promise.resolve({ id: String(idea) }) },
  );
  assert.equal(response.status, 200);
  const queued = await response.json();
  assert.equal(queued.success, true);
  const { getQueue, VIDEO_IDEA_GENERATION_QUEUE } = await import("../../lib/queue");
  const queue = getQueue(VIDEO_IDEA_GENERATION_QUEUE);
  const job = await queue.getJob(queued.jobId);
  assert.ok(job, `${routePath} placed a durable Redis job`);
  const result = await runWithAuthenticatedTeamContext(
    { userId, teamId, role: "team_member" },
    () => processVideoIdeaGenerationJob(job!, videoIdeaDependencies as any),
  );
  assert.match((result as { videoUrl: string }).videoUrl, /^\/api\/public-objects\//);
  return queued;
}

test("row 15: idea route -> Redis job -> exported worker persists and debits fixture video", async () => {
  await enqueueAndRunIdea(ideaId, "/api/social/video/idea/815/generate");
  const [idea] = await systemDb.select().from(schema.videoIdeas).where(eq(schema.videoIdeas.id, ideaId));
  assert.equal(idea!.status, "READY");
  assert.ok(idea!.videoUrl);
  assert.equal(videoProvider.submitCount >= 3, true);
  assert.equal(videoProvider.accountedReceipts >= 3, true);
  const [reservation] = await systemDb.select().from(schema.creditReservations)
    .where(eq(schema.creditReservations.teamId, teamId))
    .orderBy(desc(schema.creditReservations.id)).limit(1);
  assert.equal(reservation?.status, "DEBITED");
});

test("row 16: like-video route -> Redis job -> same exported worker settles reference-led output", async () => {
  await enqueueAndRunIdea(likeIdeaId, "/api/social/video/like/816/generate");
  const [idea] = await systemDb.select().from(schema.videoIdeas).where(eq(schema.videoIdeas.id, likeIdeaId));
  assert.equal(idea!.isLikeVideo, true);
  assert.equal(idea!.status, "READY");
  assert.ok(idea!.videoUrl);
  assert.equal(videoProvider.accountedReceipts >= 6, true);
  const [reservation] = await systemDb.select().from(schema.creditReservations)
    .where(eq(schema.creditReservations.teamId, teamId))
    .orderBy(desc(schema.creditReservations.id)).limit(1);
  assert.equal(reservation?.status, "DEBITED");
});

test("row 17: podcast route -> Redis job -> exported worker stores measured MP3 and settles", async () => {
  const { POST } = await import("../../app/api/podcast/generate/route");
  const response = await POST(new NextRequest("http://127.0.0.1/api/podcast/generate", {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ articleId, duration: "1-2 minutes", tone: "Conversational" }),
  }));
  assert.equal(response.status, 200);
  const queued = await response.json();
  assert.equal(queued.success, true);
  const { getQueue, PODCAST_GENERATION_QUEUE } = await import("../../lib/queue");
  const job = await getQueue(PODCAST_GENERATION_QUEUE).getJob(queued.jobId);
  assert.ok(job, "podcast route placed a durable Redis job");

  const words = [
    "Welcome to the Fixture Media Co podcast.",
    ...Array.from({ length: 155 }, (_, i) => `fixture${i}`),
  ].join(" ");
  await runWithAuthenticatedTeamContext(
    { userId, teamId, role: "team_member" },
    () => generateArticlePodcast(job!.data, {
      generatePodcastScript: async () => ({
        title: "Fixture podcast",
        duration: "1-2 minutes",
        segments: [
          { speaker: "host1", voice: "female", text: words },
        ],
      }),
      mergeAudioSegments: async () => {
        podcastProvider.submitCount += 1;
        await runFixtureProviderReceipt(
          "audio",
          "article",
          articleId,
          fixtureAudioBytes,
          podcastProvider,
        );
        return Buffer.from(fixtureAudioBytes);
      },
      getPromptEnhancement: async () => ({
        systemPromptAdditions: [],
        userPromptAdditions: [],
        suggestedParameters: {},
        patternsUsed: [],
        variantArmId: undefined,
      }),
      runGenerationOrchestrator: (async (input: any) => ({
        content: input.content, repairs: 0, orchestrated: false, qualityScore: 75,
        armId: undefined, patternsInjected: [], status: "ready",
        review: {},
      })) as any,
      recordContentGenerated: async () => 0,
      uploadPodcastToDrive: async () => null,
    }),
  );
  const [article] = await systemDb.select().from(schema.articles).where(eq(schema.articles.id, articleId));
  assert.equal(article!.podcastStatus, "ready");
  assert.ok(article!.podcastUrl);
  assert.equal(podcastProvider.submitCount, 1);
  assert.equal(podcastProvider.accountedReceipts, 1);
  const [reservation] = await systemDb.select().from(schema.creditReservations)
    .where(eq(schema.creditReservations.teamId, teamId))
    .orderBy(desc(schema.creditReservations.id)).limit(1);
  assert.equal(reservation?.status, "DEBITED");
});