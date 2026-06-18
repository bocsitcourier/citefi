-- Add explicit beacon engagement columns to content_performance_metrics.
-- Previously, ConversionLabeler was repurposing readabilityScore/eatScore to store
-- scroll depth and read-complete rate. These are now stored in dedicated columns
-- so eatScore and readabilityScore remain available for article critique pipeline output.
-- Both columns are idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE content_performance_metrics
  ADD COLUMN IF NOT EXISTS scroll_depth integer NOT NULL DEFAULT 0;

ALTER TABLE content_performance_metrics
  ADD COLUMN IF NOT EXISTS read_complete_rate integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN content_performance_metrics.scroll_depth IS
  '0-100: max scroll percentage reached across all beacon sessions in the measurement window';

COMMENT ON COLUMN content_performance_metrics.read_complete_rate IS
  '0-100: percentage of sessions that fired the read_complete beacon event (75%+ scroll AND 60s+ dwell)';
