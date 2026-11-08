/**
 * Checking what the salon screens send: services, staff and business details. Each parser returns
 * the clean values to save, or the first problem in words for the counter.
 */

import { BUSINESS_TYPE_IDS, type BusinessType } from './business'
import { parseMessageTemplates, type MessageTemplates } from './message-templates'
import { cleanInvoicePrefix, isValidGstin, normalizeGstin } from './invoice'
import { parseSpokenPhone } from './spoken'

type Parsed<T> = { value: T } | { error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export interface ServiceInput {
  name: string
  category: string
  price: number
  duration_minutes: number
  tax_rate: number
  sac_code: string | null
  active: boolean
}

export function parseService(body: any, partial = false): Parsed<Partial<ServiceInput>> {
  const value: Partial<ServiceInput> = {}
  if (!partial || body?.name !== undefined) {
    value.name = text(body?.name, 80)
    if (!value.name) return { error: 'Give the service a name.' }
  }
  if (!partial || body?.category !== undefined) value.category = text(body?.category, 40) || 'General'
  if (!partial || body?.price !== undefined) {
    const price = Number(body?.price)
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) return { error: 'Enter a price between ₹0 and ₹10,00,000.' }
    value.price = Math.round(price * 100) / 100
  }
  if (!partial || body?.duration_minutes !== undefined) {
    const minutes = Math.round(Number(body?.duration_minutes ?? 30))
    if (!(minutes >= 5 && minutes <= 600)) return { error: 'A service takes between 5 minutes and 10 hours.' }
    value.duration_minutes = minutes
  }
  if (!partial || body?.tax_rate !== undefined) {
    const rate = Number(body?.tax_rate ?? 18)
    if (!(rate >= 0 && rate <= 28)) return { error: 'GST is between 0% and 28%.' }
    value.tax_rate = rate
  }
  if (!partial || body?.sac_code !== undefined) {
    const sac = text(body?.sac_code, 10).replace(/\D/g, '')
    if (sac && !/^\d{4,8}$/.test(sac)) return { error: 'An SAC code has 4 to 8 digits.' }
    value.sac_code = sac || null
  }
  if (!partial || body?.active !== undefined) value.active = body?.active !== false
  return { value }
}

export interface StaffInput {
  name: string
  phone: string | null
  service_ids: string[]
  active: boolean
  /** Share of the value of the services they do, 0 to 100 */
  commission_percent?: number
}

export function parseStaff(body: any, partial = false): Parsed<Partial<StaffInput>> {
  const value: Partial<StaffInput> = {}
  if (!partial || body?.name !== undefined) {
    value.name = text(body?.name, 60)
    if (!value.name) return { error: 'Give the team member a name.' }
  }
  if (!partial || body?.phone !== undefined) {
    const raw = text(body?.phone, 30)
    const phone = raw ? parseSpokenPhone(raw) : null
    if (raw && !phone) return { error: 'Enter a 10-digit mobile number.' }
    value.phone = phone
  }
  if (!partial || body?.service_ids !== undefined) {
    value.service_ids = (Array.isArray(body?.service_ids) ? body.service_ids : []).map(String).filter((id: string) => UUID.test(id)).slice(0, 200)
  }
  if (!partial || body?.active !== undefined) value.active = body?.active !== false
  if (body?.commission_percent !== undefined && body?.commission_percent !== null && body?.commission_percent !== '') {
    const percent = Number(body.commission_percent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { error: 'Commission is a percentage from 0 to 100.' }
    value.commission_percent = Math.round(percent * 100) / 100
  }
  return { value }
}

export interface SalonSettingsInput {
  business_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  invoice_prefix: string
  prices_include_tax: boolean
  invoice_note: string | null
  voice_replies: boolean
  // WhatsApp settings: only changed when sent
  opens_at?: string
  closes_at?: string
  closed_weekdays?: number[]
  chat_assistant?: boolean
  auto_approve_bookings?: boolean
  reminders_enabled?: boolean
  feedback_enabled?: boolean
  feedback_delay_minutes?: number
  review_link?: string | null
  business_type?: BusinessType
  message_templates?: MessageTemplates
}

export const FEEDBACK_DELAYS = [30, 60, 120, 240, 1440]

export function parseSettings(body: any): Parsed<SalonSettingsInput> {
  const gstin = normalizeGstin(body?.gstin)
  if (gstin && !isValidGstin(gstin)) return { error: 'That GSTIN does not look right. It has 15 characters, like 36ABCDE1234F1Z5.' }
  const email = text(body?.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' }
  const whatsapp = parseWhatsAppSettings(body)
  if ('error' in whatsapp) return whatsapp
  return {
    value: {
      ...whatsapp.value,
      business_name: text(body?.business_name, 100) || null,
      address: String(body?.address ?? '').trim().slice(0, 300) || null,
      phone: text(body?.phone, 30) || null,
      email: email || null,
      gstin,
      invoice_prefix: cleanInvoicePrefix(body?.invoice_prefix),
      prices_include_tax: body?.prices_include_tax === true,
      invoice_note: String(body?.invoice_note ?? '').trim().slice(0, 300) || null,
      voice_replies: body?.voice_replies !== false,
    },
  }
}

/** The WhatsApp part of the settings. Fields not sent are left as they are. */
export function parseWhatsAppSettings(body: any): Parsed<Partial<SalonSettingsInput>> {
  const value: Partial<SalonSettingsInput> = {}
  const has = (key: string) => body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/
  if (has('opens_at') || has('closes_at')) {
    const opens = String(body.opens_at ?? '10:00')
    const closes = String(body.closes_at ?? '21:00')
    if (!clock.test(opens) || !clock.test(closes)) return { error: 'Choose opening and closing times.' }
    if (closes <= opens) return { error: 'Closing time must be after opening time.' }
    value.opens_at = opens
    value.closes_at = closes
  }
  if (has('closed_weekdays')) {
    const days = (Array.isArray(body.closed_weekdays) ? body.closed_weekdays : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
    if (new Set(days).size === 7) return { error: 'You cannot be closed every day.' }
    value.closed_weekdays = [...new Set<number>(days)].sort()
  }
  for (const key of ['chat_assistant', 'auto_approve_bookings', 'reminders_enabled', 'feedback_enabled'] as const) if (has(key)) value[key] = body[key] === true
  if (has('feedback_delay_minutes')) {
    const minutes = Number(body.feedback_delay_minutes)
    value.feedback_delay_minutes = FEEDBACK_DELAYS.includes(minutes) ? minutes : 120
  }
  if (has('review_link')) {
    const link = String(body.review_link ?? '').trim()
    if (link && !/^https:\/\/[^\s]+$/i.test(link)) return { error: 'The review link must start with https://' }
    value.review_link = link.slice(0, 500) || null
  }
  if (has('business_type')) {
    if (!BUSINESS_TYPE_IDS.includes(body.business_type)) return { error: 'Choose your kind of business.' }
    value.business_type = body.business_type
  }
  if (has('message_templates')) {
    const parsed = parseMessageTemplates(body.message_templates)
    if ('error' in parsed) return parsed
    value.message_templates = parsed.value
  }
  return { value }
}

export function isUuid(value: unknown): boolean {
  return UUID.test(String(value || ''))
}
