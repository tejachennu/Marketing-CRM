/**
 * The hand-off queue: chats the Flow Builder's "Hand off to team" step left for the next free
 * agent. The step stamps `conversations.handed_off_at`; taking the chat (or switching the chatbot
 * back on) clears it. The rule lives here, free of server imports, so the inbox, the sidebar and
 * the API routes all read it the same way.
 *
 * Before the column existed the queue was inferred from "nobody assigned and the chatbot off", a
 * state every manager reply also produced. A row that does not carry the column (a database the
 * migration has not reached yet, or a query that did not select it) still falls back to that
 * inference, so nothing disappears before the migration runs.
 */

export interface HandOffState {
  assigned_to?: string | null
  auto_reply_enabled?: boolean | null
  handed_off_at?: string | null
}

/** PostgREST filter for the chats waiting in the hand-off queue. */
export const HANDED_OFF_FILTER = 'and(handed_off_at.not.is.null,assigned_to.is.null)'

/** The same queue on a database without `handed_off_at`: inferred from the chatbot being off. */
export const LEGACY_HANDED_OFF_FILTER = 'and(assigned_to.is.null,auto_reply_enabled.eq.false)'

/** True for a chat waiting for any agent to pick it up (the same rule as HANDED_OFF_FILTER). */
export function isHandedOff(conversation: HandOffState): boolean {
  if (conversation.assigned_to != null) return false
  if (conversation.handed_off_at !== undefined) return conversation.handed_off_at != null
  return conversation.auto_reply_enabled === false
}
