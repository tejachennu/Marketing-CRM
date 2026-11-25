/**
 * Suggested texts for Front Desk's WhatsApp templates. Nothing here is sent on its own: a business
 * sets up its own template for each automatic message (lib/salon/message-templates.ts). It starts
 * from one of these texts, changes it if it likes, and sends it to Meta for approval under its own
 * WhatsApp account (lib/whatsapp-templates/auto-messages.ts). The wording keeps to the visit's facts
 * so Meta approves it as a Utility message.
 */

import { emptyDraft, type TemplateDraft } from '../whatsapp-templates/template-model'
import type { AutoMessageDef } from '../whatsapp-templates/auto-messages'
import { FIELD_LABELS, FIELD_SAMPLES, MESSAGE_PURPOSES, PURPOSES, type FieldKey, type MessagePurpose } from './message-templates'

export interface SuggestedTemplate {
  purpose: MessagePurpose
  /** A name to start with; the business can change it */
  name: string
  body: string
  /** What fills each blank, in order */
  fields: FieldKey[]
  samples: Record<string, string>
  /** The link button opens this page of the app, with the link code at the end */
  link?: { text: string; path: string; note: string }
}

export const SUGGESTED_TEMPLATES: SuggestedTemplate[] = [
  {
    purpose: 'bill', name: 'bill_ready',
    body: 'Hi {{1}}, thank you for visiting {{2}}. Your bill {{3}} for {{4}} is ready. Tap below to view or download it.',
    fields: ['first_name', 'business', 'bill_number', 'amount'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'GLOW-0001', 4: '₹1,911.60' },
    link: { text: 'View bill', path: '/i/', note: 'Opens the bill' },
  },
  {
    purpose: 'booking', name: 'booking_confirmed',
    body: 'Hi {{1}}, your appointment at {{2}} is confirmed for {{3}}: {{4}}. Reply to this message if you need to change it.',
    fields: ['first_name', 'business', 'date_time', 'visit'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'Sat, 8 Nov at 5:00 pm', 4: 'Consultation with Anitha' },
  },
  {
    purpose: 'reminder', name: 'appointment_reminder',
    body: 'Hi {{1}}, this is a reminder of your appointment at {{2}} today at {{3}} for {{4}}. Reply to this message if you need to change it.',
    fields: ['first_name', 'business', 'time', 'services'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: '5:00 pm', 4: 'Consultation' },
  },
  {
    purpose: 'feedback', name: 'feedback_request',
    body: 'Hi {{1}}, thank you for visiting {{2}}. How was your {{3}} with us? Tap below to rate your visit and the team. It takes less than a minute.',
    fields: ['first_name', 'business', 'services'],
    samples: { 1: 'Priya', 2: 'Glow Studio', 3: 'visit' },
    link: { text: 'Give feedback', path: '/f/', note: 'Opens the feedback form' },
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

/** "Services with staff (\"Facial with Anitha\")" → "Services with staff": the words shown in the editor's blanks. */
const shortLabel = (field: FieldKey) => FIELD_LABELS[field].replace(/ \(.*\)$/, '')

/** Each Front Desk message for the template editor: what it can fill, its suggested text and its button. */
export const FRONT_DESK_MESSAGES: Record<MessagePurpose, AutoMessageDef> = Object.fromEntries(MESSAGE_PURPOSES.map((purpose) => {
  const info = PURPOSES[purpose]
  const suggestion = SUGGESTED_TEMPLATES.find((s) => s.purpose === purpose)!
  const def: AutoMessageDef = {
    purpose,
    title: info.title,
    when: info.use,
    baseName: suggestion.name,
    // The link code goes at the end of the link button, never in the text
    fields: info.fields.filter((f) => f !== 'link').map((key) => ({ key, label: shortLabel(key), sample: FIELD_SAMPLES[key] })),
    suggestion: { body: suggestion.body, fields: [...suggestion.fields] },
    buttons: suggestion.link ? [{ type: 'URL', text: suggestion.link.text, path: suggestion.link.path, note: suggestion.link.note }] : [],
    urlField: suggestion.link ? 'link' : null,
  }
  return [purpose, def]
})) as Record<MessagePurpose, AutoMessageDef>
