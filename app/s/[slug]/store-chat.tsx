'use client'

/**
 * The store's AI chat: a button on every page that opens a chat. It answers from the shop's products and Knowledge
 * Base (POST /api/public/store/[slug]/chat), shows the products it talks about as cards with Add to cart, offers
 * quick follow-ups, and sends shoppers to the shop's WhatsApp for anything it cannot do. The chat is kept for the
 * browser tab (sessionStorage).
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { Picture } from './store-parts'

interface Card { id: string; title: string; price: number; mrp: number | null; image: string; inStock: boolean; hasOptions: boolean }
interface Turn {
  role: 'user' | 'assistant'
  content: string
  products?: Card[]
  buttons?: { title: string; question: string }[]
  attachments?: { type: string; url: string; name?: string }[]
  handoff?: boolean
  error?: boolean
}

const STARTERS = ['What are your best deals?', 'How much is delivery?', 'Do you have cash on delivery?', 'What is your return policy?']

export function StoreChat({ slug, storeName, whatsapp, money, productHref, onAdd, raised }: {
  slug: string; storeName: string; whatsapp: string; money: (n: number) => string; productHref: (id: string) => string
  onAdd: (id: string) => void; raised: boolean
}) {
  const key = `store-chat:${slug}`
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try { setTurns(JSON.parse(sessionStorage.getItem(key) || '[]').slice(-30)) } catch {}
  }, [key])
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(turns.slice(-30))) } catch {}
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [turns, key])

  const wa = (msg: string) => `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`

  async function ask(question: string) {
    const q = question.replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!q || busy) return
    setText('')
    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })).slice(-8)
    setTurns((t) => [...t, { role: 'user', content: q }])
    setBusy(true)
    try {
      const res = await fetch(`/api/public/store/${slug}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q, history }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The chat could not answer just now.')
      setTurns((t) => [...t, { role: 'assistant', content: data.reply, products: data.products, buttons: data.buttons, attachments: data.attachments, handoff: data.handoff }])
    } catch (err: any) {
      setTurns((t) => [...t, { role: 'assistant', content: err.message, error: true }])
    } finally {
      setBusy(false)
    }
  }

  const lastAsked = [...turns].reverse().find((t) => t.role === 'user')?.content || ''

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Chat with us"
          className={`fixed right-4 z-30 h-12 pl-4 pr-5 rounded-full bg-[#0E1B3D] text-white shadow-lg inline-flex items-center gap-2 font-bold text-[14px] cursor-pointer ${raised ? 'bottom-[72px] md:bottom-6' : 'bottom-[72px] sm:bottom-6'}`}>
          <Sparkles size={18} /> Ask us
        </button>
      )}
      {open && (
        <div role="dialog" aria-label={`Chat with ${storeName}`} className="fixed z-50 inset-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[380px] sm:h-[600px] sm:max-h-[calc(100vh-2rem)] bg-white sm:rounded-xl shadow-2xl flex flex-col overflow-hidden border border-[#e3e8f2]">
          <div className="h-14 px-3 flex items-center gap-2 bg-[var(--c)] text-white shrink-0">
            <span className="h-9 w-9 rounded-full bg-white/15 flex items-center justify-center"><Sparkles size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-[15px] truncate">{storeName}</p>
              <p className="text-[11.5px] text-white/80">AI assistant · answers in seconds</p>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer"><X size={19} /></button>
          </div>

          <div ref={list} className="flex-1 overflow-y-auto bg-[#f1f3f6] p-3 space-y-3" aria-live="polite">
            <div className="max-w-[88%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-[14px] text-[#0E1B3D] shadow-sm">
              Hi! Ask me about products, prices, delivery or returns.
            </div>
            {turns.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {STARTERS.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-[#d5ddeb] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--c)] cursor-pointer hover:bg-[#f4f6fa]">{s}</button>)}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[88%] rounded-lg px-3 py-2 text-[14px] whitespace-pre-line break-words shadow-sm ${t.role === 'user' ? 'rounded-tr-none bg-[var(--c)] text-white' : t.error ? 'rounded-tl-none bg-[#fdf0f0] text-[#b91c1c]' : 'rounded-tl-none bg-white text-[#0E1B3D]'}`}>
                  {t.content}
                </div>
                {t.products && t.products.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                    {t.products.map((p) => (
                      <div key={p.id} className="w-[148px] shrink-0 rounded-lg bg-white border border-[#e3e8f2] p-2">
                        <a href={productHref(p.id)} className="block">
                          <Picture src={p.image} alt={p.title} contain className="h-24 w-full" />
                          <p className="mt-1 text-[12.5px] leading-snug line-clamp-2 text-[#0E1B3D]">{p.title}</p>
                          <p className="text-[13px]"><b>{money(p.price)}</b>{p.mrp ? <s className="ml-1 text-[11.5px] text-[#8a94a8]">{money(p.mrp)}</s> : null}</p>
                        </a>
                        {!p.inStock ? <p className="mt-1 text-[11.5px] font-semibold text-[#8a94a8]">Out of stock</p>
                          : p.hasOptions ? <a href={productHref(p.id)} className="mt-1.5 block h-8 leading-[30px] text-center rounded-md border border-[var(--c)] text-[var(--c)] text-[12.5px] font-bold">Choose</a>
                          : <button type="button" onClick={() => { onAdd(p.id); setAdded(p.id); setTimeout(() => setAdded(null), 1500) }} className="mt-1.5 w-full h-8 rounded-md bg-[var(--c)] text-white text-[12.5px] font-bold cursor-pointer">{added === p.id ? 'Added' : 'Add to cart'}</button>}
                      </div>
                    ))}
                  </div>
                )}
                {t.attachments && t.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.attachments.map((a) => a.type === 'image'
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <a key={a.url} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name || ''} className="h-28 rounded-lg border border-[#e3e8f2] object-cover" /></a>
                      : <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="rounded-md border border-[#d5ddeb] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--c)]">{a.type === 'video' ? 'Watch video' : `Open ${a.name || 'file'}`}</a>)}
                  </div>
                )}
                {t.handoff && whatsapp && (
                  <a href={wa(`Hi ${storeName}, ${lastAsked}`)} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-9 px-3.5 rounded-md bg-[#25D366] text-white text-[13px] font-bold items-center gap-2"><MessageCircle size={15} /> Message the shop on WhatsApp</a>
                )}
                {i === turns.length - 1 && t.buttons && t.buttons.length > 0 && !busy && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.buttons.map((b) => <button key={b.title} type="button" onClick={() => ask(b.question)} className="rounded-full border border-[#d5ddeb] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--c)] cursor-pointer hover:bg-[#f4f6fa]">{b.title}</button>)}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[13px] text-[#6B7894] shadow-sm"><Loader2 size={14} className="animate-spin" /> Typing…</div>}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(text) }} className="p-2.5 border-t border-[#e3e8f2] bg-white flex items-center gap-2 shrink-0">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Type your question" aria-label="Your question"
              className="flex-1 min-w-0 h-11 px-3.5 rounded-full bg-[#f1f3f6] text-[15px] text-[#0E1B3D] placeholder:text-[#8a94a8] focus:outline-none focus:ring-2 focus:ring-[var(--c)]/30" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="h-11 w-11 shrink-0 rounded-full bg-[var(--c)] text-white flex items-center justify-center disabled:opacity-50 cursor-pointer"><Send size={18} /></button>
          </form>
          <p className="px-3 pb-2 bg-white text-[11px] text-[#8a94a8] text-center">AI answers can be wrong. For order help, message the shop{whatsapp ? ' on WhatsApp' : ''}.</p>
        </div>
      )}
    </>
  )
}
