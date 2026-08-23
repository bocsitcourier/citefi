/**
 * Shared fixtures for Task #151 campaign tests.
 * =============================================
 * Creates two isolated teams (A and B), each with an owner user, so tests can
 * assert tenant isolation between them. Uses the privileged `systemDb` client so
 * setup/teardown are not subject to RLS (the service under test enforces tenancy
 * via explicit teamId predicates on the ordinary `db` client, which is what the
 * tests exercise).
 *
 * Every row created here is tracked and removed by cleanupCampaignSeed(), and
 * FK cascades (teams → campaigns → campaign_exports/children) clean the rest.
 */
import { systemDb } from "../../lib/db.js";
import {
  users,
  teams,
  teamMembers,
  campaigns,
  campaignExports,
  jobBatches,
  articles,
  socialPosts,
  videoIdeas,
} from "../../shared/schema.js";
import { eq, inArray } from "drizzle-orm";

export interface CampaignSeed {
  runId: string;
  userA: { id: number; email: string };
  userB: { id: number; email: string };
  teamA: { id: number };
  teamB: { id: number };
}

/** Unique per invocation so parallel/re-runs never collide on unique columns. */
export function makeRunId(): string {
  return `t151_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export async function seedCampaignFixtures(runId: string): Promise<CampaignSeed> {
  const [userA] = await systemDb
    .insert(users)
    .values({
      email: `${runId}-a@test.invalid`,
      role: "team_member",
      accountStatus: "active",
    })
    .returning({ id: users.id, email: users.email });
  const [userB] = await systemDb
    .insert(users)
    .values({
      email: `${runId}-b@test.invalid`,
      role: "team_member",
      accountStatus: "active",
    })
    .returning({ id: users.id, email: users.email });
  if (!userA || !userB) throw new Error("Failed to seed campaign users");

  const [teamA] = await systemDb
    .insert(teams)
    .values({ name: `${runId}-team-a`, createdBy: userA.id })
    .returning({ id: teams.id });
  const [teamB] = await systemDb
    .insert(teams)
    .values({ name: `${runId}-team-b`, createdBy: userB.id })
    .returning({ id: teams.id });
  if (!teamA || !teamB) throw new Error("Failed to seed campaign teams");

  await systemDb.insert(teamMembers).values([
    { teamId: teamA.id, userId: userA.id, role: "owner" },
    { teamId: teamB.id, userId: userB.id, role: "owner" },
  ]);

  return {
    runId,
    userA: { id: userA.id, email: userA.email },
    userB: { id: userB.id, email: userB.email },
    teamA: { id: teamA.id },
    teamB: { id: teamB.id },
  };
}

/**
 * Remove everything created for this run. Children are deleted explicitly first
 * (some have no ON DELETE CASCADE from users), then teams (cascades to
 * campaigns → campaign_exports), then users.
 */
export async function cleanupCampaignSeed(seed: CampaignSeed): Promise<void> {
  const teamIds = [seed.teamA.id, seed.teamB.id];
  const userIds = [seed.userA.id, seed.userB.id];

  // Content children that reference teams but may not cascade cleanly.
  await systemDb.delete(campaignExports).where(inArray(campaignExports.teamId, teamIds));
  await systemDb.delete(articles).where(inArray(articles.teamId, teamIds));
  await systemDb.delete(socialPosts).where(inArray(socialPosts.teamId, teamIds));
  await systemDb.delete(videoIdeas).where(inArray(videoIdeas.teamId, teamIds));
  await systemDb.delete(jobBatches).where(inArray(jobBatches.teamId, teamIds));
  await systemDb.delete(campaigns).where(inArray(campaigns.teamId, teamIds));
  await systemDb.delete(teamMembers).where(inArray(teamMembers.teamId, teamIds));
  await systemDb.delete(teams).where(inArray(teams.id, teamIds));
  await systemDb.delete(users).where(inArray(users.id, userIds));
}

/** Seed a minimal completed article for a campaign so exports have content. */
export async function seedCompletedArticle(opts: {
  teamId: number;
  userId: number;
  campaignId: number;
  title: string;
  html: string;
  slug: string;
}): Promise<{ batchId: number; articleId: number }> {
  const [batch] = await systemDb
    .insert(jobBatches)
    .values({
      userId: opts.userId,
      teamId: opts.teamId,
      campaignId: opts.campaignId,
      coreTopic: opts.title,
      targetUrl: "https://example.test",
      status: "COMPLETE",
      numArticlesRequested: 1,
    })
    .returning({ id: jobBatches.id });
  if (!batch) throw new Error("Failed to seed campaign batch");

  const [article] = await systemDb
    .insert(articles)
    .values({
      batchId: batch.id,
      teamId: opts.teamId,
      campaignId: opts.campaignId,
      chosenTitle: opts.title,
      articleStatus: "COMPLETE",
      finalHtmlContent: opts.html,
      slug: opts.slug,
      wordCount: 3,
    })
    .returning({ id: articles.id });
  if (!article) throw new Error("Failed to seed campaign article");

  return { batchId: batch.id, articleId: article.id };
}

export { systemDb, campaigns, campaignExports, jobBatches, articles, eq };
