-- Hand-offs become explicit. The Flow Builder's "Hand off to team" step stamps
-- conversations.handed_off_at; taking the chat, or switching the chatbot back on, clears it.
-- Before this the hand-off queue was inferred from "nobody assigned and the chatbot off", a state
-- every manager reply produced as well (see lib/handoff.ts). Safe to run more than once.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handed_off_at timestamptz;

-- Chats a flow handed to the team queue that nobody has taken yet keep their place in the queue
UPDATE conversations c
   SET handed_off_at = COALESCE(s.last_interaction_at, now())
  FROM flow_sessions s
 WHERE s.conversation_id = c.id
   AND s.organization_id = c.organization_id
   AND s.state_data->>'handed_off' = 'true'
   AND s.state_data->>'assigned_user_id' IS NULL
   AND c.assigned_to IS NULL
   AND c.auto_reply_enabled = false
   AND c.handed_off_at IS NULL;

-- The queue index follows the new rule (the earlier one covered the inferred rule)
DROP INDEX IF EXISTS idx_conversations_handed_off;
CREATE INDEX IF NOT EXISTS idx_conversations_handed_off
  ON conversations (organization_id, last_message_at DESC)
  WHERE handed_off_at IS NOT NULL AND assigned_to IS NULL;
