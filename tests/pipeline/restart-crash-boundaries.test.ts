import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../lib/db";
import {
  claimArticleImageStage,
  completeArticleImageStage,
  reconcilePendingArticleBilling,
} from "../../lib/article-run-state";
import { reserveCredits } from "../../lib/billing";
import { generateImagesForArticle } from "../../lib/gemini-image-generator";
import {
  articleAssets,
  articleRuns,
  articles,
  creditBalances,
  creditLedger,
  jobBatches,
  teamMembers,
  teams,
  users,
} from "../../shared/schema";

after(async () => {
  const [{ closeGeminiRateLimiter }, { closeOpenAIClient }] = await Promise.all([
    import("../../lib/gemini"),
    import("../../lib/openai-client"),
  ]);
  await Promise.all([
    closeGeminiRateLimiter(),
    closeOpenAIClient(),
  ]);
  await closeDb();
});

async function seedArticle(suffix: string) {
  const marker = `t119-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [user] = await db.insert(users).values({
    email: `${marker}@test.invalid`,
    passwordHash: "x",
    role: "team_member",
    accountStatus: "active",
  }).returning();
  assert.ok(user);
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  assert.ok(team);
  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: "owner",
  });
  const [batch] = await db.insert(jobBatches).values({
    userId: user.id,
    teamId: team.id,
    coreTopic: marker,
    targetUrl: "https://example.test",
    businessName: "Crash Boundary Test",
    status: "RUNNING",
    numArticlesRequested: 1,
  }).returning();
  assert.ok(batch);
  const [article] = await db.insert(articles).values({
    batchId: batch.id,
    teamId: team.id,
    chosenTitle: marker,
    articleStatus: "COMPLETE",
    finalHtmlContent: "<article>durable content</article>",
  }).returning();
  assert.ok(article);
  return { user, team, batch, article };
}

async function cleanupSeed(seed: Awaited<ReturnType<typeof seedArticle>>) {
  await db.delete(creditLedger).where(eq(creditLedger.teamId, seed.team.id));
  await db.delete(creditBalances).where(eq(creditBalances.teamId, seed.team.id));
  await db.delete(articleAssets).where(eq(articleAssets.articleId, seed.article.id));
  await db.delete(articleRuns).where(eq(articleRuns.articleId, seed.article.id));
  await db.delete(articles).where(eq(articles.id, seed.article.id));
  await db.delete(jobBatches).where(eq(jobBatches.id, seed.batch.id));
  await db.delete(teamMembers).where(eq(teamMembers.teamId, seed.team.id));
  await db.delete(teams).where(eq(teams.id, seed.team.id));
  await db.delete(users).where(eq(users.id, seed.user.id));
}

test("a final-attempt crash after COMPLETE settles without provider re-entry", async () => {
  const seed = await seedArticle("settlement");
  const articleRunId = randomUUID();
  const billingRunId = `billing-${randomUUID()}`;
  const billingJobId = `job-${randomUUID()}`;

  try {
    await db.insert(creditBalances).values({
      teamId: seed.team.id,
      allowanceCredits: 100,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      balance: 100,
    });
    await reserveCredits({
      teamId: seed.team.id,
      operationType: "article",
      runId: billingRunId,
      amount: 10,
    });
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId: articleRunId,
      status: "running",
      completedAt: new Date(),
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
      billingTeamId: seed.team.id,
      billingRunId,
      billingAmount: 10,
      billingJobId,
    });

    const result = await reconcilePendingArticleBilling(
      new Date(),
      1,
      [articleRunId]
    );

    assert.deepEqual(result, { settled: 1, deferred: 0 });
    const [run] = await db
      .select()
      .from(articleRuns)
      .where(eq(articleRuns.runId, articleRunId));
    assert.ok(run);
    assert.equal(run.status, "completed");
    assert.equal(run.leaseToken, null);
    assert.equal(run.settlementLastError, null);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(and(
        eq(creditLedger.teamId, seed.team.id),
        eq(creditLedger.runId, billingRunId)
      ));
    assert.equal(
      ledger.filter((row) => row.eventType === "debit").length,
      1,
      "independent reconciliation must debit exactly once"
    );
    assert.equal(
      ledger.find((row) => row.eventType === "reserve")?.reservationStatus,
      "DEBITED"
    );
  } finally {
    await cleanupSeed(seed);
  }
});

test("legacy COMPLETE runs without billing identity are not promoted into settlement", async () => {
  const seed = await seedArticle("legacy-no-billing");
  const runId = randomUUID();

  try {
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId,
      status: "running",
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });

    const result = await reconcilePendingArticleBilling(
      new Date(),
      1,
      [runId]
    );
    assert.deepEqual(result, { settled: 0, deferred: 0 });

    const [run] = await db
      .select({
        status: articleRuns.status,
        settlementAttempts: articleRuns.settlementAttempts,
        settlementLastError: articleRuns.settlementLastError,
      })
      .from(articleRuns)
      .where(eq(articleRuns.runId, runId));
    assert.ok(run);
    assert.equal(run.status, "running");
    assert.equal(run.settlementAttempts, 0);
    assert.equal(run.settlementLastError, null);
  } finally {
    await cleanupSeed(seed);
  }
});

test("an uploaded image is reused after a crash and committed with its checkpoint", async () => {
  const seed = await seedArticle("image");
  const runId = randomUUID();
  const durableUrl = `https://cdn.example.test/${runId}.png`;

  try {
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId,
      status: "completed",
      completedAt: new Date(),
    });
    const [asset] = await db.insert(articleAssets).values({
      articleId: seed.article.id,
      teamId: seed.team.id,
      assetType: "image",
      storageUrl: durableUrl,
      fileFormat: "png",
      imagePromptUsed: "durable prompt",
      metadataJson: {
        articleRunId: runId,
        isHeroImage: true,
      },
    }).returning();
    assert.ok(asset);

    const recovered = await generateImagesForArticle(
      seed.article.id,
      ["this provider call must be skipped"],
      "Crash Boundary Test",
      "https://example.test",
      runId
    );
    assert.equal(recovered[0]?.url, durableUrl);
    assert.equal(recovered[0]?.assetId, asset.id);
    assert.equal(recovered[0]?.reused, true);

    const imageLeaseToken = await claimArticleImageStage({
      articleId: seed.article.id,
      runId,
    });
    assert.ok(imageLeaseToken);
    await completeArticleImageStage({
      articleId: seed.article.id,
      runId,
      imageLeaseToken,
      heroImageUrl: recovered[0]!.url,
    });

    const [article] = await db
      .select({ heroImageUrl: articles.heroImageUrl })
      .from(articles)
      .where(eq(articles.id, seed.article.id));
    const [run] = await db
      .select({
        imageGeneratedAt: articleRuns.imageGeneratedAt,
        imageLeaseToken: articleRuns.imageLeaseToken,
      })
      .from(articleRuns)
      .where(eq(articleRuns.runId, runId));
    assert.ok(article);
    assert.ok(run);
    assert.equal(article.heroImageUrl, durableUrl);
    assert.ok(run.imageGeneratedAt);
    assert.equal(run.imageLeaseToken, null);
  } finally {
    await cleanupSeed(seed);
  }
});