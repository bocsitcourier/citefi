/**
 * Migration script — T012, T014, T015, T016 tables
 * Uses the Neon serverless HTTP driver (matches the API-route DB driver).
 * Run with: node --env-file=.env.local --import tsx/esm scripts/migrate-t014-t016.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T012–T016 migrations...");

  // ── T012: content_feedback ──────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS content_feedback (
      id              SERIAL PRIMARY KEY,
      team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_type    VARCHAR(20) NOT NULL,
      article_id      INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      social_post_id  INTEGER REFERENCES social_posts(id) ON DELETE CASCADE,
      rating          VARCHAR(10) NOT NULL,
      comment         TEXT,
      metric_id       INTEGER,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS content_feedback_team_id_idx      ON content_feedback(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS content_feedback_content_type_idx ON content_feedback(content_type)`;
  await sql`CREATE INDEX IF NOT EXISTS content_feedback_rating_idx        ON content_feedback(rating)`;
  await sql`CREATE INDEX IF NOT EXISTS content_feedback_created_at_idx    ON content_feedback(created_at)`;
  console.log("  ✓ content_feedback");

  // ── T014: content_events ────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS content_events (
      id              BIGSERIAL PRIMARY KEY,
      team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      content_type    VARCHAR(20) NOT NULL,
      article_id      INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      social_post_id  INTEGER REFERENCES social_posts(id) ON DELETE CASCADE,
      event_type      VARCHAR(30) NOT NULL,
      session_id      VARCHAR(100),
      ip_hash         VARCHAR(64),
      metadata        JSONB,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS content_events_team_id_idx         ON content_events(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS content_events_event_type_idx       ON content_events(event_type)`;
  await sql`CREATE INDEX IF NOT EXISTS content_events_article_id_idx       ON content_events(article_id)`;
  await sql`CREATE INDEX IF NOT EXISTS content_events_social_post_id_idx   ON content_events(social_post_id)`;
  await sql`CREATE INDEX IF NOT EXISTS content_events_created_at_idx       ON content_events(created_at)`;
  console.log("  ✓ content_events");

  // ── T015: client_intelligence ───────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS client_intelligence (
      id               SERIAL PRIMARY KEY,
      team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      content_type     VARCHAR(20) NOT NULL,
      article_id       INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      social_post_id   INTEGER REFERENCES social_posts(id) ON DELETE CASCADE,
      window_days      INTEGER NOT NULL DEFAULT 30,
      views            INTEGER NOT NULL DEFAULT 0,
      clicks           INTEGER NOT NULL DEFAULT 0,
      shares           INTEGER NOT NULL DEFAULT 0,
      conversions      INTEGER NOT NULL DEFAULT 0,
      unique_sessions  INTEGER NOT NULL DEFAULT 0,
      ctr              REAL NOT NULL DEFAULT 0,
      conversion_rate  REAL NOT NULL DEFAULT 0,
      engagement_score REAL NOT NULL DEFAULT 0,
      computed_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS client_intelligence_team_id_idx          ON client_intelligence(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS client_intelligence_engagement_idx        ON client_intelligence(engagement_score)`;
  await sql`CREATE INDEX IF NOT EXISTS client_intelligence_article_id_idx        ON client_intelligence(article_id)`;
  await sql`CREATE INDEX IF NOT EXISTS client_intelligence_social_post_id_idx    ON client_intelligence(social_post_id)`;
  console.log("  ✓ client_intelligence");

  // ── T016: decision_policies ─────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS decision_policies (
      id               SERIAL PRIMARY KEY,
      team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      content_type     VARCHAR(20) NOT NULL DEFAULT 'article',
      objective        VARCHAR(50) NOT NULL DEFAULT 'maximize_conversions',
      exploration_rate REAL NOT NULL DEFAULT 0.1,
      holdout_percent  REAL NOT NULL DEFAULT 0.1,
      active           BOOLEAN NOT NULL DEFAULT TRUE,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS decision_policies_team_id_idx ON decision_policies(team_id)`;
  console.log("  ✓ decision_policies");

  // ── T016: decision_arms ─────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS decision_arms (
      id               SERIAL PRIMARY KEY,
      policy_id        INTEGER NOT NULL REFERENCES decision_policies(id) ON DELETE CASCADE,
      team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      content_type     VARCHAR(20) NOT NULL,
      article_id       INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      social_post_id   INTEGER REFERENCES social_posts(id) ON DELETE CASCADE,
      label            VARCHAR(100),
      prior_alpha      REAL NOT NULL DEFAULT 1.0,
      prior_beta       REAL NOT NULL DEFAULT 1.0,
      posterior_alpha  REAL NOT NULL DEFAULT 1.0,
      posterior_beta   REAL NOT NULL DEFAULT 1.0,
      impressions      INTEGER NOT NULL DEFAULT 0,
      conversions      INTEGER NOT NULL DEFAULT 0,
      active           BOOLEAN NOT NULL DEFAULT TRUE,
      last_updated     TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS decision_arms_policy_id_idx ON decision_arms(policy_id)`;
  await sql`CREATE INDEX IF NOT EXISTS decision_arms_team_id_idx   ON decision_arms(team_id)`;
  console.log("  ✓ decision_arms");

  // ── T016: holdout_assignments ───────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS holdout_assignments (
      id            SERIAL PRIMARY KEY,
      team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      policy_id     INTEGER NOT NULL REFERENCES decision_policies(id) ON DELETE CASCADE,
      visitor_hash  VARCHAR(64) NOT NULL,
      is_holdout    BOOLEAN NOT NULL DEFAULT FALSE,
      arm_id        INTEGER REFERENCES decision_arms(id) ON DELETE SET NULL,
      outcome       VARCHAR(20),
      assigned_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS holdout_assignments_policy_visitor_idx
      ON holdout_assignments(policy_id, visitor_hash)
  `;
  await sql`CREATE INDEX IF NOT EXISTS holdout_assignments_team_id_idx ON holdout_assignments(team_id)`;
  console.log("  ✓ holdout_assignments");

  console.log("\n✅ All T012–T016 migrations complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
