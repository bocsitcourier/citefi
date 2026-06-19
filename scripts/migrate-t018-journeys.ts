/**
 * Migration script — T018: Journey Orchestrator + Cadence Optimizer
 * Creates: journey_templates, journeys, journey_steps, cadence_performance tables
 * and seeds 5 prebuilt journey templates.
 * Run with: node --env-file=.env.local --import tsx/esm scripts/migrate-t018-journeys.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T018 journey orchestrator migration...");

  // ── journey_templates ────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS journey_templates (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      description   TEXT,
      template_type VARCHAR(50) NOT NULL,
      steps_config  JSONB NOT NULL DEFAULT '[]',
      is_builtin    BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS jt_type_idx    ON journey_templates(template_type)`;
  await sql`CREATE INDEX IF NOT EXISTS jt_builtin_idx ON journey_templates(is_builtin)`;
  console.log("  ✓ journey_templates");

  // ── journeys ─────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS journeys (
      id                  SERIAL PRIMARY KEY,
      team_id             INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name                VARCHAR(255) NOT NULL,
      template_type       VARCHAR(50),
      template_id         INTEGER REFERENCES journey_templates(id) ON DELETE SET NULL,
      trigger_type        VARCHAR(20) NOT NULL DEFAULT 'manual',
      status              VARCHAR(20) NOT NULL DEFAULT 'draft',
      terminal_kpi        VARCHAR(50) NOT NULL,
      locale              VARCHAR(20),
      locale_config       JSONB,
      trigger_article_id  INTEGER,
      triggered_at        TIMESTAMP,
      completed_at        TIMESTAMP,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS j_team_idx        ON journeys(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS j_status_idx      ON journeys(status)`;
  await sql`CREATE INDEX IF NOT EXISTS j_team_status_idx ON journeys(team_id, status)`;
  console.log("  ✓ journeys");

  // ── journey_steps ────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS journey_steps (
      id            SERIAL PRIMARY KEY,
      journey_id    INTEGER NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      step_index    INTEGER NOT NULL,
      content_type  VARCHAR(50) NOT NULL,
      day_offset    INTEGER NOT NULL DEFAULT 0,
      topic_angle   TEXT,
      channel       VARCHAR(50),
      status        VARCHAR(20) NOT NULL DEFAULT 'pending',
      article_id    INTEGER,
      batch_id      INTEGER,
      scheduled_for TIMESTAMP,
      published_at  TIMESTAMP,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS js_journey_idx          ON journey_steps(journey_id)`;
  await sql`CREATE INDEX IF NOT EXISTS js_status_idx           ON journey_steps(status)`;
  await sql`CREATE INDEX IF NOT EXISTS js_scheduled_idx        ON journey_steps(scheduled_for)`;
  await sql`CREATE INDEX IF NOT EXISTS js_status_scheduled_idx ON journey_steps(status, scheduled_for)`;
  console.log("  ✓ journey_steps");

  // ── cadence_performance ──────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS cadence_performance (
      id                   SERIAL PRIMARY KEY,
      team_id              INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      content_type         VARCHAR(50) NOT NULL,
      weekly_frequency     INTEGER NOT NULL,
      avg_engagement_score INTEGER NOT NULL DEFAULT 0,
      avg_conversion_rate  INTEGER NOT NULL DEFAULT 0,
      sample_size          INTEGER NOT NULL DEFAULT 0,
      period_start         TIMESTAMP NOT NULL,
      period_end           TIMESTAMP NOT NULL,
      computed_at          TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS cp_team_idx         ON cadence_performance(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS cp_team_content_idx ON cadence_performance(team_id, content_type)`;
  await sql`CREATE INDEX IF NOT EXISTS cp_computed_at_idx  ON cadence_performance(computed_at)`;
  console.log("  ✓ cadence_performance");

  // ── Seed 5 prebuilt journey templates ────────────────────────────────────
  const localSeoSteps = JSON.stringify([
    { stepIndex: 0, contentType: "article",  dayOffset: 0,  topicAngle: "Pillar: comprehensive local SEO authority piece" },
    { stepIndex: 1, contentType: "social",   dayOffset: 1,  topicAngle: "Key takeaway social post with local hook", channel: "facebook" },
    { stepIndex: 2, contentType: "social",   dayOffset: 3,  topicAngle: "FAQ-style social post answering top local question", channel: "instagram" },
    { stepIndex: 3, contentType: "social",   dayOffset: 7,  topicAngle: "Testimonial-style social post highlighting local authority", channel: "linkedin" },
    { stepIndex: 4, contentType: "podcast",  dayOffset: 14, topicAngle: "Deep-dive podcast episode summarizing pillar article insights" },
    { stepIndex: 5, contentType: "video",    dayOffset: 21, topicAngle: "60-second video summary with local CTA" },
  ]);
  const productLaunchSteps = JSON.stringify([
    { stepIndex: 0, contentType: "social",  dayOffset: 0,  topicAngle: "Launch announcement with excitement hook", channel: "facebook" },
    { stepIndex: 1, contentType: "article", dayOffset: 2,  topicAngle: "Deep-dive article: everything you need to know about [product]" },
    { stepIndex: 2, contentType: "article", dayOffset: 5,  topicAngle: "FAQ article: top 10 questions about [product] answered" },
    { stepIndex: 3, contentType: "social",  dayOffset: 10, topicAngle: "Testimonial-style social post with early adopter results", channel: "linkedin" },
    { stepIndex: 4, contentType: "podcast", dayOffset: 20, topicAngle: "Podcast interview-style episode: the story behind the launch" },
  ]);
  const thoughtLeadershipSteps = JSON.stringify([
    { stepIndex: 0, contentType: "article", dayOffset: 0,  topicAngle: "Opinion/perspective article: bold take on industry trend" },
    { stepIndex: 1, contentType: "social",  dayOffset: 1,  topicAngle: "LinkedIn post: sharp insight from article", channel: "linkedin" },
    { stepIndex: 2, contentType: "social",  dayOffset: 3,  topicAngle: "LinkedIn post: contrarian data point from article", channel: "linkedin" },
    { stepIndex: 3, contentType: "social",  dayOffset: 7,  topicAngle: "LinkedIn post: practical takeaway with engagement question", channel: "linkedin" },
    { stepIndex: 4, contentType: "podcast", dayOffset: 14, topicAngle: "Podcast episode expanding on article thesis with examples" },
  ]);
  const evergreenSteps = JSON.stringify([
    { stepIndex: 0, contentType: "article", dayOffset: 0,  topicAngle: "Comprehensive evergreen how-to or guide" },
    { stepIndex: 1, contentType: "social",  dayOffset: 1,  topicAngle: "Social post: top 3 tips from article" },
    { stepIndex: 2, contentType: "social",  dayOffset: 2,  topicAngle: "Social post: common mistake people make (from article)" },
    { stepIndex: 3, contentType: "social",  dayOffset: 5,  topicAngle: "Social post: step-by-step breakdown of key section" },
    { stepIndex: 4, contentType: "social",  dayOffset: 9,  topicAngle: "Social post: stats and data callout from article" },
    { stepIndex: 5, contentType: "social",  dayOffset: 14, topicAngle: "Social post: before/after or transformation story" },
    { stepIndex: 6, contentType: "video",   dayOffset: 30, topicAngle: "60-second video: the single most important insight from article" },
  ]);
  const churnRescueSteps = JSON.stringify([
    { stepIndex: 0, contentType: "social",  dayOffset: 0,  topicAngle: "Re-engagement social: reminder of core value delivered", channel: "facebook" },
    { stepIndex: 1, contentType: "social",  dayOffset: 2,  topicAngle: "Engagement social: ask a question, invite response", channel: "instagram" },
    { stepIndex: 2, contentType: "social",  dayOffset: 5,  topicAngle: "Value social: exclusive tip or insight for loyal audience", channel: "linkedin" },
    { stepIndex: 3, contentType: "article", dayOffset: 7,  topicAngle: "Value-demonstration article: ROI and results from working with us" },
    { stepIndex: 4, contentType: "video",   dayOffset: 14, topicAngle: "Video testimonial: real customer story and outcome" },
  ]);

  const templates = [
    { name: "Local SEO Journey",       desc: "Pillar article → social amplification → podcast → video. The go-to sequence for local service businesses.", type: "local_seo",          steps: localSeoSteps },
    { name: "Product Launch Journey",  desc: "Announcement social → article deep-dive → FAQ → testimonial → podcast. Perfect for new service or product launches.", type: "product_launch",     steps: productLaunchSteps },
    { name: "Thought Leadership Journey", desc: "Opinion article → LinkedIn posts → podcast. Establishes authority and drives professional audience engagement.", type: "thought_leadership", steps: thoughtLeadershipSteps },
    { name: "Evergreen SEO Journey",   desc: "Article → 5 social variants → video. Maximizes long-term organic traffic from a single core piece.", type: "evergreen_seo",      steps: evergreenSteps },
    { name: "Churn Rescue Journey",    desc: "3 engagement social posts → value article → video testimonial. Re-engages at-risk audience segments.", type: "churn_rescue",       steps: churnRescueSteps },
  ];

  for (const t of templates) {
    const existing = await sql`SELECT id FROM journey_templates WHERE template_type = ${t.type} AND is_builtin = true`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO journey_templates (name, description, template_type, steps_config, is_builtin)
        VALUES (${t.name}, ${t.desc}, ${t.type}, ${t.steps}::jsonb, true)
      `;
      console.log(`  ✓ seeded template: ${t.name}`);
    } else {
      console.log(`  ↩ template already exists: ${t.name}`);
    }
  }

  console.log("\n✅ T018 journey orchestrator migration complete.");
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
