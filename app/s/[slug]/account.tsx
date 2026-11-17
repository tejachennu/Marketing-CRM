'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Loader2, LogOut, MapPin, Package, Search, Truck, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { shopperAuth, unpackSession } from '@/lib/commerce/shopper-client'
import { PhoneField } from '@/components/phone-field'

type Cart = Record<string, number>

export interface ShopperOrder {
  number: string
  placedAt: string | null
  status: string
  tone: 'blue' | 'grey' | 'red' | 'done'
  paid: boolean
  payment: string
  handover: 'delivery' | 'pickup'
  address: string
  tracking: { number: string; carrier: string } | null
  items: { title: string; quantity: number; price: number; total: number; image: string }[]
  subtotal: number
  delivery: number
  total: number
  currency: string
  timeline: { key: string; label: string; state: 'done' | 'now' | 'next' | 'stopped'; at: string | null }[]
}

export interface Account {
  shopper: { name: string; email: string; picture: string; phone: string; address: Record<string, string> | null }
  cart: Cart
  orders: ShopperOrder[]
}

/**
 * The shopper's sign-in on a store page: the session (also one handed over from WAMA's sign-in page on the
 * store's own domain), their account (details, saved cart, orders), and their cart kept in sync.
 */
export function useShopper(slug: string, enabled: boolean, cart: Cart, setCart: (cart: Cart) => void, appUrl: string) {
  const [session, setSession] = useState<Session | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const merged = useRef(false)

  // The session: saved on this address, or handed over in #shopper=…
  useEffect(() => {
    const auth = enabled ? shopperAuth() : null
    if (!auth) {
      setReady(true)
      return
    }
    let gone = false
    ;(async () => {
      const handed = window.location.hash.match(/^#shopper=([A-Za-z0-9+/_-]+)/)?.[1]
      if (handed) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
        const tokens = unpackSession(handed)
        if (tokens) await auth.auth.setSession(tokens).catch(() => null)
      }
      const { data } = await auth.auth.getSession()
      if (!gone) {
        setSession(data.session)
        setReady(true)
      }
    })()
    const { data: sub } = auth.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => {
      gone = true
      sub.subscription.unsubscribe()
    }
  }, [enabled])

  const headers = useCallback((): Record<string, string> => (session ? { Authorization: `Bearer ${session.access_token}` } : {}), [session])

  const refresh = useCallback(async () => {
    if (!session) return null
    setLoading(true)
    try {
      const res = await fetch(`/api/public/store/${slug}/account`, { headers: headers() })
      if (res.status === 401) {
        await shopperAuth()?.auth.signOut({ scope: 'local' }).catch(() => null)
        setAccount(null)
        return null
      }
      const data = await res.json().catch(() => null)
      if (res.ok && data) setAccount(data)
      return res.ok ? (data as Account) : null
    } catch {
      return null
    } finally {
      setLoading(false)
    }
  }, [session, slug, headers])

  // After signing in: load the account, and join the phone's cart with the saved one
  useEffect(() => {
    if (!session) {
      setAccount(null)
      merged.current = false
      return
    }
    refresh().then((data) => {
      if (!data || merged.current) return
      merged.current = true
      const joined: Cart = { ...cart }
      for (const [id, qty] of Object.entries(data.cart || {})) joined[id] = Math.min(99, Math.max(joined[id] || 0, qty))
      if (JSON.stringify(joined) !== JSON.stringify(cart)) setCart(joined)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // Keep the cart on the account (a second after the last change)
  useEffect(() => {
    if (!session || !merged.current) return
    const timer = setTimeout(() => {
      fetch(`/api/public/store/${slug}/account`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ cart }) }).catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [cart, session, slug, headers])

  const signIn = useCallback(() => {
    const base = (appUrl || window.location.origin).replace(/\/$/, '')
    window.location.href = `${base}/s/${slug}/signin?return=${encodeURIComponent(window.location.origin)}`
  }, [appUrl, slug])

  const signOut = useCallback(async () => {
    await shopperAuth()?.auth.signOut({ scope: 'local' }).catch(() => null)
    setSession(null)
    setAccount(null)
  }, [])

  return { enabled, ready, session, account, loading, headers, refresh, signIn, signOut }
}

export type ShopperState = ReturnType<typeof useShopper>

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '')

function StatusChip({ order }: { order: ShopperOrder }) {
  const tone = {
    blue: 'bg-[var(--c)]/10 text-[var(--c)]',
    done: 'bg-[#eef1f6] text-[#0E1B3D]',
    grey: 'bg-[#eef1f6] text-[#6B7894]',
    red: 'bg-[#fdf0f0] text-[#b91c1c]',
  }[order.tone]
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-bold whitespace-nowrap ${tone}`}>{order.status}</span>
}

/** Placed → Confirmed → On the way / Ready → Delivered / Picked up, with when each happened. */
export function Timeline({ order }: { order: ShopperOrder }) {
  return (
    <ol className="space-y-0">
      {order.timeline.map((step, i) => {
        const last = i === order.timeline.length - 1
        const dot = step.state === 'done' ? 'bg-[var(--c)] text-white' : step.state === 'now' ? 'bg-white border-2 border-[var(--c)] text-[var(--c)]' : step.state === 'stopped' ? 'bg-[#b91c1c] text-white' : 'bg-white border-2 border-[#d5ddeb] text-[#8a94a8]'
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${dot}`}>
                {step.state === 'done' ? <Check size={15} /> : step.state === 'stopped' ? <X size={15} /> : step.state === 'now' ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--c)]" /> : null}
              </span>
              {!last && <span className={`w-0.5 flex-1 min-h-6 ${step.state === 'done' ? 'bg-[var(--c)]' : 'bg-[#e3e8f2]'}`} />}
            </div>
            <div className={`pb-5 ${last ? 'pb-0' : ''}`}>
              <p className={`text-[14.5px] font-bold leading-7 ${step.state === 'next' ? 'text-[#8a94a8]' : step.state === 'stopped' ? 'text-[#b91c1c]' : 'text-[#0E1B3D]'}`}>{step.label}</p>
              {step.at && <p className="text-[12.5px] text-[#6B7894] -mt-1">{when(step.at)}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** One order: where it is, what is in it, and how it is paid. */
export function OrderDetail({ order, money, onReorder }: { order: ShopperOrder; money: (n: number) => string; onReorder?: (items: { key: string; quantity: number }[]) => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[18px] font-extrabold">Order #{order.number}</p>
          <p className="text-[13px] text-[#6B7894]">Placed {when(order.placedAt)}</p>
        </div>
        <StatusChip order={order} />
      </div>
      <div className="rounded-2xl border border-[#e3e8f2] p-4"><Timeline order={order} /></div>
      {order.tracking && (
        <p className="rounded-xl bg-[#f4f6fa] p-3 text-[14px] flex gap-2"><Truck size={17} className="shrink-0 mt-px text-[var(--c)]" /> <span>Tracking number <b className="break-all">{order.tracking.number}</b>{order.tracking.carrier ? ` (${order.tracking.carrier})` : ''}</span></p>
      )}
      <div className="space-y-3">
        {order.items.map((item, i) => (
          <div key={i} className="flex gap-3 items-center">
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image} alt="" className="h-14 w-14 rounded-xl object-cover shrink-0 bg-[#eef1f6]" loading="lazy" />
            ) : (
              <span className="h-14 w-14 rounded-xl bg-[#eef1f6] flex items-center justify-center shrink-0 text-[#8a94a8]"><Package size={20} /></span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[14.5px] font-semibold leading-snug line-clamp-2">{item.title}</p>
              <p className="text-[13px] text-[#6B7894]">{item.quantity} × {money(item.price)}</p>
            </div>
            <p className="text-[14.5px] font-bold shrink-0">{money(item.total)}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-[#f4f6fa] p-4 space-y-1.5 text-[14.5px]">
        <div className="flex justify-between"><span>Items</span><span>{money(order.subtotal)}</span></div>
        {order.handover === 'delivery' && <div className="flex justify-between"><span>Delivery</span><span>{order.delivery ? money(order.delivery) : 'Free'}</span></div>}
        <div className="flex justify-between font-extrabold text-[16px] pt-1"><span>Total</span><span>{money(order.total)}</span></div>
        <p className="text-[13px] text-[#6B7894]">{order.payment}</p>
      </div>
      <p className="text-[14px] text-[#4a5672] flex gap-2">
        <MapPin size={17} className="shrink-0 mt-0.5 text-[var(--c)]" />
        {order.handover === 'delivery' ? <span>Delivering to {order.address || 'your address'}</span> : <span>Pick up from the shop</span>}
      </p>
      {onReorder && order.items.some((i: any) => i.key) && (
        <button type="button" onClick={() => onReorder(order.items.filter((i: any) => i.key).map((i: any) => ({ key: i.key, quantity: i.quantity })))} className="w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] cursor-pointer">
          Same as last time? Order again
        </button>
      )}
    </div>
  )
}

/** The account panel: sign in, My orders, one order, or Track an order (for guests too). */
export function AccountPanel({ slug, shopper, money, storeName, initialView, onClose, onReorder }: { slug: string; shopper: ShopperState; money: (n: number) => string; storeName: string; initialView: 'orders' | 'track'; onClose: () => void; onReorder?: (items: { key: string; quantity: number }[]) => void }) {
  const [view, setView] = useState<'orders' | 'track'>(initialView)
  const [openOrder, setOpenOrder] = useState<ShopperOrder | null>(null)
  const [trackNumber, setTrackNumber] = useState('')
  const [trackPhone, setTrackPhone] = useState('')
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState('')
  const signedIn = Boolean(shopper.session)

  useEffect(() => {
    if (signedIn && view === 'orders') shopper.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, view])


  const title = openOrder ? 'Your order' : view === 'track' ? 'Track an order' : shopper.session ? 'My orders' : 'Sign in'
  const account = shopper.account

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-md h-full flex flex-col">
        <div className="h-16 px-4 flex items-center gap-2 border-b border-[#e3e8f2] shrink-0">
          {openOrder && <button type="button" aria-label="Back" onClick={() => setOpenOrder(null)} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><ArrowLeft size={19} /></button>}
          <p className="font-extrabold text-[18px] flex-1">{title}</p>
          <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><X size={19} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {openOrder ? (
            <OrderDetail order={openOrder} money={money} onReorder={onReorder} />
          ) : view === 'track' ? (
            <TrackForm
              slug={slug}
              number={trackNumber}
              phone={trackPhone}
              setNumber={setTrackNumber}
              setPhone={setTrackPhone}
              busy={tracking}
              setBusy={setTracking}
              error={error}
              setError={setError}
              onFound={setOpenOrder}
              onBack={shopper.enabled ? () => setView('orders') : null}
            />
          ) : !signedIn ? (
            <div className="py-6 text-center">
              <span className="mx-auto h-16 w-16 rounded-full bg-[var(--c)]/10 text-[var(--c)] flex items-center justify-center"><Package size={28} /></span>
              <p className="mt-4 text-[19px] font-extrabold">Your orders at {storeName}</p>
              <p className="mt-1 text-[14.5px] text-[#4a5672]">Sign in to see every order and where it is, keep your cart on any phone, and check out faster.</p>
              <button type="button" onClick={shopper.signIn} className="mt-6 w-full h-12 rounded-full border-2 border-[#d5ddeb] bg-white font-bold text-[15px] inline-flex items-center justify-center gap-2.5 cursor-pointer hover:border-[var(--c)]">
                <GoogleMark /> Continue with Google
              </button>
              <button type="button" onClick={() => setView('track')} className="mt-4 text-[14.5px] font-semibold text-[#4a5672] underline cursor-pointer">Track an order without signing in</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl bg-[#f4f6fa] p-3">
                {account?.shopper.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.shopper.picture} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <span className="h-11 w-11 rounded-full bg-[var(--c)] text-white flex items-center justify-center font-bold shrink-0">{(account?.shopper.name || shopper.session?.user.email || '?').slice(0, 1).toUpperCase()}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{account?.shopper.name || 'Signed in'}</p>
                  <p className="text-[13px] text-[#6B7894] truncate">{account?.shopper.email || shopper.session?.user.email}</p>
                </div>
                <button type="button" onClick={shopper.signOut} className="h-9 px-3 rounded-full border border-[#d5ddeb] text-[13px] font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"><LogOut size={14} /> Sign out</button>
              </div>

              {shopper.loading && !account ? (
                <p className="py-10 text-center text-[#6B7894] inline-flex w-full justify-center items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading your orders…</p>
              ) : !account?.orders.length ? (
                <div className="py-10 text-center">
                  <p className="font-bold">No orders yet</p>
                  <p className="mt-1 text-[14px] text-[#6B7894]">Orders you place while signed in show up here.</p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {account.orders.map((order) => (
                    <li key={order.number}>
                      <button type="button" onClick={() => setOpenOrder(order)} className="w-full text-left rounded-2xl border border-[#e3e8f2] p-3.5 hover:border-[var(--c)] cursor-pointer flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-bold truncate">#{order.number}</p>
                            <StatusChip order={order} />
                          </div>
                          <p className="mt-1 text-[13px] text-[#6B7894] truncate">{day(order.placedAt)} · {order.items.reduce((n, i) => n + i.quantity, 0)} item{order.items.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'} · {money(order.total)}</p>
                          <p className="text-[13px] text-[#4a5672] truncate">{order.items.map((i) => i.title).join(', ')}</p>
                        </div>
                        <ChevronRight size={18} className="text-[#8a94a8] shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setView('track')} className="w-full text-center text-[14px] font-semibold text-[#4a5672] underline cursor-pointer">Track an order placed without signing in</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TrackForm({ slug, number, phone, setNumber, setPhone, busy, setBusy, error, setError, onFound, onBack }: {
  slug: string; number: string; phone: string; setNumber: (v: string) => void; setPhone: (v: string) => void; busy: boolean; setBusy: (v: boolean) => void
  error: string; setError: (v: string) => void; onFound: (order: ShopperOrder) => void; onBack: (() => void) | null
}) {
  const input = 'w-full h-12 px-4 rounded-xl border border-[#d5ddeb] text-[15px] focus:outline-none focus:border-[var(--c)] focus:ring-2 focus:ring-[var(--c)]/20'
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/public/store/${slug}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: number, phone }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'We could not find that order.')
      onFound(data.order)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[14.5px] text-[#4a5672]">Type the order number from your confirmation and the phone number you ordered with.</p>
      <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Order number, e.g. ORD-241114-0007" aria-label="Order number" required maxLength={40} autoCapitalize="characters" className={input} />
      <PhoneField value={phone} onChange={setPhone} inputClassName={input} placeholder="Mobile number" />
      {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] p-3 text-[14px] text-[#b91c1c] font-semibold">{error}</p>}
      <button type="submit" disabled={busy || !number.trim()} className="w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer">
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />} Find my order
      </button>
      {onBack && <button type="button" onClick={onBack} className="block mx-auto text-[14px] font-semibold text-[#4a5672] underline cursor-pointer">Back to my orders</button>}
    </form>
  )
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
