/**
 * The hand-off queue: chats the Flow Builder's "Hand off to team" step left for the next free
 * agent. The step stamps `conversations.handed_off_at`; taking the chat (or switching the chatbot
 * back on) clears it. The rule lives here, free of server imports, so the inbox, the sidebar and
 * the API routes all read it the same way.
 *
 * Before the column existed the queue was inferred from "nobody assigned and the chatbot off", a
 * state every manager reply also produced. A row that does not carry the column (a database the
 * migration has not reached yet, or a query that did not select it) still falls back to that
 * inference for what managers see (the queue badge, filter and label), so nothing disappears from
 * their view before the migration runs. Access is another matter: see `isStampedHandOff`.
 */

export interface HandOffState {
  assigned_to?: string | null
  auto_reply_enabled?: boolean | null
  handed_off_at?: string | null
}

/** PostgREST filter for the chats waiting in the hand-off queue. */
export const HANDED_OFF_FILTER = 'and(handed_off_at.not.is.null,assigned_to.is.null)'

/**
 * The same queue on a database without `handed_off_at`: inferred from the chatbot being off. For
 * what managers see only; it never widens what an agent limited to their own work may open.
 */
export const LEGACY_HANDED_OFF_FILTER = 'and(assigned_to.is.null,auto_reply_enabled.eq.false)'

/** True for a chat waiting for any agent to pick it up (the same rule as HANDED_OFF_FILTER). */
export function isHandedOff(conversation: HandOffState): boolean {
  if (conversation.assigned_to != null) return false
  if (conversation.handed_off_at !== undefined) return conversation.handed_off_at != null
  return conversation.auto_reply_enabled === false
}

/**
 * True only for a chat a flow really handed to the team (`handed_off_at` set) that nobody has
 * taken: the rule that lets an agent limited to their own work open, answer and take a chat they
 * hold no record for. Unlike `isHandedOff` it never falls back to the inferred rule. Before the
 * migration every chat a manager answered without taking looks like a hand-off, so the inference
 * would open those chats to every agent; until the column exists agents see only their own work.
 */
export function isStampedHandOff(conversation: HandOffState): boolean {
  return conversation.assigned_to == null && conversation.handed_off_at != null
}
