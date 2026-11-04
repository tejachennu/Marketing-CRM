-- Why: the flow runtime pauses a live workflow it can no longer execute (for example one activated
-- before stricter validation existed) instead of failing the webhook until Meta stops retrying.
-- These columns keep the reason and the time so the builder can show what to fix; going live
-- again clears both. Safe to re-run, and the code keeps working before it is applied (the pause
-- then happens without the note).
-- Needs the Flow Builder tables (scripts/db-migration-v31-flows.js); without them this file only
-- prints a notice, so it can be applied in order with the others and again once they exist.
DO $guard$
BEGIN
  IF to_regclass('public.whatsapp_workflows') IS NULL THEN
    RAISE NOTICE 'public.whatsapp_workflows does not exist yet: run scripts/db-migration-v31-flows.js, then apply this file again';
    RETURN;
  END IF;
    EXECUTE $sql$ALTER TABLE public.whatsapp_workflows ADD COLUMN IF NOT EXISTS paused_reason TEXT$sql$;
    EXECUTE $sql$ALTER TABLE public.whatsapp_workflows ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ$sql$;
END $guard$;
