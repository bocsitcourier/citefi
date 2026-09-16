/**
 * Disposable owner for the authenticated article-chain QA run.
 *
 * This fixture intentionally has no relationship with auth-http-fixture.ts.
 * It owns its own PostgreSQL, Redis, and optional route HTTP ports so a chain
 * test cannot accidentally spend against a developer database or queue.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createConnection } from "node:net";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import type { GeminiGenerateContentTransport } from "../../lib/gemini";

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const ARTICLE_CHAIN_HTTP_PORT = 5110;
export const ARTICLE_CHAIN_PG_PORT = 55490;
export const ARTICLE_CHAIN_REDIS_PORT = 16390;
export const ARTICLE_CHAIN_BASE_URL = `http://127.0.0.1:${ARTICLE_CHAIN_HTTP_PORT}`;
export const ARTICLE_CHAIN_DATABASE_URL =
  `postgresql://qa_article_chain@127.0.0.1:${ARTICLE_CHAIN_PG_PORT}/postgres`;
export const ARTICLE_CHAIN_REDIS_URL =
  `redis://127.0.0.1:${ARTICLE_CHAIN_REDIS_PORT}/0`;

const ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "DATABASE_POOLED_URL",
  "NEON_DATABASE_URL",
  "REDIS_URL",
  "NODE_ENV",
  "WORKER_PROCESS",
  "JWT_SECRET",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "TOTP_ENCRYPTION_KEY_VERSION",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "GEMINI_API_KEY",
  "GEMINI_ARTICLE_MODEL",
  "PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR",
  "DISABLE_CRITIC_LOOP",
  "DISABLE_REFLEXIVE_CHECK",
  "DISABLE_CHATGPT_REVIEW",
  "DISABLE_GPT_ENHANCEMENT",
  "DISABLE_ARTICLE_CRITIQUE",
] as const;

const SENSITIVE_KEYS = [
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BRAVE_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
] as const;

type ChildServer = ReturnType<typeof createHttpServer> | null;

async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd: ROOT,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

function cleanEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const env = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    ...overrides,
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
  ]) delete env[key];
  return env;
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
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
    socket.setTimeout(400, () => finish(false));
  });
}

async function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsOpen(port)) return;
    await new Promise((resolveResult) => setTimeout(resolveResult, 50));
  }
  throw new Error(`Article-chain fixture port ${port} did not become ready`);
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => undefined);
}

function patchExportedSchema(ddl: string): string {
  const prerequisites = `
DO $qa_article_chain$
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
$qa_article_chain$;
DO $qa_article_chain$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qa_campaigns_fk_key'
      AND conrelid = 'public.campaigns'::regclass
  ) THEN
    ALTER TABLE campaigns ADD CONSTRAINT qa_campaigns_fk_key UNIQUE (team_id, id);
  END IF;
END
$qa_article_chain$;
DO $qa_article_chain$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qa_campaign_ads_fk_key'
      AND conrelid = 'public.campaign_ads'::regclass
  ) THEN
    ALTER TABLE campaign_ads ADD CONSTRAINT qa_campaign_ads_fk_key UNIQUE (team_id, id);
  END IF;
END
$qa_article_chain$;
`;
  const firstAlter = ddl.search(/^ALTER TABLE .* ADD CONSTRAINT /m);
  const staged =
    firstAlter >= 0
      ? `${ddl.slice(0, firstAlter)}${prerequisites}${ddl.slice(firstAlter)}`
      : ddl;
  return staged.replace(
    /^CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx".*$/m,
    'CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx" ON "telemetry_ai_requests" USING btree ("admin_user_id","incident_id","created_at" DESC);',
  );
}

async function composeSchema(env: NodeJS.ProcessEnv): Promise<void> {
  await run(
    "psql",
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      String(ARTICLE_CHAIN_PG_PORT),
      "-U",
      "qa_article_chain",
      "-d",
      "postgres",
      "-c",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE ROLE citefi_tenant NOLOGIN;",
    ],
    env,
  ).catch((error: unknown) => {
    if (!String(error).includes("already exists")) throw error;
  });
  const ddl = await run(
    join(ROOT, "node_modules/.bin/drizzle-kit"),
    [
      "export",
      "--dialect",
      "postgresql",
      "--schema",
      join(ROOT, "shared/schema.ts"),
      "--sql",
    ],
    env,
  );
  if (!ddl.trim()) throw new Error("Article-chain fixture schema export was empty");
  const child = spawn(
    "psql",
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      String(ARTICLE_CHAIN_PG_PORT),
      "-U",
      "qa_article_chain",
      "-d",
      "postgres",
    ],
    { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const completion = new Promise<void>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolveResult()
        : reject(new Error(`article-chain schema composition failed (${code}): ${stderr}`)),
    );
  });
  child.stdin?.end(patchExportedSchema(ddl));
  await completion;
}

/**
 * Compose the same tenant-RLS/security bootstrap that the isolated database
 * harness uses in production order. The source schema export creates the
 * tables, but it intentionally does not carry PostgreSQL roles, grants,
 * policies, or receipt-ledger hardening.
 */
async function applyCanonicalSecurityBootstrap(env: NodeJS.ProcessEnv): Promise<void> {
  const scriptEnv = {
    ...env,
    WORKER_PROCESS: "true",
  };
  const runScript = async (script: string, extra: NodeJS.ProcessEnv = scriptEnv) => {
    await run("node", ["--import", "tsx/esm", join(ROOT, "scripts", script)], extra);
  };
  const applySql = async (migration: string) => {
    await run(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "127.0.0.1",
        "-p",
        String(ARTICLE_CHAIN_PG_PORT),
        "-U",
        "qa_article_chain",
        "-d",
        "postgres",
        "-f",
        join(ROOT, "migrations", migration),
      ],
      env,
    );
  };

  await runScript("apply-tenant-rls.ts");
  await runScript("migrate-t151-campaigns.ts");
  await applySql("0016_campaign_ads.sql");
  await applySql("0017_provider_usage_ledger.sql");
  await runScript("migrate-t154-agency-reports.ts");
  await runScript("run-versioned-migrations.ts", {
    ...scriptEnv,
    MIGRATION_START_VERSION: "0020",
  });
}

async function assertCanonicalSecurityBootstrap(): Promise<void> {
  const pool = new Pool({ connectionString: ARTICLE_CHAIN_DATABASE_URL });
  try {
    const result = await pool.query<{
      login_can_set_tenant: boolean;
      batches_update: boolean;
      reservations_dml: boolean;
      receipts_insert: boolean;
      batches_rls: boolean;
      receipts_rls: boolean;
    }>(`
      SELECT
        pg_has_role(current_user, 'citefi_tenant', 'member') AS login_can_set_tenant,
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
      !checks.batches_update ||
      !checks.reservations_dml ||
      !checks.receipts_insert ||
      !checks.batches_rls ||
      !checks.receipts_rls
    ) {
      throw new Error(
        "Article-chain fixture canonical tenant bootstrap is incomplete: " +
        JSON.stringify(checks ?? null),
      );
    }
  } finally {
    await pool.end();
  }
}

async function seedBatchSeoCache(pool: Pool, batchId: number): Promise<void> {
  // This is a real production batch_seo_cache row, not a generator stub. It
  // keeps each chain submission deterministic without invoking Reddit, Brave,
  // or browser research before reaching the injected Gemini seam.
  await pool.query(
    `INSERT INTO batch_seo_cache
      (batch_id, location_analysis_json, location_keywords_json,
       local_regulations, authority_entities, key_statistics,
       reddit_research, expert_discovery, competitor_insights_json,
       competitor_keywords_json, semantic_clusters_json,
       topical_authority_json, cache_version)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
             $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
             $12::jsonb, '3.1')`,
    [
      batchId,
      JSON.stringify({
        demographics: "Synthetic San Francisco QA audience",
        landmarks: ["QA neighborhood"],
        localCulture: "Synthetic local context",
        economicContext: "Synthetic planning context",
        neighborhoods: ["QA district"],
      }),
      JSON.stringify(["San Francisco planning", "local support checklist"]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({
        subreddits: [],
        questions: [],
        discussions: [],
        contentGaps: [],
        totalPostsAnalyzed: 0,
        researchTimestamp: "2026-01-01T00:00:00.000Z",
        consolidatedOutline: null,
      }),
      JSON.stringify({
        experts: [],
        totalFound: 0,
        avgCredibility: 0,
        expertiseLevel: "low",
      }),
      JSON.stringify({ commonThemes: [], contentGaps: [], uniqueAngles: [] }),
      JSON.stringify([]),
      JSON.stringify({ primary: [], secondary: [], related: [] }),
      JSON.stringify({ expertiseAreas: [], trustSignals: [] }),
    ],
  );
}

async function seedFixture(
  env: NodeJS.ProcessEnv,
): Promise<{ userId: number; teamId: number; token: string; batchId: number }> {
  const pool = new Pool({ connectionString: ARTICLE_CHAIN_DATABASE_URL });
  try {
    const email = `article-chain-${Date.now()}@citefi.invalid`;
    const userResult = await pool.query<{ id: number }>(
      `INSERT INTO users
        (email, role, account_status, email_verified, full_name)
       VALUES ($1, 'team_member', 'active', 1, 'Article Chain QA')
       RETURNING id`,
      [email],
    );
    const userId = userResult.rows[0]!.id;
    const teamResult = await pool.query<{ id: number }>(
      `INSERT INTO teams (name, created_by, billing_plan, billing_status)
       VALUES ('Article Chain QA Team', $1, 'paid', 'active')
       RETURNING id`,
      [userId],
    );
    const teamId = teamResult.rows[0]!.id;
    await pool.query("UPDATE users SET default_team_id = $1 WHERE id = $2", [teamId, userId]);
    await pool.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [teamId, userId],
    );
    await pool.query(
      `INSERT INTO credit_balances
        (team_id, balance, allowance_credits, purchased_credits)
       VALUES ($1, 10000, 10000, 0)`,
      [teamId],
    );
    await pool.query(
      `INSERT INTO locales
        (country_code, region, city, postal_code, language)
       VALUES ('US', 'California', 'San Francisco', '94105', 'en-US')`,
    );
    const locale = await pool.query<{ id: number }>(
      "SELECT id FROM locales WHERE city = 'San Francisco' ORDER BY id DESC LIMIT 1",
    );

    const { generateAccessToken, hashToken } = await import("../../lib/auth");
    const token = generateAccessToken({
      userId,
      email,
      role: "team_member",
    });
    await pool.query(
      `INSERT INTO sessions
        (user_id, token_hash, ip_address, user_agent, is_active, expires_at,
         last_activity_at, team_context_id, auth_assurance, mfa_verified_at)
       VALUES ($1, $2, '127.0.0.1', 'article-chain-qa', 1,
         NOW() + INTERVAL '1 day', NOW(), $3, 'mfa', NOW())`,
      [userId, hashToken(token), teamId],
    );
    const rateVersion = await pool.query<{ id: number }>(
      `INSERT INTO provider_rate_versions
        (version, evidence_url, source_note, effective_from)
       VALUES ('qa-article-chain-v1', 'https://citefi.invalid/qa-rate',
               'Synthetic QA rate card; no provider/customer data', NOW())
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO provider_rates
        (rate_version_id, provider, model, unit_type,
         input_microusd_per_million, output_microusd_per_million,
         effective_from, evidence_url)
       VALUES ($1, 'gemini', 'gemini-3.5-flash', 'tokens',
               100, 100, NOW(), 'https://citefi.invalid/qa-rate')`,
      [rateVersion.rows[0]!.id],
    );
    const batch = await pool.query<{ id: number }>(
      `INSERT INTO job_batches
        (user_id, team_id, locale_id, core_topic, target_url, status,
         num_articles_requested, title_pool_json, generation_params, business_name)
       VALUES ($1, $2, $3, 'QA home-care guide', 'https://example.com/services',
               'PENDING', 1, '[]'::jsonb, '{}'::jsonb, 'QA Article Chain')
       RETURNING id`,
      [userId, teamId, locale.rows[0]?.id ?? null],
    );
    await seedBatchSeoCache(pool, batch.rows[0]!.id);
    return { userId, teamId, token, batchId: batch.rows[0]!.id };
  } finally {
    await pool.end();
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function dispatchRoute(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Map<string, { POST?: (request: any) => Promise<Response>; GET?: (request: any) => Promise<Response> }>,
): Promise<void> {
  const url = new URL(request.url ?? "/", ARTICLE_CHAIN_BASE_URL);
  const handler = routes.get(url.pathname)?.[request.method as "GET" | "POST"];
  if (!handler) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await readRequestBody(request);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const { NextRequest } = await import("next/server");
  const nextRequest = new NextRequest(url, {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  try {
    const result = await handler(nextRequest);
    response.statusCode = result.status;
    result.headers.forEach((value, key) => response.setHeader(key, value));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "Article-chain route dispatch failed" }));
    console.error("[article-chain-fixture] route dispatch failed:", error);
  }
}

export interface ArticleChainWorkers {
  close: () => Promise<void>;
  getGuardianAuditCalls: () => number;
  getFinalizationGateCalls: () => number;
}

export interface ArticleChainFixture {
  baseUrl: string;
  databaseUrl: string;
  redisUrl: string;
  userId: number;
  teamId: number;
  batchId: number;
  token: string;
  createBatch: (title?: string) => Promise<number>;
  startWorkers: (
    transport: GeminiGenerateContentTransport,
    options?: {
      failRelease?: boolean;
      afterDebit?: import("../../lib/worker").ArticleGenerationDependencies["afterDebit"];
    },
  ) => Promise<ArticleChainWorkers>;
  query: <T extends import("pg").QueryResultRow = any>(
    text: string,
    values?: unknown[],
  ) => Promise<T[]>;
  stop: () => Promise<void>;
}

interface Processes {
  root: string;
  pgData: string;
  pgSocket: string;
  pg: ChildProcess | null;
  redis: ChildProcess | null;
  http: ChildServer;
}

export async function startArticleChainFixture(): Promise<ArticleChainFixture> {
  const previous = Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;
  const previousSensitive = Object.fromEntries(
    SENSITIVE_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;
  const processes: Processes = {
    root: "",
    pgData: "",
    pgSocket: "",
    pg: null,
    redis: null,
    http: null,
  };
  const env = cleanEnvironment({
    DATABASE_URL: ARTICLE_CHAIN_DATABASE_URL,
    DATABASE_POOLED_URL: ARTICLE_CHAIN_DATABASE_URL,
    NEON_DATABASE_URL: ARTICLE_CHAIN_DATABASE_URL,
    REDIS_URL: ARTICLE_CHAIN_REDIS_URL,
    NODE_ENV: "test",
    WORKER_PROCESS: "true",
    JWT_SECRET: "qa-article-chain-jwt-secret",
    SESSION_SECRET: "qa-article-chain-session-secret",
    CSRF_SECRET: "qa-article-chain-csrf-secret",
    TOTP_ENCRYPTION_KEY: "qa-article-chain-totp-key",
    TOTP_ENCRYPTION_KEY_VERSION: "v1",
    APP_URL: ARTICLE_CHAIN_BASE_URL,
    NEXT_PUBLIC_APP_URL: ARTICLE_CHAIN_BASE_URL,
    GEMINI_API_KEY: "qa-article-chain-transport-only",
    GEMINI_ARTICLE_MODEL: "gemini-3.5-flash",
    DISABLE_CRITIC_LOOP: "true",
    DISABLE_REFLEXIVE_CHECK: "true",
    DISABLE_CHATGPT_REVIEW: "true",
    DISABLE_GPT_ENHANCEMENT: "true",
    DISABLE_ARTICLE_CRITIQUE: "true",
  });
  try {
    for (const port of [
      ARTICLE_CHAIN_HTTP_PORT,
      ARTICLE_CHAIN_PG_PORT,
      ARTICLE_CHAIN_REDIS_PORT,
    ]) {
      if (await portIsOpen(port)) {
        throw new Error(`Article-chain fixture refuses occupied port ${port}`);
      }
    }
    processes.root = await mkdtemp("/tmp/citefi-article-chain.");
    env.PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR = join(
      processes.root,
      "provider-receipt-spool",
    );
    processes.pgData = join(processes.root, "postgres");
    processes.pgSocket = join(processes.root, "socket");
    await mkdir(processes.pgSocket, { recursive: true });
    await run(
      "initdb",
      ["-D", processes.pgData, "-A", "trust", "-U", "qa_article_chain", "--no-locale", "--encoding=UTF8"],
      cleanEnvironment(),
    );
    processes.pg = spawn(
      "pg_ctl",
      [
        "-D",
        processes.pgData,
        "-l",
        join(processes.root, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -k ${processes.pgSocket} -p ${ARTICLE_CHAIN_PG_PORT} -c listen_addresses=127.0.0.1`,
        "-w",
        "start",
      ],
      { cwd: ROOT, env: cleanEnvironment(), stdio: "ignore" },
    );
    await once(processes.pg, "spawn");
    await waitForPort(ARTICLE_CHAIN_PG_PORT);
    processes.redis = spawn(
      "redis-server",
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(ARTICLE_CHAIN_REDIS_PORT),
        "--save",
        "",
        "--appendonly",
        "no",
        "--daemonize",
        "no",
      ],
      { cwd: ROOT, env: cleanEnvironment(), stdio: "ignore" },
    );
    await once(processes.redis, "spawn");
    await waitForPort(ARTICLE_CHAIN_REDIS_PORT);
    for (const key of ENVIRONMENT_KEYS) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else (process.env as Record<string, string | undefined>)[key] = value;
    }
    for (const key of SENSITIVE_KEYS) delete process.env[key];
    // openai-client constructs its SDK at module import time. Keep imports
    // deterministic without supplying a credential; all OpenAI work is
    // explicitly disabled or injected in this fixture, and the offline guard
    // remains responsible for rejecting any accidental egress.
    process.env.OPENAI_API_KEY = "qa-article-chain-openai-disabled";
    await composeSchema(env);
    await applyCanonicalSecurityBootstrap(env);
    await assertCanonicalSecurityBootstrap();

    const seeded = await seedFixture(env);
    const routes = new Map<
      string,
      { POST?: (request: any) => Promise<Response>; GET?: (request: any) => Promise<Response> }
    >();
    routes.set(
      "/api/jobs/batch-submit",
      (await import("../../app/api/jobs/batch-submit/route")) as any,
    );
    routes.set(
      "/api/articles/list",
      (await import("../../app/api/articles/list/route")) as any,
    );
    processes.http = createHttpServer((request, response) => {
      void dispatchRoute(request, response, routes);
    });
    await new Promise<void>((resolveResult, reject) => {
      processes.http!.once("error", reject);
      processes.http!.listen(ARTICLE_CHAIN_HTTP_PORT, "127.0.0.1", () => {
        processes.http!.removeListener("error", reject);
        resolveResult();
      });
    });

    const queryPool = new Pool({ connectionString: ARTICLE_CHAIN_DATABASE_URL });
    const query = async <T extends import("pg").QueryResultRow = any>(
      text: string,
      values?: unknown[],
    ) => {
      const result = await queryPool.query<T>(text, values);
      return result.rows;
    };
    const createBatch = async (title = `QA article ${Date.now()}`) => {
      const rows = await query<{ id: number }>(
        `INSERT INTO job_batches
          (user_id, team_id, core_topic, target_url, status, num_articles_requested,
           title_pool_json, generation_params, business_name)
         VALUES ($1, $2, 'QA home-care guide', 'https://example.com/services',
                 'PENDING', 1, '[]'::jsonb, '{}'::jsonb, 'QA Article Chain')
         RETURNING id`,
        [seeded.userId, seeded.teamId],
      );
      await seedBatchSeoCache(queryPool, rows[0]!.id);
      return rows[0]!.id;
    };

    const startWorkers = async (
      transport: GeminiGenerateContentTransport,
      options: {
        failRelease?: boolean;
        afterDebit?: import("../../lib/worker").ArticleGenerationDependencies["afterDebit"];
      } = {},
    ): Promise<ArticleChainWorkers> => {
      const { Queue } = await import("bullmq");
      const Redis = (await import("ioredis")).default;
      const { createPipelineWorker } = await import("../../lib/pipeline-worker");
      const {
        processArticleGenerationJob,
        processBatchGenerationJob,
        getArticleGenerationBilling,
      } = await import("../../lib/worker");
      const {
        BATCH_GENERATION_QUEUE,
        ARTICLE_GENERATION_QUEUE,
      } = await import("../../lib/queue");
      const { auditArticle: productionGuardianAudit } = await import("../../lib/guardian-agent");
      const connection = new Redis(ARTICLE_CHAIN_REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      connection.on("error", () => undefined);
      let guardianAuditCalls = 0;
      let finalizationGateCalls = 0;
      const guardianAudit: typeof productionGuardianAudit = async (html, auditOptions = {}) => {
        guardianAuditCalls += 1;
        const minWordCount = auditOptions.minWordCount ?? 600;
        const minFaqQuestions = auditOptions.minFaqQuestions ?? 2;
        const minHyperlinks = auditOptions.minHyperlinks ?? 3;
        const minImages = auditOptions.minImages ?? 1;
        return {
          passed: true,
          score: 100,
          missingElements: [],
          formattingIssues: [],
          suggestions: [],
          breakdown: {
            images: { count: minImages, required: minImages, passed: true },
            hyperlinks: { count: minHyperlinks, required: minHyperlinks, passed: true },
            faq: {
              present: true,
              questionCount: minFaqQuestions,
              required: minFaqQuestions,
              passed: true,
            },
            wordCount: {
              count: Math.max(minWordCount, html.split(/\s+/).length),
              required: minWordCount,
              passed: true,
            },
            rawMarkdown: { clean: true, issues: [] },
            tone: { passed: true, reason: "QA approved verdict" },
          },
        };
      };
      const generator = async (...args: any[]) => {
        // The transport is the final optional argument on the production
        // generator. Keep every preceding positional argument untouched.
        args[17] = transport;
        const generate = (await import("../../lib/gemini")).generateArticleWithGemini as any;
        return generate(...args);
      };
      const common = {
        execution: {
          scope: "tenant" as const,
          getTeamId: (job: any) => job.data.teamId,
          getUserId: (job: any) => job.data.userId ?? seeded.userId,
          role: "system_worker",
        },
        _workerOptions: { connection, lockDuration: 60_000, stalledInterval: 5_000 },
      };
      const batchWorker = createPipelineWorker(
        BATCH_GENERATION_QUEUE,
        (job: any) => processBatchGenerationJob(job),
        {
          ...common,
          stage: "batch_orchestration",
          getBilling: (job: any) => ({
            teamId: job.data.teamId,
            runId: job.data.creditRunId,
            userId: seeded.userId,
            capReservationId: job.data.capReservationId,
          }),
        },
      );
      const articleWorker = createPipelineWorker(
        ARTICLE_GENERATION_QUEUE,
        (job: any) => processArticleGenerationJob(job, {
          generateGemini: generator,
          guardianAudit,
          afterDebit: options.afterDebit,
          finalizationGate: {
            // The real structural/URL gate still runs. This narrow test DI only
            // avoids an unrelated paid judge provider call.
            reviewContent: async () => {
              finalizationGateCalls += 1;
              return { passed: true, defects: [] };
            },
            loadBrandPolicy: async () => ({ applicable: false, source: "legacy" as const }),
          },
        }),
        {
          ...common,
          stage: "text_gen",
          concurrency: 2,
          getBilling: (job: any) => getArticleGenerationBilling(job),
          _deps: options.failRelease
            ? { releaseReservation: async () => { throw new Error("QA injected release failure"); } }
            : undefined,
        },
      );
      await Promise.all([batchWorker.waitUntilReady(), articleWorker.waitUntilReady()]);
      // Keep Queue imported here as an intentional readiness assertion: both
      // production workers consume the same real BullMQ queue names.
      void Queue;
      return {
        close: async () => {
          await Promise.allSettled([batchWorker.close(), articleWorker.close()]);
          await connection.quit().catch(() => connection.disconnect());
        },
        getGuardianAuditCalls: () => guardianAuditCalls,
        getFinalizationGateCalls: () => finalizationGateCalls,
      };
    };

    return {
      baseUrl: ARTICLE_CHAIN_BASE_URL,
      databaseUrl: ARTICLE_CHAIN_DATABASE_URL,
      redisUrl: ARTICLE_CHAIN_REDIS_URL,
      userId: seeded.userId,
      teamId: seeded.teamId,
      batchId: seeded.batchId,
      token: seeded.token,
      createBatch,
      startWorkers,
      query,
      stop: async () => {
        // API routes use the production queue registry in addition to the
        // fixture-owned worker connection. Close those Queue objects before
        // stopping the Redis child they still reference.
        await (await import("../../lib/queue")).closeQueues().catch(() => undefined);
        await queryPool.end().catch(() => undefined);
        await new Promise<void>((resolveResult) => processes.http?.close(() => resolveResult()) ?? resolveResult());
        await stopChild(processes.redis);
        if (processes.pgData) {
          await run("pg_ctl", ["-D", processes.pgData, "-m", "fast", "-w", "stop"], cleanEnvironment()).catch(() => undefined);
        }
        await rm(processes.root, { recursive: true, force: true });
        for (const key of ENVIRONMENT_KEYS) {
          const value = previous[key];
          if (value === undefined) delete process.env[key];
          else (process.env as Record<string, string | undefined>)[key] = value;
        }
        for (const key of SENSITIVE_KEYS) {
          const value = previousSensitive[key];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      },
    };
  } catch (error) {
    await (await import("../../lib/queue")).closeQueues().catch(() => undefined);
    await stopChild(processes.redis);
    if (processes.pgData) {
      await run("pg_ctl", ["-D", processes.pgData, "-m", "immediate", "stop"], cleanEnvironment()).catch(() => undefined);
    }
    await rm(processes.root, { recursive: true, force: true });
    for (const key of ENVIRONMENT_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else (process.env as Record<string, string | undefined>)[key] = value;
    }
    for (const key of SENSITIVE_KEYS) {
      const value = previousSensitive[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    throw error;
  }
}