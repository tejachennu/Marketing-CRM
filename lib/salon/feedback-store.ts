/** Saving feedback (server only). */

import { staffOnInvoice, type FeedbackInput } from './feedback'
import { withSalonSchema } from './schema'

/** Save the answer for this bill (a second answer replaces the first). */
export async function saveFeedback(db: any, invoice: any, input: FeedbackInput, source: 'form' | 'chat') {
  const people = staffOnInvoice(invoice)
  const row = {
    organization_id: invoice.organization_id, invoice_id: invoice.id, contact_id: invoice.contact_id || null,
    customer_name: invoice.customer_name, customer_phone: invoice.customer_phone,
    rating: input.rating, comment: input.comment, tags: input.tags, staff_ratings: input.staff_ratings, source,
    staff_ids: people.map((p) => p.id).filter(Boolean), staff_names: people.map((p) => p.name),
  }
  const { data: existing } = await withSalonSchema(() => db.from('salon_feedback').select('id').eq('invoice_id', invoice.id).eq('organization_id', invoice.organization_id).maybeSingle())
  const saved = existing
    ? await withSalonSchema(() => db.from('salon_feedback').update({ ...row, followed_up_at: null }).eq('id', existing.id).eq('organization_id', invoice.organization_id).select('*').single())
    : await withSalonSchema(() => db.from('salon_feedback').insert(row).select('*').single())
  if (saved.error) throw new Error(saved.error.message)
  return saved.data
}
