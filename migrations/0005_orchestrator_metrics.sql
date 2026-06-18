-- Task #13: Add Bayesian A/B measurement columns to content_performance_metrics
-- variantId: deterministic UUID derived from sorted patternsUsedJson + contentType hash
-- armId: nullable FK to decision_arms for content inside a Bayesian policy experiment

ALTER TABLE content_performance_metrics
  ADD COLUMN IF NOT EXISTS variant_id  VARCHAR(36),
  ADD COLUMN IF NOT EXISTS arm_id      INTEGER REFERENCES decision_arms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_performance_variant_id_idx ON content_performance_metrics (variant_id);
CREATE INDEX IF NOT EXISTS content_performance_arm_id_idx     ON content_performance_metrics (arm_id);
