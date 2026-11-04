-- The cron tick expires chatbot sessions idle for more than a day (lib/scheduler/flow-sessions.ts)
-- with "status in (...) and last_interaction_at < ..." ordered by last_interaction_at. Without an
-- index that is a scan of every session ever started, every 10 minutes; the partial index covers
-- only the sessions still open, which is a small and shrinking set. Safe to apply more than once.
-- It needs the flow_sessions table, so apply it after scripts/db-migration-v31-flows.js; until
-- then the job runs without it (and skips altogether while the table does not exist).
-- Needs the Flow Builder tables (scripts/db-migration-v31-flows.js); without them this file only
-- prints a notice, so it can be applied in order with the others and again once they exist.
DO $guard$
BEGIN
  IF to_regclass('public.flow_sessions') IS NULL THEN
    RAISE NOTICE 'public.flow_sessions does not exist yet: run scripts/db-migration-v31-flows.js, then apply this file again';
    RETURN;
  END IF;
    EXECUTE $sql$create index if not exists flow_sessions_idle_idx
        on public.flow_sessions (last_interaction_at)
        where status in ('IN_PROGRESS', 'PAUSED_RAG')$sql$;
END $guard$;
