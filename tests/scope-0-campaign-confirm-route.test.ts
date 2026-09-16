/**
 * Scope 0 campaign brand-confirmation route locks. The actual route handler
 * runs with deterministic auth/service boundary doubles so call ordering,
 * tenant/public-id threading, response flattening, and status branches are
 * executable without a database write.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/scope-0-campaign-confirm-route.test.ts
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

const campaignPublicId = "b71068e5-e0fb-4cc2-86ad-125431cff413";
let authMode: "allow" | "deny" = "allow";
let confirmResult: { ok: boolean; reason?: string } = { ok: true };
let campaignResult: any = {
  id: 41,
  publicId: campaignPublicId,
  teamId: 702,
  brandStatus: "ready",
  status: "planning",
  brandProfileSnapshot: { source: "fixture", approved: true },
};
let detailResult: any = {
  campaign: {
    id: 41,
    publicId: campaignPublicId,
    teamId: 702,
    brandStatus: "confirmed",
    status: "ready",
    brandProfileSnapshot: { source: "fixture", approved: true },
  },
  brandProfile: { companyName: "Fixture Services" },
  research: { status: "confirmed" },
};
const events: Array<{ name: string; args: any[] }> = [];

const authUrl = new URL("../lib/api/auth.ts", import.meta.url).href;
moduleMock(authUrl, {
  namedExports: {
    withAuthenticatedTeamContext: async (
      _request: NextRequest,
      callback: (auth: { userId: number; teamId: number; role: string }) => unknown,
    ) => {
      events.push({ name: "auth", args: [] });
      if (authMode === "deny") return Response.json({ error: "Access denied" }, { status: 401 });
      return await callback({ userId: 801, teamId: 702, role: "team_member" });
    },
  },
});

const campaignServiceUrl = new URL("../lib/campaign-service.ts", import.meta.url).href;
moduleMock(campaignServiceUrl, {
  namedExports: {
    getCampaignByPublicId: async (...args: any[]) => {
      events.push({ name: "getCampaignByPublicId", args });
      return campaignResult;
    },
    confirmBrandSnapshot: async (...args: any[]) => {
      events.push({ name: "confirmBrandSnapshot", args });
      return confirmResult;
    },
    getCampaignDetailByPublicId: async (...args: any[]) => {
      events.push({ name: "getCampaignDetailByPublicId", args });
      return detailResult;
    },
  },
});

function reset() {
  authMode = "allow";
  confirmResult = { ok: true };
  campaignResult = {
    id: 41,
    publicId: campaignPublicId,
    teamId: 702,
    brandStatus: "ready",
    status: "planning",
    brandProfileSnapshot: { source: "fixture", approved: true },
  };
  detailResult = {
    campaign: {
      id: 41,
      publicId: campaignPublicId,
      teamId: 702,
      brandStatus: "confirmed",
      status: "ready",
      brandProfileSnapshot: { source: "fixture", approved: true },
    },
    brandProfile: { companyName: "Fixture Services" },
    research: { status: "confirmed" },
  };
  events.length = 0;
}

function request() {
  return new NextRequest(`http://localhost/api/campaigns/${campaignPublicId}/confirm-brand`, {
    method: "POST",
  });
}

test("confirm-brand route threads team/public id, confirms before detail, and flattens frozen response", async () => {
  reset();
  const { POST } = await import("../app/api/campaigns/[id]/confirm-brand/route.js");

  const response = await POST(request(), { params: Promise.resolve({ id: campaignPublicId }) });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.deepEqual(events.map((event) => event.name), [
    "auth",
    "getCampaignByPublicId",
    "confirmBrandSnapshot",
    "getCampaignDetailByPublicId",
  ]);
  assert.deepEqual(events[1]?.args, [702, campaignPublicId]);
  assert.deepEqual(events[2]?.args, [702, 41]);
  assert.deepEqual(events[3]?.args, [702, campaignPublicId]);
  assert.equal(body.success, true);
  assert.equal(body.campaign.id, 41);
  assert.equal(body.campaign.brandStatus, "confirmed");
  assert.deepEqual(body.campaign.brandProfileSnapshot, {
    source: "fixture",
    approved: true,
  });
  assert.equal(body.campaign.brandProfile.companyName, "Fixture Services");
  assert.equal(body.campaign.research.status, "confirmed");
  assert.equal("campaign" in body.campaign, false);
});

test("confirm-brand route returns 409 and does not load detail when research is incomplete", async () => {
  reset();
  confirmResult = { ok: false, reason: "research_incomplete" };
  const { POST } = await import("../app/api/campaigns/[id]/confirm-brand/route.js");

  const response = await POST(request(), { params: Promise.resolve({ id: campaignPublicId }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "research_incomplete");
  assert.deepEqual(events.map((event) => event.name), [
    "auth",
    "getCampaignByPublicId",
    "confirmBrandSnapshot",
  ]);
});

test("confirm-brand route returns 404 for an absent campaign and never confirms", async () => {
  reset();
  campaignResult = null;
  const { POST } = await import("../app/api/campaigns/[id]/confirm-brand/route.js");

  const response = await POST(request(), { params: Promise.resolve({ id: campaignPublicId }) });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /not found/i);
  assert.deepEqual(events.map((event) => event.name), [
    "auth",
    "getCampaignByPublicId",
  ]);
});

test("confirm-brand route returns auth denial without campaign service calls", async () => {
  reset();
  authMode = "deny";
  const { POST } = await import("../app/api/campaigns/[id]/confirm-brand/route.js");

  const response = await POST(request(), { params: Promise.resolve({ id: campaignPublicId }) });
  assert.equal(response.status, 401);
  assert.deepEqual(events.map((event) => event.name), ["auth"]);
});

test("confirm-brand route rejects an invalid public UUID before campaign lookup", async () => {
  reset();
  const { POST } = await import("../app/api/campaigns/[id]/confirm-brand/route.js");

  const response = await POST(request(), { params: Promise.resolve({ id: "not-a-uuid" }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid campaign ID");
  assert.deepEqual(events.map((event) => event.name), ["auth"]);
});