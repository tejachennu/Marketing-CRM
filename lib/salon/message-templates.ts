/**
 * Which WhatsApp template goes out for each automatic message. WhatsApp only allows free-form
 * messages within 24 hours of the customer's last message; after that an approved template is
 * sent instead. By default that is the built-in one (lib/salon/templates.ts); the business can
 * pick any of its own approved templates for each message and say what fills each blank
 * ("template 1 for bills, template 2 for reminders"). Pure and browser-safe.
 */

import type { SalonTemplateKey } from './templates'

export type MessagePurpose = 'bill' | 'booking' | 'reminder' | 'feedback'
export type FieldKey = 'first_name' | 'customer_name' | 'business' | 'bill_number' | 'amount' | 'services' | 'staff' | 'visit' | 'date_time' | 'date' | 'time' | 'link'

export const FIELD_LABELS: Record<FieldKey, string> = {
  first_name: 'Customer first name',
  customer_name: 'Customer full name',
  business: 'Business name',
  bill_number: 'Bill number',
  amount: 'Bill amount',
  services: 'Services',
  staff: 'Staff name',
  visit: 'Services with staff ("Facial with Anitha")',
  date_time: 'Date and time',
  date: 'Date',
  time: 'Time',
  link: 'Link code (for a link button)',
}

export interface PurposeInfo {
  title: string
  use: string
  /** What this message can fill a template's blanks with */
  fields: FieldKey[]
  /** The built-in template and what fills its blanks, in order */
  defaultKey: SalonTemplateKey
  defaultFields: FieldKey[]
  /** The built-in template's link button opens this page with the link code */
  linkPath?: string
}

export const PURPOSES: Record<MessagePurpose, PurposeInfo> = {
  bill: { title: 'Bill', use: 'Sends the bill with a link to view it', fields: ['first_name', 'customer_name', 'business', 'bill_number', 'amount', 'services', 'staff', 'date', 'link'], defaultKey: 'bill', defaultFields: ['first_name', 'business', 'bill_number', 'amount'], linkPath: '/i/' },
  booking: { title: 'Booking confirmed', use: 'Confirms a booking from the counter or the chat', fields: ['first_name', 'customer_name', 'business', 'date_time', 'date', 'time', 'services', 'staff', 'visit'], defaultKey: 'booking', defaultFields: ['first_name', 'business', 'date_time', 'visit'] },
  reminder: { title: 'Appointment reminder', use: 'About 2 hours before the appointment', fields: ['first_name', 'customer_name', 'business', 'time', 'date', 'services', 'staff', 'visit'], defaultKey: 'reminder', defaultFields: ['first_name', 'business', 'time', 'services'] },
  feedback: { title: 'Feedback request', use: 'Asks how the visit was, with a link to the feedback form', fields: ['first_name', 'customer_name', 'business', 'services', 'staff', 'link'], defaultKey: 'feedback', defaultFields: ['first_name', 'business', 'services'], linkPath: '/f/' },
}

export const MESSAGE_PURPOSES = Object.keys(PURPOSES) as MessagePurpose[]

export interface MessageTemplateChoice {
  /** The template's name on WhatsApp */
  name: string
  language: string
  /** What fills {{1}}, {{2}}, … in order */
  fields: FieldKey[]
  /** What goes at the end of the template's link button, if it has one */
  url_field?: FieldKey | null
}
export type MessageTemplates = Partial<Record<MessagePurpose, MessageTemplateChoice>>

const NAME = /^[a-z0-9_]{1,512}$/
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/

/** Check the choices sent from Setup. A message left out uses the built-in template. */
export function parseMessageTemplates(raw: unknown): { value: MessageTemplates } | { error: string } {
  if (raw === null || raw === undefined) return { value: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Choose a template for each message.' }
  const value: MessageTemplates = {}
  for (const [purpose, choice] of Object.entries(raw as Record<string, any>)) {
    if (!MESSAGE_PURPOSES.includes(purpose as MessagePurpose)) return { error: 'That message is not one Front Desk sends.' }
    if (choice === null || choice === undefined) continue
    const info = PURPOSES[purpose as MessagePurpose]
    const name = String(choice?.name ?? '').trim()
    const language = String(choice?.language ?? '').trim()
    if (!NAME.test(name)) return { error: `Choose a template for the ${info.title.toLowerCase()} message.` }
    if (!LANGUAGE.test(language)) return { error: `The ${info.title.toLowerCase()} template's language is not right.` }
    const fields = Array.isArray(choice?.fields) ? choice.fields.map(String) : []
    if (fields.length > 20) return { error: 'A template can have at most 20 blanks.' }
    const bad = fields.find((field: string) => !info.fields.includes(field as FieldKey))
    if (bad) return { error: `Choose what fills each blank of the ${info.title.toLowerCase()} template.` }
    const urlField = choice?.url_field ? String(choice.url_field) : null
    if (urlField && !info.fields.includes(urlField as FieldKey)) return { error: `Choose what goes in the ${info.title.toLowerCase()} template's link.` }
    value[purpose as MessagePurpose] = { name, language, fields: fields as FieldKey[], url_field: urlField as FieldKey | null }
  }
  return { value }
}

/** Template values may not hold new lines, tabs or long runs of spaces, and may not be empty. */
export function cleanTemplateValue(value: unknown): string {
  return String(value ?? '').replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000) || '-'
}

/** The message for a template the business chose, filled with this message's values. */
export function chosenTemplatePayload(choice: MessageTemplateChoice, phone: string, values: Partial<Record<FieldKey, string>>) {
  const components: any[] = []
  if (choice.fields.length) components.push({ type: 'body', parameters: choice.fields.map((field) => ({ type: 'text', text: cleanTemplateValue(values[field]) })) })
  if (choice.url_field && values[choice.url_field]) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: cleanTemplateValue(values[choice.url_field]) }] })
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(phone).replace(/[^\d]/g, ''),
    type: 'template',
    template: { name: choice.name, language: { code: choice.language }, components },
  }
}

/** How many blanks ({{1}}, {{2}}, …) a template's body has, from Meta's description of it. */
export function templateBlanks(template: { components?: any[] }): { blanks: number; urlButton: boolean } {
  const body = (template.components || []).find((c: any) => String(c?.type).toUpperCase() === 'BODY')
  const numbers = [...String(body?.text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  const buttons = (template.components || []).find((c: any) => String(c?.type).toUpperCase() === 'BUTTONS')?.buttons || []
  const urlButton = buttons.some((b: any) => String(b?.type).toUpperCase() === 'URL' && /\{\{\s*1\s*\}\}/.test(String(b?.url || '')))
  return { blanks: numbers.length ? Math.max(...numbers) : 0, urlButton }
}

/** A sensible first guess at what fills each blank, for a template just picked. */
export function guessFields(purpose: MessagePurpose, blanks: number): FieldKey[] {
  const order = PURPOSES[purpose].defaultFields
  const rest = PURPOSES[purpose].fields.filter((f) => f !== 'link' && !order.includes(f))
  return [...order, ...rest].slice(0, blanks)
}
