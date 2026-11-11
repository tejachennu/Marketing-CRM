/**
 * The message wallet: WhatsApp messages that WAMA's own number sends for a business (Starter plan)
 * are paid from it at Meta's price, with no markup. A message is charged before it is sent and given
 * back when Meta refuses it or reports it failed, so a business never pays for a message that did not
 * go out. The wallet never goes below zero: when it cannot cover a message, the message is not sent.
 */

export type MessageCategory = 'utility' | 'authentication' | 'marketing' | 'service'

/**
 * Meta's price per message in India, in rupees (Meta's INR rate card). Checked: July 2025.
 * Override any of them in the environment (META_PRICE_UTILITY_INR…) when Meta changes its prices.
 * Service messages (replies within 24 hours of the customer writing) are free.
 */
export const META_PRICES_INR: Record<MessageCategory, number> = {
  utility: 0.115,
  authentication: 0.115,
  marketing: 0.7846,
  service: 0,
}
export const META_PRICES_CHECKED = '2025-07-01'

export const MESSAGE_TOPUP_OPTIONS = [200, 500, 1000, 2000]
export const MIN_MESSAGE_TOPUP = 200
export const MAX_MESSAGE_TOPUP = 50000
/** Below this the business is told to top up. */
export const LOW_MESSAGE_BALANCE = 100

/** What one message costs the business, in rupees: Meta's price, nothing added. */
export function messagePrice(category: MessageCategory, env: Record<string, string | undefined> = process.env): number {
  const override = Number(env[`META_PRICE_${category.toUpperCase()}_INR`])
  if (String(env[`META_PRICE_${category.toUpperCase()}_INR`] ?? '').trim() !== '' && Number.isFinite(override) && override >= 0) return override
  return META_PRICES_INR[category] ?? META_PRICES_INR.utility
}

/** Every price, for the pricing and billing pages. */
export function messagePrices(env: Record<string, string | undefined> = process.env): Record<MessageCategory, number> {
  return { utility: messagePrice('utility', env), authentication: messagePrice('authentication', env), marketing: messagePrice('marketing', env), service: messagePrice('service', env) }
}

/**
 * Take a message's price from the wallet. Returns true when it was paid (or costs nothing), false when
 * the wallet is short (send nothing). `ref` identifies the message, so charging it twice takes the money once.
 */
export async function chargeMessage(db: any, organizationId: string, ref: string, category: MessageCategory = 'utility'): Promise<boolean> {
  const amount = messagePrice(category)
  if (!(amount > 0)) return true
  const { data, error } = await db.rpc('message_wallet_charge', { p_org: organizationId, p_amount: amount, p_ref: ref, p_category: category })
  if (error) throw new Error(error.message)
  return data === true
}

/** Give back a message's price (refused or failed). Safe to call more than once. Never throws. */
export async function refundMessage(db: any, ref: string): Promise<number> {
  try {
    const { data, error } = await db.rpc('message_wallet_refund', { p_ref: ref })
    if (error) {
      console.error('[Message wallet] Could not refund:', error.message)
      return 0
    }
    return Number(data) || 0
  } catch (error: any) {
    console.error('[Message wallet] Could not refund:', error?.message)
    return 0
  }
}

/** Add money to the wallet once per payment (top-up) or as an adjustment by Super Admin. */
export async function creditMessages(db: any, organizationId: string, amount: number, kind: 'topup' | 'adjustment', paymentId: string | null, createdBy: string | null = null): Promise<number> {
  const { data, error } = await db.rpc('message_wallet_credit', { p_org: organizationId, p_amount: amount, p_kind: kind, p_payment_id: paymentId, p_created_by: createdBy })
  if (error) throw new Error(error.message)
  return Number(data) || 0
}

/** The last charges, refunds and top-ups, for the billing page. */
export async function messageHistory(db: any, organizationId: string, limit = 20): Promise<{ kind: string; amount: number; category: string | null; date: string }[]> {
  const { data, error } = await db.from('message_wallet_transactions').select('kind, amount, category, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(limit)
  if (error) return []
  return (data || []).map((row: any) => ({ kind: row.kind, amount: Number(row.amount) || 0, category: row.category || null, date: row.created_at }))
}
