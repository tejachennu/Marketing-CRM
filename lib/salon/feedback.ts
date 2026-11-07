/**
 * The feedback form a customer opens from WhatsApp (/f/<invoice token>): a star rating for the
 * visit, one for each person who served them, what stood out, and a comment. One answer per bill;
 * sending the form again updates it. Pure and browser-safe; saving is in feedback-store.ts.
 */

/** What stood out, when the visit was good, and when it was not. */
export const LIKED_TAGS = ['Service quality', 'Friendly staff', 'Cleanliness', 'Value for money', 'On time', 'Ambience']
export const ISSUE_TAGS = ['Long wait', 'Service quality', 'Staff behaviour', 'Cleanliness', 'Price', 'Booking']

export interface InvoiceStaff { key: string; id: string | null; name: string; services: string[] }

/** The people on a bill, with what each one did. Bills from before per-service staff name one person for the visit. */
export function staffOnInvoice(invoice: { items?: any[]; staff_name?: string | null }): InvoiceStaff[] {
  const people = new Map<string, InvoiceStaff>()
  for (const line of invoice.items || []) {
    if (!line?.staff_name) continue
    const key = line.staff_id || `name:${line.staff_name}`
    const person: InvoiceStaff = people.get(key) || { key, id: line.staff_id || null, name: String(line.staff_name), services: [] }
    if (line.name && !person.services.includes(line.name)) person.services.push(line.name)
    people.set(key, person)
  }
  if (!people.size && invoice.staff_name) {
    for (const name of String(invoice.staff_name).split(',').map((n) => n.trim()).filter(Boolean)) {
      people.set(`name:${name}`, { key: `name:${name}`, id: null, name, services: [] })
    }
  }
  return [...people.values()]
}

export interface FeedbackInput { rating: number; staff_ratings: Record<string, number>; tags: string[]; comment: string | null }

const stars = (value: unknown) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** Check what the form sent, against the people on this bill. */
export function parseFeedbackForm(body: any, invoice: { items?: any[]; staff_name?: string | null }): { value: FeedbackInput } | { error: string } {
  const rating = stars(body?.rating)
  if (!rating) return { error: 'Tap the stars to rate your visit.' }
  const people = staffOnInvoice(invoice)
  const staff_ratings: Record<string, number> = {}
  for (const person of people) {
    const given = stars(body?.staff_ratings?.[person.key])
    if (given) staff_ratings[person.key] = given
  }
  const allowed = new Set([...LIKED_TAGS, ...ISSUE_TAGS])
  const tags = [...new Set((Array.isArray(body?.tags) ? body.tags : []).map(String).filter((tag: string) => allowed.has(tag)))].slice(0, 8) as string[]
  const comment = String(body?.comment ?? '').replace(/\s+\n/g, '\n').trim().slice(0, 1000) || null
  return { value: { rating, staff_ratings, tags, comment } }
}

export function feedbackLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/f/${token}`
}
