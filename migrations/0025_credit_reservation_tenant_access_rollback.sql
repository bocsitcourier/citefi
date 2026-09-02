BEGIN;

DROP POLICY IF EXISTS rls_credit_reservations_sel ON credit_reservations;
DROP POLICY IF EXISTS rls_credit_reservations_ins ON credit_reservations;
DROP POLICY IF EXISTS rls_credit_reservations_upd ON credit_reservations;
DROP POLICY IF EXISTS rls_credit_reservations_del ON credit_reservations;
ALTER TABLE credit_reservations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON SEQUENCE credit_reservations_id_seq FROM citefi_tenant;
REVOKE ALL ON credit_reservations FROM citefi_tenant;

COMMIT;