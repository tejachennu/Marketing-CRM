-- Hand-offs become explicit. The Flow Builder's "Hand off to team" step stamps
-- conversations.handed_off_at; taking the chat, or switching the chatbot back on, clears it.
-- Before this the hand-off queue was inferred from "nobody assigned and the chatbot off", a state
-- every manager reply produced as well (see lib/handoff.ts). Safe to run more than once.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handed_off_at timestamptz;

-- Chats a flow handed to the team queue that nobody has taken yet keep their place in the queue.
-- Only where the Flow Builder's tables exist (scripts/db-migration-v31-flows.js): without them
-- there were no flow hand-offs to carry over.
DO $$
BEGIN
  IF to_regclass('public.flow_sessions') IS NOT NULL THEN
    UPDATE conversations c
       SET handed_off_at = s.last_interaction_at
      FROM flow_sessions s
     WHERE s.conversation_id = c.id
       AND s.organization_id = c.organization_id
       AND s.state_data->>'handed_off' = 'true'
       AND s.state_data->>'assigned_user_id' IS NULL
       AND c.assigned_to IS NULL
       AND c.auto_reply_enabled = false
       AND c.handed_off_at IS NULL
       -- Recent hand-offs only: the session keeps its hand-off note after the chat was taken, so an
       -- old note must not put a chat back in the queue when this file is run again
       AND s.last_interaction_at > now() - interval '7 days';
  END IF;
END $$;

-- The queue index follows the new rule (the earlier one covered the inferred rule)
DROP INDEX IF EXISTS idx_conversations_handed_off;
CREATE INDEX IF NOT EXISTS idx_conversations_handed_off
  ON conversations (organization_id, last_message_at DESC)
  WHERE handed_off_at IS NOT NULL AND assigned_to IS NULL;
