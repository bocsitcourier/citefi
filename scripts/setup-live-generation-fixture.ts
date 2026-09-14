import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { and, count, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { hashPassword } from "../lib/auth.js";
import { closeDb, getTxDb } from "../lib/db.js";
import { getAllModels } from "../lib/model-resolver.js";
import { grantCredits } from "../lib/credits.js";
import { runWithSystemContext } from "../lib/tenant-context.js";
import {
  creditBalances,
  creditLedger,
  jobBatches,
  providerRates,
  providerRateVersions,
  providerUsageLedger,
  spendingCaps,
  teamMembers,
  teams,
  users,
} from "../shared/schema.js";

const FIXTURE_LABEL = "LIVE GENERATION QA 2026-09-10";
const BUSINESS_NAME = "Harbor Home Energy";
const LOGIN_EMAIL = "live-generation-qa-2026-09-10@example.invalid";
const TARGET_URL = "https://www.energy.gov/energysaver";
const USER_PUBLIC_ID = "26091000-0000-4000-8000-000000000001";
const TEAM_PUBLIC_ID = "26091000-0000-4000-8000-000000000002";
const BATCH_PUBLIC_ID = "26091000-0000-4000-8000-000000000003";
const INITIAL_CREDITS = 5_000;
const MONTHLY_CAP_CENTS = 5_000;
const CREDIT_GRANT_KEY = "live-generation-qa-2026-09-10:initial-credit-grant:v1";
const CREDENTIAL_PATH = ".local/test-fixtures/live-generation.json";
const REPORT_PATH = "reports/live-generation/session.json";

interface LocalCredentials {
  fixtureLabel: string;
  email: string;
  password: string;
}

async function readOrCreateCredentials(): Promise<LocalCredentials> {
  try {
    const parsed = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8")) as LocalCredentials;
    if (
      parsed.fixtureLabel !== FIXTURE_LABEL ||
      parsed.email !== LOGIN_EMAIL ||
      typeof parsed.password !== "string" ||
      parsed.password.length < 20
    ) {
      throw new Error(`Existing ${CREDENTIAL_PATH} is not the expected fixture credential file`);
    }
    await chmod(CREDENTIAL_PATH, 0o600);
    return parsed;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  const credentials: LocalCredentials = {
    fixtureLabel: FIXTURE_LABEL,
    email: LOGIN_EMAIL,
    password: `${randomBytes(24).toString("base64url")}!aA7`,
  };
  await mkdir(dirname(CREDENTIAL_PATH), { recursive: true, mode: 0o700 });
  const temporaryPath = `${CREDENTIAL_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, CREDENTIAL_PATH);
  await chmod(CREDENTIAL_PATH, 0o600);
  return credentials;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe accounting aggregate: ${String(value)}`);
  return parsed;
}

async function confirmExistingLocalLogin(credentials: LocalCredentials) {
  const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:5000";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.1, 198.51.100.241",
      },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      signal: controller.signal,
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    const match = setCookie.match(/(?:^|,\s*)auth_token=([^;]+)/);
    if (response.status !== 200 || !match) {
      return { attempted: true, baseUrl, loginStatus: response.status, meStatus: null, confirmed: false };
    }
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `auth_token=${match[1]}` },
      signal: controller.signal,
    });
    return {
      attempted: true,
      baseUrl,
      loginStatus: response.status,
      meStatus: me.status,
      confirmed: me.status === 200,
    };
  } catch (error: any) {
    return {
      attempted: false,
      baseUrl,
      loginStatus: null,
      meStatus: null,
      confirmed: false,
      blocker: error?.name === "AbortError" ? "local dev HTTP timed out" : "local dev HTTP unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const credentials = await readOrCreateCredentials();
  const passwordHash = await hashPassword(credentials.password);

  const fixture = await runWithSystemContext("provision approved isolated live-generation QA fixture", async () => {
    const db = getTxDb();
    return db.transaction(async (tx) => {
      const [emailOwner] = await tx.select({ id: users.id, publicId: users.publicId })
        .from(users).where(eq(users.email, LOGIN_EMAIL)).limit(1);
      if (emailOwner && emailOwner.publicId !== USER_PUBLIC_ID) {
        throw new Error("Synthetic fixture email is already owned by a non-fixture user");
      }

      const [user] = await tx.insert(users).values({
        publicId: USER_PUBLIC_ID,
        email: LOGIN_EMAIL,
        passwordHash,
        role: "team_member",
        accountStatus: "active",
        emailVerified: 1,
        fullName: "Harbor Home Energy QA",
        twoFactorEnabled: 0,
        failedLoginAttempts: 0,
        lockedUntil: null,
        approvalEmailSentAt: null,
      }).onConflictDoUpdate({
        target: users.publicId,
        set: {
          passwordHash,
          accountStatus: "active",
          emailVerified: 1,
          twoFactorEnabled: 0,
          failedLoginAttempts: 0,
          lockedUntil: null,
          approvalEmailSentAt: null,
          deletedAt: null,
          updatedAt: new Date(),
        },
      }).returning({ id: users.id, publicId: users.publicId, email: users.email });
      if (!user || user.email !== LOGIN_EMAIL) throw new Error("Fixture user identity mismatch");

      const [team] = await tx.insert(teams).values({
        publicId: TEAM_PUBLIC_ID,
        name: FIXTURE_LABEL,
        createdBy: user.id,
        billingPlan: "enterprise",
        billingStatus: "active",
        currentPeriodEnd: new Date("2026-10-10T23:59:59.000Z"),
        cancelAtPeriodEnd: false,
        clientStatus: "active",
      }).onConflictDoUpdate({
        target: teams.publicId,
        set: {
          name: FIXTURE_LABEL,
          billingPlan: "enterprise",
          billingStatus: "active",
          currentPeriodEnd: new Date("2026-10-10T23:59:59.000Z"),
          cancelAtPeriodEnd: false,
          clientStatus: "active",
          deletedAt: null,
          updatedAt: new Date(),
        },
      }).returning({ id: teams.id, publicId: teams.publicId });
      if (!team) throw new Error("Failed to create fixture team");

      await tx.update(users).set({ defaultTeamId: team.id }).where(eq(users.id, user.id));
      await tx.insert(teamMembers).values({
        teamId: team.id,
        userId: user.id,
        role: "admin",
      }).onConflictDoUpdate({
        target: [teamMembers.teamId, teamMembers.userId],
        set: { role: "admin" },
      });
      await tx.insert(spendingCaps).values({
        teamId: team.id,
        monthlyCapCents: MONTHLY_CAP_CENTS,
        alertThresholdPct: 80,
        hardStop: true,
      }).onConflictDoUpdate({
        target: spendingCaps.teamId,
        set: {
          monthlyCapCents: MONTHLY_CAP_CENTS,
          alertThresholdPct: 80,
          hardStop: true,
          updatedAt: new Date(),
        },
      });

      const [batch] = await tx.insert(jobBatches).values({
        publicId: BATCH_PUBLIC_ID,
        userId: user.id,
        teamId: team.id,
        coreTopic: "Home energy audits for Boston homeowners",
        targetUrl: TARGET_URL,
        businessName: BUSINESS_NAME,
        status: "PENDING",
        numArticlesRequested: 1,
        generationParams: {
          fixtureLabel: FIXTURE_LABEL,
          geographicFocus: "Boston, Massachusetts",
          audience: "Boston-area homeowners seeking practical energy-efficiency guidance",
          tone: "helpful, evidence-led, and locally informed",
          actualAffiliation: false,
          targetUrlPurpose: "public informational reference only",
        },
        autoPublishEnabled: 0,
      }).onConflictDoNothing({ target: jobBatches.publicId })
        .returning({ id: jobBatches.id, publicId: jobBatches.publicId });
      const [storedBatch] = batch ? [batch] : await tx.select({
        id: jobBatches.id,
        publicId: jobBatches.publicId,
      }).from(jobBatches).where(and(
        eq(jobBatches.publicId, BATCH_PUBLIC_ID),
        eq(jobBatches.teamId, team.id),
      )).limit(1);
      if (!storedBatch) throw new Error("Fixture generation draft is missing or has wrong ownership");
      return { user, team, batch: storedBatch };
    });
  });

  const grant = await runWithSystemContext("grant finite live-generation QA credits through billing ledger", () =>
    grantCredits({
      teamId: fixture.team.id,
      amount: INITIAL_CREDITS,
      eventType: "grant",
      sourceType: "test_fixture",
      idempotencyKey: CREDIT_GRANT_KEY,
      reason: `${FIXTURE_LABEL} finite live-provider test credit grant`,
    })
  );

  const accounting = await runWithSystemContext("read live-generation QA baseline accounting and locked rates", async () => {
    const db = getTxDb();
    const [[balance], [cap], [teamLedger], [globalLedger], [ownership], rateRows] = await Promise.all([
      db.select().from(creditBalances).where(eq(creditBalances.teamId, fixture.team.id)).limit(1),
      db.select().from(spendingCaps).where(eq(spendingCaps.teamId, fixture.team.id)).limit(1),
      db.select({
        eventCount: count(),
        costMicrousd: sql<string>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)`,
        unpricedCount: sql<string>`count(*) filter (where ${providerUsageLedger.rateVersionId} is null)`,
      }).from(providerUsageLedger).where(eq(providerUsageLedger.teamId, fixture.team.id)),
      db.select({
        eventCount: count(),
        costMicrousd: sql<string>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)`,
        unpricedCount: sql<string>`count(*) filter (where ${providerUsageLedger.rateVersionId} is null)`,
      }).from(providerUsageLedger),
      db.select({
        ledgerRowId: creditLedger.id,
        teamId: creditLedger.teamId,
        amount: creditLedger.amount,
      }).from(creditLedger).where(eq(creditLedger.idempotencyKey, CREDIT_GRANT_KEY)).limit(1),
      db.select({
        provider: providerRates.provider,
        model: providerRates.model,
        unitType: providerRates.unitType,
        version: providerRateVersions.version,
        evidenceUrl: providerRates.evidenceUrl,
      }).from(providerRates)
        .innerJoin(providerRateVersions, eq(providerRates.rateVersionId, providerRateVersions.id))
        .where(and(
          inArray(providerRates.provider, ["gemini", "openai", "veo"]),
          lte(providerRates.effectiveFrom, new Date()),
          or(isNull(providerRates.effectiveTo), sql`${providerRates.effectiveTo} > now()`),
        )),
    ]);
    if (!balance || !cap || !ownership || ownership.teamId <= 0 || ownership.amount <= 0) {
      throw new Error("Fixture accounting ownership, cap, or credit balance is incomplete");
    }
    const allowanceRemaining = Math.max(0, balance.allowanceCredits - balance.allowanceUsed - balance.allowanceDebt);
    const purchasedRemaining = Math.max(0, balance.purchasedCredits - balance.purchasedUsed - balance.purchasedDebt);
    return {
      credit: {
        legacyBalance: balance.balance,
        allowanceRemaining,
        purchasedRemaining,
        reservedCredits: balance.reservedCredits,
        availableCredits: allowanceRemaining + purchasedRemaining - balance.reservedCredits,
        grantLedgerRowId: ownership.ledgerRowId,
      },
      spendingCap: {
        monthlyCapCents: cap.monthlyCapCents,
        monthlyCapUsd: cap.monthlyCapCents / 100,
        hardStop: cap.hardStop,
      },
      fixtureProviderLedgerBaseline: {
        eventCount: numeric(teamLedger?.eventCount),
        costMicrousd: numeric(teamLedger?.costMicrousd),
        unpricedCount: numeric(teamLedger?.unpricedCount),
      },
      globalProviderLedgerBaseline: {
        eventCount: numeric(globalLedger?.eventCount),
        costMicrousd: numeric(globalLedger?.costMicrousd),
        unpricedCount: numeric(globalLedger?.unpricedCount),
      },
      rateRows,
    };
  });

  const models = getAllModels();
  const modelGroups = {
    gemini: [...new Set([
      models.geminiFlash,
      models.geminiArticle,
      models.geminiPro,
      models.geminiCritique,
      models.geminiImage,
    ])],
    openai: [...new Set([
      models.gptMini,
      models.gptReview,
      models.gptAdvanced,
      models.gptHyperlinkExtract,
      models.gptHyperlinkCorrection,
      models.tts,
    ])],
    veo: [models.veoVideo],
  };
  const pricingCoverage = Object.fromEntries(Object.entries(modelGroups).map(([family, configuredModels]) => {
    const expectedProviders = family === "veo" ? ["gemini", "veo"] : [family];
    return [family, configuredModels.map((model) => {
      const matches = accounting.rateRows.filter((row) =>
        expectedProviders.includes(row.provider) && row.model === model
      );
      return {
        model,
        covered: matches.length > 0,
        unitTypes: [...new Set(matches.map((row) => row.unitType))].sort(),
        rateVersions: [...new Set(matches.map((row) => row.version))].sort(),
        evidenceUrls: [...new Set(matches.map((row) => row.evidenceUrl))].sort(),
      };
    })];
  }));

  const httpConfirmation = await confirmExistingLocalLogin(credentials);
  const report = {
    fixtureLabel: FIXTURE_LABEL,
    generatedAt: new Date().toISOString(),
    isolation: {
      developmentOnly: true,
      syntheticIdentity: true,
      noProviderCallsMade: true,
      noEmailsSent: true,
      noPublishingConnectionsCreated: true,
      targetUrl: TARGET_URL,
      actualAffiliation: false,
    },
    identity: {
      userId: fixture.user.id,
      userPublicId: fixture.user.publicId,
      loginHandle: LOGIN_EMAIL,
      accountStatus: "active",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    team: {
      teamId: fixture.team.id,
      teamPublicId: fixture.team.publicId,
      membershipRole: "admin",
      billingPlan: "enterprise",
      billingStatus: "active",
    },
    generationDraft: {
      batchId: fixture.batch.id,
      batchPublicId: fixture.batch.publicId,
      status: "PENDING",
      businessName: BUSINESS_NAME,
      businessDescription: "Fictitious Boston home energy audit business",
      targetUrl: TARGET_URL,
      actualAffiliation: false,
      autoPublishEnabled: false,
    },
    accounting: {
      ...accounting.credit,
      ...accounting.spendingCap,
      creditGrantRequested: INITIAL_CREDITS,
      grantResultBalance: grant.balance,
      fixtureProviderLedgerBaseline: accounting.fixtureProviderLedgerBaseline,
      globalProviderLedgerBaseline: accounting.globalProviderLedgerBaseline,
    },
    pricingCoverage,
    httpConfirmation,
    credentialFile: CREDENTIAL_PATH,
    credentialFileMode: "0600",
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify({
    setup: "complete",
    userId: fixture.user.id,
    userPublicId: fixture.user.publicId,
    teamId: fixture.team.id,
    teamPublicId: fixture.team.publicId,
    batchId: fixture.batch.id,
    batchPublicId: fixture.batch.publicId,
    loginHandle: LOGIN_EMAIL,
    availableCredits: accounting.credit.availableCredits,
    spendingCapUsd: accounting.spendingCap.monthlyCapUsd,
    httpConfirmed: httpConfirmation.confirmed,
    reportPath: REPORT_PATH,
    credentialPath: CREDENTIAL_PATH,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(`Live-generation fixture setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });