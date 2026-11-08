/**
 * Front Desk's built-in WhatsApp message templates. WhatsApp only allows free-form messages within
 * 24 hours of the customer's last message; after that, a business may only send templates Meta
 * approved. This pack covers what Front Desk sends on its own (bill, booking, reminder, feedback)
 * and a few marketing messages for Campaigns. Setup submits them in one tap; they are used
 * automatically when the 24-hour window has closed, unless the business picked its own template
 * for that message (lib/salon/message-templates.ts).
 */

import { emptyDraft, type TemplateDraft } from '../whatsapp-templates/template-model'
import { sendWhatsAppMessage } from '../commerce/commerce-webhook-handler'

export type SalonTemplateKey = 'bill' | 'booking' | 'reminder' | 'feedback' | 'offer' | 'comeback' | 'festival'

export interface SalonTemplate {
  key: SalonTemplateKey
  name: string
  /** Names it had before Front Desk was renamed from Spa & Salon: still found on Meta and sent */
  legacyNames: string[]
  category: 'UTILITY' | 'MARKETING'
  title: string
  /** When it is used */
  use: string
  body: string
  samples: Record<string, string>
  buttons: ({ type: 'QUICK_REPLY'; text: string } | { type: 'URL'; text: string; path: string })[]
}

/** Rating buttons of the first feedback template (taps on older messages are still recorded). */
export const FEEDBACK_BUTTONS: { text: string; rating: number }[] = [{ text: 'Loved it 😍', rating: 5 }, { text: 'It was okay', rating: 3 }, { text: 'Not happy', rating: 1 }]

export const SALON_TEMPLATES: SalonTemplate[] = [
  {
    key: 'bill', name: 'wama_bill', legacyNames: ['wama_salon_bill'], category: 'UTILITY', title: 'Bill',
    use: 'Sends the bill when the customer has not messaged in the last 24 hours',
    body: 'Hi {{1}}, thank you for visiting {{2}}! Your bill {{3}} for {{4}} is ready. Tap below to view or download it.',
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'GLOW-0001', 4: '₹1,911.60' },
    buttons: [{ type: 'URL', text: 'View bill', path: '/i/' }],
  },
  {
    key: 'booking', name: 'wama_booking_confirmed', legacyNames: ['wama_salon_booking'], category: 'UTILITY', title: 'Booking confirmed',
    use: 'Confirms a booking made at the counter or approved from the chat',
    body: 'Hi {{1}}, your appointment at {{2}} is confirmed for {{3}}: {{4}}. See you soon!',
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'Sat, 8 Nov at 5:00 pm', 4: 'Consultation with Anitha' },
    buttons: [],
  },
  {
    key: 'reminder', name: 'wama_appointment_reminder', legacyNames: ['wama_salon_reminder'], category: 'UTILITY', title: 'Appointment reminder',
    use: 'Reminds the customer about 2 hours before their appointment',
    body: 'Hi {{1}}, a reminder of your appointment at {{2}} today at {{3}} ({{4}}). Reply here if you need to change it.',
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: '5:00 pm', 4: 'Consultation' },
    buttons: [],
  },
  {
    key: 'feedback', name: 'wama_feedback_request', legacyNames: ['wama_salon_feedback_form'], category: 'UTILITY', title: 'Feedback',
    use: 'Asks how the visit was, a while after the bill, with a short feedback form',
    body: 'Hi {{1}}, thank you for visiting {{2}}. How was your {{3}} with us? Tap below to rate your visit and the team. It takes less than a minute.',
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'visit' },
    buttons: [{ type: 'URL', text: 'Give feedback', path: '/f/' }],
  },
  {
    key: 'offer', name: 'wama_special_offer', legacyNames: ['wama_salon_offer'], category: 'MARKETING', title: 'Special offer',
    use: 'Campaigns: announce an offer to your customers',
    body: 'Hi {{1}}! {{2}} has a special offer for you: {{3}}. Reply to book your slot.',
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: '20% off all services this week' },
    buttons: [{ type: 'QUICK_REPLY', text: 'Book now' }],
  },
  {
    key: 'comeback', name: 'wama_we_miss_you', legacyNames: ['wama_salon_we_miss_you'], category: 'MARKETING', title: 'We miss you',
    use: 'Campaigns: bring back customers who have not visited for a while',
    body: 'Hi {{1}}, we miss you at {{2}}! Come back this week and enjoy {{3}}. Reply to book.',
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'a free add-on with your next visit' },
    buttons: [{ type: 'QUICK_REPLY', text: 'Book now' }],
  },
  {
    key: 'festival', name: 'wama_festival_greeting', legacyNames: ['wama_salon_festival'], category: 'MARKETING', title: 'Festival greeting',
    use: 'Campaigns: festival wishes with an offer',
    body: 'Happy {{1}} from all of us at {{2}}! 🎉 Get ready for the celebrations with {{3}}. Reply to book your slot.',
    samples: { 1: 'Diwali', 2: 'Glow Studio', 3: 'our festive offers' },
    buttons: [{ type: 'QUICK_REPLY', text: 'Book now' }],
  },
]

export const templateFor = (key: SalonTemplateKey) => SALON_TEMPLATES.find((t) => t.key === key)!

export interface PackEntry { key: SalonTemplateKey; name: string; category: string; title: string; use: string; body: string; samples: Record<string, string>; buttons: string[]; status: string; rejectedReason: string | null }

/** Where each built-in template stands, from Meta's list (English versions, by its name or an older one). `onMeta` null: Meta could not be asked. */
export function packStatus(onMeta: { name: string; language?: string; status?: string; rejected_reason?: string | null }[] | null): PackEntry[] {
  return SALON_TEMPLATES.map((template) => {
    const english = (t: { language?: string }) => !t.language || t.language === 'en' || t.language.startsWith('en_')
    const found = onMeta?.find((t) => t.name === template.name && english(t)) || onMeta?.find((t) => template.legacyNames.includes(t.name) && english(t))
    return {
      key: template.key, name: found?.name || template.name, category: template.category, title: template.title, use: template.use, body: template.body, samples: template.samples,
      buttons: template.buttons.map((b) => b.text),
      status: onMeta === null ? 'UNKNOWN' : found ? String(found.status || 'PENDING').toUpperCase() : 'NOT_SUBMITTED',
      rejectedReason: found?.rejected_reason || null,
    }
  })
}

/** The template as a draft for Meta (the bill button links to this app's invoice page). */
export function templateDraft(template: SalonTemplate, origin: string): TemplateDraft {
  const base = origin.replace(/\/+$/, '')
  return {
    ...emptyDraft(template.category, 'custom'),
    name: template.name,
    language: 'en',
    body: template.body,
    samples: { ...template.samples },
    buttons: template.buttons.map((button) => (button.type === 'URL'
      ? { type: 'URL' as const, text: button.text, url: `${base}${button.path}{{1}}`, example: `${base}${button.path}AbCdEf123456` }
      : { type: 'QUICK_REPLY' as const, text: button.text })),
    allowCategoryChange: true,
  }
}

/** Template values may not hold new lines, tabs or long runs of spaces. */
export function cleanParam(value: unknown): string {
  return String(value ?? '').replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000) || '-'
}

export function templatePayload(template: SalonTemplate, phone: string, params: string[], extra: { urlSuffix?: string; quickReplyPayloads?: string[] } = {}, name = template.name) {
  const components: any[] = [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: cleanParam(text) })) }]
  template.buttons.forEach((button, index) => {
    if (button.type === 'URL' && extra.urlSuffix) components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: extra.urlSuffix }] })
    if (button.type === 'QUICK_REPLY' && extra.quickReplyPayloads?.[index]) components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload: extra.quickReplyPayloads[index] }] })
  })
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(phone).replace(/[^\d]/g, ''),
    type: 'template',
    template: { name, language: { code: 'en' }, components },
  }
}

/**
 * Send one of the built-in templates: by its name, or by its older name when Meta does not know the
 * new one (it was submitted before the rename). Not sent when it is not approved yet.
 */
export async function sendSalonTemplate(organization: any, key: SalonTemplateKey, phone: string, params: string[], extra: { urlSuffix?: string; quickReplyPayloads?: string[] } = {}, send: typeof sendWhatsAppMessage = sendWhatsAppMessage): Promise<{ ok: boolean; messageId?: string | null; error?: string }> {
  const template = templateFor(key)
  let result: { ok: boolean; messageId?: string | null; error?: string } = { ok: false, error: 'Not sent' }
  for (const name of [template.name, ...template.legacyNames]) {
    result = await send(organization, templatePayload(template, phone, params, extra, name))
    // 132001: no template by that name (in that language)
    if (result.ok || !/132001|does not exist/i.test(result.error || '')) return result
  }
  return result
}
