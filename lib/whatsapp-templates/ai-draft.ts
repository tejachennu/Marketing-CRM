/**
 * Writing a WhatsApp template with AI: the business describes the message in its own words and
 * gets a draft that follows Meta's rules (name, category, variables with samples, buttons), ready to
 * check in the editor and submit. For a Front Desk message the blanks are limited to what that
 * message can fill, and the AI says which value goes in each one.
 */

import { emptyDraft, validateDraft, type ButtonDraft, type DraftProblem, type TemplateCategory, type TemplateDraft } from './template-model'
import { FIELD_LABELS, PURPOSES, type FieldKey, type MessagePurpose } from '../salon/message-templates'

export interface AiDraftRequest {
  description: string
  language?: string
  category?: TemplateCategory | null
  /** A Front Desk message: the blanks must come from what it can fill */
  purpose?: MessagePurpose | null
  businessName?: string | null
  businessKind?: string | null
}

/** What the model returns (strict JSON). */
export interface AiTemplateOutput {
  name: string
  category: 'MARKETING' | 'UTILITY'
  header: string
  body: string
  footer: string
  buttons: { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url: string; phone: string }[]
  samples: string[]
  fields: string[]
}

export const AI_TEMPLATE_SCHEMA = {
  name: 'whatsapp_template',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'category', 'header', 'body', 'footer', 'buttons', 'samples', 'fields'],
    properties: {
      name: { type: 'string', description: 'lowercase letters, digits and underscores only, under 50 characters' },
      category: { type: 'string', enum: ['MARKETING', 'UTILITY'] },
      header: { type: 'string', description: 'Optional short title, at most 60 characters, no variables, or an empty string' },
      body: { type: 'string', description: 'The message, at most 900 characters, with variables {{1}}, {{2}} … in order' },
      footer: { type: 'string', description: 'Optional, at most 60 characters, no variables, or an empty string' },
      buttons: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['type', 'text', 'url', 'phone'],
          properties: {
            type: { type: 'string', enum: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] },
            text: { type: 'string', description: 'At most 25 characters' },
            url: { type: 'string', description: 'For URL buttons: an https:// address, else an empty string' },
            phone: { type: 'string', description: 'For PHONE_NUMBER buttons: +country code and number, else an empty string' },
          },
        },
      },
      samples: { type: 'array', items: { type: 'string' }, description: 'A realistic example for each variable, in order' },
      fields: { type: 'array', items: { type: 'string' }, description: 'For a Front Desk message: the value key for each variable, in order; else empty' },
    },
  },
} as const

export function aiTemplateSystemPrompt(request: AiDraftRequest): string {
  const purpose = request.purpose ? PURPOSES[request.purpose] : null
  const fieldList = purpose ? purpose.fields.filter((f) => f !== 'link').map((f) => `- ${f}: ${FIELD_LABELS[f]}`).join('\n') : ''
  return `You write WhatsApp Business message templates that Meta approves. Return only the JSON asked for.

Rules (Meta rejects templates that break them):
- name: lowercase letters, digits and underscores, describing the message (e.g. order_ready_notice).
- category: UTILITY for messages about something the customer did or booked (bills, bookings, reminders, feedback on a visit, updates). MARKETING for offers, promotions, greetings and anything that sells. Never put offers or sales words in a UTILITY template.
- Variables are {{1}}, {{2}}, … numbered in order of first use, each used once. The body must not start or end with a variable, two variables must not be next to each other, and there must be clearly more words than variables.
- Give one realistic sample per variable in "samples", in order (Indian names, ₹ amounts, dates like "Sat, 8 Nov at 5:00 pm").
- header and footer have no variables and no emoji. Keep the footer short, or empty.
- At most 3 buttons. URL buttons need a full https:// address. Do not add a button unless it helps.
- Write naturally and politely, in the language asked for, ready to send as it is. No placeholders like [name].
${request.businessName ? `\nThe business: ${request.businessName}${request.businessKind ? `, ${request.businessKind}` : ''}.` : request.businessKind ? `\nThe business is ${request.businessKind}.` : ''}
${purpose ? `
This template is the "${purpose.title}" message (${purpose.use}). It is UTILITY.
Its variables may only be these values; put the key of each variable, in order, in "fields":
${fieldList}${purpose.linkPath ? `
Add exactly one URL button (text such as "${request.purpose === 'bill' ? 'View bill' : 'Give feedback'}"); its address is filled in by the app, so put "https://example.com" as the url.` : ''}` : '\n"fields" must be an empty list.'}`
}

const NAME_CHARS = /[^a-z0-9_]+/g

/** A clean template name: lowercase, underscores, at most 50 characters. */
export function cleanTemplateName(value: unknown, fallback = 'new_template'): string {
  const name = String(value || '').toLowerCase().replace(/\s+/g, '_').replace(NAME_CHARS, '').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 50)
  return name || fallback
}

/**
 * The model's answer as an editor draft, with the variables renumbered in order and checked
 * against Meta's rules. For a Front Desk message, the link button opens this app's page and
 * `fields` says what fills each blank.
 */
export function draftFromAi(output: AiTemplateOutput, request: AiDraftRequest, origin: string): { draft: TemplateDraft; fields: FieldKey[]; urlField: FieldKey | null; problems: DraftProblem[] } {
  const purpose = request.purpose ? PURPOSES[request.purpose] : null
  const category: TemplateCategory = purpose ? 'UTILITY' : output.category === 'UTILITY' ? 'UTILITY' : request.category === 'UTILITY' ? 'UTILITY' : 'MARKETING'
  // Renumber variables in order of first use ({{3}} {{1}} → {{1}} {{2}}), carrying samples and fields along
  const order: number[] = []
  for (const match of String(output.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) { const n = Number(match[1]); if (!order.includes(n)) order.push(n) }
  const body = String(output.body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => `{{${order.indexOf(Number(n)) + 1}}}`).trim().slice(0, 1024)
  const samples: Record<string, string> = {}
  const fields: FieldKey[] = []
  order.forEach((n, index) => {
    samples[String(index + 1)] = String(output.samples?.[n - 1] ?? output.samples?.[index] ?? '').trim().slice(0, 200) || `Sample ${index + 1}`
    const field = String(output.fields?.[n - 1] ?? output.fields?.[index] ?? '') as FieldKey
    if (purpose) fields.push(purpose.fields.includes(field) && field !== 'link' ? field : purpose.usualFields[index] || purpose.usualFields[0])
  })
  const base = origin.replace(/\/+$/, '')
  let buttons: ButtonDraft[] = (output.buttons || []).slice(0, 3).map((button) => {
    const text = String(button.text || '').trim().slice(0, 25) || 'Open'
    if (button.type === 'URL') return { type: 'URL' as const, text, url: String(button.url || '').trim() || 'https://' }
    if (button.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER' as const, text, phone_number: String(button.phone || '').trim() }
    return { type: 'QUICK_REPLY' as const, text }
  })
  let urlField: FieldKey | null = null
  if (purpose?.linkPath) {
    const label = buttons.find((b) => b.type === 'URL')?.text || (request.purpose === 'bill' ? 'View bill' : 'Give feedback')
    buttons = [{ type: 'URL', text: label, url: `${base}${purpose.linkPath}{{1}}`, example: `${base}${purpose.linkPath}AbCdEf123456` }, ...buttons.filter((b) => b.type === 'QUICK_REPLY').slice(0, 2)]
    urlField = 'link'
  } else if (purpose) {
    buttons = buttons.filter((b) => b.type !== 'URL')
  }
  const header = String(output.header || '').replace(/\{\{[^}]*\}\}/g, '').trim().slice(0, 60)
  const draft: TemplateDraft = {
    ...emptyDraft(category, 'custom'),
    name: cleanTemplateName(output.name, request.purpose ? `${request.purpose}_message` : 'new_template'),
    language: request.language || 'en',
    headerFormat: header ? 'TEXT' : 'NONE',
    headerText: header,
    body,
    footer: String(output.footer || '').replace(/\{\{[^}]*\}\}/g, '').trim().slice(0, 60),
    buttons,
    samples,
    allowCategoryChange: true,
  }
  return { draft, fields, urlField, problems: validateDraft(draft) }
}
