-- Why: the flow runtime pauses a live workflow it can no longer execute (for example one activated
-- before stricter validation existed) instead of failing the webhook until Meta stops retrying.
-- These columns keep the reason and the time so the builder can show what to fix; going live
-- again clears both. Safe to re-run, and the code keeps working before it is applied (the pause
-- then happens without the note).
ALTER TABLE public.whatsapp_workflows ADD COLUMN IF NOT EXISTS paused_reason TEXT;
ALTER TABLE public.whatsapp_workflows ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
