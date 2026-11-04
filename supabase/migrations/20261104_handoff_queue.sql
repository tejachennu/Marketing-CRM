-- The hand-off queue: chats the Flow Builder's "Hand off to team" step left with nobody assigned
-- and the chatbot off (conversations.assigned_to IS NULL AND auto_reply_enabled = false).
-- The inbox lists them (GET /api/conversations?filter=needs_agent) and counts them on every list
-- request, so they get a small partial index per organization. The code works without it: the
-- index only keeps the lookup cheap on busy tenants. Safe to run more than once.
CREATE INDEX IF NOT EXISTS idx_conversations_handed_off
  ON conversations (organization_id, last_message_at DESC)
  WHERE assigned_to IS NULL AND auto_reply_enabled = false;
