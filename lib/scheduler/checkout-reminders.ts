/**
 * Reminders for WhatsApp checkouts the customer walked away from: a cart without an address,
 * an address without a payment, a payment request that was never paid. The step the order is
 * waiting on is sent again (the same message as "Send reminder" on the Orders page), at most
 * twice per order and at most once a day, only for checkouts begun in the last week, only
 * while WhatsApp still accepts a plain message from the store, and never into a chat a person
 * is in the middle of.
 */
import { OPEN_CHECKOUT_STATUSES, type OrderStatus } from '@/lib/commerce/commerce-utils'
import { resendCheckoutStep } from '@/lib/commerce/commerce-webhook-handler'
import { parseCommerceMessage } from '@/lib/chat-commerce'
import { isModuleDisabledByPlatform, isModuleEnabled } from '@/lib/feature-flags'
import { isMissingColumn } from './schema-errors'

type Database = any

const HOUR = 60 * 60 * 1000
/** A checkout counts as abandoned after an hour without a change. */
export const ABANDONED_AFTER_MS = 1 * HOUR
/**
 * Checkouts older than this are left alone: a cart from months ago is not abandoned, it is
 * over, and the day the reminders go live must not reach back into every old one. The
 * migration marks older open orders as already reminded, for the same reason.
 */
export const MAX_ORDER_AGE_MS = 7 * 24 * HOUR
/** Reminders per order; the second goes out a day after the first. */
export const MAX_REMINDERS = 2
export const REMINDER_INTERVAL_MS = 20 * HOUR
/** When a reminder cannot go out (or the customer is out of reach), the order is looked at again after this. */
export const RETRY_AFTER_MS = 6 * HOUR
/**
 * Meta accepts a plain message only within 24 hours of the customer's last message (error
 * 131047 otherwise). An hour of slack keeps a reminder from arriving right at the deadline.
 */
export const CUSTOMER_WINDOW_MS = 23 * HOUR
/** A chat with a message in the last hour is live; a reminder (with a fresh payment request) would land in the middle of it. */
export const LIVE_CHAT_MS = 1 * HOUR
/**
 * How long a step may take to send. Each WhatsApp call behind it gives up after 15 seconds
 * (WHATSAPP_SEND_TIMEOUT_MS), so a single slow send still gets its answer; a step that falls
 * through to the next message can take longer. A step not settled by then may still reach the
 * customer, so it is recorded as sent (see remindOrder), never retried within the day.
 */
export const SEND_TIMEOUT_MS = 20 * 1000
/** Candidates read per query. */
const CHUNK_SIZE = 50
/** Candidates examined per run at most, so a backlog can never make a tick run long. */
const MAX_SCANNED = 500
/** A customer's conversations looked at per order: more than a handful means duplicates, and the latest are the ones that matter. */
const MAX_CONVERSATIONS = 20

export const MIGRATION_HINT = 'Checkout reminders need the 20261104_commerce_reminders migration'
const REMINDER_COLUMNS = ['reminder_count', 'next_reminder_at', 'commerce_reminders_enabled']

const ORGANIZATION_COLUMNS = [
  'id', 'name', 'currency', 'enable_commerce', 'enable_messages', 'commerce_reminders_enabled',
  'whatsapp_api_token', 'whatsapp_phone_number_id', 'whatsapp_graph_api_version',
  'commerce_address_flow_id', 'commerce_payment_gateway', 'commerce_gateway_config_name', 'commerce_enable_cod',
].join(', ')
// The items and the customer's phone come along so resending needs no further reads
const ORDER_COLUMNS = `*, items:commerce_order_items(*), contact:contacts(phone_number), organizations!inner(${ORGANIZATION_COLUMNS})`
const CONVERSATION_COLUMNS = 'id, assigned_to, auto_reply_enabled, last_message_at'

const isOpen = (status: string) => OPEN_CHECKOUT_STATUSES.includes(status as OrderStatus)

export interface ReminderRunResult {
  /** The migration is not applied: nothing was read or sent. */
  skipped?: true
  /** The commerce module is switched off for the whole platform (NEXT_PUBLIC_DISABLED_MODULES): nothing was read or sent. */
  disabled?: true
  /** Orders examined. */
  scanned: number
  /** Includes steps WhatsApp did not confirm in time, which may still have reached the customer. */
  sent: number
  /** WhatsApp refused the message (or did not answer in time); the order is tried again in six hours. */
  failed: number
  /** Left for a later run: the customer is outside the 24-hour window, has no conversation, or the store is not connected. */
  waiting: number
  /** Not sent on purpose: a person is on the chat, or the customer wrote in the last hour. Tried again in six hours. */
  held: number
  /** The run stopped early because its time was up. */
  out_of_time?: true
}

type Outcome = 'sent' | 'failed' | 'waiting' | 'held' | 'skipped'

let migrationWarned = false

function skipUntilMigrated(result: ReminderRunResult): ReminderRunResult {
  if (!migrationWarned) {
    console.warn(`[Checkout Reminders] ${MIGRATION_HINT}`)
    migrationWarned = true
  }
  return { skipped: true, ...result }
}

/**
 * Send the next reminder for every abandoned checkout that is due one, oldest first.
 * `limit` caps the reminders per run and `deadline` (a Date.now() value) the time it may take.
 */
export async function sendCheckoutReminders({
  supabase,
  now = new Date(),
  limit = 50,
  deadline,
  sendTimeoutMs = SEND_TIMEOUT_MS,
}: {
  supabase: Database
  now?: Date
  limit?: number
  deadline?: number
  sendTimeoutMs?: number
}): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { scanned: 0, sent: 0, failed: 0, waiting: 0, held: 0 }
  const nowIso = now.toISOString()
  const abandonedBefore = new Date(now.getTime() - ABANDONED_AFTER_MS).toISOString()
  const begunAfter = new Date(now.getTime() - MAX_ORDER_AGE_MS).toISOString()
  const outOfTime = () => Boolean(deadline && Date.now() >= deadline)
  let cursor: string | null = null

  // The platform's kill switch for commerce stops the reminders with the rest of the module
  if (isModuleDisabledByPlatform('commerce')) return { disabled: true, ...result }

  while (result.sent + result.failed < limit && result.scanned < MAX_SCANNED) {
    if (outOfTime()) {
      result.out_of_time = true
      break
    }

    // Open checkouts begun in the last week that have sat untouched for an hour and are due a
    // reminder, for stores that sell on WhatsApp (commerce and messaging both on, as
    // lib/feature-flags.ts defines the module) and have not switched reminders off. Only the
    // inner join on the organization lets the database apply the store settings.
    let query = supabase
      .from('commerce_orders')
      .select(ORDER_COLUMNS)
      .in('status', OPEN_CHECKOUT_STATUSES)
      .neq('payment_status', 'paid')
      .lt('reminder_count', MAX_REMINDERS)
      .or(`next_reminder_at.is.null,next_reminder_at.lte.${nowIso}`)
      .gte('created_at', begunAfter)
      .lte('created_at', abandonedBefore)
      .lte('updated_at', abandonedBefore)
      .not('organizations.enable_commerce', 'is', false)
      .not('organizations.enable_messages', 'is', false)
      .not('organizations.commerce_reminders_enabled', 'is', false)
      .order('created_at', { ascending: true })
      .limit(CHUNK_SIZE)
    // Orders left waiting keep matching the filters, so the next chunk starts after the last one seen
    if (cursor) query = query.gt('created_at', cursor)

    const { data: orders, error } = await query
    if (error) {
      if (isMissingColumn(error, REMINDER_COLUMNS)) return skipUntilMigrated(result)
      throw new Error(error.message || 'Could not read the orders due a reminder')
    }
    if (!orders || orders.length === 0) break

    for (const order of orders) {
      if (result.sent + result.failed >= limit || result.scanned >= MAX_SCANNED) break
      if (outOfTime()) {
        result.out_of_time = true
        break
      }
      result.scanned++
      cursor = order.created_at

      const outcome = await remindOrder(supabase, order, now, sendTimeoutMs)
      if (outcome === 'migration') return skipUntilMigrated(result)
      if (outcome !== 'skipped') result[outcome]++
    }

    if (result.out_of_time || orders.length < CHUNK_SIZE) break
  }

  if (result.sent || result.failed || result.waiting || result.held) {
    console.log(`[Checkout Reminders] Sent ${result.sent}, failed ${result.failed}, waiting ${result.waiting}, held ${result.held} (examined ${result.scanned}).`)
  }
  return result
}

async function remindOrder(supabase: Database, order: any, now: Date, sendTimeoutMs: number): Promise<Outcome | 'migration'> {
  const organization = order.organizations
  // The query already leaves these out; a reminder must never reach a canceled, paid or
  // confirmed order, or a store whose commerce module is off, so the rules are checked here as well.
  if (!organization || !isOpen(order.status) || order.payment_status === 'paid') return 'skipped'
  if (organization.enable_commerce === false || !isModuleEnabled(organization, 'commerce')) return 'skipped'

  // Claim the order for this run first. With a second scheduler running (pg_cron next to
  // Vercel Cron, or a slow tick overlapping the next one) a customer could otherwise be
  // reminded twice. The claim doubles as the retry delay: whatever happens next, the order
  // is not looked at again for six hours unless the reminder goes out.
  const reminderCount = Number(order.reminder_count) || 0
  let claim = supabase
    .from('commerce_orders')
    .update({ next_reminder_at: new Date(now.getTime() + RETRY_AFTER_MS).toISOString() })
    .eq('id', order.id)
    .eq('organization_id', order.organization_id)
    .eq('reminder_count', reminderCount)
  claim = order.next_reminder_at ? claim.eq('next_reminder_at', order.next_reminder_at) : claim.is('next_reminder_at', null)
  const { data: claimed, error: claimErr } = await claim.select('id')
  if (claimErr) {
    if (isMissingColumn(claimErr, REMINDER_COLUMNS)) return 'migration'
    throw new Error(claimErr.message || `Could not claim order ${order.id} for a reminder`)
  }
  if (!claimed || claimed.length === 0) return 'skipped' // another run got there first

  if (!order.conversation_id) return 'waiting'
  if (!organization.whatsapp_api_token || !organization.whatsapp_phone_number_id) return 'waiting'

  const conversations = await loadConversations(supabase, order)
  if (conversations.length === 0) return 'waiting'
  const conversationIds = conversations.map((conversation: any) => conversation.id)

  // A person is looking after this customer, or the customer is writing right now: a reminder
  // would barge into the conversation. The claim above already holds the order for six hours.
  const live = liveChatReason(conversations, now)
  if (live) return hold(order, live)

  // WhatsApp refuses a plain message more than 24 hours after the customer's last one, so
  // without a recent inbound message the reminder waits (reaching them then would take an
  // approved template, which the store would have to set up first).
  const { data: lastInbound, error: inboundErr } = await supabase
    .from('messages')
    .select('created_at')
    .eq('organization_id', order.organization_id)
    .in('conversation_id', conversationIds)
    .eq('sender_type', 'contact')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (inboundErr) throw new Error(inboundErr.message || 'Could not read the conversation')
  const sinceInbound = now.getTime() - Date.parse(lastInbound?.created_at || '')
  if (!(sinceInbound < CUSTOMER_WINDOW_MS)) return 'waiting'

  // The team wrote last, after the order last changed: someone is already following up. The
  // checkout's own lines (the address form, the payment request, an earlier reminder) are
  // stored as sent by the team as well, and do not count.
  const { data: lastMessage, error: lastErr } = await supabase
    .from('messages')
    .select('sender_type, body, created_at')
    .eq('organization_id', order.organization_id)
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastErr) throw new Error(lastErr.message || 'Could not read the conversation')
  if (
    lastMessage?.sender_type === 'user' &&
    Date.parse(lastMessage.created_at || '') > Date.parse(order.updated_at || '') &&
    !parseCommerceMessage(lastMessage.body, 'user')
  ) {
    return hold(order, 'the team wrote last')
  }

  const outcome = await withTimeout<{ step: string; error?: string; timedOut?: true }>(
    resendCheckoutStep({ organization, order, database: supabase }),
    sendTimeoutMs,
    () => ({ step: 'not_sent', timedOut: true })
  )
  if (outcome.timedOut) {
    // The send carries on without us and may well reach the customer (and move the order on).
    // Counting it as failed would remind them again in six hours, past the limits; counted as
    // sent, the worst case is one reminder fewer.
    console.warn(`[Checkout Reminders] Order #${order.order_number} (${order.id}): WhatsApp did not answer within ${Math.round(sendTimeoutMs / 1000)} seconds; the reminder may still arrive, so it is counted as sent.`)
  } else if (outcome.step === 'not_sent') {
    console.warn(`[Checkout Reminders] Order #${order.order_number} (${order.id}): ${outcome.error || 'not sent'}; trying again in 6 hours.`)
    return 'failed'
  }

  const { error: doneErr } = await supabase
    .from('commerce_orders')
    .update({
      reminder_count: reminderCount + 1,
      next_reminder_at: new Date(now.getTime() + REMINDER_INTERVAL_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', order.id)
    .eq('organization_id', order.organization_id)
  // The customer has the message either way; the six-hour hold from the claim still applies
  if (doneErr) console.error(`[Checkout Reminders] Order #${order.order_number} (${order.id}): reminder sent but not recorded:`, doneErr)
  else console.log(`[Checkout Reminders] Reminder ${reminderCount + 1} ${outcome.timedOut ? 'possibly sent' : 'sent'} for order #${order.order_number} (${outcome.timedOut ? 'unconfirmed' : outcome.step}).`)
  return 'sent'
}

/**
 * The customer's conversations in this organization, latest first. A contact routinely has
 * several (the campaign worker used to open a new one whenever two existed), and the latest
 * message, or a person's reply, can be in any of them; the order's own is always included.
 */
async function loadConversations(supabase: Database, order: any): Promise<any[]> {
  let query = supabase.from('conversations').select(CONVERSATION_COLUMNS).eq('organization_id', order.organization_id)
  query = order.contact_id
    ? query.or(`contact_id.eq.${order.contact_id},id.eq.${order.conversation_id}`)
    : query.eq('id', order.conversation_id)
  const { data, error } = await query.order('last_message_at', { ascending: false, nullsFirst: false }).limit(MAX_CONVERSATIONS)
  if (error) throw new Error(error.message || 'Could not read the conversation')
  return data || []
}

/** Why the chat must not be disturbed, or null when a reminder may go out. */
function liveChatReason(conversations: any[], now: Date): string | null {
  for (const conversation of conversations) {
    // Switched off when a person replies from the inbox, or when a flow hands the chat to the team
    if (conversation.auto_reply_enabled === false) return 'the chatbot is off'
    if (conversation.assigned_to) return 'the chat is assigned'
    if (now.getTime() - Date.parse(conversation.last_message_at || '') < LIVE_CHAT_MS) return 'the chat was active in the last hour'
  }
  return null
}

function hold(order: any, reason: string): Outcome {
  console.log(`[Checkout Reminders] Order #${order.order_number} (${order.id}): ${reason}; looking again in 6 hours.`)
  return 'held'
}

/** `fallback` after `ms` when `promise` has not settled; the promise is left to settle on its own (its rejection is handled). */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms)
  })
  try {
    return await Promise.race([promise, expiry])
  } finally {
    clearTimeout(timer)
  }
}
