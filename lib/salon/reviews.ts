/**
 * Customer reviews for the Reviews tab: who was served by whom, and a summary of a date range
 * (average, how many of each star, happy share, people to call, each person's stars). Pure, so the
 * tab and the tests agree.
 */

import { staffOnInvoice } from './feedback'
import { staffIndex, staffRatingsOn, type PerformanceFeedback, type PerformanceStaff } from './performance'

export interface ReviewRow extends PerformanceFeedback {
  id: string
  invoice_id?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  comment?: string | null
  tags?: string[] | null
  source?: string | null
  followed_up_at?: string | null
}

export interface ReviewPerson { key: string; id: string | null; name: string; rating: number | null }

export interface ReviewSummary {
  count: number
  average: number | null
  distribution: { stars: number; count: number }[]
  happyPercent: number | null
  unhappy: number
  toCall: number
  comments: number
  tags: { tag: string; count: number }[]
  staff: { id: string; name: string; ratings: number; average: number }[]
}

const stars = (value: unknown) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}
const oneDecimal = (value: number) => Math.round(value * 10) / 10

/** A review needs a call: 1 or 2 stars, and nobody has called yet. */
export const needsCall = (review: { rating: number; followed_up_at?: string | null }) => review.rating <= 2 && !review.followed_up_at

/** The people on the bill, each with their own stars when the customer gave them (else null). */
export function reviewPeople(review: Pick<ReviewRow, 'staff_names' | 'staff_ratings'>, invoice?: { items?: any[]; staff_name?: string | null } | null): ReviewPerson[] {
  const own = review.staff_ratings || {}
  const people = invoice ? staffOnInvoice(invoice) : (review.staff_names || []).map((name) => ({ key: `name:${name}`, id: null, name }))
  return people.map((person) => ({ key: person.key, id: person.id, name: person.name, rating: stars(own[person.key]) }))
}

export function reviewSummary(rows: ReviewRow[], staff: PerformanceStaff[] = []): ReviewSummary {
  const ratings = rows.map((row) => stars(row.rating)).filter((n): n is number => n !== null)
  const tagCounts = new Map<string, number>()
  for (const row of rows) for (const tag of row.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)

  const { byId, byName } = staffIndex(staff)
  const perStaff = new Map<string, { id: string; name: string; ratings: number; sum: number }>()
  for (const row of rows) {
    for (const { member, rating } of staffRatingsOn(row, byId, byName)) {
      if (!rating) continue
      const entry = perStaff.get(member.id) || { id: member.id, name: member.name, ratings: 0, sum: 0 }
      entry.ratings += 1
      entry.sum += rating
      perStaff.set(member.id, entry)
    }
  }

  return {
    count: ratings.length,
    average: ratings.length ? oneDecimal(ratings.reduce((sum, n) => sum + n, 0) / ratings.length) : null,
    distribution: [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: ratings.filter((r) => r === n).length })),
    happyPercent: ratings.length ? Math.round((ratings.filter((r) => r >= 4).length / ratings.length) * 100) : null,
    unhappy: ratings.filter((r) => r <= 2).length,
    toCall: rows.filter(needsCall).length,
    comments: rows.filter((row) => String(row.comment || '').trim()).length,
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([tag, count]) => ({ tag, count })),
    staff: [...perStaff.values()].map(({ sum, ...entry }) => ({ ...entry, average: oneDecimal(sum / entry.ratings) }))
      .sort((a, b) => b.average - a.average || b.ratings - a.ratings || a.name.localeCompare(b.name)),
  }
}
