'use client'

import { useState } from 'react'
import { Check, Loader2, Star } from 'lucide-react'
import { ISSUE_TAGS, LIKED_TAGS } from '@/lib/salon/feedback'

const LABELS = ['', 'Bad', 'Not great', 'Okay', 'Good', 'Excellent']

function Stars({ value, onChange, size, label }: { value: number; onChange: (n: number) => void; size: number; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(n)}
          className="rounded-lg p-0.5 cursor-pointer transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D5BEA]/40">
          <Star style={{ width: size, height: size }} className={n <= value ? 'fill-[#f59e0b] text-[#f59e0b]' : 'text-[#d5ddeb]'} strokeWidth={1.6} />
        </button>
      ))}
    </div>
  )
}

const initials = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export function FeedbackForm({ token, business, logo, customerName, services, billLabel, people, closed, existing }: {
  token: string
  business: string
  logo: string | null
  customerName: string
  services: string[]
  billLabel: string
  people: { key: string; name: string; services: string[] }[]
  closed: boolean
  existing: { rating: number; staff_ratings: Record<string, number>; tags: string[]; comment: string } | null
}) {
  const [rating, setRating] = useState(existing?.rating || 0)
  const [staffRatings, setStaffRatings] = useState<Record<string, number>>(existing?.staff_ratings || {})
  const [touched, setTouched] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(existing?.staff_ratings || {}).map((k) => [k, true])))
  const [tags, setTags] = useState<string[]>(existing?.tags || [])
  const [comment, setComment] = useState(existing?.comment || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ rating: number; reviewLink: string | null } | null>(null)

  const good = rating >= 4
  const tagChoices = rating ? (good ? LIKED_TAGS : ISSUE_TAGS) : []

  function rateVisit(n: number) {
    setRating(n)
    // People not rated yet start from the visit's rating
    setStaffRatings((current) => Object.fromEntries(people.map((p) => [p.key, touched[p.key] ? current[p.key] : n])))
    // Tags belong to the kind of visit; switching between good and not good clears them
    if ((n >= 4) !== (rating >= 4)) setTags([])
  }

  async function send() {
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/salon/feedback/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, rating, staff_ratings: staffRatings, tags, comment }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Your feedback could not be sent. Please try again.')
      setDone({ rating: data.rating, reviewLink: data.reviewLink || null })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const header = (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt="" className="h-12 w-12 rounded-2xl object-contain bg-white border border-[#e3e8f2] p-1" /> : <span className="h-12 w-12 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center text-[17px] font-bold">{initials(business)}</span>}
      <div className="min-w-0">
        <p className="text-[16px] font-extrabold truncate">{business}</p>
        <p className="text-[13px] text-[#6B7894]">{billLabel}</p>
      </div>
    </div>
  )

  if (closed) {
    return <div className="max-w-md mx-auto bg-white rounded-3xl border border-[#e3e8f2] p-6 shadow-sm">{header}<p className="mt-6 text-[15.5px] text-[#4a5672]">This bill was cancelled, so there is nothing to rate.</p></div>
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-3xl border border-[#e3e8f2] p-6 sm:p-8 shadow-sm text-center">
        <span className="mx-auto h-16 w-16 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow-lg shadow-[#00A884]/30"><Check size={32} strokeWidth={3} /></span>
        <h1 className="mt-4 text-[24px] font-extrabold tracking-tight">Thank you{customerName ? `, ${customerName}` : ''}!</h1>
        <p className="mt-2 text-[15.5px] text-[#4a5672]">
          {done.rating >= 4 ? `We are so glad you enjoyed your visit to ${business}.` : done.rating === 3 ? 'Thank you for telling us. We will keep getting better.' : `We are sorry your visit was not good. The ${business} team will call you to make it right.`}
        </p>
        {done.reviewLink && (
          <a href={done.reviewLink} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[16px] font-bold">
            <Star size={18} className="fill-white" /> Leave a Google review
          </a>
        )}
        <p className="mt-6 text-[13px] text-[#8a94a8]">You can close this page.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-3xl border border-[#e3e8f2] p-5 sm:p-7 shadow-sm">
      {header}
      <h1 className="mt-6 text-[24px] font-extrabold tracking-tight leading-tight">How was your visit{customerName ? `, ${customerName}` : ''}?</h1>
      {services.length > 0 && <p className="mt-1 text-[15px] text-[#4a5672]">{services.join(', ')}</p>}
      {existing && <p className="mt-2 text-[13.5px] text-[#6B7894]">You rated this visit {existing.rating} star{existing.rating === 1 ? '' : 's'}. You can change it below.</p>}

      <div className="mt-5 flex flex-col items-center gap-1">
        <Stars value={rating} onChange={rateVisit} size={44} label="Your visit" />
        <p className={`h-6 text-[15px] font-bold ${rating ? 'text-[#0E1B3D]' : 'text-[#a3adc2]'}`}>{rating ? LABELS[rating] : 'Tap a star'}</p>
      </div>

      {rating > 0 && people.length > 0 && (
        <div className="mt-6">
          <p className="text-[14px] font-bold">Rate the team</p>
          <ul className="mt-2 divide-y divide-[#eef1f6] rounded-2xl border border-[#e3e8f2]">
            {people.map((person) => (
              <li key={person.key} className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="h-10 w-10 shrink-0 rounded-full bg-[#eef3fe] text-[#1D5BEA] flex items-center justify-center text-[14px] font-bold">{initials(person.name)}</span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold truncate">{person.name}</p>
                    {person.services.length > 0 && <p className="text-[12.5px] text-[#6B7894]">{person.services.join(', ')}</p>}
                  </div>
                </div>
                <div className="pl-[52px] sm:pl-0">
                  <Stars value={staffRatings[person.key] || 0} onChange={(n) => { setStaffRatings((c) => ({ ...c, [person.key]: n })); setTouched((t) => ({ ...t, [person.key]: true })) }} size={30} label={`Rate ${person.name}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rating > 0 && (
        <div className="mt-6">
          <p className="text-[14px] font-bold">{good ? 'What did you like?' : 'What could be better?'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tagChoices.map((tag) => {
              const on = tags.includes(tag)
              return (
                <button key={tag} type="button" aria-pressed={on} onClick={() => setTags(on ? tags.filter((t) => t !== tag) : [...tags, tag])}
                  className={`min-h-10 px-3.5 rounded-xl border text-[14.5px] font-semibold cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA]' : 'border-[#d5ddeb] text-[#0E1B3D] hover:border-[#9db5ef]'}`}>{tag}</button>
              )
            })}
          </div>
        </div>
      )}

      {rating > 0 && (
        <label className="mt-6 block">
          <span className="text-[14px] font-bold">{good ? 'Anything else to tell us? (optional)' : 'Tell us what happened (optional)'}</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} placeholder={good ? 'Loved the facial, Anitha was great…' : 'What went wrong, and how can we make it right?'}
            className="mt-2 w-full px-3.5 py-3 rounded-xl border border-[#d5ddeb] text-[15px] placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15" />
        </label>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-4 py-3 text-[14.5px]">{error}</p>}

      <button type="button" onClick={send} disabled={!rating || sending} className="mt-6 w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[#00A884] hover:bg-[#008f70] text-white text-[16px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
        {sending && <Loader2 size={18} className="animate-spin" />} {existing ? 'Update feedback' : 'Send feedback'}
      </button>
    </div>
  )
}
