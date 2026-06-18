-- Task #14 remediation: ensure content_events table exists with all required columns.
-- content_events was originally created via drizzle push (not SQL migration).
-- A fresh database built purely from SQL migration files was missing this table and all
-- its engagement/attribution columns, causing beacon inserts to fail at runtime.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS content_events (
  id             bigserial PRIMARY KEY,
  team_id        integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  content_type   varchar(20) NOT NULL,
  article_id     integer REFERENCES articles(id) ON DELETE CASCADE,
  social_post_id integer REFERENCES social_posts(id) ON DELETE CASCADE,
  event_type     varchar(30) NOT NULL,
  created_at     timestamp NOT NULL DEFAULT now()
);

-- Engagement / session signals
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS session_id       varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS visitor_id       varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS variant_id       varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS arm_id           integer;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS ip_hash          varchar(64);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS scroll_pct       smallint;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS engaged_sec      integer;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS read_complete    boolean DEFAULT false;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS bounced          boolean DEFAULT false;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS fatigue_signal   boolean DEFAULT false;

-- Conversion fields
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS conversion_type  varchar(50);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS conversion_value real;

-- Attribution / UTM
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS channel          varchar(30);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS utm_source       varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS utm_medium       varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS utm_campaign     varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS utm_content      varchar(100);

-- Device / locale context
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS device           varchar(20);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS locale           varchar(20);

-- Journey / return-visitor (also added by 0006 — fully idempotent)
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS journey_id       varchar(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS journey_step     smallint;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS is_return        boolean DEFAULT false;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS session_count    smallint;

-- Structured metadata blob
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS metadata         jsonb;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS content_events_team_id_idx         ON content_events (team_id);
CREATE INDEX IF NOT EXISTS content_events_event_type_idx      ON content_events (event_type);
CREATE INDEX IF NOT EXISTS content_events_article_id_idx      ON content_events (article_id);
CREATE INDEX IF NOT EXISTS content_events_social_post_id_idx  ON content_events (social_post_id);
CREATE INDEX IF NOT EXISTS content_events_created_at_idx      ON content_events (created_at);
CREATE INDEX IF NOT EXISTS content_events_visitor_id_idx      ON content_events (visitor_id);
CREATE INDEX IF NOT EXISTS content_events_arm_id_idx          ON content_events (arm_id);
-- journey_id index also in 0006 — idempotent
CREATE INDEX IF NOT EXISTS content_events_journey_id_idx      ON content_events (journey_id);
