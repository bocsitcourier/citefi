-- Task #14: content_events schema v2 — journey tracking fields + team webhook secret
-- Idempotent: all ADD COLUMN IF NOT EXISTS

-- Journey / return-visitor signals
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS journey_id     VARCHAR(100);
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS journey_step   SMALLINT;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS is_return      BOOLEAN DEFAULT FALSE;
ALTER TABLE content_events ADD COLUMN IF NOT EXISTS session_count  SMALLINT;

-- Team-level conversion webhook secret (HMAC-SHA256 gated external ingestion)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS conversion_webhook_secret VARCHAR(100);

-- Indexes for journey lookups
CREATE INDEX IF NOT EXISTS content_events_journey_id_idx ON content_events(journey_id);
