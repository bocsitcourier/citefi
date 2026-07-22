---
name: BullMQ + Redis on Replit
description: How to wire BullMQ with local Redis in a Replit dev environment given the javascript_mem_db integration quirks.
---

# BullMQ + Redis on Replit

## The Rule
Always use local Redis (`redis://127.0.0.1:6379`) for dev, not the Upstash URL injected by the `javascript_mem_db` integration. The integration URL has a known typo and Upstash is unreachable from the Replit dev sandbox.

**Why:** Replit's `javascript_mem_db` integration injects `REDIS_URL=ediss://default:...@next-pony-XXXXX.upstash.io:6379` into process.env — the `ediss://` scheme (missing leading `r`) makes ioredis treat the whole URL as a Unix socket path, causing `ENOENT`. Even after normalizing to `rediss://`, the Upstash host is DNS-unreachable (`ENOTFOUND`) from the Replit dev container.

**How to apply:**
1. Set `REDIS_URL=redis://127.0.0.1:6379` in `.env.local`
2. Call dotenv with `override: true` in both `server/index.ts` and `server/worker-process.ts` so `.env.local` wins over the integration env var
3. Auto-start the local Redis daemon in `server/index.ts` before spawning the worker process (use `execSync('redis-server --daemonize yes ...')` in a try/catch around `redis-cli ping`)
4. Keep the `ediss://` → `rediss://` normalization + TLS flag in `getRedisConnection()` as a safety net for production Upstash URLs

## BullMQ Worker Pattern
- Single `new Worker(QUEUE_NAME, async (job) => { ... }, { connection: getRedisConnection(), concurrency: N })` replaces the old `boss.work()` for-loop
- Cron workers: `getQueue(Q).upsertJobScheduler(\`${Q}-scheduler\`, { pattern: cron, tz: 'UTC' }, { name: Q, data: {} })` + `new Worker(Q, async (_job) => { ... }, { connection: ..., concurrency: 1 })`
- Orphan `}` from old `for (const job of jobs)` loops are a common leftover that causes esbuild parse errors — always delete them when removing the outer loop

## VideoIdeaJobData
`teamId` and `userId` are optional in the interface because legacy `boss.send()` calls only passed `videoIdeaId`. The worker queries the DB for the rest.
