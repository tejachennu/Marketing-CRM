/**
 * Pop-up notifications for things that happen in a workspace: a ticket raised, an order paid or
 * confirmed, a deal given to someone, an unhappy review. Each one is sent with `sendPush`, which never
 * throws, so none of these can fail the action that caused it.
 */

import { sendPush } from './push'

const short = (text: unknown, max = 120) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** The person a chat is assigned to, or null (then everyone gets it). */
async function chatOwner(db: any, organizationId: string, conversationId?: string | null): Promise<string | null> {
  if (!conversationId) return null
  try {
    const { data } = await db.from('conversations').select('assigned_to').eq('id', conversationId).eq('organization_id', organizationId).maybeSingle()
    return data?.assigned_to || null
  } catch {
    return null
  }
}

/** A new ticket: the AI handed a chat to the team, a flow raised one, or someone made one. */
export async function notifyTicketRaised(db: any, input: { organizationId: string; ticketId: string; subject?: string | null; contactName?: string | null; conversationId?: string | null; exceptUserId?: string | null }) {
  const owner = await chatOwner(db, input.organizationId, input.conversationId)
  return sendPush(db, { organizationId: input.organizationId, userIds: owner ? [owner] : [], exceptUserId: input.exceptUserId }, {
    kind: 'ticket',
    title: `New ticket${input.contactName ? ` · ${short(input.contactName, 40)}` : ''}`,
    body: short(input.subject) || 'A customer needs your team',
    open: 'tickets',
    tag: `ticket:${input.ticketId}`,
  })
}

/** An order the team now has to pack and send: paid in the chat, or confirmed for Cash on Delivery. */
export async function notifyOrderReady(db: any, input: { organizationId: string; orderId: string; orderNumber: string; how: 'paid' | 'cod'; amount: string; customer?: string | null }) {
  return sendPush(db, { organizationId: input.organizationId }, {
    kind: 'order',
    title: input.how === 'paid' ? `Payment received · ${input.amount}` : `Cash on Delivery order · ${input.amount}`,
    body: `Order #${input.orderNumber}${input.customer ? ` from ${short(input.customer, 40)}` : ''} is ready to ship.`,
    open: 'orders',
    tag: `order:${input.orderId}`,
  })
}

/** A deal given to someone (not by themselves). */
export async function notifyDealAssigned(db: any, input: { organizationId: string; dealId: string; title?: string | null; ownerId: string | null; byUserId?: string | null }) {
  if (!input.ownerId || input.ownerId === input.byUserId) return 0
  return sendPush(db, { organizationId: input.organizationId, userIds: [input.ownerId] }, {
    kind: 'deal',
    title: 'A deal was given to you',
    body: short(input.title) || 'Open the Sales Pipeline to see it',
    open: 'deals',
    tag: `deal:${input.dealId}`,
  })
}

/** A customer rated a visit 3 or less: worth a call back. */
export async function notifyLowReview(db: any, input: { organizationId: string; feedbackId: string; rating: number; customer?: string | null; comment?: string | null }) {
  if (!(input.rating > 0 && input.rating <= 3)) return 0
  return sendPush(db, { organizationId: input.organizationId }, {
    kind: 'review',
    title: `${input.rating}★ review${input.customer ? ` from ${short(input.customer, 40)}` : ''}`,
    body: short(input.comment) || 'Call them back to put it right.',
    open: 'reviews',
    tag: `review:${input.feedbackId}`,
  })
}
