import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { trialInputSchema } from "../lib/trial/contracts";
import { supportReferenceFromMessage } from "../lib/trial/ui-errors";

const reader = readFileSync("components/marketing/trial-reader.tsx", "utf8");
const signup = readFileSync("app/signup/page.tsx", "utf8");
const homepage = readFileSync("app/page.tsx", "utf8");
const appShell = readFileSync("components/navigation/app-shell.tsx", "utf8");
const navConfig = readFileSync("components/navigation/nav-config.ts", "utf8");
const loadingFallback = readFileSync("app/free-article/loading.tsx", "utf8");
const errorFallback = readFileSync("app/free-article/error.tsx", "utf8");

test("free-article entry CTA opens the real reader and signup continues back to it", () => {
  assert.match(homepage, /href="\/free-article"/);
  assert.match(reader, /href="\/signup\?trial=1"/);
  assert.match(signup, /if \(trialSignup\) \{\s*router\.replace\("\/free-article"\)/);
  assert.match(reader, /claimTrial\(\)\.then\(setTrial\)/);
  assert.match(reader, /user\?\.accountStatus === "active" && trial\?\.status === "ready" && trial\.access === "preview"/);
  assert.match(reader, /\[user\?\.accountStatus, trial\?\.status, trial\?\.access\]/);
});

test("whitespace-only brief fields are rejected locally after normalization", () => {
  const result = trialInputSchema.safeParse({
    businessName: "  ",
    city: " Boston ",
    audience: " homeowners ",
    topic: "  A useful topic  ",
  });
  assert.equal(result.success, false);
  const valid = trialInputSchema.safeParse({
    businessName: " Example Studio ",
    city: " Boston ",
    audience: " Homeowners ",
    topic: " A useful customer question ",
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.businessName, "Example Studio");
    assert.equal(valid.data.topic, "A useful customer question");
  }
  assert.match(reader, /trialInputSchema\.safeParse\(form\)/);
  assert.match(reader, /generateTrial\(parsed\.data\)/);
  assert.match(reader, /aria-invalid=\{!!fieldErrors\.topic\}/);
});

test("failed or timed-out generation requires a confirmed status read before another submit", () => {
  assert.match(reader, /submitted = true;\s+const view = await generateTrial/);
  assert.match(reader, /catch \(e\) \{\s+setGenerationNeedsStatusCheck\(submitted\)/);
  assert.match(reader, /disabled=\{busy \|\| checkingStatus \|\| generationNeedsStatusCheck \|\| !trial\}/);
  assert.match(reader, /if \(view\.status !== "empty"\) setGenerationNeedsStatusCheck\(false\)/);
  assert.match(reader, /Check article status before trying again/);
  assert.match(reader, /We have not confirmed whether the request completed/);
  assert.match(reader, /We couldn’t find the session for your previous request[\s\S]*!error && <button type="button" className="quiet-button" onClick=\{\(\) => void load\(true\)\}/);
});

test("server support reference remains visible and can be copied without exposing payload data", () => {
  assert.equal(supportReferenceFromMessage("Unavailable. Support reference: 9af2d381-b3dd-4c7c-93e0-33e4686a1c31."), "9af2d381-b3dd-4c7c-93e0-33e4686a1c31");
  assert.equal(supportReferenceFromMessage("No reference supplied."), null);
  assert.match(reader, /Support reference:/);
  assert.match(reader, /copySupportReference/);
  assert.match(reader, /Select the support reference above and copy it manually/);
});

test("development-only signup token storage denial does not block same-browser signup", () => {
  assert.match(signup, /try \{ trialToken = sessionStorage\.getItem\("citefi-trial-dev"\)/);
  assert.match(signup, /catch \{\s*\/\/ The same-origin trial cookie remains the normal continuity mechanism\./);
});

test("initial render shows the brief while status loads and only valid submission creates a session", () => {
  assert.match(reader, /\(!trial \|\| trial\.status === "empty" \|\| trial\.status === "created"\)/);
  assert.match(reader, /Checking for an existing article/);
  assert.match(reader, /No sign-in or paid account is required/);
  assert.match(reader, /Check article status/);
  const statusRead = reader.slice(reader.indexOf("const load ="), reader.indexOf("const submit ="));
  assert.match(statusRead, /await getTrial\(\)/);
  assert.doesNotMatch(statusRead, /prepareTrialForGeneration|startTrial|generateTrial/);
  assert.match(reader, /if \(!parsed\.success\)[\s\S]*return;[\s\S]*trial\.status === "empty" \? await prepareTrialForGeneration\(\)/);
  assert.match(reader, /if \(session\.status !== "created"\) return;[\s\S]*await generateTrial/);
});

test("public reader does not wait for auth startup and has route loading/error fallbacks", () => {
  assert.match(navConfig, /"\/free-article"/);
  assert.match(appShell, /if \(isPublicRoute\) return <>\{children\}<\/>/);
  assert.match(loadingFallback, /Reload article page/);
  assert.match(errorFallback, /Retry setup/);
  assert.match(errorFallback, /check its status before creating another/);
});
