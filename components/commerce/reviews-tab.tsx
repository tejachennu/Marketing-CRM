'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, Star } from 'lucide-react'
import { ratingSummary } from '@/lib/commerce/reviews'
import { cardClass, secondaryButton, type ShowToast } from './ui'

/** E-commerce → Reviews: what customers wrote (with photos); hide any review from the store page. */
export function ReviewsTab({ orgId, canManage, showToast }: { orgId: string; canManage: boolean; showToast: ShowToast }) {
  const [reviews, setReviews] = useState<any[] | null>(null)
  const load = useCallback(() => {
    fetch(`/api/commerce/reviews?organizationId=${orgId}`).then((r) => r.json()).then((d) => setReviews(d.reviews || [])).catch(() => setReviews([]))
  }, [orgId])
  useEffect(() => { load() }, [load])
  async function toggle(r: any) {
    const res = await fetch('/api/commerce/reviews', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, id: r.id, published: !r.published }) })
    if (!res.ok) { showToast('error', 'Could not change it.'); return }
    showToast('success', r.published ? 'Hidden from your store page.' : 'Shown on your store page.')
    load()
  }
  if (!reviews) return <div className={`${cardClass} py-12 flex items-center justify-center gap-2 text-sm text-slate-500`}><Loader2 size={18} className="animate-spin" /> Loading reviews…</div>
  const sum = ratingSummary(reviews.filter((r) => r.published))
  return (
    <div className="max-w-3xl space-y-3">
      <section className={`${cardClass} p-4 sm:p-5`}>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Customer reviews</h2>
        <p className="text-xs text-slate-500">Customers get a review link on WhatsApp when their order is delivered. Reviews show on the product page.</p>
        {sum.count > 0 && <p className="mt-2 text-sm flex items-center gap-1.5"><Star size={16} className="text-[#f5a623]" fill="currentColor" /> <b>{sum.average}</b> average from {sum.count} review{sum.count === 1 ? '' : 's'}</p>}
      </section>
      {reviews.length === 0 && <p className={`${cardClass} p-6 text-sm text-center text-slate-500`}>No reviews yet.</p>}
      <ul className="space-y-2">
        {reviews.map((r) => (
          <li key={r.id} className={`${cardClass} p-3 sm:p-4 ${r.published ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} className={n <= r.rating ? 'text-[#f5a623]' : 'text-slate-300'} fill={n <= r.rating ? 'currentColor' : 'none'} />)}</span>
              <b className="text-[13.5px] text-slate-900 dark:text-white">{r.product?.title || 'Product'}</b>
              {r.rating <= 2 && <span className="text-[11px] font-bold rounded-full bg-[#fdf0f0] text-[#b91c1c] px-2 py-0.5">Low rating</span>}
              {!r.published && <span className="text-[11px] font-bold rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">Hidden</span>}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{r.customer_name || 'A customer'}{r.order?.order_number ? ` · order #${r.order.order_number}` : ''}{r.created_at && !Number.isNaN(Date.parse(r.created_at)) ? ` · ${new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</p>
            {r.body && <p className="mt-1.5 text-[13.5px] text-slate-700 dark:text-slate-200 break-words">{r.body}</p>}
            {Array.isArray(r.photos) && r.photos.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.photos.map((url: string) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Customer photo" className="h-16 w-16 rounded-lg object-cover" /></a>)}
              </div>
            )}
            {canManage && (
              <button type="button" className={`${secondaryButton} h-8 mt-2`} onClick={() => toggle(r)}>
                {r.published ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Show</>}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
