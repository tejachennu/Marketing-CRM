/**
 * WAMA's own WhatsApp number, sending booking messages for businesses that did not connect their own
 * (the Starter plan, `organization_billing.whatsapp_mode = 'shared'`).
 *
 * - Only approved utility templates go out, never marketing. Each names the business, gives its phone
 *   number and says the number does not take replies.
 * - Each message is paid from the business's message wallet at Meta's price before it is sent; a
 *   message Meta refuses (or later reports failed) is given back.
 * - A customer who replies gets one short automatic answer a day with the business's phone number.
 *
 * Settings (Vercel only, never in the repo): WAMA CRM's own WhatsApp number (WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_API_TOKEN), or a separate number with WAMA_SHARED_PHONE_NUMBER_ID,
 * WAMA_SHARED_WABA_ID and WAMA_SHARED_ACCESS_TOKEN. Its events reach the platform workspace's webhook,
 * which passes them here; a separate number can use /api/webhooks/wama-shared instead.
 */

import { randomUUID } from 'node:crypto'
import { sendWhatsAppMessage } from './commerce/commerce-webhook-handler'
import { chargeMessage, refundMessage } from './message-wallet'
import type { FieldKey, MessagePurpose } from './salon/message-templates'
import { phoneKey } from './salon/spoken'

export interface SharedConfig {
  phoneNumberId: string
  wabaId: string
  token: string
  graphVersion: string
}

/**
 * WAMA's number: the WAMA_SHARED_* settings when set, otherwise WAMA CRM's own WhatsApp number (the
 * WHATSAPP_* settings the platform workspace already uses on Meta Cloud API).
 */
export function sharedConfig(env: Record<string, string | undefined> = process.env): SharedConfig | null {
  const own = (name: string) => String(env[name] || '').trim()
  const platformOnMeta = (own('WHATSAPP_PROVIDER') || 'facebook') === 'facebook'
  const phoneNumberId = own('WAMA_SHARED_PHONE_NUMBER_ID') || (platformOnMeta ? own('WHATSAPP_PHONE_NUMBER_ID') : '')
  const wabaId = own('WAMA_SHARED_WABA_ID') || (platformOnMeta ? own('WHATSAPP_BUSINESS_ACCOUNT_ID') : '')
  const token = own('WAMA_SHARED_ACCESS_TOKEN') || (platformOnMeta ? own('WHATSAPP_API_TOKEN') : '')
  if (!phoneNumberId || !token) return null
  return { phoneNumberId, wabaId, token, graphVersion: own('WAMA_SHARED_GRAPH_VERSION') || own('WHATSAPP_GRAPH_API_VERSION') || 'v25.0' }
}

/** WAMA CRM's own workspaces, in the order their WhatsApp number is tried. */
const PLATFORM_WORKSPACES = ['303b7a2d-281c-403c-b794-54d1e195ca69', 'b2acf062-c379-49f2-8905-267413c9c394']

export interface SharedSource { config: SharedConfig | null; from: string; why?: string }

let resolved: { at: number; source: SharedSource } | null = null

/** Test seam: forget which number was found. */
export function resetSharedNumber() {
  resolved = null
}

/**
 * WAMA's number, with where it came from: the settings in Vercel when set, otherwise the WhatsApp
 * number WAMA CRM's own workspace has connected in Settings (Meta Cloud API). WAMA_SHARED_WORKSPACE_ID
 * names another workspace to use. Remembered for five minutes.
 */
export async function findSharedNumber(db: any, now = Date.now()): Promise<SharedSource> {
  const fromEnv = sharedConfig()
  if (fromEnv) return { config: fromEnv, from: 'the settings in Vercel' }
  if (resolved && now - resolved.at < 5 * 60_000) return resolved.source
  const ids = [String(process.env.WAMA_SHARED_WORKSPACE_ID || '').trim(), ...PLATFORM_WORKSPACES].filter(Boolean)
  const reasons: string[] = []
  let source: SharedSource = { config: null, from: '', why: '' }
  try {
    const { data } = await db.from('organizations').select('id, name, whatsapp_provider, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_graph_api_version').in('id', ids)
    for (const id of ids) {
      const org = (data || []).find((row: any) => row.id === id)
      if (!org) continue
      if (org.whatsapp_provider !== 'facebook') { reasons.push(`${org.name} sends WhatsApp through Twilio, not Meta`); continue }
      if (!org.whatsapp_api_token || !org.whatsapp_phone_number_id) { reasons.push(`${org.name} has no WhatsApp number connected`); continue }
      source = {
        config: { phoneNumberId: String(org.whatsapp_phone_number_id), wabaId: String(org.whatsapp_business_account_id || ''), token: String(org.whatsapp_api_token), graphVersion: String(org.whatsapp_graph_api_version || '') || 'v25.0' },
        from: `the number connected in ${org.name}`,
      }
      break
    }
    if (!source.config) source.why = reasons.join('; ') || 'WAMA CRM\'s own workspace was not found'
  } catch (error: any) {
    source.why = error?.message || 'The workspaces could not be read'
  }
  // A miss is only remembered briefly, so connecting a number shows up at once
  if (source.config) resolved = { at: now, source }
  return source
}

/** WAMA's number in the shape the WhatsApp sender takes. */
function sender(config: SharedConfig) {
  return { whatsapp_provider: 'facebook', whatsapp_api_token: config.token, whatsapp_phone_number_id: config.phoneNumberId, whatsapp_graph_api_version: config.graphVersion }
}

export interface SharedTemplate {
  purpose: MessagePurpose
  name: string
  body: string
  /** What fills {{1}}, {{2}}, … ('phone' = the business's phone number) */
  params: (FieldKey | 'phone')[]
  /** A link button: its words and the address, ending in the value of `link` */
  button?: { text: string; path: '/i/' | '/f/' }
  example: string[]
}

const NO_REPLY = 'This number does not take replies.'

/** The templates on WAMA's own WhatsApp account. Names and words are fixed: Meta approves them once. */
export const SHARED_TEMPLATES: SharedTemplate[] = [
  {
    purpose: 'booking',
    name: 'wama_booking_confirmed',
    body: `Hi {{1}}, your booking at {{2}} is confirmed for {{3}} ({{4}}). ${NO_REPLY} To talk to the business, call {{5}}. Thank you.`,
    params: ['first_name', 'business', 'date_time', 'visit', 'phone'],
    example: ['Priya', 'Glow Salon', 'Sat 15 Nov at 4:30 pm', 'Haircut with Anitha', '+91 98480 12345'],
  },
  {
    purpose: 'reminder',
    name: 'wama_booking_reminder',
    body: `Hi {{1}}, a reminder of your visit to {{2}} at {{3}} today ({{4}}). ${NO_REPLY} To change it, call {{5}}. See you soon.`,
    params: ['first_name', 'business', 'time', 'visit', 'phone'],
    example: ['Priya', 'Glow Salon', '4:30 pm', 'Haircut with Anitha', '+91 98480 12345'],
  },
  {
    purpose: 'bill',
    name: 'wama_bill_ready',
    body: `Hi {{1}}, thank you for visiting {{2}}. Your bill {{3}} is {{4}}. Tap below to see it. ${NO_REPLY} To talk to the business, call {{5}}. Thank you.`,
    params: ['first_name', 'business', 'bill_number', 'amount', 'phone'],
    button: { text: 'View bill', path: '/i/' },
    example: ['Priya', 'Glow Salon', 'INV-0042', '₹1,180', '+91 98480 12345'],
  },
  {
    purpose: 'feedback',
    name: 'wama_feedback_request',
    body: `Hi {{1}}, how was your visit to {{2}}? Tell the business in one tap below. ${NO_REPLY} To talk to them, call {{3}}. Thank you.`,
    params: ['first_name', 'business', 'phone'],
    button: { text: 'Give feedback', path: '/f/' },
    example: ['Priya', 'Glow Salon', '+91 98480 12345'],
  },
]

export const SHARED_LANGUAGE = 'en'

export function sharedTemplateFor(purpose: MessagePurpose): SharedTemplate | null {
  return SHARED_TEMPLATES.find((template) => template.purpose === purpose) || null
}

/** WhatsApp refuses empty blanks and new lines in them. */
function blank(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return (text || fallback).slice(0, 200)
}

/** The message for one shared template, filled in. */
export function sharedTemplatePayload(template: SharedTemplate, phone: string, values: Partial<Record<FieldKey, string>>, businessPhone: string | null) {
  const parameters = template.params.map((param) => ({
    type: 'text',
    text: param === 'phone' ? blank(businessPhone, 'the business') : blank(values[param], param === 'first_name' ? 'there' : '-'),
  }))
  const components: any[] = [{ type: 'body', parameters }]
  if (template.button && values.link) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(values.link) }] })
  }
  return {
    messaging_product: 'whatsapp',
    to: String(phone).replace(/[^\d]/g, ''),
    type: 'template',
    template: { name: template.name, language: { code: SHARED_LANGUAGE }, components },
  }
}

/** What to submit to Meta for one template (Super Admin → Shared number → Submit templates). */
export function sharedTemplateDefinition(template: SharedTemplate, appUrl: string) {
  const components: any[] = [{ type: 'BODY', text: template.body, example: { body_text: [template.example] } }]
  if (template.button) {
    components.push({
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: template.button.text, url: `${appUrl.replace(/\/+$/, '')}${template.button.path}{{1}}`, example: [`${appUrl.replace(/\/+$/, '')}${template.button.path}abc123`] }],
    })
  }
  return { name: template.name, language: SHARED_LANGUAGE, category: 'UTILITY', components }
}

async function graph(config: SharedConfig, path: string, init: { method?: string; body?: unknown } = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const response = await fetcher(`https://graph.facebook.com/${config.graphVersion}/${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${config.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.error) throw new Error(data?.error?.error_user_msg || data?.error?.message || `Meta returned HTTP ${response.status}`)
  return data
}

/** Each shared template and its status on Meta (APPROVED, PENDING, REJECTED or missing). */
export async function sharedTemplateStatus(config: SharedConfig | null, fetcher: typeof fetch = fetch): Promise<{ name: string; purpose: MessagePurpose; status: string; reason?: string | null }[]> {
  if (!config?.wabaId) throw new Error("WAMA's number has no WhatsApp Business Account ID, so its templates cannot be read.")
  const data = await graph(config, `${config.wabaId}/message_templates?fields=name,status,language,rejected_reason&limit=200`, {}, fetcher)
  const found = (data?.data || []).filter((t: any) => t.language === SHARED_LANGUAGE)
  return SHARED_TEMPLATES.map((template) => {
    const match = found.find((t: any) => t.name === template.name)
    return { name: template.name, purpose: template.purpose, status: match?.status || 'MISSING', reason: match?.rejected_reason && match.rejected_reason !== 'NONE' ? match.rejected_reason : null }
  })
}

/** Submit the templates Meta does not have yet. Returns the statuses afterwards. */
export async function submitSharedTemplates(config: SharedConfig | null, appUrl: string, fetcher: typeof fetch = fetch) {
  if (!config?.wabaId) throw new Error("WAMA's number has no WhatsApp Business Account ID, so templates cannot be submitted.")
  const before = await sharedTemplateStatus(config, fetcher)
  const errors: string[] = []
  for (const template of SHARED_TEMPLATES) {
    const current = before.find((t) => t.name === template.name)
    if (current && current.status !== 'MISSING') continue
    try {
      await graph(config, `${config.wabaId}/message_templates`, { method: 'POST', body: sharedTemplateDefinition(template, appUrl) }, fetcher)
    } catch (error: any) {
      errors.push(`${template.name}: ${error?.message}`)
    }
  }
  return { templates: await sharedTemplateStatus(config, fetcher), errors }
}

/** The business's own phone number for "call …": Front Desk settings, else the workspace's. */
async function businessPhone(db: any, organizationId: string): Promise<string | null> {
  try {
    const { data } = await db.from('salon_settings').select('phone').eq('organization_id', organizationId).maybeSingle()
    if (data?.phone) return String(data.phone)
    const { data: org } = await db.from('organizations').select('contact_phone').eq('id', organizationId).maybeSingle()
    return org?.contact_phone ? String(org.contact_phone) : null
  } catch {
    return null
  }
}

export type SharedSendResult = { sent: boolean; error?: string; walletEmpty?: boolean }

/**
 * Send one Front Desk message from WAMA's number for a business. Paid from its message wallet first;
 * given back when Meta refuses it. Nothing is sent when the wallet is short.
 */
export async function sendShared(db: any, organizationId: string, phone: string, purpose: MessagePurpose, values: Partial<Record<FieldKey, string>>): Promise<SharedSendResult> {
  const { config } = await findSharedNumber(db)
  if (!config) return { sent: false, error: "WhatsApp messages from WAMA's number are not switched on yet." }
  const template = sharedTemplateFor(purpose)
  if (!template) return { sent: false, error: 'This message cannot go from WAMA\'s number.' }
  if (template.button && !values.link) return { sent: false, error: 'The link for this message is missing.' }

  const ref = `shared_${randomUUID()}`
  let paid = false
  try {
    paid = await chargeMessage(db, organizationId, ref, 'utility')
  } catch (error: any) {
    return { sent: false, error: `The message wallet could not be checked: ${error?.message}` }
  }
  if (!paid) return { sent: false, walletEmpty: true, error: 'Your message wallet is empty. Top it up in Billing so booking messages go out.' }

  const payload = sharedTemplatePayload(template, phone, values, await businessPhone(db, organizationId))
  const result = await sendWhatsAppMessage(sender(config), payload)
  await db.from('shared_messages').insert({
    organization_id: organizationId, phone: phoneKey(phone), purpose, charge_ref: ref,
    meta_message_id: result.ok ? result.messageId || null : null, status: result.ok ? 'sent' : 'failed', error: result.ok ? null : result.error || null,
  }).then(() => undefined, () => undefined)
  if (!result.ok) {
    await refundMessage(db, ref)
    return { sent: false, error: result.error }
  }
  return { sent: true }
}

/** Meta says how a message from WAMA's number went: a failed one is given back to the wallet. */
export async function handleSharedStatus(db: any, status: { id?: string; status?: string; errors?: any[] }): Promise<void> {
  if (!status?.id || !status.status) return
  const { data: row } = await db.from('shared_messages').select('id, charge_ref, status').eq('meta_message_id', status.id).maybeSingle()
  if (!row) return
  if (status.status === 'failed') {
    if (row.charge_ref) await refundMessage(db, row.charge_ref)
    const reason = status.errors?.[0]?.title || status.errors?.[0]?.message || null
    await db.from('shared_messages').update({ status: 'failed', error: reason }).eq('id', row.id)
  } else if (['delivered', 'read'].includes(status.status) && row.status !== 'failed') {
    await db.from('shared_messages').update({ status: status.status }).eq('id', row.id)
  }
}

/** The automatic answer to a customer who writes to WAMA's number. */
export function autoReplyText(business: string | null, phone: string | null): string {
  if (!business) return 'Hi! This WhatsApp number only sends booking messages for businesses that use WAMA CRM, so it cannot read replies. Please contact the business directly.'
  return `Hi! This number only sends booking messages for ${business}, so it cannot read replies.${phone ? ` To talk to ${business}, please call ${phone}.` : ` Please contact ${business} directly.`}`
}

const DAY = 86_400_000

/**
 * A customer wrote to WAMA's number: answer once a day with the business they last heard from and its
 * phone number. Free for the business (a reply within 24 hours of the customer writing is free on Meta).
 */
export async function handleSharedIncoming(db: any, from: string, now = Date.now()): Promise<{ replied: boolean; known?: boolean }> {
  const { config } = await findSharedNumber(db)
  const key = phoneKey(from)
  if (!config || key.length < 6) return { replied: false }
  const { data: recent } = await db.from('shared_messages').select('organization_id, purpose, created_at').eq('phone', key).order('created_at', { ascending: false }).limit(20)
  const rows = recent || []
  const last = rows.find((row: any) => row.purpose !== 'auto_reply')
  // Someone we never sent a booking message to (or not in the last 30 days): not a business's customer
  if (!last || now - Date.parse(last.created_at) > 30 * DAY) return { replied: false }
  if (rows.some((row: any) => row.purpose === 'auto_reply' && now - Date.parse(row.created_at) < DAY)) return { replied: false, known: true }
  let business: string | null = null
  let phone: string | null = null
  {
    const { data: settings } = await db.from('salon_settings').select('business_name, phone').eq('organization_id', last.organization_id).maybeSingle()
    const { data: org } = await db.from('organizations').select('name, contact_phone').eq('id', last.organization_id).maybeSingle()
    business = settings?.business_name || org?.name || null
    phone = settings?.phone || org?.contact_phone || null
  }
  const result = await sendWhatsAppMessage(sender(config), { messaging_product: 'whatsapp', to: String(from).replace(/[^\d]/g, ''), type: 'text', text: { body: autoReplyText(business, phone) } })
  {
    await db.from('shared_messages').insert({ organization_id: last.organization_id, phone: key, purpose: 'auto_reply', meta_message_id: result.ok ? result.messageId || null : null, status: result.ok ? 'sent' : 'failed' }).then(() => undefined, () => undefined)
  }
  return { replied: result.ok, known: true }
}
