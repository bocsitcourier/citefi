import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  excerpt, isPaidArticleAccess, presentTrial, trialInputSchema,
  TRIAL_DAILY_LIMIT, TRIAL_RESERVE_MICROUSD,
} from "../lib/trial/contracts";

const text = "Useful customer guidance. ".repeat(300);
test("trial security repair is forward-only, enforced and release-verified", () => {
  const repair = readFileSync("migrations/0039_public_article_trial_forced_rls.sql", "utf8");
  const runner = readFileSync("scripts/run-versioned-migrations.ts", "utf8");
  for (const table of ["public_trial_documents", "public_trial_sponsor"]) {
    assert.match(repair, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(repair, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`));
    assert.match(runner, new RegExp(`AS ${table}_rls`));
  }
  assert.match(runner, /"0038_public_article_trial.sql",\s*"0039_public_article_trial_forced_rls.sql"/);
  assert.doesNotMatch(repair, /\b(?:GRANT|DROP|DELETE|UPDATE|INSERT)\b/);
});
const anonymous = { status: "ready", title: "Helpful article", fullText: text,
  preview: excerpt(text), ownerUserId: null };
test("anonymous DTO never contains full text, including unknown/failed payment", () => {
  for (const paid of [false, true]) {
    const view = presentTrial(anonymous, paid);
    assert.equal(view.text, undefined);
    assert.equal(view.canExport, false);
    assert.ok(view.preview!.split(/\s+/).length <= 66);
    assert.ok(!JSON.stringify(view).includes(text));
  }
});
test("signup claim unlocks existing text with embedded watermark, not export", () => {
  const view = presentTrial({ ...anonymous, ownerUserId: 100 });
  assert.equal(view.access, "watermarked");
  assert.match(view.text!, /CITEFI FREE ARTICLE/);
  assert.ok(view.text!.includes("Useful customer guidance."));
  assert.equal(view.canExport, false);
});
test("paid owner gets original article and export without regenerating", () => {
  const view = presentTrial({ ...anonymous, ownerUserId: 100 }, true);
  assert.equal(view.text, text);
  assert.equal(view.access, "paid");
  assert.equal(view.canExport, true);
});
test("payment eligibility never follows credits alone or an unpaid subscription", () => {
  const paid = { billingPlan: "starter", billingStatus: "active", stripeSubscriptionId: "sub_fixture" };
  assert.equal(isPaidArticleAccess(paid), true);
  for (const billingStatus of ["trialing","past_due","unpaid","incomplete","canceled","unknown"]) {
    assert.equal(isPaidArticleAccess({ ...paid, billingStatus }), false);
  }
  assert.equal(isPaidArticleAccess({ ...paid, billingPlan: "free" }), false);
  assert.equal(isPaidArticleAccess({ ...paid, stripeSubscriptionId: null }), false);
  assert.equal(isPaidArticleAccess(null), false);
});
test("input bounds and sponsor reserve are explicit", () => {
  assert.equal(trialInputSchema.safeParse({ topic: "Customer decision guide",
    businessName: "Fixture", city: "Boston", audience: "Homeowners" }).success, true);
  assert.equal(trialInputSchema.safeParse({ topic: "a".repeat(181),
    businessName: "Fixture", city: "Boston", audience: "Homeowners" }).success, false);
  assert.equal(TRIAL_DAILY_LIMIT * TRIAL_RESERVE_MICROUSD, 5_000_000);
});
test("city coverage includes exactly the top 250 incorporated Census places and all 50 capitals", () => {
  const data = JSON.parse(readFileSync("lib/marketing/cities.json","utf8"));
  assert.equal(data.vintage, 2025);
  assert.equal(new Set(data.cities.map((c: {slug:string}) => c.slug)).size, data.cities.length);
  assert.equal(data.cities.filter((c: {capital:boolean}) => c.capital).length, 50);
  assert.equal(data.cities.filter((c: {rank:number|null}) => c.rank !== null && c.rank <= 250).length, 250);
  assert.match(data.source, /^https:\/\/www2\.census\.gov\//);
});
