/**
 * What Front Desk sends on its own, a while after something happens:
 * - feedback: a rating question some time after the bill (the time is set in Setup);
 * - reminders: a message about 2 hours before a booking.
 *
 * runSalonJobs runs whenever the counter is open (every couple of minutes) and from the optional
 * scheduled job (/api/cron/salon). Each message is claimed before it is sent, so two counters
 * open at once never send it twice.
 */

import { feedbackLink } from './feedback'
import { saveFeedback } from './feedback-store'
import { withSalonSchema } from './schema'
import { formatIstDay, formatIstTime, istDate, phoneKey } from './spoken'
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

export function feedbackQuestion(invoice: any): string {
  const name = firstName(invoice.customer_name)
  const staff = staffOf(invoice.items, invoice.staff_name)
  const business = invoice.business?.name || 'us'
  return `Hi${name ? ` ${name}` : ''}, thank you for visiting ${business}! How was your ${servicesOf(invoice.items) || 'visit'}${staff ? ` with ${staff}` : ''}? Tap below to rate your visit and the team. It takes less than a minute.`
}

/** The feedback question with a "Give feedback" button that opens the form. */
export function feedbackMessage(phone: string, invoice: any, origin: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(phone).replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: feedbackQuestion(invoice) },
      action: { name: 'cta_url', parameters: { display_text: 'Give feedback', url: feedbackLink(origin, invoice.public_token) } },
    },
  }
}

/** Where links in messages point: the configured app address, else the one given. */
export function messageOrigin(fallback?: string | null): string {
  return (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || String(fallback || '').replace(/\/+$/, '') || 'https://wamacrm.magnetora.in'
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

export async function runSalonJobs(db: any, organizationId: string, options: { now?: number; origin?: string | null } = {}): Promise<JobsResult> {
  const now = options.now ?? Date.now()
  const origin = messageOrigin(options.origin)
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
        const sent = await sendToCustomer(db, organizationId, invoice.customer_phone, { payload: feedbackMessage(invoice.customer_phone, invoice, origin), logBody: `${feedbackQuestion(invoice)}\n${feedbackLink(origin, invoice.public_token)}` }, {
          purpose: 'feedback',
          values: { first_name: firstName(invoice.customer_name) || 'there', customer_name: invoice.customer_name || 'Customer', business: invoice.business?.name || business, services: servicesOf(invoice.items) || 'visit', staff: staffOf(invoice.items, invoice.staff_name), link: invoice.public_token },
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
        purpose: 'reminder',
        values: {
          first_name: firstName(appointment.customer_name) || 'there', customer_name: appointment.customer_name || 'Customer', business, time: formatIstTime(appointment.starts_at), date: formatIstDay(istDate(appointment.starts_at)),
          services: servicesOf(appointment.services) || 'your visit', staff: staffOf(appointment.services), visit: `${servicesOf(appointment.services) || 'your visit'}${staffOf(appointment.services) ? ` with ${staffOf(appointment.services)}` : ''}`,
        },
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
  await saveFeedback(db, invoice, { rating: parsed.rating, staff_ratings: {}, tags: [], comment: null }, 'chat')
  const { data: settings } = await db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle()
  const text = thanksText(parsed.rating, settings?.review_link)
  await sendToCustomer(db, organizationId, input.customerPhone, { text, logBody: text })
  return { handled: true, rating: parsed.rating }
}
