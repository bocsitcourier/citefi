import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AuthHttpUiSeed } from "./auth-http-ui-seed";

export const PUBLISHING_UI_ENCRYPTION_FIXTURE = "offline-publishing-ui-only-key-32";
export async function seedPublishingReconciliationUi(seed: AuthHttpUiSeed) {
  const { db } = await import("../../lib/db");
  const { sql, eq } = await import("drizzle-orm");
  const { runWithSystemContext } = await import("../../lib/tenant-context");
  const s = await import("../../shared/schema");
  const { hashApiKey, encryptApiKey } = await import("../../lib/publishing/auth/hmac");
  const { generateAccessToken, hashToken } = await import("../../lib/auth");
  process.env.API_KEY_ENCRYPTION_SECRET = PUBLISHING_UI_ENCRYPTION_FIXTURE;
  return runWithSystemContext("owned offline publishing UI fixtures", async () => {
    // Only the disposable auth-UI database created by the caller is touched.
    for (const file of ["0014_tenant_rls.sql", "0037_publishing_client_summary.sql"]) {
      await db.execute(sql.raw(await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8")));
    }
    const [team] = await db.insert(s.teams).values({ name: `Owned publishing UI ${randomUUID()}`, createdBy: seed.admin.id }).returning();
    if (!team) throw new Error("Owned publishing team seed failed");
    const actors: Record<string, { token: string; userId: number }> = {};
    for (const [name, user, role] of [
      ["operator", seed.admin, "owner"], ["member", seed.member, "member"], ["client", seed.mfaMember, "client_viewer"],
    ] as const) {
      await db.insert(s.teamMembers).values({ teamId: team.id, userId: user.id, role });
      await db.update(s.users).set({ defaultTeamId: team.id }).where(eq(s.users.id, user.id));
      const token = generateAccessToken({ userId: user.id, email: user.email, role: name === "operator" ? "admin" : "team_member" });
      await db.insert(s.sessions).values({ userId: user.id, teamContextId: team.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) });
      actors[name] = { token, userId: user.id };
    }
    const key = "owned-ui-native-receiver-fixture-key";
    const [connection] = await db.insert(s.publishingConnections).values({
      teamId: team.id, name: "Offline fixture receiver", channel: "website", status: "active", baseUrl: "https://example.invalid",
      encryptedApiKey: encryptApiKey(key), apiKeyHash: hashApiKey(key), capabilities: { articles: true, publishingReceiptV1: false },
    }).returning();
    const [batch] = await db.insert(s.jobBatches).values({ teamId: team.id, userId: seed.admin.id,
      coreTopic: "Owned publishing UI", targetUrl: "https://example.invalid", numArticlesRequested: 3 }).returning();
    if (!connection || !batch) throw new Error("Owned fixture seed failed");
    const fixtures = [];
    const { websiteAdapter } = await import("../../lib/publishing/channels/website/adapter");
    const { publicationHash, reviewHash } = await import("../../lib/publishing/dispatch-policy");
    const { buildReviewManifest, persistReview, assertCurrentActor } = await import("../../lib/publishing/review-binding");
    for (const outcome of ["accepted", "not_accepted", "legacy"] as const) {
      const at = new Date(Date.now() - 60000);
      const [article] = await db.insert(s.articles).values({
        teamId: team.id, batchId: batch.id, chosenTitle: `Owned UI ${outcome}`, finalHtmlContent: "<p>Owned fixture only.</p>",
        articleStatus: "COMPLETE", approvalStatus: "approved", approvalTeamId: team.id, approvalReviewedAt: at, updatedAt: at,
      }).returning();
      if (!article) throw new Error("Owned article seed failed");
      const reviewer = { userId: seed.admin.id, teamId: team.id, role: "owner" as const };
      const { snapshot, publisherMembership } = await db.transaction(async tx => ({
        snapshot: await persistReview(tx, article, await buildReviewManifest(tx, article, connection, "article"), reviewer),
        publisherMembership: await assertCurrentActor(tx, reviewer, ["owner"]),
      }));
      const hash = reviewHash({ publication: publicationHash(snapshot.formatted, connection), reviewDigest: snapshot.digest });
      const [job] = await db.insert(s.publishingJobs).values({
        teamId: team.id, connectionId: connection.id, articleId: article.id, contentType: "article",
        status: "outcome_unknown", attempts: 1, lastAttemptAt: at, lastError: "Owned simulated lost reply",
        errorDetails: outcome === "legacy" ? {} : { dispatchContract: { version: 1, hash, submissionStarted: true,
          reviewId: snapshot.reviewId, publisherUserId: seed.admin.id, publisherRole: "owner", publisherMembership,
          receiverOrigin: "https://example.invalid", receiverKeyHash: hashApiKey(key) } },
      }).returning();
      if (!job) throw new Error("Owned publishing job seed failed");
      const rawReceipt = JSON.stringify({ version: 1, receiptId: randomUUID(), jobId: job.publicId,
        dispatchAttempt: at.toISOString(), contentHash: hash, receiverOrigin: "https://example.invalid",
        outcome: outcome === "legacy" ? "accepted" : outcome, final: true, operationFenced: outcome === "not_accepted",
        observedAt: new Date().toISOString(), ...(outcome === "accepted" || outcome === "legacy" ? { pageUrl: "https://example.invalid/owned-fixture" } : {}) });
      fixtures.push({ outcome, jobId: job.id, rawReceipt,
        signature: createHmac("sha256", key).update(`publishing-receipt-v1.${rawReceipt}`).digest("hex") });
    }
    return { teamId: team.id, actors, fixtures, receiverCalls: 0, paidCalls: 0 };
  });
}
