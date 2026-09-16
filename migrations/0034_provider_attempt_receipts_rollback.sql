BEGIN;

DROP POLICY IF EXISTS provider_attempt_receipts_update ON provider_attempt_receipts;
DROP POLICY IF EXISTS provider_attempt_receipts_insert ON provider_attempt_receipts;
DROP POLICY IF EXISTS provider_attempt_receipts_select ON provider_attempt_receipts;
ALTER TABLE IF EXISTS provider_attempt_receipts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS provider_attempt_receipts DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE provider_attempt_receipts FROM citefi_tenant;
REVOKE ALL ON SEQUENCE provider_attempt_receipts_id_seq FROM citefi_tenant;
DROP TABLE IF EXISTS provider_attempt_receipts;

COMMIT;