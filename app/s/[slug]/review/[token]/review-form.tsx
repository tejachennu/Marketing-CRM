'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, Package, Star, X } from 'lucide-react'
import { MAX_REVIEW_PHOTOS } from '@/lib/commerce/reviews'

type Item = { productId: string; title: string; image: string; reviewed: boolean }
type Draft = { rating: number; text: string; photos: string[]; busy?: boolean }

export function ReviewForm({ slug, token }: { slug: string; token: string }) {
  const [data, setData] = useState<{ orderNumber: string; name: string; items: Item[] } | null>(null)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`/api/public/store/${slug}/review?token=${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'This review link is not valid.')
      setData(d)
    }).catch((e) => setError(e.message))
  }, [slug, token])

  const set = (id: string, change: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...(all[id] || { rating: 0, text: '', photos: [] }), ...change } }))

  async function send() {
    const reviews = Object.entries(drafts).filter(([, d]) => d.rating > 0).map(([productId, d]) => ({ productId, rating: d.rating, text: d.text, photos: d.photos }))
    if (!reviews.length) { setError('Tap the stars to rate at least one product.'); return }
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/public/store/${slug}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, reviews }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not send. Please try again.')
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (error && !data) return <p role="alert" className="mt-6 rounded-2xl bg-white border border-[#e3e8f2] p-6 text-[15px]">{error}</p>
  if (!data) return <p className="mt-6 flex items-center gap-2 text-[#4a5672]"><Loader2 size={18} className="animate-spin" /> Loading…</p>
  if (done) return (
    <div className="mt-6 rounded-2xl bg-white border border-[#e3e8f2] p-8 text-center">
      <span className="mx-auto h-14 w-14 rounded-full bg-[var(--c)] text-white flex items-center justify-center"><Check size={28} /></span>
      <p className="mt-4 text-[20px] font-extrabold">Thank you{data.name ? `, ${data.name}` : ''}!</p>
      <p className="mt-1 text-[15px] text-[#4a5672]">Your review helps other customers choose.</p>
    </div>
  )
  const open = data.items.filter((i) => !i.reviewed)
  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-[24px] font-extrabold leading-tight">How was your order #{data.orderNumber}?</h1>
      {!open.length && <p className="rounded-2xl bg-white border border-[#e3e8f2] p-6 text-[15px]">You have already reviewed everything in this order. Thank you!</p>}
      {open.map((item) => {
        const d = drafts[item.productId] || { rating: 0, text: '', photos: [] }
        return (
          <section key={item.productId} className="rounded-2xl bg-white border border-[#e3e8f2] p-4 space-y-3">
            <div className="flex items-center gap-3">
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="h-14 w-14 rounded-xl object-cover bg-[#eef1f6]" />
              ) : <span className="h-14 w-14 rounded-xl bg-[#eef1f6] flex items-center justify-center text-[#8a94a8]"><Package size={20} /></span>}
              <p className="font-semibold text-[15px] leading-snug">{item.title}</p>
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={`Rating for ${item.title}`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={d.rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => set(item.productId, { rating: n })} className="p-1 cursor-pointer">
                  <Star size={30} className={n <= d.rating ? 'text-[#f5a623]' : 'text-[#d5ddeb]'} fill={n <= d.rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            {d.rating > 0 && (
              <>
                <textarea value={d.text} onChange={(e) => set(item.productId, { text: e.target.value })} maxLength={1000} rows={3} placeholder="What did you like? (optional)" aria-label="Your review" className="w-full rounded-xl border border-[#d5ddeb] px-3 py-2.5 text-[15px]" />
                <Photos slug={slug} token={token} photos={d.photos} onChange={(photos) => set(item.productId, { photos })} onError={setError} />
              </>
            )}
          </section>
        )
      })}
      {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] p-3 text-[14px] text-[#b91c1c] font-semibold">{error}</p>}
      {open.length > 0 && (
        <button type="button" onClick={send} disabled={sending} className="w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
          {sending && <Loader2 size={17} className="animate-spin" />} Send review
        </button>
      )}
    </div>
  )
}

function Photos({ slug, token, photos, onChange, onError }: { slug: string; token: string; photos: string[]; onChange: (p: string[]) => void; onError: (e: string) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((url) => (
        <div key={url} className="relative h-16 w-16 rounded-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Your photo" className="h-full w-full object-cover" />
          <button type="button" aria-label="Remove photo" onClick={() => onChange(photos.filter((u) => u !== url))} className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-[#0E1B3D]/80 text-white flex items-center justify-center cursor-pointer"><X size={12} /></button>
        </div>
      ))}
      {photos.length < MAX_REVIEW_PHOTOS && (
        <button type="button" onClick={() => file.current?.click()} className="h-16 px-3 rounded-xl border border-dashed border-[#d5ddeb] bg-[#f4f6fa] text-[13px] font-semibold text-[#4a5672] inline-flex items-center gap-2 cursor-pointer">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={18} />} Add a photo
        </button>
      )}
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        setBusy(true)
        try {
          const form = new FormData()
          form.append('file', f)
          form.append('token', token)
          const res = await fetch(`/api/public/store/${slug}/review-photo`, { method: 'POST', body: form })
          const d = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(d.error || 'The photo could not be added.')
          onChange([...photos, d.url])
        } catch (err: any) {
          onError(err.message)
        } finally {
          setBusy(false)
        }
      }} />
    </div>
  )
}
