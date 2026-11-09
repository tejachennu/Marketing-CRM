'use client'

/** Reviews: every customer rating in the chosen dates, with a summary, filters and unhappy customers to call. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, Loader2, MessageSquareText, Phone, Search, Smile, Star, ThumbsDown, Users } from 'lucide-react'
import { rangeQuery, type DateRange } from '@/lib/salon/ranges'
import { needsCall, type ReviewPerson, type ReviewSummary } from '@/lib/salon/reviews'
import { formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'
import { DateRangeFilter } from './date-range'
import { api, Avatar, card, StatTile } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void

interface Review {
  id: string
  rating: number
  comment: string | null
  tags: string[]
  source: string
  created_at: string
  followed_up_at: string | null
  customer_name: string | null
  customer_phone: string | null
  people: ReviewPerson[]
  invoice: { number: string; public_token: string; total: number; status: string } | null
}

type Show = 'all' | 'call' | 'comments' | 1 | 2 | 3 | 4 | 5
const LABELS = ['', 'Bad', 'Not great', 'Okay', 'Good', 'Excellent']
const PAGE = 30

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= Math.round(rating) ? 'fill-[#0E1B3D] text-[#0E1B3D] dark:fill-slate-100 dark:text-slate-100' : 'text-[#d5ddeb] dark:text-slate-700'} />)}
    </span>
  )
}

const chip = (on: boolean) => `inline-flex items-center gap-1 h-9 px-3 rounded-xl border text-[13.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300 hover:border-[#9db5ef]'}`

export function SalonReviews({ orgId, flash, range, onRangeChange }: { orgId: string; flash: Flash; range: DateRange; onRangeChange: (range: DateRange) => void }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [summary, setSummary] = useState<ReviewSummary | null>(null)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [show, setShow] = useState<Show>('all')
  const [person, setPerson] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [busyId, setBusyId] = useState<string | null>(null)
  const latest = useRef(0)
  const listRef = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    // Only the newest request counts when the dates change quickly
    const request = ++latest.current
    setLoading(true)
    try {
      const data = await api(`/api/salon/reviews?organizationId=${orgId}&${rangeQuery(range)}`)
      if (request !== latest.current) return
      setReviews(data.reviews || [])
      setSummary(data.summary || null)
      setStaff(data.staff || [])
      setTruncated(Boolean(data.truncated))
      setLimit(PAGE)
      setLoaded(true)
    } catch (err: any) {
      if (request === latest.current) flash('error', err.message)
    } finally {
      if (request === latest.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, range])

  useEffect(() => { load() }, [load])
  useEffect(() => { setLimit(PAGE) }, [show, person, query])

  async function called(review: Review) {
    setBusyId(review.id)
    try {
      const { feedback } = await api('/api/salon/feedback', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, id: review.id }) })
      setReviews((current) => current.map((r) => (r.id === review.id ? { ...r, followed_up_at: feedback?.followed_up_at || new Date().toISOString() } : r)))
      setSummary((current) => (current ? { ...current, toCall: Math.max(0, current.toCall - 1) } : current))
      flash('success', `Marked ${review.customer_name || 'the customer'} as called.`)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  /** Jump to the list with a filter on (from the summary cards). */
  function focus(next: { show?: Show; person?: string }) {
    if (next.show !== undefined) setShow(next.show)
    if (next.person !== undefined) setPerson(next.person)
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    const digits = words.replace(/\D/g, '')
    const member = staff.find((s) => s.id === person)
    return reviews.filter((review) => {
      if (show === 'call' && !needsCall(review)) return false
      if (show === 'comments' && !review.comment) return false
      if (typeof show === 'number' && review.rating !== show) return false
      if (member && !review.people.some((p) => p.id === member.id || p.name.trim().toLowerCase() === member.name.trim().toLowerCase())) return false
      if (!words) return true
      return String(review.customer_name || '').toLowerCase().includes(words)
        || String(review.comment || '').toLowerCase().includes(words)
        || review.tags.some((tag) => tag.toLowerCase().includes(words))
        || String(review.invoice?.number || '').toLowerCase().includes(words)
        || (digits.length >= 3 && String(review.customer_phone || '').replace(/\D/g, '').includes(digits))
    })
  }, [reviews, show, person, query, staff])

  const today = istDate()
  const most = Math.max(1, ...(summary?.distribution || []).map((d) => d.count))
  const filtered = show !== 'all' || person || query.trim()

  return (
    <div className="space-y-5">
      <DateRangeFilter value={range} onChange={onRangeChange} loading={loading} />

      <div className="grid grid-cols-2 @4xl:grid-cols-4 gap-2.5 @xl:gap-3">
        <StatTile label="Average rating" value={summary ? (summary.average ? `${summary.average} ★` : '–') : '…'} icon={<Star size={20} />} tone="amber" hint={summary ? `${summary.count} review${summary.count === 1 ? '' : 's'}` : undefined} />
        <StatTile label="Happy customers" value={summary ? (summary.happyPercent === null ? '–' : `${summary.happyPercent}%`) : '…'} icon={<Smile size={20} />} tone="green" hint="Gave 4 or 5 stars" />
        <StatTile label="Unhappy" value={summary ? summary.unhappy : '…'} icon={<ThumbsDown size={20} />} tone="pink" hint="Gave 1 or 2 stars" />
        <StatTile label="To call" value={summary ? summary.toCall : '…'} icon={<Phone size={20} />} tone="blue" hint={summary ? (summary.toCall ? 'Unhappy, not called yet' : 'Nobody waiting') : undefined} />
      </div>

      {summary && summary.count > 0 && (
        <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3">
          <section className={`${card} p-4 @xl:p-5`}>
            <div className="flex items-center gap-4">
              <div className="text-center shrink-0">
                <p className="text-[40px] font-extrabold leading-none tracking-tight text-[#0E1B3D] dark:text-white">{summary.average}</p>
                <div className="mt-1.5"><Stars rating={summary.average || 0} size={15} /></div>
                <p className="mt-1 text-[12.5px] text-[#6B7894]">{summary.count} review{summary.count === 1 ? '' : 's'}</p>
              </div>
              <ul className="flex-1 min-w-0 space-y-1">
                {summary.distribution.map((row) => (
                  <li key={row.stars}>
                    <button type="button" onClick={() => focus({ show: show === row.stars ? 'all' : (row.stars as Show) })} aria-pressed={show === row.stars} aria-label={`${row.stars} stars: ${row.count}`}
                      className={`w-full flex items-center gap-2 h-7 px-1.5 rounded-lg cursor-pointer hover:bg-[#f4f6fa] dark:hover:bg-slate-800 ${show === row.stars ? 'bg-[#eef3fe] dark:bg-blue-950/40' : ''}`}>
                      <span className="w-7 shrink-0 text-[13px] font-bold text-[#4a5672] dark:text-slate-300 inline-flex items-center gap-0.5">{row.stars}<Star size={11} className="fill-[#0E1B3D] text-[#0E1B3D] dark:fill-slate-100 dark:text-slate-100" /></span>
                      <span className="flex-1 h-2.5 rounded-full bg-[#eef1f6] dark:bg-slate-800 overflow-hidden"><span className={`block h-full rounded-full bg-[#1D5BEA]`} style={{ width: `${Math.round((row.count / most) * 100)}%` }} /></span>
                      <span className="w-8 shrink-0 text-right text-[13px] font-semibold text-[#6B7894]">{row.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {summary.tags.length > 0 && (
              <div className="mt-4 pt-3.5 border-t border-[#eef1f6] dark:border-slate-800">
                <p className="text-[13px] font-bold text-[#6B7894]">Mentioned most</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {summary.tags.map((t) => (
                    <button key={t.tag} type="button" onClick={() => { setQuery(t.tag); focus({}) }} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[#f4f6fa] dark:bg-slate-800 text-[13px] font-semibold text-[#0E1B3D] dark:text-slate-200 hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer">
                      {t.tag} <span className="text-[#8a94a8]">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className={card}>
            <div className="px-4 @xl:px-5 py-3.5 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2"><Users size={18} className="text-[#1D5BEA]" /><h2 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Team ratings</h2></div>
            {summary.staff.length === 0 ? <p className="px-5 py-8 text-center text-[14px] text-[#6B7894]">No team member was named on these bills.</p> : (
              <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800 max-h-[264px] overflow-y-auto">
                {summary.staff.map((member) => (
                  <li key={member.id}>
                    <button type="button" onClick={() => focus({ person: person === member.id ? '' : member.id })} aria-pressed={person === member.id}
                      className={`w-full px-4 @xl:px-5 py-2.5 flex items-center gap-3 text-left cursor-pointer hover:bg-[#f8fafc] dark:hover:bg-slate-900/50 ${person === member.id ? 'bg-[#eef3fe] dark:bg-blue-950/40' : ''}`}>
                      <Avatar name={member.name} size={34} />
                      <span className="flex-1 min-w-0 text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{member.name}</span>
                      <span className="hidden min-[360px]:inline-flex"><Stars rating={member.average} size={13} /></span>
                      <span className="w-[76px] shrink-0 text-right text-[13.5px] font-bold text-[#0E1B3D] dark:text-white">{member.average} <span className="font-normal text-[#8a94a8]">({member.ratings})</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <section ref={listRef} className={`${card} scroll-mt-4`}>
        <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 space-y-3">
          <div className="flex flex-col @xl:flex-row @xl:items-center gap-3">
            <h2 className="flex items-center gap-2 text-[18px] font-extrabold text-[#0E1B3D] dark:text-white"><MessageSquareText size={19} className="text-[#1D5BEA]" /> Customer reviews {loaded && <span className="text-[14px] font-semibold text-[#8a94a8]">{filtered ? `${shown.length} of ${reviews.length}` : reviews.length}</span>}</h2>
            <div className="@xl:ml-auto flex flex-col @xl:flex-row gap-2">
              {staff.length > 0 && (
                <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Served by"
                  className="h-11 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base @xl:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15 cursor-pointer">
                  <option value="">Whole team</option>
                  {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              )}
              <label className="relative block @xl:w-60">
                <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone or words" aria-label="Search reviews"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base @xl:text-[14.5px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15" />
              </label>
            </div>
          </div>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')} className={chip(show === 'all')}>All</button>
            {[5, 4, 3, 2, 1].map((n) => (
              <button key={n} type="button" aria-pressed={show === n} aria-label={`${n} stars`} onClick={() => setShow(show === n ? 'all' : (n as Show))} className={chip(show === n)}>{n} <Star size={12} className="fill-[#0E1B3D] text-[#0E1B3D] dark:fill-slate-100 dark:text-slate-100" /></button>
            ))}
            <button type="button" aria-pressed={show === 'call'} onClick={() => setShow(show === 'call' ? 'all' : 'call')} className={chip(show === 'call')}><Phone size={13} /> To call{summary?.toCall ? <span className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-[#b91c1c] text-white text-[11.5px] font-bold">{summary.toCall}</span> : null}</button>
            <button type="button" aria-pressed={show === 'comments'} onClick={() => setShow(show === 'comments' ? 'all' : 'comments')} className={chip(show === 'comments')}>With comments</button>
          </div>
        </div>

        {!loaded ? <div className="flex justify-center py-14"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
          : reviews.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Star size={30} className="mx-auto text-[#a3adc2]" />
              <p className="mt-2 text-[15.5px] font-semibold text-[#4a5672] dark:text-slate-300">No reviews in these dates</p>
              <p className="text-[14px] text-[#8a94a8] max-w-sm mx-auto">Customers rate their visit from the WhatsApp message sent after their bill. Their reviews show here.</p>
            </div>
          )
          : shown.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[15px] text-[#6B7894]">No reviews match.</p>
              <button type="button" onClick={() => { setShow('all'); setPerson(''); setQuery('') }} className="mt-2 h-10 px-4 rounded-xl text-[14.5px] font-semibold text-[#1D5BEA] hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer">Show all reviews</button>
            </div>
          )
          : (
            <ul className={`divide-y divide-[#eef1f6] dark:divide-slate-800 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {shown.slice(0, limit).map((review) => {
                const call = needsCall(review)
                const good = review.rating >= 4
                return (
                  <li key={review.id} className={`px-4 @xl:px-5 py-4 ${call ? 'bg-[#f8fafc] dark:bg-red-950/10' : ''}`}>
                    <div className="flex items-start gap-3">
                      <Avatar name={review.customer_name || 'Customer'} size={40} className="hidden @xl:inline-flex" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">{review.customer_name || 'Customer'}</p>
                          {review.customer_phone && <a href={`tel:${review.customer_phone}`} className="text-[13.5px] font-semibold text-[#1D5BEA] hover:underline">{review.customer_phone}</a>}
                          <span className="@xl:ml-auto text-[12.5px] text-[#8a94a8]">{formatIstDay(istDate(review.created_at), today)}, {formatIstTime(review.created_at)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <Stars rating={review.rating} size={16} />
                          <span className={`text-[13.5px] font-bold text-[#4a5672] dark:text-slate-300`}>{LABELS[review.rating]}</span>
                          <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[11.5px] font-bold text-[#6B7894] dark:text-slate-400">{review.source === 'form' ? 'Form' : 'Chat'}</span>
                          {review.invoice && <a href={`/i/${review.invoice.public_token}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#4a5672] dark:text-slate-300 hover:text-[#1D5BEA]">{review.invoice.number} <ExternalLink size={12} /></a>}
                        </div>
                        {review.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {review.tags.map((tag) => <span key={tag} className="inline-flex items-center h-6 px-2 rounded-md text-[12.5px] font-semibold bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300">{tag}</span>)}
                          </div>
                        )}
                        {review.comment && <p className="mt-2 text-[14.5px] leading-relaxed text-[#0E1B3D] dark:text-slate-200 whitespace-pre-line break-words">“{review.comment}”</p>}
                        {review.people.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#6B7894]">
                            <span>Served by</span>
                            {review.people.map((p) => (
                              <span key={p.key} className="inline-flex items-center gap-1.5 font-semibold text-[#0E1B3D] dark:text-slate-200">{p.name}{p.rating && <Stars rating={p.rating} size={11} />}</span>
                            ))}
                          </div>
                        )}
                        {review.rating <= 2 && (
                          <div className="mt-2.5">
                            {call
                              ? <button type="button" disabled={busyId === review.id} onClick={() => called(review)} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[14px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">{busyId === review.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Mark as called</button>
                              : <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0E1B3D] dark:text-slate-100"><Check size={15} /> Called{review.followed_up_at ? ` · ${formatIstDay(istDate(review.followed_up_at), today)}` : ''}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        {loaded && shown.length > limit && (
          <div className="px-5 py-3.5 border-t border-[#eef1f6] dark:border-slate-800 text-center">
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="h-10 px-5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">Show more ({shown.length - limit} left)</button>
          </div>
        )}
        {loaded && truncated && <p className="px-5 py-3 border-t border-[#eef1f6] dark:border-slate-800 text-center text-[13px] text-[#6B7894]">Showing the latest {reviews.length.toLocaleString('en-IN')} reviews. Choose fewer days to see older ones.</p>}
      </section>
    </div>
  )
}
