BEGIN;

-- Persist the exact credit/cap hold attached to a video-idea job. Recovery must
-- requeue the same run and settle the same pending usage row rather than
-- creating a second completed usage event.
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS video_credit_run_id varchar(255),
  ADD COLUMN IF NOT EXISTS video_cap_reservation_id integer,
  ADD COLUMN IF NOT EXISTS video_billing_settled_at timestamp;

-- Social-video rows already persist the credit run and delivery checkpoint;
-- add the matching original spending-cap hold for durable recovery.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS video_cap_reservation_id integer;

COMMIT;