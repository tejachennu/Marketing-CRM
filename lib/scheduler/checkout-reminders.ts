/**
 * Reminders for WhatsApp checkouts the customer walked away from: a cart without an address,
 * an address without a payment, a payment request that was never paid. The step the order is
 * waiting on is sent again (the same message as "Send reminder" on the Orders page), at most
 * twice per order and at most once a day, and only while WhatsApp still accepts a plain
 * message from the store.
 */
import { OPEN_CHECKOUT_STATUSES, type OrderStatus } from '@/lib/commerce/commerce-utils'
import { resendCheckoutStep } from '@/lib/commerce/commerce-webhook-handler'
import { isMissingColumn } from './schema-errors'

type Database = any

const HOUR = 60 * 60 * 1000
/** A checkout counts as abandoned after an hour without a change. */
export const ABANDONED_AFTER_MS = 1 * HOUR
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
/** Candidates read per query. */
const CHUNK_SIZE = 50
/** Candidates examined per run at most, so a backlog can never make a tick run long. */
const MAX_SCANNED = 500

export const MIGRATION_HINT = 'Checkout reminders need the 20261104_commerce_reminders migration'
const REMINDER_COLUMNS = ['reminder_count', 'next_reminder_at', 'commerce_reminders_enabled']

const ORGANIZATION_COLUMNS = [
  'id', 'name', 'currency', 'enable_commerce', 'commerce_reminders_enabled',
  'whatsapp_api_token', 'whatsapp_phone_number_id', 'whatsapp_graph_api_version',
  'commerce_address_flow_id', 'commerce_payment_gateway', 'commerce_gateway_config_name', 'commerce_enable_cod',
].join(', ')
// The items and the customer's phone come along so resending needs no further reads
const ORDER_COLUMNS = `*, items:commerce_order_items(*), contact:contacts(phone_number), organizations!inner(${ORGANIZATION_COLUMNS})`

const isOpen = (status: string) => OPEN_CHECKOUT_STATUSES.includes(status as OrderStatus)

export interface ReminderRunResult {
  /** The migration is not applied: nothing was read or sent. */
  skipped?: true
  /** Orders examined. */
  scanned: number
  sent: number
  /** WhatsApp refused the message; the order is tried again in six hours. */
  failed: number
  /** Left for a later run: the customer is outside the 24-hour window, has no conversation, or the store is not connected. */
  waiting: number
  /** The run stopped early because its time was up. */
  out_of_time?: true
}

type Outcome = 'sent' | 'failed' | 'waiting' | 'skipped'

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
}: {
  supabase: Database
  now?: Date
  limit?: number
  deadline?: number
}): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { scanned: 0, sent: 0, failed: 0, waiting: 0 }
  const nowIso = now.toISOString()
  const abandonedBefore = new Date(now.getTime() - ABANDONED_AFTER_MS).toISOString()
  const outOfTime = () => Boolean(deadline && Date.now() >= deadline)
  let cursor: string | null = null

  while (result.sent + result.failed < limit && result.scanned < MAX_SCANNED) {
    if (outOfTime()) {
      result.out_of_time = true
      break
    }

    // Open checkouts that have sat untouched for an hour and are due a reminder, for stores
    // that sell on WhatsApp and have not switched reminders off. Only the inner join on the
    // organization lets the database apply the store settings.
    let query = supabase
      .from('commerce_orders')
      .select(ORDER_COLUMNS)
      .in('status', OPEN_CHECKOUT_STATUSES)
      .neq('payment_status', 'paid')
      .lt('reminder_count', MAX_REMINDERS)
      .or(`next_reminder_at.is.null,next_reminder_at.lte.${nowIso}`)
      .lte('created_at', abandonedBefore)
      .lte('updated_at', abandonedBefore)
      .not('organizations.enable_commerce', 'is', false)
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

      const outcome = await remindOrder(supabase, order, now)
      if (outcome === 'migration') return skipUntilMigrated(result)
      if (outcome !== 'skipped') result[outcome]++
    }

    if (result.out_of_time || orders.length < CHUNK_SIZE) break
  }

  if (result.sent || result.failed || result.waiting) {
    console.log(`[Checkout Reminders] Sent ${result.sent}, failed ${result.failed}, waiting ${result.waiting} (examined ${result.scanned}).`)
  }
  return result
}

async function remindOrder(supabase: Database, order: any, now: Date): Promise<Outcome | 'migration'> {
  const organization = order.organizations
  // The query already leaves these out; a reminder must never reach a canceled, paid or
  // confirmed order, so the rule is checked here as well.
  if (!organization || !isOpen(order.status) || order.payment_status === 'paid') return 'skipped'

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

  // WhatsApp refuses a plain message more than 24 hours after the customer's last one, so
  // without a recent inbound message the reminder waits (reaching them then would take an
  // approved template, which the store would have to set up first).
  if (!order.conversation_id) return 'waiting'
  if (!organization.whatsapp_api_token || !organization.whatsapp_phone_number_id) return 'waiting'
  const { data: lastInbound, error: inboundErr } = await supabase
    .from('messages')
    .select('created_at')
    .eq('organization_id', order.organization_id)
    .eq('conversation_id', order.conversation_id)
    .eq('sender_type', 'contact')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (inboundErr) throw new Error(inboundErr.message || 'Could not read the conversation')
  const sinceInbound = now.getTime() - Date.parse(lastInbound?.created_at || '')
  if (!(sinceInbound < CUSTOMER_WINDOW_MS)) return 'waiting'

  const outcome = await resendCheckoutStep({ organization, order, database: supabase })
  if (outcome.step === 'not_sent') {
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
  else console.log(`[Checkout Reminders] Reminder ${reminderCount + 1} sent for order #${order.order_number} (${outcome.step}).`)
  return 'sent'
}
