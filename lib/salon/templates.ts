/**
 * Suggested texts for Front Desk's WhatsApp templates. Nothing here is sent on its own: a business
 * sets up its own template for each automatic message (lib/salon/message-templates.ts), and can
 * start from one of these texts, change it, and submit it to Meta under its own name.
 */

import { emptyDraft, type TemplateDraft } from '../whatsapp-templates/template-model'
import type { FieldKey, MessagePurpose } from './message-templates'

export interface SuggestedTemplate {
  purpose: MessagePurpose
  /** A name to start with; the business can change it */
  name: string
  body: string
  /** What fills each blank, in order */
  fields: FieldKey[]
  samples: Record<string, string>
  /** The link button opens this page of the app, with the link code at the end */
  link?: { text: string; path: string }
}

export const SUGGESTED_TEMPLATES: SuggestedTemplate[] = [
  {
    purpose: 'bill', name: 'bill_ready',
    body: 'Hi {{1}}, thank you for visiting {{2}}! Your bill {{3}} for {{4}} is ready. Tap below to view or download it.',
    fields: ['first_name', 'business', 'bill_number', 'amount'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'GLOW-0001', 4: '₹1,911.60' },
    link: { text: 'View bill', path: '/i/' },
  },
  {
    purpose: 'booking', name: 'booking_confirmed',
    body: 'Hi {{1}}, your appointment at {{2}} is confirmed for {{3}}: {{4}}. See you soon!',
    fields: ['first_name', 'business', 'date_time', 'visit'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'Sat, 8 Nov at 5:00 pm', 4: 'Consultation with Anitha' },
  },
  {
    purpose: 'reminder', name: 'appointment_reminder',
    body: 'Hi {{1}}, a reminder of your appointment at {{2}} today at {{3}} ({{4}}). Reply here if you need to change it.',
    fields: ['first_name', 'business', 'time', 'services'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: '5:00 pm', 4: 'Consultation' },
  },
  {
    purpose: 'feedback', name: 'feedback_request',
    body: 'Hi {{1}}, thank you for visiting {{2}}. How was your {{3}} with us? Tap below to rate your visit and the team. It takes less than a minute.',
    fields: ['first_name', 'business', 'services'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'visit' },
    link: { text: 'Give feedback', path: '/f/' },
  },
]

/** A suggested text as an editor draft (the link button opens this app's page), with what fills each blank. */
export function suggestionFor(purpose: MessagePurpose, origin: string): { draft: TemplateDraft; fields: FieldKey[]; urlField: FieldKey | null } {
  const suggestion = SUGGESTED_TEMPLATES.find((s) => s.purpose === purpose)!
  const base = origin.replace(/\/+$/, '')
  return {
    draft: {
      ...emptyDraft('UTILITY', 'custom'),
      name: suggestion.name,
      language: 'en',
      body: suggestion.body,
      samples: { ...suggestion.samples },
      buttons: suggestion.link ? [{ type: 'URL', text: suggestion.link.text, url: `${base}${suggestion.link.path}{{1}}`, example: `${base}${suggestion.link.path}AbCdEf123456` }] : [],
      allowCategoryChange: true,
    },
    fields: [...suggestion.fields],
    urlField: suggestion.link ? 'link' : null,
  }
}
