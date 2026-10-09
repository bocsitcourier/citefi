BEGIN;
-- Client reviewers retain NO raw access to publishing_jobs, connections or
-- receipts. Only explicitly assigned review content has a safe delivery view.
CREATE OR REPLACE FUNCTION citefi_rls.publishing_client_summary(
  requested_job integer DEFAULT NULL, requested_status text DEFAULT NULL,
  requested_type text DEFAULT NULL, requested_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET row_security = off
SET search_path = pg_catalog, public, citefi_rls
AS $fn$
DECLARE selected_team integer := citefi_rls.current_team_id();
BEGIN
  IF NOT citefi_rls.client_viewer_membership_valid(selected_team) THEN
    RAISE EXCEPTION 'Client delivery summary is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(summary ORDER BY created_at DESC) FROM (
      SELECT j.created_at, jsonb_build_object(
        'id', j.id, 'publicId', j.public_id, 'teamId', j.team_id,
        'contentType', j.content_type, 'articleId', j.article_id,
        'status', j.status, 'publishedUrl', j.published_url, 'publishedAt', j.published_at,
        'createdAt', j.created_at, 'updatedAt', j.updated_at, 'articleTitle', a.chosen_title,
        'lastError', NULL, 'connectionBaseUrl', NULL, 'connectionName', NULL,
        'retryable', false, 'deletable', false, 'canReconcile', false,
        'reconciliationStatus', CASE WHEN j.error_details->>'reconciliationConflict' = 'true' THEN 'conflicting_evidence'
          ELSE COALESCE(j.error_details->'reconciliation'->'decision'->>'outcome',
            CASE WHEN j.status = 'outcome_unknown' THEN 'unresolved' END) END,
        'replacementJobId', j.error_details->'reconciliation'->'replacementJobId'
      ) AS summary
      FROM public.publishing_jobs j
      JOIN public.articles a ON a.id = j.article_id
      WHERE j.team_id = a.team_id
        AND a.approval_team_id = selected_team AND a.deleted_at IS NULL
        AND (requested_job IS NULL OR j.id = requested_job)
        AND (requested_status IS NULL OR j.status = requested_status)
        AND (requested_type IS NULL OR j.content_type = requested_type)
      ORDER BY j.created_at DESC
      LIMIT LEAST(GREATEST(COALESCE(requested_limit, 100), 1), 200)
    ) safe_rows
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION citefi_rls.publishing_client_summary(integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION citefi_rls.publishing_client_summary(integer, text, text, integer) TO citefi_tenant;
COMMIT;
