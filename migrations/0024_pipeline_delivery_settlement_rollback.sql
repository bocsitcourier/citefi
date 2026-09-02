DROP INDEX IF EXISTS articles_podcast_billing_pending_idx;
ALTER TABLE articles
  DROP COLUMN IF EXISTS podcast_billing_settled_at,
  DROP COLUMN IF EXISTS podcast_credit_run_id;

DROP INDEX IF EXISTS social_posts_video_billing_pending_idx;
DROP INDEX IF EXISTS social_posts_billing_pending_idx;
ALTER TABLE social_posts
  DROP COLUMN IF EXISTS video_billing_settled_at,
  DROP COLUMN IF EXISTS billing_settled_at,
  DROP COLUMN IF EXISTS billing_run_id;