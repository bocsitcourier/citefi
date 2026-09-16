/**
 * Scope 0 standalone Brand Intelligence route locks. The actual route handler
 * runs with auth, repository, queue, campaign-lookup, and campaign-sync
 * boundaries stubbed. No provider, network, queue, or database operation is
 * performed.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/scope-0-brand-intelligence-route.test.ts
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

type AuthMode = "allow" | "deny";
let authMode: AuthMode = "allow";
let profileStatus: string | null = null;
let campaignLookupRows: any[] = [{ id: 123 }];
const calls = {
  auth: 0,
  getProfile: 0,
  upsert: 0,
  enqueue: 0,
  campaignLookup: 0,
  campaignSync: 0,
};
const upsertArgs: any[] = [];
const enqueueArgs: any[] = [];
const syncArgs: any[] = [];
const eventStream: string[] = [];

const authUrl = new URL("../lib/api/auth.ts", import.meta.url).href;
moduleMock(authUrl, {
  namedExports: {
    withAuthenticatedTeamContext: async (
      _request: NextRequest,
      callback: (auth: { userId: number; teamId: number; role: string }) => unknown,
    ) => {
      calls.auth++;
      if (authMode === "deny") return Response.json({ error: "Access denied" }, { status: 401 });
      return await callback({ userId: 901, teamId: 902, role: "team_member" });
    },
  },
});

const profileServiceUrl = new URL("../lib/client-brand-profile-service.ts", import.meta.url).href;
moduleMock(profileServiceUrl, {
  namedExports: {
    getClientBrandProfile: async () => {
      calls.getProfile++;
      return profileStatus == null ? null : { status: profileStatus, progressStep: "competitors" };
    },
    upsertClientBrandProfile: async (...args: any[]) => {
      calls.upsert++;
      upsertArgs.push(args);
      eventStream.push("upsert");
    },
  },
});

const queueUrl = new URL("../lib/queue.ts", import.meta.url).href;
moduleMock(queueUrl, {
  namedExports: {
    addIntelligenceResearchJob: async (...args: any[]) => {
      calls.enqueue++;
      enqueueArgs.push(args);
      eventStream.push("enqueue");
      return "scope0-job-123";
    },
  },
});

const campaignServiceUrl = new URL("../lib/campaign-service.ts", import.meta.url).href;
moduleMock(campaignServiceUrl, {
  namedExports: {
    markCampaignResearchQueued: async (...args: any[]) => {
      calls.campaignSync++;
      syncArgs.push(args);
      eventStream.push("sync");
    },
  },
});

const dbUrl = new URL("../lib/db.ts", import.meta.url).href;
moduleMock(dbUrl, {
  namedExports: {
    db: {
      select: () => {
        calls.campaignLookup++;
        return {
          from: () => ({
            where: () => ({
              limit: async () => campaignLookupRows,
            }),
          }),
        };
      },
    },
  },
});

function reset() {
  authMode = "allow";
  profileStatus = null;
  campaignLookupRows = [{ id: 123 }];
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0;
  upsertArgs.length = 0;
  enqueueArgs.length = 0;
  syncArgs.length = 0;
  eventStream.length = 0;
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/intelligence/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Brand Intelligence route upserts then enqueues exact tenant/source/campaign arguments", async () => {
  reset();
  const { POST } = await import("../app/api/intelligence/run/route.js");
  const response = await POST(request({
    websiteUrl: "https://fixture.example",
    companyName: "Fixture Services",
    campaignId: 123,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    jobId: "scope0-job-123",
    message: "Brand intelligence research started",
  });
  assert.equal(calls.auth, 1);
  assert.deepEqual(upsertArgs, [[902, "https://fixture.example", "Fixture Services"]]);
  assert.deepEqual(enqueueArgs, [[{
    teamId: 902,
    websiteUrl: "https://fixture.example",
    companyName: "Fixture Services",
    campaignId: 123,
  }]]);
  assert.deepEqual(syncArgs, [[902, 123, "scope0-job-123"]]);
  assert.equal(calls.campaignLookup, 1);
  assert.deepEqual(eventStream, ["upsert", "enqueue", "sync"]);
});

test("Brand Intelligence route keeps an unowned campaign out of the job and sync", async () => {
  reset();
  campaignLookupRows = [];
  const { POST } = await import("../app/api/intelligence/run/route.js");
  const response = await POST(request({
    websiteUrl: "https://fixture.example",
    companyName: "Fixture Services",
    campaignId: 999,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(enqueueArgs, [[{
    teamId: 902,
    websiteUrl: "https://fixture.example",
    companyName: "Fixture Services",
    campaignId: null,
  }]]);
  assert.equal(calls.campaignLookup, 1);
  assert.equal(calls.campaignSync, 0);
  assert.deepEqual(eventStream, ["upsert", "enqueue"]);
});

test("Brand Intelligence route returns already-running without writes or enqueue", async () => {
  reset();
  profileStatus = "running";
  const { POST } = await import("../app/api/intelligence/run/route.js");
  const response = await POST(request({
    websiteUrl: "https://fixture.example",
    companyName: "Fixture Services",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    alreadyRunning: true,
    status: "running",
    progressStep: "competitors",
    message: "Brand intelligence research is already in progress.",
  });
  assert.equal(calls.getProfile, 1);
  assert.equal(calls.upsert, 0);
  assert.equal(calls.enqueue, 0);
  assert.equal(calls.campaignLookup, 0);
  assert.equal(calls.campaignSync, 0);
  assert.deepEqual(eventStream, []);
});

test("Brand Intelligence route rejects invalid input before repository/queue calls", async () => {
  reset();
  const { POST } = await import("../app/api/intelligence/run/route.js");
  const response = await POST(request({ websiteUrl: "not-a-url", companyName: "" }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid input");
  assert.equal(calls.auth, 1);
  assert.equal(calls.getProfile, 0);
  assert.equal(calls.upsert, 0);
  assert.equal(calls.enqueue, 0);
  assert.equal(calls.campaignLookup, 0);
});

test("Brand Intelligence route denies auth before validating or calling downstream boundaries", async () => {
  reset();
  authMode = "deny";
  const { POST } = await import("../app/api/intelligence/run/route.js");
  const response = await POST(request({
    websiteUrl: "https://fixture.example",
    companyName: "Fixture Services",
  }));

  assert.equal(response.status, 401);
  assert.equal(calls.auth, 1);
  assert.equal(calls.getProfile, 0);
  assert.equal(calls.upsert, 0);
  assert.equal(calls.enqueue, 0);
  assert.equal(calls.campaignLookup, 0);
});