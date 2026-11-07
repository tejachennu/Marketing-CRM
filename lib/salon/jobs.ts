/**
 * What the salon sends on its own, a while after something happens:
 * - feedback: a rating question some time after the bill (the time is set in Setup);
 * - reminders: a message about 2 hours before a booking.
 *
 * runSalonJobs runs whenever the counter is open (every couple of minutes) and from the optional
 * scheduled job (/api/cron/salon). Each message is claimed before it is sent, so two counters
 * open at once never send it twice.
 */

import { withSalonSchema } from './schema'
import { formatIstTime, phoneKey } from './spoken'
import { FEEDBACK_BUTTONS } from './templates'
import { sendToCustomer } from './whatsapp'

export interface JobsResult { feedbackSent: number; feedbackSkipped: number; remindersSent: number }

const firstName = (name: unknown) => {
  const first = String(name || '').trim().split(/\s+/)[0]
  return first && first !== 'Walk-in' ? first : ''
}
const servicesOf = (lines: any[]) => [...new Set((lines || []).map((line) => line?.name).filter(Boolean))].join(', ')
const staffOf = (lines: any[], fallback?: string | null) => {
  const names = [...new Set((lines || []).map((line) => line?.staff_name).filter(Boolean))]
  return names.length ? names.join(', ') : fallback || ''
}

/** Ratings in the chat: tapping one records it ("sf:<invoice>:<1-5>"). */
export const RATING_ROWS: { rating: number; title: string }[] = [
  { rating: 5, title: '⭐⭐⭐⭐⭐ Excellent' }, { rating: 4, title: '⭐⭐⭐⭐ Good' }, { rating: 3, title: '⭐⭐⭐ Okay' }, { rating: 2, title: '⭐⭐ Not great' }, { rating: 1, title: '⭐ Bad' },
]

export function feedbackQuestion(invoice: any): string {
  const name = firstName(invoice.customer_name)
  const staff = staffOf(invoice.items, invoice.staff_name)
  const business = invoice.business?.name || 'us'
  return `Hi${name ? ` ${name}` : ''}, thank you for visiting ${business}! How was your ${servicesOf(invoice.items) || 'visit'}${staff ? ` with ${staff}` : ''}? Tap to rate.`
}

export function feedbackList(phone: string, invoice: any) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(phone).replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: feedbackQuestion(invoice) },
      action: { button: 'Rate your visit', sections: [{ title: 'Your rating', rows: RATING_ROWS.map((row) => ({ id: `sf:${invoice.id}:${row.rating}`, title: row.title })) }] },
    },
  }
}

export function reminderText(appointment: any, business: string): string {
  const name = firstName(appointment.customer_name)
  const staff = staffOf(appointment.services)
  return `Hi${name ? ` ${name}` : ''}, a reminder of your appointment at ${business} today at ${formatIstTime(appointment.starts_at)} (${servicesOf(appointment.services) || 'your visit'}${staff ? ` with ${staff}` : ''}). Reply here if you need to change it.`
}

/** Mark a row as taken by this run. Returns false when another run got it first. */
async function claim(db: any, table: string, id: string, column: string, value: unknown): Promise<boolean> {
  const { data } = await db.from(table).update({ [column]: value }).eq('id', id).is(column, null).select('id')
  return Array.isArray(data) ? data.length > 0 : Boolean(data)
}

export async function runSalonJobs(db: any, organizationId: string, options: { now?: number } = {}): Promise<JobsResult> {
  const now = options.now ?? Date.now()
  const result: JobsResult = { feedbackSent: 0, feedbackSkipped: 0, remindersSent: 0 }
  const { data: settingsRow } = await withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle())
  const settings = settingsRow || {}
  const business = settings.business_name || 'us'

  if (settings.feedback_enabled !== false) {
    const { data: due } = await withSalonSchema(() => db.from('salon_invoices').select('*').eq('organization_id', organizationId)
      .is('feedback_status', null).lte('feedback_due_at', new Date(now).toISOString()).gte('issued_at', new Date(now - 3 * 24 * 3600_000).toISOString()).limit(20))
    for (const invoice of due || []) {
      if (!(await claim(db, 'salon_invoices', invoice.id, 'feedback_status', 'sending'))) continue
      let status = 'skipped'
      if (invoice.status !== 'void' && invoice.customer_phone) {
        const sent = await sendToCustomer(db, organizationId, invoice.customer_phone, { payload: feedbackList(invoice.customer_phone, invoice), logBody: feedbackQuestion(invoice) }, {
          key: 'feedback',
          params: [firstName(invoice.customer_name) || 'there', invoice.business?.name || business, servicesOf(invoice.items) || 'visit'],
          extra: { quickReplyPayloads: FEEDBACK_BUTTONS.map((button) => `sf:${invoice.id}:${button.rating}`) },
        })
        status = sent.sent ? 'sent' : sent.windowClosed ? 'skipped' : 'failed'
      }
      await db.from('salon_invoices').update({ feedback_status: status }).eq('id', invoice.id).eq('organization_id', organizationId)
      if (status === 'sent') result.feedbackSent++
      else result.feedbackSkipped++
    }
  }

  if (settings.reminders_enabled !== false) {
    const { data: soon } = await withSalonSchema(() => db.from('salon_appointments').select('*').eq('organization_id', organizationId).eq('status', 'booked')
      .is('reminder_sent_at', null).gte('starts_at', new Date(now + 60 * 60_000).toISOString()).lte('starts_at', new Date(now + 150 * 60_000).toISOString()).limit(20))
    for (const appointment of soon || []) {
      if (!appointment.customer_phone) continue
      if (!(await claim(db, 'salon_appointments', appointment.id, 'reminder_sent_at', new Date(now).toISOString()))) continue
      const text = reminderText(appointment, business)
      const sent = await sendToCustomer(db, organizationId, appointment.customer_phone, { text, logBody: text }, {
        key: 'reminder', params: [firstName(appointment.customer_name) || 'there', business, formatIstTime(appointment.starts_at), servicesOf(appointment.services) || 'your visit'],
      })
      if (sent.sent) result.remindersSent++
    }
  }
  return result
}

// ── A rating tapped by the customer ──────────────────────────────────────────

export function parseFeedbackButton(id: unknown): { invoiceId: string; rating: number } | null {
  const match = /^sf:([0-9a-f-]{36}):([1-5])$/i.exec(String(id || ''))
  return match ? { invoiceId: match[1].toLowerCase(), rating: Number(match[2]) } : null
}

export function thanksText(rating: number, reviewLink?: string | null): string {
  if (rating >= 4) return `Thank you so much! 😊 We are glad you enjoyed it.${reviewLink ? `\nIf you have a minute, a Google review helps us a lot: ${reviewLink}` : ''}`
  if (rating === 3) return 'Thank you for the feedback! We will keep getting better. 🙏'
  return 'We are sorry your visit was not good. Our manager will call you to make it right. 🙏'
}

/** Record a rating and thank the customer. Not handled when the button is not a salon rating. */
export async function handleFeedbackReply(input: { supabase: any; organization: any; contact: { id: string }; customerPhone: string; buttonId: string }): Promise<{ handled: boolean; rating?: number }> {
  const parsed = parseFeedbackButton(input.buttonId)
  if (!parsed) return { handled: false }
  const db = input.supabase
  const organizationId = input.organization.id
  const { data: invoice } = await withSalonSchema(() => db.from('salon_invoices').select('*').eq('id', parsed.invoiceId).eq('organization_id', organizationId).maybeSingle())
  if (!invoice || phoneKey(invoice.customer_phone) !== phoneKey(input.customerPhone)) return { handled: false }
  const staffIds = [...new Set((invoice.items || []).map((line: any) => line?.staff_id).filter(Boolean))]
  const staffNames = staffOf(invoice.items, invoice.staff_name).split(', ').filter(Boolean)
  const row = { organization_id: organizationId, invoice_id: invoice.id, contact_id: input.contact.id || invoice.contact_id || null, customer_name: invoice.customer_name, customer_phone: invoice.customer_phone, rating: parsed.rating, staff_ids: staffIds, staff_names: staffNames }
  const { data: existing } = await withSalonSchema(() => db.from('salon_feedback').select('id').eq('invoice_id', invoice.id).eq('organization_id', organizationId).maybeSingle())
  const saved = existing
    ? await db.from('salon_feedback').update({ rating: parsed.rating }).eq('id', existing.id).eq('organization_id', organizationId)
    : await withSalonSchema(() => db.from('salon_feedback').insert(row).select('id').single())
  if (saved?.error) throw new Error(saved.error.message)
  const { data: settings } = await db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle()
  const text = thanksText(parsed.rating, settings?.review_link)
  await sendToCustomer(db, organizationId, input.customerPhone, { text, logBody: text })
  return { handled: true, rating: parsed.rating }
}
