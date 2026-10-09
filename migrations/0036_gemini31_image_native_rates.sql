-- Forward-only correction; historical rate versions and ledger entries stay immutable.
BEGIN;
-- 0017's legacy non-token check required a per-image flat rate. Support
-- native token-priced images on both migration-first and declarative-first DBs.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'provider_rates'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%unit_type%'
      AND pg_get_constraintdef(oid) LIKE '%microusd_per_unit%'
  LOOP
    EXECUTE format('ALTER TABLE provider_rates DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;
ALTER TABLE provider_rates ADD CONSTRAINT provider_rates_pricing_shape_check CHECK (
  (unit_type IN ('tokens', 'images') AND input_microusd_per_million IS NOT NULL AND output_microusd_per_million IS NOT NULL)
  OR (unit_type <> 'tokens' AND microusd_per_unit IS NOT NULL)
);
INSERT INTO provider_rate_versions(version,evidence_url,source_note,effective_from)
VALUES ('2026-10-09','https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image',
  'Official standard Gemini 3.1 Flash Image prices: input $0.50/M tokens; image output $60/M tokens; text/thinking output $3/M tokens.',
  '2026-10-09T00:00:00Z')
ON CONFLICT (version) DO NOTHING;
INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,input_microusd_per_million,output_microusd_per_million,microusd_per_unit,effective_from,evidence_url)
SELECT v.id,'gemini','gemini-3.1-flash-image',r.unit_type,500000,r.output_rate,NULL,
  '2026-10-09T00:00:00Z','https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image'
FROM provider_rate_versions v
CROSS JOIN (VALUES ('images',60000000),('tokens',3000000)) r(unit_type,output_rate)
WHERE v.version='2026-10-09' ON CONFLICT DO NOTHING;
COMMIT;
