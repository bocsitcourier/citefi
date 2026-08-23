import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { POST } from "../../app/api/events/conversion/route";
import { closeDb, systemDb } from "../../lib/db";
import {
  articles,
  contentEvents,
  jobBatches,
  teams,
  users,
} from "../../shared/schema";

after(async () => {
  await closeDb();
});

function signedRequest(rawBody: string, secret: string): NextRequest {
  const signature = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return new NextRequest("http://localhost/api/events/conversion", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-citefi-signature": `sha256=${signature}`,
    },
    body: rawBody,
  });
}

void test("signed conversion resolves ownership, enters tenant RLS, and rejects cross-team content", async () => {
  const marker = `conversion-rls-${Date.now()}`;
  const secretA = `${marker}-secret-a`;
  const secretB = `${marker}-secret-b`;

  const [user] = await systemDb
    .insert(users)
    .values({
      email: `${marker}@test.invalid`,
      role: "team_member",
      accountStatus: "active",
    })
    .returning({ id: users.id });
  assert.ok(user, "conversion fixture user must be created");

  const [teamA] = await systemDb
    .insert(teams)
    .values({
      name: `${marker}-a`,
      createdBy: user.id,
      conversionWebhookSecret: secretA,
    })
    .returning({ id: teams.id });
  const [teamB] = await systemDb
    .insert(teams)
    .values({
      name: `${marker}-b`,
      createdBy: user.id,
      conversionWebhookSecret: secretB,
    })
    .returning({ id: teams.id });
  assert.ok(teamA && teamB, "conversion fixture teams must be created");

  const [batch] = await systemDb
    .insert(jobBatches)
    .values({
      userId: user.id,
      teamId: teamA.id,
      coreTopic: marker,
      targetUrl: "https://example.test",
      status: "COMPLETED",
      numArticlesRequested: 1,
    })
    .returning({ id: jobBatches.id });
  assert.ok(batch, "conversion fixture batch must be created");

  const [article] = await systemDb
    .insert(articles)
    .values({
      batchId: batch.id,
      teamId: teamA.id,
      chosenTitle: marker,
      articleStatus: "PENDING",
    })
    .returning({ id: articles.id });
  assert.ok(article, "conversion fixture article must be created");

  try {
    const validBody = JSON.stringify({
      contentType: "article",
      contentId: article.id,
      conversionType: "lead",
      value: 25,
    });
    const validResponse = await POST(signedRequest(validBody, secretA));
    assert.equal(validResponse.status, 200);
    const validJson = await validResponse.json();
    assert.equal(validJson.ok, true);

    const [created] = await systemDb
      .select({
        id: contentEvents.id,
        teamId: contentEvents.teamId,
        articleId: contentEvents.articleId,
      })
      .from(contentEvents)
      .where(eq(contentEvents.id, validJson.id))
      .limit(1);
    assert.ok(created, "signed conversion must persist");
    assert.equal(created.teamId, teamA.id);
    assert.equal(created.articleId, article.id);

    const invalidResponse = await POST(
      signedRequest(validBody, "wrong-secret")
    );
    assert.equal(invalidResponse.status, 401);

    const spoofedBody = JSON.stringify({
      teamId: teamB.id,
      contentType: "article",
      contentId: article.id,
      conversionType: "purchase",
      value: 100,
    });
    const spoofedResponse = await POST(
      signedRequest(spoofedBody, secretB)
    );
    assert.equal(
      spoofedResponse.status,
      204,
      "a valid team-B signature must not access team-A content"
    );

    const allEvents = await systemDb
      .select({ id: contentEvents.id })
      .from(contentEvents)
      .where(eq(contentEvents.articleId, article.id));
    assert.equal(allEvents.length, 1, "only the valid tenant event may exist");
  } finally {
    await systemDb
      .delete(contentEvents)
      .where(eq(contentEvents.articleId, article.id));
    await systemDb.delete(articles).where(eq(articles.id, article.id));
    await systemDb.delete(jobBatches).where(eq(jobBatches.id, batch.id));
    await systemDb.delete(teams).where(eq(teams.id, teamA.id));
    await systemDb.delete(teams).where(eq(teams.id, teamB.id));
    await systemDb.delete(users).where(eq(users.id, user.id));
  }
});