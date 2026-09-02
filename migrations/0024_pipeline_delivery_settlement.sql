ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS billing_run_id varchar(255),
  ADD COLUMN IF NOT EXISTS billing_settled_at timestamp,
  ADD COLUMN IF NOT EXISTS video_billing_settled_at timestamp;

CREATE INDEX IF NOT EXISTS social_posts_billing_pending_idx
  ON social_posts (billing_run_id)
  WHERE status = 'READY' AND billing_settled_at IS NULL;

CREATE INDEX IF NOT EXISTS social_posts_video_billing_pending_idx
  ON social_posts (video_credit_run_id)
  WHERE video_status = 'READY' AND video_billing_settled_at IS NULL;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS podcast_credit_run_id varchar(255),
  ADD COLUMN IF NOT EXISTS podcast_billing_settled_at timestamp;

CREATE INDEX IF NOT EXISTS articles_podcast_billing_pending_idx
  ON articles (podcast_credit_run_id)
  WHERE podcast_status = 'ready' AND podcast_billing_settled_at IS NULL;