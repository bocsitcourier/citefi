import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  articles,
  decisionArms,
  decisionPolicies,
  holdoutAssignments,
  socialPosts,
} from "../../shared/schema";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:55489/fixture";

type Policy = {
  id: number;
  teamId: number;
  contentType: string;
  active: boolean;
  holdoutPercent: number;
};
type Arm = {
  id: number;
  policyId: number;
  teamId: number;
  contentType: string;
  articleId: number | null;
  socialPostId: number | null;
  label: string;
  priorAlpha: number;
  priorBeta: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  impressions: number;
  conversions: number;
  active: boolean;
};
type Assignment = {
  id: number;
  teamId: number;
  policyId: number;
  visitorHash: string;
  isHoldout: boolean;
  armId: number | null;
  outcome: "impression" | "conversion" | null;
};

const state: {
  policies: Policy[];
  arms: Arm[];
  assignments: Assignment[];
  articles: Array<{ id: number; teamId: number; chosenTitle: string; title: string; slug: string; articleStatus: string }>;
  posts: Array<{ id: number; teamId: number; title: string; status: string }>;
  failReads: boolean;
} = {
  policies: [],
  arms: [],
  assignments: [],
  articles: [{
    id: 501,
    teamId: 23,
    chosenTitle: "Austin Patient Guide",
    title: "Austin Patient Guide",
    slug: "austin-patient-guide",
    articleStatus: "COMPLETE",
  }],
  posts: [],
  failReads: false,
};

function tableRows(table: unknown): unknown[] {
  if (state.failReads) throw new Error("local journey fixture database timeout");
  if (table === decisionPolicies) return state.policies;
  if (table === decisionArms) return state.arms;
  if (table === holdoutAssignments) return state.assignments;
  if (table === articles) return state.articles;
  if (table === socialPosts) return state.posts;
  return [];
}

function queryChain(selection?: unknown) {
  let table: unknown;
  let joined = false;
  const chain: any = {
    from(input: unknown) {
      table = input;
      return chain;
    },
    innerJoin() {
      joined = true;
      return chain;
    },
    leftJoin() {
      joined = true;
      return chain;
    },
    where() { return chain; },
    limit() { return chain; },
    orderBy() { return chain; },
    for() { return chain; },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      try {
        const rows = selection && typeof selection === "object" && "cnt" in selection
          ? [{ cnt: String(tableRows(table).length) }]
          : tableRows(table);
        return Promise.resolve(joined ? rows : rows).then(onFulfilled, onRejected);
      } catch (error) {
        return Promise.reject(error).then(onFulfilled, onRejected);
      }
    },
  };
  return chain;
}

function insertChain(table: unknown) {
  let values: Record<string, unknown> | undefined;
  let conflictIgnored = false;
  const chain: any = {
    values(input: Record<string, unknown>) {
      values = input;
      return chain;
    },
    onConflictDoNothing() {
      conflictIgnored = true;
      return chain;
    },
    returning() {
      return Promise.resolve(insertRow(table, values ?? {}, conflictIgnored));
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(insertRow(table, values ?? {}, conflictIgnored)).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

function insertRow(table: unknown, values: Record<string, unknown>, conflictIgnored: boolean): unknown[] {
  if (table === decisionPolicies) {
    const row: Policy = {
      id: state.policies.length + 1,
      teamId: Number(values.teamId),
      contentType: String(values.contentType),
      active: Boolean(values.active),
      holdoutPercent: Number(values.holdoutPercent ?? 0),
    };
    state.policies.push(row);
    return [row];
  }
  if (table === decisionArms) {
    const row: Arm = {
      id: state.arms.length + 1,
      policyId: Number(values.policyId),
      teamId: Number(values.teamId),
      contentType: String(values.contentType),
      articleId: values.articleId == null ? null : Number(values.articleId),
      socialPostId: values.socialPostId == null ? null : Number(values.socialPostId),
      label: String(values.label ?? ""),
      priorAlpha: Number(values.priorAlpha ?? 1),
      priorBeta: Number(values.priorBeta ?? 1),
      posteriorAlpha: Number(values.posteriorAlpha ?? 1),
      posteriorBeta: Number(values.posteriorBeta ?? 1),
      impressions: Number(values.impressions ?? 0),
      conversions: Number(values.conversions ?? 0),
      active: Boolean(values.active),
    };
    state.arms.push(row);
    return [row];
  }
  if (table === holdoutAssignments) {
    const existing = state.assignments.find((row) =>
      row.policyId === Number(values.policyId) && row.visitorHash === String(values.visitorHash));
    if (existing && conflictIgnored) return [];
    const row: Assignment = {
      id: state.assignments.length + 1,
      teamId: Number(values.teamId),
      policyId: Number(values.policyId),
      visitorHash: String(values.visitorHash),
      isHoldout: Boolean(values.isHoldout),
      armId: values.armId == null ? null : Number(values.armId),
      outcome: null,
    };
    state.assignments.push(row);
    return [row];
  }
  return [];
}

function updateChain(table: unknown) {
  let values: Record<string, unknown> = {};
  const chain: any = {
    set(input: Record<string, unknown>) {
      values = input;
      return chain;
    },
    where() {
      const rows = table === decisionPolicies ? state.policies
        : table === decisionArms ? state.arms
          : table === holdoutAssignments ? state.assignments : [];
      const row = rows[0] as Record<string, unknown> | undefined;
      if (row) Object.assign(row, values);
      return chain;
    },
    returning() { return Promise.resolve([]); },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const fixtureDb: any = {
  select: (selection?: unknown) => queryChain(selection),
  insert: (table: unknown) => insertChain(table),
  update: (table: unknown) => updateChain(table),
  execute: async () => ({ rows: [] }),
  transaction: async (callback: (tx: any) => unknown) => callback(fixtureDb),
};

const dbUrl = new URL("../../lib/db.ts", import.meta.url).href;
const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown> },
) => void;
moduleMock(dbUrl, {
  namedExports: {
    db: fixtureDb,
    getTxDb: () => fixtureDb,
  },
});

const { getNextContent, recordConversion } = await import("../../lib/journey-orchestrator-service");

function resetState() {
  state.policies.length = 0;
  state.arms.length = 0;
  state.assignments.length = 0;
  state.failReads = false;
}

test("journey selects real service content, records one impression, and deduplicates conversion", async () => {
  resetState();
  const first = await getNextContent({ teamId: 23, visitorId: "visitor-positive", contentType: "article" });
  assert.equal(first.content?.id, 501);
  assert.equal(first.recommendationSource, "bayesian");
  assert.equal(state.assignments.length, 1);
  assert.equal(state.assignments[0]?.outcome, "impression");

  const duplicateDelivery = await getNextContent({
    teamId: 23,
    visitorId: "visitor-positive",
    contentType: "article",
  });
  assert.equal(duplicateDelivery.armId, first.armId);
  assert.equal(state.assignments.length, 1);

  const conversion = await recordConversion(first.policyId, 23, "visitor-positive");
  assert.equal(conversion.recorded, true);
  const duplicateConversion = await recordConversion(first.policyId, 23, "visitor-positive");
  assert.equal(duplicateConversion.recorded, false);
  assert.equal(duplicateConversion.message, "Already converted");
});

test("journey partial conversion without an impression is an explicit no-op", async () => {
  resetState();
  state.policies.push({
    id: 1,
    teamId: 23,
    contentType: "article",
    active: true,
    holdoutPercent: 0,
  });
  const noImpression = await recordConversion(1, 23, "visitor-never-seen");
  assert.equal(noImpression.recorded, false);
  assert.match(noImpression.message, /No impression/);
});

test("journey invalid request conditions and database timeout are surfaced", async () => {
  resetState();
  state.articles.length = 0;
  await assert.rejects(
    getNextContent({ teamId: 23, visitorId: "visitor-invalid" }),
    (error: unknown) => (error as { status?: number }).status === 422,
  );

  resetState();
  state.failReads = true;
  await assert.rejects(
    getNextContent({ teamId: 23, visitorId: "visitor-timeout" }),
    /local journey fixture database timeout/,
  );
});