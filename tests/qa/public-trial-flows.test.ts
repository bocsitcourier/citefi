import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { startAuthHttpFixture } from "../../QA/support/auth-http-fixture";

// Direct-process harness: disposable PostgreSQL/Redis/SMTP, no live credentials.
// Provider injection is an internal function parameter, never a HTTP flag.
const fixture = await startAuthHttpFixture();
const pool = new Pool({ connectionString: fixture.databaseUrl, max: 3 });
try {
  const auth = await import("../../lib/auth");
  const service = await import("../../lib/trial/server");
  const signup = await import("../../app/api/auth/signup/route");
  const password = "OfflineTrial!Pass2026";
  const passwordHash = await auth.hashPassword(password);
  const seeded = await pool.query(`INSERT INTO users(email,password_hash,full_name,role,account_status,email_verified,two_factor_enabled)
    VALUES ('trial-owner@fixture.invalid',$1,'Offline owner','admin','active',1,0) RETURNING id`, [passwordHash]);
  const owner = Number(seeded.rows[0].id);
  // Exercise the existing, time-bounded administrator enrollment grace;
  // do not bypass requireAdmin or forge a privileged session.
  await pool.query("UPDATE users SET mfa_enrollment_deadline=now()+interval '1 hour' WHERE id=$1",[owner]);
  await pool.query(readFileSync("migrations/0038_public_article_trial.sql", "utf8"));
  await pool.query(`INSERT INTO provider_rate_versions(version,evidence_url,source_note,effective_from)
    VALUES('trial-offline-fixture','https://example.invalid/fixture','Offline fixture, not live prices',now()-interval '1 day')`);
  await pool.query(`INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,input_microusd_per_million,output_microusd_per_million,effective_from,evidence_url)
    SELECT id,'gemini','gemini-2.5-flash-lite','tokens',100000,400000,now()-interval '1 day','https://example.invalid/fixture'
    FROM provider_rate_versions WHERE version='trial-offline-fixture'`);
  process.env.GEMINI_API_KEY = "OFFLINE-INJECTION-NOT-A-CREDENTIAL";
  const token = randomBytes(32).toString("hex");
  const tokenHash = service.tokenHash(token);
  const row = await pool.query(`INSERT INTO public_trial_documents(token_hash,ip_hash,expires_at)
    VALUES($1,$2,now()+interval '30 days') RETURNING id`, [tokenHash, randomBytes(32).toString("hex")]);
  const id = Number(row.rows[0].id);
  const body = { topic: "Choosing a trustworthy neighborhood service", businessName: "Offline fixture business",
    city: "Boston", audience: "Busy small-business owners" };
  const cookie = `citefi_article_trial=${token}`;
  function request(path: string, method = "GET", data?: unknown, extra: Record<string,string> = {}) {
    return new NextRequest(`${fixture.baseUrl}${path}`, {
      method, headers: { origin: fixture.baseUrl, host: new URL(fixture.baseUrl).host,
        "x-trial-request": "1", cookie, ...extra },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  }
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const text = "OFFLINE VERIFICATION ARTICLE\n\n" + "Helpful, clearly marked offline test content for a customer. ".repeat(60);
  const first = service.generateArticleTrial(request("/api/trial/generate","POST",body), async () => {
    calls++; await gate; return text;
  });
  for (let i=0; i<100 && calls===0; i++) await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(calls, 1, "first request reaches only injected provider");
  const replay = await service.generateArticleTrial(request("/api/trial/generate","POST",body), async () => {
    calls++; throw new Error("duplicate provider invocation");
  });
  assert.equal((await replay.json()).status, "generating");
  release();
  const generated = await (await first).json();
  assert.equal(generated.status, "ready");
  assert.equal(generated.text, undefined, "anonymous response never contains full article");
  assert.ok(generated.preview.length < text.length);
  assert.equal(calls, 1);
  await service.generateArticleTrial(request("/api/trial/generate","POST",body), async () => {
    calls++; return text;
  });
  assert.equal(calls, 1, "completed retries cannot regenerate");
  const registration = await signup.POST(request("/api/auth/signup","POST",{
    email: "pending-trial@fixture.invalid", password, fullName: "Offline pending reader",
  }));
  assert.equal(registration.status, 201, JSON.stringify(await registration.clone().json()));
  const registered = await registration.json();
  assert.equal(registered.user.accountStatus, "pending_approval");
  const claimed = await (await service.readTrial(request("/api/trial"))).json();
  assert.equal(claimed.access, "watermarked");
  assert.match(claimed.text, /CITEFI FREE ARTICLE/);
  assert.equal(claimed.accountPending, true);
  assert.equal(claimed.canExport, false);
  await assert.rejects(() => service.paidTrialExport(request("/api/trial/export","POST")), /paid subscription/);
  const saved = await pool.query("SELECT owner_user_id,full_text FROM public_trial_documents WHERE id=$1",[id]);
  assert.equal(saved.rows[0].owner_user_id, registered.user.id);
  assert.equal(saved.rows[0].full_text, text, "signup claims original text atomically");
  await assert.rejects(() => service.claimExistingTrial(request("/api/trial/claim","POST")), /[Aa]uth|[Tt]oken|[Ll]ogin|[Ss]ession|[Cc]redential/);
  await pool.query("UPDATE users SET account_status='suspended' WHERE id=$1",[registered.user.id]);
  await assert.rejects(() => service.readTrial(request("/api/trial")), /not permitted/);
  await pool.query("UPDATE users SET account_status='pending_approval' WHERE id=$1",[registered.user.id]);
  const paidTeam = await pool.query("SELECT team_id AS id FROM team_members WHERE user_id=$1",[registered.user.id]);
  assert.equal(paidTeam.rows.length,1,"signup provisions its own legitimate customer workspace");
  const sponsorTeam = await pool.query("SELECT team_id FROM public_trial_sponsor");
  assert.notEqual(paidTeam.rows[0].id,sponsorTeam.rows[0].team_id);
  const rootLogin = await fetch(`${fixture.baseUrl}/api/auth/login`, {
    method:"POST",headers:{"Content-Type":"application/json",origin:fixture.baseUrl},
    body:JSON.stringify({email:"trial-owner@fixture.invalid",password}),
  });
  assert.equal(rootLogin.status,200);
  const rootCookies = rootLogin.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const rootCsrf = rootLogin.headers.getSetCookie().find(value=>value.startsWith("csrf_token="))!.split(";")[0]!.slice("csrf_token=".length);
  const approval = await import("../../app/api/admin/users/[id]/approve/route");
  const approved = await approval.POST(request(`/api/admin/users/${registered.user.id}/approve`,"POST",undefined,{
    cookie:rootCookies,"x-csrf-token":decodeURIComponent(rootCsrf),
  }),{params:Promise.resolve({id:String(registered.user.id)})});
  assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));
  const login = await fetch(`${fixture.baseUrl}/api/auth/login`, {
    method:"POST",headers:{"Content-Type":"application/json",origin:fixture.baseUrl},
    body:JSON.stringify({email:"pending-trial@fixture.invalid",password}),
  });
  assert.equal(login.status,200,JSON.stringify(await login.clone().json()));
  const authCookies = login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  const csrf = login.headers.getSetCookie().find(value=>value.startsWith("csrf_token="))?.split(";")[0]?.slice("csrf_token=".length);
  assert.ok(csrf);
  delete process.env.STRIPE_PRICE_STARTER;
  const checkout = await import("../../app/api/billing/checkout/route");
  const eligible = await checkout.POST(request("/api/billing/checkout","POST",{kind:"subscription",planId:"starter",annual:false},{
    cookie:`${cookie}; ${authCookies}`,"x-csrf-token":decodeURIComponent(csrf),
  }));
  assert.equal(eligible.status,503,"native checkout passes customer ownership and reaches its intentionally unconfigured offline price gate");
  await pool.query(`UPDATE teams SET billing_plan='starter',billing_status='active',stripe_subscription_id='sub_offline_fixture' WHERE id=$1`,[paidTeam.rows[0].id]);
  const paidRequest = request("/api/trial/export","POST",undefined,{
    cookie:`${cookie}; ${authCookies}`, "x-csrf-token":decodeURIComponent(csrf),
  });
  const exported = await (await service.paidTrialExport(paidRequest)).json();
  assert.equal(exported.text,text);
  const crossBrowser = await (await service.readTrial(request("/api/trial","GET",undefined,{cookie:authCookies}))).json();
  assert.equal(crossBrowser.text,text,"active owner recovers original article without the guest cookie");
  await pool.query("UPDATE teams SET billing_status='past_due' WHERE id=$1",[paidTeam.rows[0].id]);
  await assert.rejects(() => service.paidTrialExport(paidRequest), /paid subscription/);
  const outsider = await (await service.readTrial(request("/api/trial","GET",undefined,{
    cookie:`citefi_article_trial=${randomBytes(32).toString("hex")}`,
  }))).json();
  assert.equal(outsider.status,"empty");
  assert.equal(outsider.text,undefined);
  const stale = await pool.query(`INSERT INTO public_trial_documents(token_hash,ip_hash,status,started_at,expires_at)
    VALUES($1,$2,'generating',now()-interval '11 minutes',now()+interval '1 day') RETURNING id`,
  [service.tokenHash("b".repeat(64)), "c".repeat(64)]);
  const recovered = await (await service.readTrial(request("/api/trial","GET",undefined,{
    cookie:`citefi_article_trial=${"b".repeat(64)}`,
  }))).json();
  assert.equal(recovered.status,"uncertain");
  assert.ok(stale.rows[0].id);
  assert.equal(calls,1,"all verification used one injected provider and zero external model calls");
  console.log("PASS: anonymous excerpt, double-submit/replay, atomic pending-signup claim, watermarked read, CSRF-paid export, revoked payment, cross-document isolation, stale recovery.");
  assert.ok(owner);
} finally {
  delete process.env.GEMINI_API_KEY;
  await pool.end();
  await (await import("../../lib/queue")).closeQueues();
  await (await import("../../lib/db")).closeDb();
  await fixture.stop();
}
