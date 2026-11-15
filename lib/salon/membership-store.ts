/**
 * Memberships in the database: plans, cards, and their use. The rules (what a card does to a bill, its
 * state, its numbers) are in memberships.ts; billing itself is in actions.ts.
 */

import { randomBytes } from 'node:crypto'
import { isUuid } from '../record-visibility'
import { cardAfterRefund, cardAfterUse, formatCardNumber, readPlan, usableCard, withMembershipSchema, type Membership, type MembershipPlan } from './memberships'

async function checked<T = any>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await withMembershipSchema(() => query)
  if (error) throw new Error(error.message)
  return data
}

const last10 = (phone: unknown) => String(phone ?? '').replace(/\D/g, '').slice(-10)

// ── Plans ────────────────────────────────────────────────────────────────────

export async function loadPlans(db: any, organizationId: string, onlyActive = false) {
  let query = db.from('salon_membership_plans').select('*').eq('organization_id', organizationId)
  if (onlyActive) query = query.eq('active', true)
  return (await checked<any[]>(query.order('price', { ascending: true }))) || []
}

export async function loadPlan(db: any, organizationId: string, planId: string) {
  if (!isUuid(planId)) return null
  return checked(db.from('salon_membership_plans').select('*').eq('id', planId).eq('organization_id', organizationId).maybeSingle())
}

/** Add or change a plan. Cards already sold keep the plan as it was when sold. */
export async function savePlan(db: any, organizationId: string, raw: any) {
  const services = await checked<any[]>(db.from('salon_services').select('id, name').eq('organization_id', organizationId))
  const parsed = readPlan(raw, services || [])
  if ('error' in parsed) throw new Error(parsed.error)
  const { id, ...plan } = parsed.plan as MembershipPlan
  const now = new Date().toISOString()
  if (id) {
    const saved = await checked(db.from('salon_membership_plans').update({ ...plan, updated_at: now }).eq('id', id).eq('organization_id', organizationId).select('*').maybeSingle())
    if (!saved) throw new Error('That plan was not found.')
    return saved
  }
  return checked(db.from('salon_membership_plans').insert({ ...plan, organization_id: organizationId }).select('*').single())
}

// ── Cards ────────────────────────────────────────────────────────────────────

export async function loadCard(db: any, organizationId: string, cardId: string): Promise<Membership | null> {
  if (!isUuid(cardId)) return null
  return checked(db.from('salon_memberships').select('*').eq('id', cardId).eq('organization_id', organizationId).maybeSingle())
}

/** A customer's cards that can be used today (matched by their contact or the last 10 digits of their phone). */
export async function cardsForCustomer(db: any, organizationId: string, who: { contact_id?: string | null; phone?: string | null }, now = new Date()): Promise<Membership[]> {
  const found = new Map<string, Membership>()
  if (isUuid(who.contact_id)) {
    for (const card of (await checked<any[]>(db.from('salon_memberships').select('*').eq('organization_id', organizationId).eq('contact_id', who.contact_id).eq('status', 'active'))) || []) found.set(card.id, card)
  }
  const digits = last10(who.phone)
  if (digits.length === 10) {
    for (const card of (await checked<any[]>(db.from('salon_memberships').select('*').eq('organization_id', organizationId).eq('status', 'active').like('customer_phone', `%${digits}`))) || []) found.set(card.id, card)
  }
  return [...found.values()].filter((card) => usableCard(card, now)).sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at))
}

/** Is this card this customer's? (So one customer's card is never used on another's bill.) */
export function cardBelongsTo(card: Pick<Membership, 'contact_id' | 'customer_phone'>, who: { contact_id?: string | null; phone?: string | null }): boolean {
  if (card.contact_id && who.contact_id && card.contact_id === who.contact_id) return true
  const a = last10(card.customer_phone)
  return a.length === 10 && a === last10(who.phone)
}

export const makeCardToken = () => randomBytes(18).toString('base64url')

/** Save a new card with the next card number (retries if two counters sell at the same moment). */
export async function insertCard(db: any, organizationId: string, values: Record<string, unknown>) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await checked<any[]>(db.from('salon_memberships').select('seq').eq('organization_id', organizationId).order('seq', { ascending: false }).limit(1))
    const seq = (Number(last?.[0]?.seq) || 0) + 1
    const { data, error } = await withMembershipSchema(() => db.from('salon_memberships').insert({ ...values, organization_id: organizationId, seq, card_number: formatCardNumber(seq), public_token: makeCardToken() }).select('*').single())
    if (!error) return data as Membership
    if (!(error.code === '23505' || /duplicate key/i.test(error.message || ''))) throw new Error(error.message)
  }
  throw new Error('The card could not be numbered. Please try again.')
}

export async function addUsage(db: any, organizationId: string, rows: { membership_id: string; invoice_id?: string | null; kind: string; service_id?: string | null; detail?: string | null; amount?: number; sessions?: number; created_by?: string | null }[]) {
  if (!rows.length) return
  await checked(db.from('salon_membership_usage').insert(rows.map((row) => ({ organization_id: organizationId, amount: 0, sessions: 0, ...row }))))
}

/** Change a card safely when two counters may touch it at once: re-read and retry if it moved. */
async function updateCard(db: any, organizationId: string, cardId: string, change: (card: Membership) => Record<string, unknown> | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const card = await loadCard(db, organizationId, cardId)
    if (!card) throw new Error('That membership card was not found.')
    const values = change(card)
    if (!values) return card
    const { data, error } = await withMembershipSchema(() => db.from('salon_memberships').update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', cardId).eq('organization_id', organizationId).eq('updated_at', card.updated_at).select('*'))
    if (error) throw new Error(error.message)
    if (data?.length) return data[0] as Membership
  }
  throw new Error('The card is busy. Please try again.')
}

/** After a bill: take the sessions and credit it used, and write down what it saved. */
export async function recordCardUse(db: any, organizationId: string, cardId: string, use: { sessions: { service_id: string; name: string; count: number }[]; credit: number; discountSaved: number }, invoiceId: string, userId: string | null) {
  await updateCard(db, organizationId, cardId, (card) => cardAfterUse(card, use))
  await addUsage(db, organizationId, [
    ...use.sessions.map((s) => ({ membership_id: cardId, invoice_id: invoiceId, kind: 'session', service_id: s.service_id, detail: s.name.replace(/ \(membership\)$/, ''), sessions: s.count, created_by: userId })),
    ...(use.discountSaved > 0 ? [{ membership_id: cardId, invoice_id: invoiceId, kind: 'discount', amount: use.discountSaved, created_by: userId }] : []),
    ...(use.credit > 0 ? [{ membership_id: cardId, invoice_id: invoiceId, kind: 'credit', amount: use.credit, created_by: userId }] : []),
  ])
}

/**
 * A bill was cancelled: give its sessions and credit back to the card (once), and cancel a card that
 * was sold on that bill.
 */
export async function undoCardsForInvoice(db: any, organizationId: string, invoiceId: string, userId: string | null) {
  const { data: rows, error } = await withMembershipSchema(() => db.from('salon_membership_usage').select('*').eq('organization_id', organizationId).eq('invoice_id', invoiceId))
  if (error) return
  const byCard = new Map<string, any[]>()
  for (const row of rows || []) byCard.set(row.membership_id, [...(byCard.get(row.membership_id) || []), row])
  for (const [cardId, list] of byCard) {
    if (list.some((row) => row.kind === 'refund' || row.kind === 'cancel')) continue
    if (list.some((row) => row.kind === 'sale')) {
      await updateCard(db, organizationId, cardId, () => ({ status: 'cancelled' }))
      await addUsage(db, organizationId, [{ membership_id: cardId, invoice_id: invoiceId, kind: 'cancel', detail: 'The bill for this card was cancelled', created_by: userId }])
      continue
    }
    const back = {
      sessions: list.filter((row) => row.kind === 'session').map((row) => ({ service_id: String(row.service_id || ''), count: Number(row.sessions) || 0 })),
      credit: list.filter((row) => row.kind === 'credit').reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    }
    await updateCard(db, organizationId, cardId, (card) => cardAfterRefund(card, back))
    await addUsage(db, organizationId, [{ membership_id: cardId, invoice_id: invoiceId, kind: 'refund', detail: 'Bill cancelled', amount: back.credit, sessions: back.sessions.reduce((n, s) => n + s.count, 0), created_by: userId }])
  }
}

/** Shop changes to a card: extend it, add credit or sessions, or cancel it. Each is written to its history. */
export async function adjustCard(db: any, organizationId: string, cardId: string, change: { type: 'extend'; days: number } | { type: 'credit'; amount: number; note?: string } | { type: 'sessions'; service_id: string; count: number } | { type: 'cancel' }, userId: string | null) {
  let detail = ''
  let amount = 0
  let sessions = 0
  const card = await updateCard(db, organizationId, cardId, (current) => {
    if (change.type === 'cancel') {
      if (current.status === 'cancelled') return null
      return { status: 'cancelled' }
    }
    if (change.type === 'extend') {
      const days = Math.round(change.days)
      if (!(days >= 1 && days <= 3650)) throw new Error('Choose between 1 day and 10 years.')
      const from = Math.max(Date.parse(current.expires_at), Date.now())
      detail = `Valid ${days} more day${days === 1 ? '' : 's'}`
      return { expires_at: new Date(from + days * 86_400_000).toISOString() }
    }
    if (change.type === 'credit') {
      const n = Math.round(Number(change.amount) * 100) / 100
      if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1_000_000) throw new Error('Enter an amount to add (or take off, with a minus).')
      const next = Math.round(((Number(current.credit_balance) || 0) + n) * 100) / 100
      if (next < 0) throw new Error('The card does not have that much credit.')
      amount = n
      detail = `${n > 0 ? 'Added' : 'Took off'} ₹${Math.abs(n).toLocaleString('en-IN')} credit${change.note ? ` · ${String(change.note).slice(0, 100)}` : ''}`
      return { credit_balance: next }
    }
    const count = Math.round(change.count)
    const row = current.sessions.find((s) => s.service_id === change.service_id)
    if (!row) throw new Error('That service is not on this card.')
    if (!(count !== 0 && Math.abs(count) <= 500) || row.total + count < row.used) throw new Error('That number of sessions does not fit.')
    sessions = count
    detail = `${count > 0 ? 'Added' : 'Took off'} ${Math.abs(count)} × ${row.name}`
    return { sessions: current.sessions.map((s) => (s.service_id === change.service_id ? { ...s, total: s.total + count } : s)) }
  })
  await addUsage(db, organizationId, [{ membership_id: cardId, kind: change.type === 'cancel' ? 'cancel' : 'adjust', detail: detail || null, amount, sessions, created_by: userId }])
  return card
}
