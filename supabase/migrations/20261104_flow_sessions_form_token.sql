-- Why: a WhatsApp form answered late (after its session expired, or after the flow was paused)
-- is matched to the session that sent it by the form token the runtime stored in
-- flow_sessions.state_data->>'_flow_token', so the answers are filed under that flow and form
-- instead of being saved as orphans. The first index keeps that lookup from scanning every session
-- of the organization. Safe to re-run, and the code works before it is applied (the lookup is
-- then a sequential scan of the organization's sessions).
--
-- Why: the flows list counts each workflow's open conversations (IN_PROGRESS or PAUSED_RAG within
-- the last day) with a HEAD count per workflow, and the scheduler expires idle sessions by the same
-- columns. Both filter on workflow, status and last activity: the second index.
--
-- Needs the Flow Builder tables (scripts/db-migration-v31-flows.js); without them this file only
-- prints a notice, so it can be applied in order with the others and again once they exist.
DO $guard$
BEGIN
  IF to_regclass('public.flow_sessions') IS NULL THEN
    RAISE NOTICE 'public.flow_sessions does not exist yet: run scripts/db-migration-v31-flows.js, then apply this file again';
    RETURN;
  END IF;
  EXECUTE $sql$CREATE INDEX IF NOT EXISTS idx_flow_sessions_form_token
    ON public.flow_sessions (organization_id, (state_data->>'_flow_token'))$sql$;
  EXECUTE $sql$CREATE INDEX IF NOT EXISTS idx_flow_sessions_workflow_activity
    ON public.flow_sessions (workflow_id, status, last_interaction_at)$sql$;
END $guard$;
