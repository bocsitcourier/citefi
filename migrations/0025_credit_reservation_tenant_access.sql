BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON credit_reservations TO citefi_tenant;
GRANT USAGE, SELECT ON SEQUENCE credit_reservations_id_seq TO citefi_tenant;

ALTER TABLE credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_credit_reservations_sel ON credit_reservations;
DROP POLICY IF EXISTS rls_credit_reservations_ins ON credit_reservations;
DROP POLICY IF EXISTS rls_credit_reservations_upd ON credit_reservations;
DROP POLICY IF EXISTS rls_credit_reservations_del ON credit_reservations;

CREATE POLICY rls_credit_reservations_sel ON credit_reservations
  FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_reservations_ins ON credit_reservations
  FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_reservations_upd ON credit_reservations
  FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_reservations_del ON credit_reservations
  FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

COMMIT;