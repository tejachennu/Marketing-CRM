/**
 * Finding a returning customer at the counter: type part of a mobile number or a name, pick them,
 * and see their last visit (to book the same again in one tap).
 */

import { istDate } from './spoken'

export interface CustomerVisit { date: string; services: string[]; service_ids: string[]; staff_ids: string[]; total: number }
export interface CustomerMatch { contact_id: string; name: string; phone: string | null; visits: number; last_visit: CustomerVisit | null }

/** What was typed, made safe for a search: the digits of a number (at least 4), or up to two words of a name. */
export function customerSearch(value: unknown): { digits: string } | { words: string[] } | null {
  const text = String(value ?? '').trim().slice(0, 60)
  const digits = text.replace(/\D/g, '')
  if (digits.length >= 4 && digits.length >= text.replace(/[\s+()-]/g, '').length - 1) return { digits: digits.slice(-10) }
  // Letters, digits and a few name characters only: nothing that means something to the database
  const words = text.replace(/[^\p{L}\p{N}' -]/gu, ' ').split(/\s+/).filter((w) => w.length > 0).slice(0, 2)
  if (!words.length || words.join('').length < 2) return null
  return { words }
}

/** Each customer's visits and their last visit, from their bills (newest first; void bills skipped). */
export function summarizeVisits(invoices: { contact_id?: string | null; status: string; issued_at: string; total?: number | string; items?: any[] }[]): Map<string, { visits: number; last_visit: CustomerVisit }> {
  const out = new Map<string, { visits: number; last_visit: CustomerVisit }>()
  const sorted = [...invoices].filter((i) => i.contact_id && i.status !== 'void').sort((a, b) => b.issued_at.localeCompare(a.issued_at))
  for (const invoice of sorted) {
    const key = invoice.contact_id as string
    const entry = out.get(key)
    if (entry) { entry.visits += 1; continue }
    const items = invoice.items || []
    out.set(key, {
      visits: 1,
      last_visit: {
        date: istDate(invoice.issued_at),
        services: items.map((item) => String(item?.name || '')).filter(Boolean),
        service_ids: [...new Set(items.map((item) => item?.service_id).filter(Boolean))] as string[],
        staff_ids: items.map((item) => item?.staff_id || null),
        total: Number(invoice.total) || 0,
      },
    })
  }
  return out
}

const fullName = (contact: { first_name?: string | null; last_name?: string | null }) => [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()

/** Up to 8 saved customers matching what was typed, with their visits. */
export async function findCustomers(db: any, organizationId: string, typed: unknown): Promise<CustomerMatch[]> {
  const search = customerSearch(typed)
  if (!search) return []
  let query = db.from('contacts').select('id, first_name, last_name, phone_number').eq('organization_id', organizationId)
  if ('digits' in search) query = query.ilike('phone_number', `%${search.digits}%`)
  else if (search.words.length > 1) query = query.ilike('first_name', `${search.words[0]}%`).ilike('last_name', `${search.words[1]}%`)
  else query = query.or(`first_name.ilike.${search.words[0]}*,last_name.ilike.${search.words[0]}*`)
  const { data: contacts, error } = await query.limit(8)
  if (error) throw new Error(error.message)
  if (!contacts?.length) return []
  const { data: invoices } = await db.from('salon_invoices').select('contact_id, status, issued_at, total, items').eq('organization_id', organizationId)
    .in('contact_id', contacts.map((c: any) => c.id)).order('issued_at', { ascending: false }).limit(300)
  const visits = summarizeVisits(invoices || [])
  return contacts
    .map((contact: any) => ({ contact_id: contact.id, name: fullName(contact) || 'Customer', phone: contact.phone_number || null, visits: visits.get(contact.id)?.visits || 0, last_visit: visits.get(contact.id)?.last_visit || null }))
    // Regulars first, then by name
    .sort((a: CustomerMatch, b: CustomerMatch) => b.visits - a.visits || a.name.localeCompare(b.name))
}
