import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthHttpUiSeed } from "./auth-http-ui-seed";

export async function seedPublishingReviewUi(seed: AuthHttpUiSeed) {
  const { systemDb } = await import("../../lib/db");
  const { users, teams, teamMembers, articles, articleAssets, jobBatches, publishingConnections } = await import("../../shared/schema");
  const { encryptApiKey, hashApiKey } = await import("../../lib/publishing/auth/hmac");
  const { eq, sql } = await import("drizzle-orm");
  const target = await systemDb.execute(sql`SELECT current_user AS owner, inet_server_port() AS port`);
  const identity = (target as any).rows?.[0];
  if (identity?.owner !== "qa_auth_http" || Number(identity?.port) !== 55485) throw new Error("Owned UI database identity did not match");
  // Auth fixtures intentionally install only auth grants. This optional review
  // fixture installs the real tenant policy in its proven disposable cluster.
  await systemDb.execute(sql.raw(await readFile(new URL("../../migrations/0014_tenant_rls.sql", import.meta.url), "utf8")));
  const [team] = await systemDb.insert(teams).values({ name: "Owned review UI workspace", createdBy: seed.member.id }).returning();
  await systemDb.insert(teamMembers).values({ userId: seed.member.id, teamId: team!.id, role: "owner" });
  await systemDb.update(users).set({ defaultTeamId: team!.id }).where(eq(users.id, seed.member.id));
  const [batch] = await systemDb.insert(jobBatches).values({ teamId: team!.id, userId: seed.member.id, coreTopic: "Isolated reviewed destination", targetUrl: "https://example.invalid", numArticlesRequested: 1 }).returning();
  const [article] = await systemDb.insert(articles).values({ teamId: team!.id, batchId: batch!.id,
    chosenTitle: "Owned exact destination review", articleStatus: "COMPLETE",
    finalHtmlContent: "<p>Precisely reviewed fixture body. No live publication.</p>",
    seoTitle: "Owned review metadata", metaDescription: "Immutable review fixture metadata",
    approvalStatus: "in_review", approvalRequestedAt: new Date() }).returning();
  const key = `private/articles/${article!.id}/review.png`;
  // Valid synthetic 1px PNG, not customer media.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
  const file = join("/tmp/privatefixture/review-media-fixture", key);
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, png);
  await systemDb.insert(articleAssets).values({ articleId: article!.id, teamId: team!.id, storageUrl: `/api/public-objects/${key}`, fileFormat: "png", altText: "Owned pixel fixture" });
  await systemDb.update(articles).set({ heroImageUrl: `/api/public-objects/${key}` }).where(eq(articles.id, article!.id));
  const [connection] = await systemDb.insert(publishingConnections).values({ teamId: team!.id, name: "Owned receiver — example.invalid", channel: "website",
    status: "active", baseUrl: "https://example.invalid/blog", apiKeyHash: hashApiKey("owned-ui-account-key"),
    encryptedApiKey: encryptApiKey("owned-ui-account-key") }).returning();
  return { articleId: article!.id, connectionId: connection!.id, teamId: team!.id, policy: "Owned isolated services; no receiver publication or provider calls authorized" };
}
