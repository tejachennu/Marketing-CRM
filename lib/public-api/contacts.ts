/** Contacts through the public API: list and search, read, create (or update by phone) and change. */

import { phoneKey } from '../salon/spoken'
import { normalizePhone } from './keys'

export interface ApiContact {
  id: string
  name: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  company: string | null
  tags: string[]
  created_at: string | null
  updated_at: string | null
}

const COLUMNS = 'id, first_name, last_name, phone_number, whatsapp_number, email, company, tags, created_at, updated_at'

export function toApiContact(row: any): ApiContact {
  const whatsapp = String(row.whatsapp_number || '').replace(/^whatsapp:/, '') || null
  return {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.phone_number || whatsapp || 'Contact',
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    phone: row.phone_number || whatsapp,
    whatsapp,
    email: row.email || null,
    company: row.company || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

export interface ContactInput { first_name?: string | null; last_name?: string | null; phone?: string; email?: string | null; company?: string | null; tags?: string[] }

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Check a contact sent to the API. `partial`: only the fields sent are changed. */
export function parseContactInput(body: any, partial = false): { value: ContactInput } | { error: string; field: string } {
  const value: ContactInput = {}
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body || {}, key) && body[key] !== undefined
  if (has('name') && !has('first_name')) {
    const [first, ...rest] = text(body.name, 120).split(' ')
    value.first_name = first || null
    value.last_name = rest.join(' ') || null
  }
  if (has('first_name')) value.first_name = text(body.first_name, 60) || null
  if (has('last_name')) value.last_name = text(body.last_name, 60) || null
  if (has('phone')) {
    const phone = normalizePhone(body.phone)
    if (!phone) return { error: 'Give the phone number with its country code, like +919876543210 (a 10-digit Indian number also works).', field: 'phone' }
    value.phone = phone
  } else if (!partial) {
    return { error: 'A phone number is needed to create a contact.', field: 'phone' }
  }
  if (has('email')) {
    const email = text(body.email, 120).toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address does not look right.', field: 'email' }
    value.email = email || null
  }
  if (has('company')) value.company = text(body.company, 120) || null
  if (has('tags')) {
    if (!Array.isArray(body.tags)) return { error: 'tags must be a list of words, like ["VIP", "Website"].', field: 'tags' }
    value.tags = [...new Set(body.tags.map((tag: unknown) => text(tag, 40)).filter(Boolean))].slice(0, 30) as string[]
  }
  return { value }
}

/** The contact with this number, by the number saved or the WhatsApp number. */
export async function contactByPhone(db: any, organizationId: string, phone: string) {
  const key = phoneKey(phone)
  const { data, error } = await db.from('contacts').select(COLUMNS).eq('organization_id', organizationId).or(`phone_number.ilike.*${key},whatsapp_number.ilike.*${key}`).limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] || null
}

/** List contacts, newest first; ?search matches name, phone or email, ?phone finds one number. */
export async function listContacts(db: any, organizationId: string, params: URLSearchParams, page: { limit: number; offset: number }) {
  let query = db.from('contacts').select(COLUMNS).eq('organization_id', organizationId)
  const phone = params.get('phone')
  const search = text(params.get('search'), 60)
  // Characters that would change the meaning of the database filter are dropped
  const tag = text(params.get('tag'), 40).replace(/[{}",\\]/g, '')
  if (phone) {
    const key = phoneKey(phone)
    if (key.length < 6) return []
    query = query.or(`phone_number.ilike.*${key},whatsapp_number.ilike.*${key}`)
  } else if (search) {
    const digits = search.replace(/\D/g, '')
    const word = search.replace(/[^\p{L}\p{N}@.' -]/gu, '').replace(/[,.()]/g, ' ').trim().split(/\s+/)[0] || ''
    if (digits.length >= 4) query = query.or(`phone_number.ilike.*${digits}*,whatsapp_number.ilike.*${digits}*`)
    else if (word) query = query.or(`first_name.ilike.${word}*,last_name.ilike.${word}*,email.ilike.${word}*`)
  }
  if (tag) query = query.contains('tags', [tag])
  const { data, error } = await query.order('created_at', { ascending: false }).range(page.offset, page.offset + page.limit)
  if (error) throw new Error(error.message)
  return (data || []).map(toApiContact)
}

export async function getContact(db: any, organizationId: string, id: string) {
  const { data, error } = await db.from('contacts').select(COLUMNS).eq('organization_id', organizationId).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toApiContact(data) : null
}

/** Create a contact, or update the one with the same number. `created` says which. */
export async function upsertContact(db: any, organizationId: string, input: ContactInput): Promise<{ contact: ApiContact; created: boolean }> {
  const existing = await contactByPhone(db, organizationId, input.phone!)
  if (existing) {
    const changes: Record<string, unknown> = {}
    if (input.first_name !== undefined) changes.first_name = input.first_name
    if (input.last_name !== undefined) changes.last_name = input.last_name
    if (input.email !== undefined) changes.email = input.email
    if (input.company !== undefined) changes.company = input.company
    if (input.tags !== undefined) changes.tags = [...new Set([...(existing.tags || []), ...input.tags])]
    if (!existing.phone_number) changes.phone_number = input.phone
    if (!Object.keys(changes).length) return { contact: toApiContact(existing), created: false }
    const { data, error } = await db.from('contacts').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('organization_id', organizationId).select(COLUMNS).single()
    if (error) throw new Error(error.message)
    return { contact: toApiContact(data), created: false }
  }
  const { data, error } = await db.from('contacts').insert({
    organization_id: organizationId, first_name: input.first_name || null, last_name: input.last_name || null,
    phone_number: input.phone, whatsapp_number: `whatsapp:${input.phone}`, email: input.email || null, company: input.company || null,
    tags: input.tags?.length ? input.tags : ['API'],
  }).select(COLUMNS).single()
  if (error) throw new Error(error.message)
  return { contact: toApiContact(data), created: true }
}

/** Change a contact. A new phone number may not belong to another contact. */
export async function updateContact(db: any, organizationId: string, id: string, input: ContactInput): Promise<{ contact?: ApiContact; error?: 'not_found' | 'phone_taken' }> {
  const { data: current } = await db.from('contacts').select('id').eq('organization_id', organizationId).eq('id', id).maybeSingle()
  if (!current) return { error: 'not_found' }
  const changes: Record<string, unknown> = {}
  for (const key of ['first_name', 'last_name', 'email', 'company', 'tags'] as const) if (input[key] !== undefined) changes[key] = input[key]
  if (input.phone) {
    const other = await contactByPhone(db, organizationId, input.phone)
    if (other && other.id !== id) return { error: 'phone_taken' }
    changes.phone_number = input.phone
    changes.whatsapp_number = `whatsapp:${input.phone}`
  }
  if (!Object.keys(changes).length) return { contact: (await getContact(db, organizationId, id))! }
  const { data, error } = await db.from('contacts').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id).eq('organization_id', organizationId).select(COLUMNS).single()
  if (error) throw new Error(error.message)
  return { contact: toApiContact(data) }
}
