'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Banknote, Check, ChevronLeft, ChevronRight, CreditCard, Loader2, MapPin, Minus, Phone, Play, Plus, MessageCircle, Search, Share2, ShieldCheck, ShoppingBag, Store, Truck, UserRound, X } from 'lucide-react'
import { PhoneField } from '@/components/phone-field'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { showPhone } from '@/lib/phone-display'
import { AccountPanel, useShopper } from './account'
import type { StoreView } from '@/lib/commerce/storefront'
import { findVariant, valueAvailable } from '@/lib/commerce/variants'

type Product = StoreView['products'][number]

/** Razorpay's checkout window, loaded only when someone pays online. */
function loadRazorpay(): Promise<any> {
  const w = window as any
  if (w.Razorpay) return Promise.resolve(w.Razorpay)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Online payment could not be opened.')))
    script.onerror = () => reject(new Error('Online payment could not be opened. Check your internet and try again.'))
    document.body.appendChild(script)
  })
}
type Cart = Record<string, number>

const input = 'w-full h-12 px-4 rounded-xl border border-[#d5ddeb] bg-white text-[15px] text-[#0E1B3D] placeholder:text-[#8a94a8] focus:outline-none focus:border-[var(--c)] focus:ring-4 focus:ring-[var(--c)]/10'

function Picture({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={`${className} bg-[#eef1f6] flex items-center justify-center text-[#8a94a8]`}>
        <ShoppingBag size={28} />
      </div>
    )
  }
  // Product photos come from any address the business uses (Meta's catalog, its own site), so a plain img
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover`} />
}

/** The banners at the top: slide by themselves, swipe on phones, arrows on wide screens. */
function Banners({ store, onCategory }: { store: StoreView; onCategory: (name: string) => void }) {
  const [index, setIndex] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const count = store.banners.length
  const go = useCallback((next: number) => {
    const el = strip.current
    if (!el || !count) return
    const target = (next + count) % count
    el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' })
  }, [count])
  useEffect(() => {
    if (count < 2) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') go(index + 1)
    }, 5000)
    return () => clearInterval(timer)
  }, [index, count, go])

  if (!count) {
    return (
      <section className="bg-[var(--c)] text-white">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
          <h1 className="text-[28px] sm:text-[40px] font-extrabold tracking-tight leading-tight">{store.name}</h1>
          {store.tagline && <p className="mt-2 text-[16px] sm:text-[18px] text-white/85 max-w-xl">{store.tagline}</p>}
        </div>
      </section>
    )
  }
  return (
    <section className="max-w-6xl mx-auto px-0 sm:px-4 sm:pt-4">
      <div className="relative sm:rounded-2xl overflow-hidden">
        <div
          ref={strip}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
          className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        >
          {store.banners.map((banner, i) => {
            const open = () => (banner.category ? onCategory(banner.category) : banner.link ? window.open(banner.link, '_blank', 'noopener') : null)
            return (
              <button key={i} type="button" onClick={open} className="relative shrink-0 w-full snap-start aspect-[16/9] sm:aspect-[21/8] text-left cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={banner.image} alt={banner.title || store.name} className="absolute inset-0 h-full w-full object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
                {(banner.title || banner.text || banner.button) && (
                  <span className="absolute inset-0 bg-black/35 flex flex-col justify-end p-5 sm:p-10 text-white">
                    {banner.title && <span className="block text-[22px] sm:text-[38px] font-extrabold leading-tight max-w-xl">{banner.title}</span>}
                    {banner.text && <span className="block mt-1 text-[14px] sm:text-[17px] text-white/90 max-w-xl">{banner.text}</span>}
                    {banner.button && <span className="mt-3 inline-flex w-fit items-center h-10 px-5 rounded-full bg-white text-[var(--c)] text-[14px] font-bold">{banner.button}</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {count > 1 && (
          <>
            <button type="button" aria-label="Previous" onClick={() => go(index - 1)} className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/90 text-[#0E1B3D] items-center justify-center shadow cursor-pointer"><ChevronLeft size={20} /></button>
            <button type="button" aria-label="Next" onClick={() => go(index + 1)} className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/90 text-[#0E1B3D] items-center justify-center shadow cursor-pointer"><ChevronRight size={20} /></button>
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
              {store.banners.map((_, i) => (
                <button key={i} type="button" aria-label={`Banner ${i + 1}`} onClick={() => go(i)} className={`h-2 rounded-full transition-all cursor-pointer ${i === index ? 'w-6 bg-white' : 'w-2 bg-white/60'}`} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Stepper({ value, onChange, small }: { value: number; onChange: (n: number) => void; small?: boolean }) {
  const size = small ? 'h-8 w-8' : 'h-11 w-11'
  return (
    <div className="inline-flex items-center rounded-full border border-[#d5ddeb] bg-white">
      <button type="button" aria-label="One less" onClick={() => onChange(value - 1)} className={`${size} flex items-center justify-center text-[#0E1B3D] cursor-pointer`}><Minus size={small ? 14 : 16} /></button>
      <span className={`${small ? 'w-6 text-[14px]' : 'w-8 text-[16px]'} text-center font-bold tabular-nums`}>{value}</span>
      <button type="button" aria-label="One more" onClick={() => onChange(value + 1)} className={`${size} flex items-center justify-center text-[#0E1B3D] cursor-pointer`}><Plus size={small ? 14 : 16} /></button>
    </div>
  )
}

export function Storefront({ store, startCategory, appUrl = '', basePath = '', productId = null }: { store: StoreView; startCategory: string | null; appUrl?: string; basePath?: string; productId?: string | null }) {
  // Addresses inside the store: /s/<slug>/… on WAMA, or /… on the store's own domain
  const homeHref = basePath || '/'
  const productHref = (id: string) => `${basePath}/p/${id}`
  const categoryHref = (name: string) => `${homeHref}?c=${encodeURIComponent(name)}`
  const viewing = productId ? store.products.find((p) => p.id === productId) || null : null
  const money = (n: number) => formatMoney(n, store.currency)
  const [category, setCategory] = useState<string | null>(startCategory)
  const [query, setQuery] = useState('')
  const [openQty, setOpenQty] = useState(1)
  const [shared, setShared] = useState(false)
  const [cart, setCart] = useState<Cart>({})
  const [panel, setPanel] = useState<null | 'cart' | 'checkout' | 'done'>(null)
  const productsRef = useRef<HTMLDivElement>(null)
  const cartKey = `store-cart:${store.slug}`

  // The cart stays on this phone between visits
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(cartKey) || '{}')
      const valid: Cart = {}
      for (const [key, qty] of Object.entries(saved)) if (lineFor(store.products, key)?.inStock && Number(qty) > 0) valid[key] = Math.min(99, Number(qty))
      setCart(valid)
    } catch {}
  }, [cartKey, store.products])
  useEffect(() => {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart))
    } catch {}
  }, [cart, cartKey])

  const setQty = (id: string, qty: number) => setCart((current) => {
    const next = { ...current }
    if (qty <= 0) delete next[id]
    else next[id] = Math.min(99, qty)
    return next
  })

  // Signed-in shoppers: orders, tracking, cart on every phone
  const shopper = useShopper(store.slug, store.accounts, cart, setCart, appUrl)
  const [accountView, setAccountView] = useState<null | 'orders' | 'track'>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('account') !== '1') return
    params.delete('account')
    history.replaceState(null, '', window.location.pathname + (params.toString() ? `?${params}` : ''))
    setAccountView('orders')
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return store.products.filter((p) => (!category || p.category === category) && (!q || `${p.title} ${p.description} ${p.category}`.toLowerCase().includes(q)))
  }, [store.products, category, query])

  // A cart key is the product id, or "product id:option id" for a size / colour
  const lines = Object.entries(cart).map(([key, qty]) => ({ key, qty, ...lineFor(store.products, key)! })).filter((l) => l.product)
  const count = lines.reduce((sum, line) => sum + line.qty, 0)
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0)

  const pickCategory = (name: string | null) => {
    setCategory(name)
    setQuery('')
    productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Checkout
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [handover, setHandover] = useState<'pickup' | 'delivery'>(store.pickup ? 'pickup' : 'delivery')
  const [address, setAddress] = useState({ address_line_1: '', address_line_2: '', city: '', pincode: '', state: '' })
  const [note, setNote] = useState('')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ orderNumber: string; total: number; paid: boolean } | null>(null)
  const [pay, setPay] = useState<'online' | 'later'>(store.payOnline ? 'online' : 'later')
  // An online payment that was started but not finished: try again, or pay later
  const [unpaid, setUnpaid] = useState<{ orderNumber: string; total: number; razorpay: any } | null>(null)
  const unpaidKey = `store-unpaid:${store.slug}`
  // An unfinished payment survives a reload: ask once whether it was paid after all, else offer it again
  useEffect(() => {
    let saved: { orderNumber: string; total: number; razorpay: any } | null = null
    try {
      saved = JSON.parse(localStorage.getItem(unpaidKey) || 'null')
    } catch {}
    if (!saved?.orderNumber || !saved.razorpay?.orderId) return
    fetch(`/api/public/store/${store.slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: saved.orderNumber, razorpayOrderId: saved.razorpay.orderId, action: 'check' }) })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.paid) {
          try { localStorage.removeItem(unpaidKey) } catch {}
          setDone({ orderNumber: saved!.orderNumber, total: saved!.total, paid: true })
          setPanel('done')
        } else if ((ok && !data.canceled) || data?.error === 'Online payment is not set up for this shop.') {
          setUnpaid(saved)
          setPanel('checkout')
        } else {
          // The order is gone or already handled: forget it
          try { localStorage.removeItem(unpaidKey) } catch {}
        }
      })
      .catch(() => {})
  }, [unpaidKey, store.slug])
  useEffect(() => {
    try {
      if (unpaid) localStorage.setItem(unpaidKey, JSON.stringify(unpaid))
      else localStorage.removeItem(unpaidKey)
    } catch {}
  }, [unpaid, unpaidKey])
  // Signed in: name, phone and address filled in from last time (only empty boxes)
  useEffect(() => {
    const saved = shopper.account?.shopper
    if (panel !== 'checkout' || !saved) return
    if (!name && saved.name) setName(saved.name)
    if (!phone && saved.phone) setPhone(saved.phone)
    if (saved.address && !address.address_line_1 && !address.city) setAddress((current) => ({ ...current, ...saved.address }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, shopper.account])
  const delivery = handover === 'delivery' ? (store.freeFrom > 0 && subtotal >= store.freeFrom ? 0 : store.deliveryFee) : 0
  // Offers: a typed code, or the best offer that applies by itself (the server checks again when ordering)
  const [codeInput, setCodeInput] = useState('')
  const [code, setCode] = useState('')
  const [offer, setOffer] = useState<{ ok: boolean; title?: string; amount?: number; freeDelivery?: boolean; reason?: string } | null>(null)
  const offerKey = JSON.stringify([panel === 'checkout' || panel === 'cart', code, handover, Object.entries(cart).sort()])
  useEffect(() => {
    if (!(panel === 'checkout' || panel === 'cart') || !lines.length || (!code && !store.offers.length)) { setOffer(null); return }
    const timer = setTimeout(() => {
      fetch(`/api/public/store/${store.slug}/discount`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, handover, phone, items: lines.map((l) => ({ productId: l.product.id, ...(l.variant ? { variantId: l.variant.id } : {}), quantity: l.qty })) }) })
        .then((r) => r.json()).then(setOffer).catch(() => setOffer(null))
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey])
  const offOk = offer?.ok === true
  const discountOff = offOk ? Number(offer!.amount) || 0 : 0
  const deliveryToPay = offOk && offer!.freeDelivery ? 0 : delivery
  const toPay = Math.max(0, Math.round((subtotal - discountOff + deliveryToPay) * 100) / 100)
  const short = store.minOrder > 0 && subtotal < store.minOrder

  const confirmPayment = async (orderNumber: string, razorpayOrderId: string, extra: Record<string, string>) => {
    const res = await fetch(`/api/public/store/${store.slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber, razorpayOrderId, ...extra }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The payment could not be confirmed.')
    return data
  }

  /** Open Razorpay for an order; resolves when the window closes, paid or not. */
  async function payOnline(order: { orderNumber: string; total: number; razorpay: any }) {
    setError('')
    const Razorpay = await loadRazorpay()
    await new Promise<void>((resolve) => {
      const checkout = new Razorpay({
        key: order.razorpay.keyId,
        order_id: order.razorpay.orderId,
        amount: order.razorpay.amount,
        currency: order.razorpay.currency,
        name: order.razorpay.name,
        description: `Order #${order.orderNumber}`,
        // So Razorpay's payment (and its webhook) carries our order too
        notes: { wama_order_number: order.orderNumber },
        prefill: { name: order.razorpay.customer?.name, contact: order.razorpay.customer?.contact },
        theme: { color: store.colour },
        handler: async (response: any) => {
          try {
            const data = await confirmPayment(order.orderNumber, order.razorpay.orderId, { paymentId: response.razorpay_payment_id, signature: response.razorpay_signature })
            if (data.paid) {
              setUnpaid(null)
              setDone({ orderNumber: order.orderNumber, total: order.total, paid: true })
              setPanel('done')
            } else setError('Your payment is being checked. If money was taken, the shop will see it shortly.')
          } catch (err: any) {
            setError(err.message)
          }
          resolve()
        },
        modal: { ondismiss: () => resolve() },
      })
      checkout.on('payment.failed', (response: any) => setError(response?.error?.description ? `Payment failed: ${response.error.description}` : 'The payment did not go through.'))
      checkout.open()
    })
  }

  async function place(event: React.FormEvent) {
    event.preventDefault()
    setPlacing(true)
    setError('')
    try {
      const res = await fetch(`/api/public/store/${store.slug}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...shopper.headers() },
        body: JSON.stringify({ name, phone, handover, pay, code, address: handover === 'delivery' ? address : null, note, items: lines.map((l) => ({ productId: l.product.id, ...(l.variant ? { variantId: l.variant.id } : {}), quantity: l.qty })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The order could not be placed. Please try again.')
      setCart({})
      if (shopper.session) shopper.refresh()
      if (data.razorpay) {
        const order = { orderNumber: data.orderNumber, total: data.total, razorpay: data.razorpay }
        setUnpaid(order)
        await payOnline(order)
      } else {
        setDone({ orderNumber: data.orderNumber, total: data.total, paid: false })
        setPanel('done')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPlacing(false)
    }
  }

  async function payLaterInstead() {
    if (!unpaid) return
    setPlacing(true)
    try {
      await confirmPayment(unpaid.orderNumber, unpaid.razorpay.orderId, { action: 'later' })
      setDone({ orderNumber: unpaid.orderNumber, total: unpaid.total, paid: false })
      setUnpaid(null)
      setPanel('done')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPlacing(false)
    }
  }

  const waLink = (text: string) => `https://wa.me/${store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
  const cartText = () => [`Hi ${store.name}, I would like to order:`, ...lines.map((l) => `• ${l.qty} × ${l.title} (${money(l.price * l.qty)})`), `Total: ${money(subtotal)}`].join('\n')

  /** One product in a grid: picture and name open its page; Add / amount right on the card. */
  const card = (p: Product) => (
    <article key={p.id} className="bg-white rounded-2xl border border-[#e3e8f2] overflow-hidden flex flex-col">
      <a href={productHref(p.id)} className="block text-left">
        <div className="relative aspect-square">
          <Picture src={p.image} alt={p.title} className={`h-full w-full ${p.inStock ? '' : 'opacity-50 grayscale'}`} />
          {!p.inStock && <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#0E1B3D]/85 text-white text-[11.5px] font-bold">Out of stock</span>}
        </div>
        <div className="px-3 pt-2.5">
          <h3 className="text-[14.5px] font-semibold leading-snug line-clamp-2 min-h-[2.6em]">{p.title}</h3>
          <p className="mt-1 text-[16px] font-extrabold">{p.variants?.length && p.priceFrom !== undefined && p.variants.some((v) => v.price !== p.priceFrom) ? <><span className="text-[12.5px] font-semibold text-[#6B7894]">from </span>{money(p.priceFrom)}</> : money(p.variants?.length ? p.priceFrom ?? p.price : p.price)}</p>
        </div>
      </a>
      <div className="p-3 mt-auto">
        {!p.inStock ? (
          <span className="block h-10 leading-10 text-center text-[13.5px] text-[#8a94a8] font-semibold">Not available now</span>
        ) : p.variants?.length ? (
          <a href={productHref(p.id)} className="block w-full h-10 leading-[36px] text-center rounded-full border-2 border-[var(--c)] text-[var(--c)] text-[14px] font-bold hover:bg-[var(--c)] hover:text-white transition-colors">Choose</a>
        ) : cart[p.id] ? (
          <div className="flex justify-center"><Stepper small value={cart[p.id]} onChange={(n) => setQty(p.id, n)} /></div>
        ) : (
          <button type="button" onClick={() => setQty(p.id, 1)} className="w-full h-10 rounded-full border-2 border-[var(--c)] text-[var(--c)] text-[14px] font-bold cursor-pointer hover:bg-[var(--c)] hover:text-white transition-colors">Add</button>
        )}
      </div>
    </article>
  )

  const related = viewing ? store.products.filter((p) => p.category === viewing.category && p.id !== viewing.id).slice(0, 8) : []
  // A product page starts with the amount already in the cart
  // Size / colour picked on the product page
  const [picked, setPicked] = useState<Record<string, string>>({})
  useEffect(() => {
    // One choice per option is picked for you when there is only one
    const start: Record<string, string> = {}
    for (const o of viewing?.options || []) if (o.values.length === 1) start[o.name] = o.values[0]
    setPicked(start)
  }, [viewing?.id])
  const chosen = viewing?.variants?.length ? findVariant(viewing.variants, picked, viewing.options || []) : null
  const needsChoice = Boolean(viewing?.variants?.length) && !chosen
  const viewKey = viewing ? (chosen ? `${viewing.id}:${chosen.id}` : viewing.id) : ''
  const viewPrice = chosen ? chosen.price : viewing ? (viewing.variants?.length ? viewing.priceFrom ?? viewing.price : viewing.price) : 0
  const viewInStock = chosen ? chosen.inStock : Boolean(viewing?.inStock)
  const viewImage = chosen?.image || viewing?.image || ''
  useEffect(() => {
    if (viewKey && cart[viewKey]) setOpenQty(cart[viewKey])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, Boolean(viewKey && cart[viewKey])])

  const share = async () => {
    if (!viewing) return
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: viewing.title, text: `${viewing.title} · ${money(viewPrice)}`, url })
      else {
        await navigator.clipboard.writeText(url)
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      }
    } catch {}
  }

  return (
    <div style={{ ['--c' as any]: store.colour }} className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]">
      {store.announcement && <div className="bg-[var(--c)] text-white text-center text-[13.5px] font-semibold px-4 py-2">{store.announcement}</div>}

      <header className="sticky top-0 z-30 bg-white border-b border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          {store.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logo} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
          ) : (
            <span className="h-10 w-10 shrink-0 rounded-full bg-[var(--c)] text-white flex items-center justify-center font-bold">{store.name.slice(0, 1).toUpperCase()}</span>
          )}
          <p className="font-extrabold text-[17px] truncate min-w-0 flex-1 sm:flex-none">{store.name}</p>
          <div className="relative hidden sm:block flex-1 max-w-md mx-auto">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" className="w-full h-10 pl-10 pr-4 rounded-full bg-[#f4f6fa] text-[14.5px] focus:outline-none focus:ring-2 focus:ring-[var(--c)]/30" />
          </div>
          {store.accounts && (
            <button type="button" onClick={() => setAccountView('orders')} aria-label={shopper.session ? 'My orders' : 'Sign in'} className="h-11 shrink-0 rounded-full border border-[#d5ddeb] bg-white px-3 sm:px-4 inline-flex items-center gap-2 font-bold text-[14px] text-[#0E1B3D] cursor-pointer hover:border-[var(--c)]">
              {shopper.account?.shopper.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shopper.account.shopper.picture} alt="" className="h-7 w-7 -ml-1 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserRound size={18} />
              )}
              <span className="hidden sm:inline">{shopper.session ? 'My orders' : 'Sign in'}</span>
            </button>
          )}
          <button type="button" onClick={() => setPanel('cart')} aria-label={`Cart, ${count} items`} className="relative h-11 px-4 rounded-full bg-[var(--c)] text-white font-bold text-[14.5px] inline-flex items-center gap-2 shrink-0 cursor-pointer">
            <ShoppingBag size={18} />
            <span className="hidden sm:inline">Cart</span>
            {count > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-white text-[var(--c)] text-[12px] font-extrabold flex items-center justify-center">{count}</span>}
          </button>
        </div>
        <div className="sm:hidden px-4 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" className="w-full h-10 pl-10 pr-4 rounded-full bg-[#f4f6fa] text-[14.5px] focus:outline-none focus:ring-2 focus:ring-[var(--c)]/30" />
          </div>
        </div>
      </header>

      {!viewing && <Banners store={store} onCategory={pickCategory} />}

      {!viewing && store.categories.length > 1 && (
        <section className="max-w-6xl mx-auto px-4 pt-6">
          <h2 className="text-[19px] font-extrabold mb-3">Shop by category</h2>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
            {store.categories.map((c) => (
              <button key={c.name} type="button" onClick={() => pickCategory(category === c.name ? null : c.name)} className="shrink-0 w-[84px] sm:w-[104px] text-center cursor-pointer">
                <span className={`block mx-auto h-[72px] w-[72px] sm:h-[92px] sm:w-[92px] rounded-full overflow-hidden ring-2 ${category === c.name ? 'ring-[var(--c)]' : 'ring-transparent'}`}>
                  <Picture src={c.image} alt="" className="h-full w-full" />
                </span>
                <span className={`block mt-1.5 text-[13px] leading-tight line-clamp-2 ${category === c.name ? 'font-bold text-[var(--c)]' : 'font-semibold'}`}>{c.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(!viewing || query) && (
        <section ref={productsRef} className="max-w-6xl mx-auto px-4 pt-6 pb-28 scroll-mt-28">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <h2 className="text-[19px] font-extrabold mr-auto">{category || (query ? 'Search results' : 'All products')}</h2>
            {(category || query) && (
              <button type="button" onClick={() => pickCategory(null)} className="h-9 px-4 rounded-full border border-[#d5ddeb] bg-white text-[13.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                <X size={14} /> Show all
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="py-16 text-center text-[#6B7894]">{store.products.length ? 'Nothing matches. Try another word.' : 'Products are coming soon.'}</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {shown.map(card)}
            </div>
          )}
        </section>
      )}

      {/* One product's own page */}
      {viewing && !query && (
        <section className="max-w-6xl mx-auto px-4 pt-4 pb-28">
          <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-[#6B7894] mb-3">
            <a href={homeHref} className="inline-flex items-center gap-1 font-semibold hover:text-[var(--c)]"><ArrowLeft size={15} /> All products</a>
            <span aria-hidden="true">/</span>
            <a href={categoryHref(viewing.category)} className="font-semibold hover:text-[var(--c)]">{viewing.category}</a>
          </nav>
          <div className="bg-white rounded-2xl border border-[#e3e8f2] p-3 sm:p-6 grid md:grid-cols-2 gap-5 md:gap-10">
            <div className="relative">
              <Gallery key={viewing.id + (chosen?.id || '')} main={viewImage} images={viewing.images || []} video={viewing.video || null} title={viewing.title} dim={!viewInStock} />
            </div>
            <div className="flex flex-col min-w-0">
              <a href={categoryHref(viewing.category)} className="text-[12.5px] font-bold text-[#6B7894] uppercase tracking-wide hover:text-[var(--c)]">{viewing.category}</a>
              <h1 className="mt-1 text-[24px] sm:text-[30px] font-extrabold leading-tight break-words">{viewing.title}</h1>
              <p className="mt-2 text-[26px] font-extrabold text-[var(--c)]">{needsChoice && viewing.variants!.some((v) => v.price !== viewPrice) ? <span className="text-[15px] font-semibold text-[#6B7894]">from </span> : null}{money(viewPrice)}</p>
              <p className={`mt-2 inline-flex w-fit items-center gap-1.5 h-7 px-3 rounded-full text-[13px] font-bold ${viewInStock ? 'bg-[#eef1f6] text-[#0E1B3D]' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
                {viewInStock ? <><Check size={14} /> In stock</> : chosen ? `${chosen.name} is out of stock` : 'Out of stock right now'}
              </p>

              {(viewing.options || []).length > 0 && viewing.variants?.length ? (
                <div className="mt-5 space-y-4">
                  {viewing.options!.map((o) => (
                    <fieldset key={o.name}>
                      <legend className="text-[14px] font-semibold text-[#4a5672] mb-2">{o.name}{picked[o.name] ? <span className="text-[#0E1B3D]">: {picked[o.name]}</span> : null}</legend>
                      <div className="flex flex-wrap gap-2">
                        {o.values.map((value) => {
                          const on = picked[o.name] === value
                          const can = valueAvailable(viewing.variants!, viewing.options!, picked, o.name, value)
                          return (
                            <button key={value} type="button" aria-pressed={on} onClick={() => setPicked({ ...picked, [o.name]: value })}
                              className={`min-w-11 h-10 px-3.5 rounded-full border-2 text-[14px] font-semibold cursor-pointer ${on ? 'border-[var(--c)] bg-[var(--c)] text-white' : can ? 'border-[#d5ddeb] bg-white text-[#0E1B3D] hover:border-[var(--c)]' : 'border-[#e3e8f2] bg-[#f4f6fa] text-[#8a94a8] line-through'}`}>
                              {value}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>
              ) : null}

              {viewInStock && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-semibold text-[#4a5672]">Quantity</span>
                    <Stepper value={openQty} onChange={(n) => setOpenQty(Math.max(1, Math.min(99, n)))} />
                  </div>
                  <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
                    <button type="button" disabled={needsChoice} onClick={() => setQty(viewKey, openQty)} className="h-12 rounded-full border-2 border-[var(--c)] text-[var(--c)] font-bold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--c)]/5 disabled:opacity-50 disabled:cursor-not-allowed">
                      <ShoppingBag size={17} /> {cart[viewKey] ? 'Update cart' : 'Add to cart'}
                    </button>
                    <button type="button" disabled={needsChoice} onClick={() => { setQty(viewKey, openQty); setPanel('cart') }} className="h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                      Buy now · {money(viewPrice * openQty)}
                    </button>
                  </div>
                  {needsChoice && <p className="text-[13.5px] text-[#4a5672]">Choose {viewing.options!.filter((o) => !picked[o.name]).map((o) => o.name.toLowerCase()).join(' and ')} first.</p>}
                  {cart[viewKey] > 0 && (
                    <p className="text-[13.5px] text-[#4a5672]">
                      {cart[viewKey]} in your cart · <button type="button" onClick={() => setPanel('cart')} className="font-bold text-[var(--c)] underline cursor-pointer">View cart</button>
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {store.whatsapp && (
                  <a href={waLink(`Hi ${store.name}, I have a question about ${viewing.title}${chosen ? ` (${chosen.name})` : ''} (${money(viewPrice)}): ${typeof window !== 'undefined' ? window.location.href : ''}`)} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-full border border-[#d5ddeb] bg-white text-[13.5px] font-semibold inline-flex items-center gap-2">
                    <MessageCircle size={16} className="text-[#25D366]" /> Ask on WhatsApp
                  </a>
                )}
                <button type="button" onClick={share} className="h-10 px-4 rounded-full border border-[#d5ddeb] bg-white text-[13.5px] font-semibold inline-flex items-center gap-2 cursor-pointer">
                  {shared ? <Check size={16} className="text-[var(--c)]" /> : <Share2 size={16} />} {shared ? 'Link copied' : 'Share'}
                </button>
              </div>

              <ul className="mt-5 rounded-xl bg-[#f4f6fa] p-4 space-y-2 text-[14px] text-[#4a5672]">
                {store.delivery && (
                  <li className="flex gap-2"><Truck size={17} className="shrink-0 mt-px text-[var(--c)]" />
                    <span>Home delivery{store.deliveryFee ? ` · ${money(store.deliveryFee)}` : ' · free'}{store.deliveryFee && store.freeFrom ? `, free above ${money(store.freeFrom)}` : ''}</span>
                  </li>
                )}
                {store.pinCheck && <li><PinCheck slug={store.slug} charge={store.deliveryFee ? `Delivery ${money(store.deliveryFee)}${store.freeFrom ? `, free above ${money(store.freeFrom)}` : ''}.` : 'Free delivery.'} /></li>}
                {store.pickup && <li className="flex gap-2"><Store size={17} className="shrink-0 mt-px text-[var(--c)]" /><span>Pick up from the shop{store.address ? ` · ${store.address.split('\n')[0]}` : ''}</span></li>}
                <li className="flex gap-2"><ShieldCheck size={17} className="shrink-0 mt-px text-[var(--c)]" />
                  <span>{store.payOnline && store.payLater ? 'Pay online, or cash when you get it' : store.payOnline ? 'Pay online by UPI, card or net banking' : 'Pay cash when you get it'}</span>
                </li>
              </ul>

              {viewing.description && (
                <div className="mt-5">
                  <h2 className="text-[16px] font-extrabold">About this product</h2>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[#4a5672] whitespace-pre-line break-words">{viewing.description}</p>
                </div>
              )}
            </div>
          </div>

          {related.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-[19px] font-extrabold mr-auto">More in {viewing.category}</h2>
                <a href={categoryHref(viewing.category)} className="text-[14px] font-bold text-[var(--c)]">See all</a>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">{related.map(card)}</div>
            </div>
          )}
        </section>
      )}

      <footer className="bg-white border-t border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 py-8 grid gap-6 sm:grid-cols-2 text-[14.5px]">
          <div>
            <p className="font-extrabold text-[17px]">{store.name}</p>
            {store.about && <p className="mt-2 text-[#4a5672] whitespace-pre-line">{store.about}</p>}
          </div>
          <div className="space-y-2 text-[#4a5672]">
            {store.address && <p className="flex gap-2"><MapPin size={17} className="shrink-0 mt-0.5 text-[var(--c)]" /> <span className="whitespace-pre-line">{store.address}</span></p>}
            {store.phone && <a href={`tel:${store.phone}`} className="flex gap-2 font-semibold text-[#0E1B3D]"><Phone size={17} className="text-[var(--c)]" /> {showPhone(store.phone)}</a>}
            {store.whatsapp && <a href={waLink(`Hi ${store.name}`)} target="_blank" rel="noreferrer" className="inline-flex h-10 px-4 rounded-full bg-[#25D366] text-white font-bold items-center gap-2">Chat on WhatsApp</a>}
          </div>
        </div>
        <p className="pb-2 text-center">
          <button type="button" onClick={() => setAccountView(shopper.session ? 'orders' : 'track')} className="text-[14px] font-semibold text-[#4a5672] underline cursor-pointer">{shopper.session ? 'My orders' : 'Track your order'}</button>
        </p>
        <p className="pb-6 text-center text-[12.5px] text-[#8a94a8]">Online store by WAMA CRM</p>
      </footer>

      {/* Cart button on phones while shopping */}
      {count > 0 && !panel && !accountView && (
        <button type="button" onClick={() => setPanel('cart')} className="sm:hidden fixed bottom-4 left-4 right-4 z-30 h-14 rounded-2xl bg-[var(--c)] text-white shadow-xl px-5 flex items-center justify-between font-bold cursor-pointer">
          <span>{count} item{count === 1 ? '' : 's'} · {money(subtotal)}</span>
          <span className="inline-flex items-center gap-1">View cart <ChevronRight size={18} /></span>
        </button>
      )}

      {/* Cart, checkout, done */}
      {panel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Your cart" onClick={() => panel !== 'done' && setPanel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-md h-full flex flex-col">
            <div className="h-16 px-4 flex items-center gap-2 border-b border-[#e3e8f2] shrink-0">
              {panel === 'checkout' && <button type="button" aria-label="Back to cart" onClick={() => setPanel('cart')} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><ArrowLeft size={19} /></button>}
              <p className="font-extrabold text-[18px] flex-1">{panel === 'cart' ? 'Your cart' : panel === 'checkout' ? 'Your details' : 'Order placed'}</p>
              <button type="button" aria-label="Close" onClick={() => setPanel(null)} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><X size={19} /></button>
            </div>

            {panel === 'cart' && (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {lines.length === 0 && <p className="py-16 text-center text-[#6B7894]">Your cart is empty.</p>}
                  {lines.map(({ key, product, variant, image, price, qty }) => (
                    <div key={key} className="flex gap-3 items-center">
                      <Picture src={image} alt="" className="h-16 w-16 rounded-xl shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14.5px] font-semibold leading-snug line-clamp-2">{product.title}</p>
                        {variant && <p className="text-[13px] text-[#6B7894]">{variant.name}</p>}
                        <p className="text-[14px] font-bold mt-0.5">{money(price * qty)}</p>
                      </div>
                      <Stepper small value={qty} onChange={(n) => setQty(key, n)} />
                    </div>
                  ))}
                </div>
                {lines.length > 0 && (
                  <div className="p-4 border-t border-[#e3e8f2] space-y-3 shrink-0">
                    {offOk && <p className="text-[13.5px] font-semibold text-[var(--c)]">Offer: {offer!.title}{discountOff > 0 ? ` · you save ${money(discountOff)}` : ''}</p>}
                    {!offOk && store.offers.length > 0 && <p className="text-[13px] text-[#4a5672]">Offers: {store.offers.map((o) => o.title).join(' · ')}</p>}
                    <div className="flex justify-between text-[16px] font-extrabold"><span>Total</span><span>{money(subtotal)}</span></div>
                    {short && <p className="text-[13.5px] text-[#b91c1c] font-semibold">The smallest order here is {money(store.minOrder)}. Add {money(store.minOrder - subtotal)} more.</p>}
                    <button type="button" disabled={short} onClick={() => setPanel('checkout')} className="w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] disabled:opacity-50 cursor-pointer">Continue</button>
                    {store.whatsapp && <a href={waLink(cartText())} target="_blank" rel="noreferrer" className="block text-center text-[14px] font-semibold text-[#4a5672] underline">Or send this cart on WhatsApp</a>}
                  </div>
                )}
              </>
            )}

            {panel === 'checkout' && unpaid && (
              <div className="flex-1 overflow-y-auto p-6 text-center">
                <span className="mx-auto h-16 w-16 rounded-full bg-[#fdf0f0] text-[#b91c1c] flex items-center justify-center"><CreditCard size={28} /></span>
                <p className="mt-4 text-[20px] font-extrabold">Payment not finished</p>
                <p className="mt-1 text-[15px] text-[#4a5672]">Your order <b>#{unpaid.orderNumber}</b> is saved and waits for payment of {money(unpaid.total)}.</p>
                {error && <p role="alert" className="mt-3 rounded-xl bg-[#fdf0f0] p-3 text-[14px] text-[#b91c1c] font-semibold">{error}</p>}
                <button type="button" disabled={placing} onClick={() => payOnline(unpaid).catch((err) => setError(err.message))} className="mt-6 w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] cursor-pointer disabled:opacity-60">Try paying again</button>
                {store.payLater && (
                  <button type="button" disabled={placing} onClick={payLaterInstead} className="mt-3 w-full h-12 rounded-full border-2 border-[#d5ddeb] font-bold text-[15px] cursor-pointer disabled:opacity-60">
                    {placing && <Loader2 size={16} className="inline animate-spin mr-1" />} {handover === 'delivery' ? 'Cash on delivery instead' : 'Cash at pick up instead'}
                  </button>
                )}
              </div>
            )}

            {panel === 'checkout' && !unpaid && (
              <form onSubmit={place} className="flex-1 overflow-y-auto p-4 space-y-4">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" required maxLength={120} className={input} />
                <PhoneField value={phone} onChange={setPhone} inputClassName={input} placeholder="Mobile number" />
                {store.pickup && store.delivery && (
                  <div className="grid grid-cols-2 gap-2">
                    {([['pickup', 'Pick up', Store], ['delivery', 'Delivery', Truck]] as const).map(([id, label, Icon]) => (
                      <button key={id} type="button" onClick={() => setHandover(id)} className={`h-12 rounded-xl border-2 font-bold text-[14.5px] inline-flex items-center justify-center gap-2 cursor-pointer ${handover === id ? 'border-[var(--c)] text-[var(--c)] bg-[var(--c)]/5' : 'border-[#d5ddeb] text-[#4a5672]'}`}>
                        <Icon size={17} /> {label}
                      </button>
                    ))}
                  </div>
                )}
                {handover === 'delivery' ? (
                  <div className="space-y-3">
                    <input value={address.address_line_1} onChange={(e) => setAddress({ ...address, address_line_1: e.target.value })} placeholder="House, street" aria-label="House, street" required className={input} />
                    <input value={address.address_line_2} onChange={(e) => setAddress({ ...address, address_line_2: e.target.value })} placeholder="Area, landmark (optional)" aria-label="Area" className={input} />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} placeholder="City" aria-label="City" required className={input} />
                      <input value={address.pincode} onChange={(e) => setAddress({ ...address, pincode: e.target.value })} placeholder="PIN code" aria-label="PIN code" inputMode="numeric" className={input} />
                    </div>
                  </div>
                ) : (
                  store.address && <p className="text-[14px] text-[#4a5672] flex gap-2"><MapPin size={17} className="shrink-0 mt-0.5 text-[var(--c)]" /> Pick up from: {store.address}</p>
                )}
                {store.deliveryNote && handover === 'delivery' && <p className="text-[13.5px] text-[#4a5672] bg-[#f4f6fa] rounded-xl p-3 whitespace-pre-line">{store.deliveryNote}</p>}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know? (optional)" aria-label="Note" rows={2} maxLength={500} className={`${input} h-auto py-3`} />
                {store.payOnline && store.payLater && (
                  <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
                    {([['online', 'Pay now', CreditCard], ['later', handover === 'delivery' ? 'Cash on delivery' : 'Cash at pick up', Banknote]] as const).map(([id, label, Icon]) => (
                      <button key={id} type="button" onClick={() => setPay(id)} className={`h-12 px-2 rounded-xl border-2 font-bold text-[14px] leading-tight inline-flex items-center justify-center gap-2 cursor-pointer ${pay === id ? 'border-[var(--c)] text-[var(--c)] bg-[var(--c)]/5' : 'border-[#d5ddeb] text-[#4a5672]'}`}>
                        <Icon size={17} /> {label}
                      </button>
                    ))}
                  </div>
                )}
                {store.hasCodes && (
                  <div>
                    <div className="flex gap-2">
                      <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="Have a code?" aria-label="Discount code" maxLength={20} className={`${input} uppercase`} />
                      {code ? (
                        <button type="button" onClick={() => { setCode(''); setCodeInput('') }} className="h-12 px-4 rounded-xl border-2 border-[#d5ddeb] font-bold text-[14px] cursor-pointer shrink-0">Remove</button>
                      ) : (
                        <button type="button" disabled={codeInput.length < 3} onClick={() => setCode(codeInput)} className="h-12 px-4 rounded-xl bg-[var(--c)] text-white font-bold text-[14px] cursor-pointer disabled:opacity-50 shrink-0">Apply</button>
                      )}
                    </div>
                    {code && offer && !offer.ok && offer.reason && <p role="status" className="mt-1.5 text-[13.5px] text-[#b91c1c]">{offer.reason}</p>}
                  </div>
                )}
                <div className="rounded-xl bg-[#f4f6fa] p-4 space-y-1.5 text-[14.5px]">
                  <div className="flex justify-between"><span>Items</span><span>{money(subtotal)}</span></div>
                  {offOk && discountOff > 0 && <div className="flex justify-between text-[var(--c)] font-semibold"><span>{offer!.title}</span><span>− {money(discountOff)}</span></div>}
                  {handover === 'delivery' && <div className="flex justify-between"><span>Delivery</span><span>{deliveryToPay ? money(deliveryToPay) : offOk && offer!.freeDelivery && delivery ? <><s className="text-[#8a94a8] mr-1">{money(delivery)}</s>Free</> : 'Free'}</span></div>}
                  <div className="flex justify-between font-extrabold text-[17px] pt-1"><span>To pay</span><span>{money(toPay)}</span></div>
                  {pay === 'online' ? (
                    <p className="text-[13px] text-[#6B7894] flex gap-1.5"><ShieldCheck size={15} className="shrink-0 mt-px text-[var(--c)]" /> Pay securely by UPI, card or net banking with Razorpay.</p>
                  ) : (
                    <p className="text-[13px] text-[#6B7894]">Pay cash when you {handover === 'delivery' ? 'get your order' : 'pick it up'}. The shop will confirm your order.</p>
                  )}
                </div>
                {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] p-3 text-[14px] text-[#b91c1c] font-semibold">{error}</p>}
                <button type="submit" disabled={placing} className="w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer">
                  {placing && <Loader2 size={17} className="animate-spin" />} {pay === 'online' ? `Pay ${money(toPay)}` : 'Place order'}
                </button>
              </form>
            )}

            {panel === 'done' && done && (
              <div className="flex-1 overflow-y-auto p-6 text-center">
                <span className="mx-auto h-16 w-16 rounded-full bg-[var(--c)] text-white flex items-center justify-center"><Check size={32} /></span>
                <p className="mt-4 text-[22px] font-extrabold">Thank you, {name.split(' ')[0]}!</p>
                <p className="mt-1 text-[15px] text-[#4a5672]">
                  {done.paid
                    ? <>Your payment of {money(done.total)} is received. Order <b>#{done.orderNumber}</b> is confirmed with {store.name}.</>
                    : <>Your order <b>#{done.orderNumber}</b> for {money(done.total)} is with {store.name}. They will contact you to confirm it.</>}
                </p>
                {store.whatsapp && (
                  <a href={waLink(`Hi ${store.name}, I just placed order #${done.orderNumber} on your website.`)} target="_blank" rel="noreferrer" className="mt-6 inline-flex h-12 px-6 rounded-full bg-[#25D366] text-white font-bold items-center">Message the shop on WhatsApp</a>
                )}
                <button type="button" onClick={() => { setPanel(null); setAccountView(shopper.session ? 'orders' : 'track') }} className="mt-3 w-full h-12 rounded-full border-2 border-[#d5ddeb] font-bold text-[15px] cursor-pointer">
                  {shopper.session ? 'See it in My orders' : 'Track this order'}
                </button>
                {!shopper.session && store.accounts && <p className="mt-2 text-[13px] text-[#6B7894]">Keep your order number <b>#{done.orderNumber}</b>, or sign in next time to see all your orders.</p>}
                <button type="button" onClick={() => setPanel(null)} className="mt-3 block mx-auto text-[14.5px] font-semibold text-[#4a5672] underline cursor-pointer">Continue shopping</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sign in, My orders, Track an order */}
      {accountView && <AccountPanel slug={store.slug} shopper={shopper} money={money} storeName={store.name} initialView={accountView} onClose={() => setAccountView(null)} />}
    </div>
  )
}

/** "Check delivery to your PIN code": asks the store's own courier partners (Shiprocket / Delhivery). */
function PinCheck({ slug, charge }: { slug: string; charge: string }) {
  const [pin, setPin] = useState('')
  const [state, setState] = useState<{ busy?: boolean; text?: string; ok?: boolean } | null>(null)
  async function check(e: React.FormEvent) {
    e.preventDefault()
    if (!/^[1-9]\d{5}$/.test(pin)) { setState({ text: 'Type a 6-digit PIN code.', ok: false }); return }
    setState({ busy: true })
    try {
      const res = await fetch(`/api/public/store/${slug}/delivery-check?pin=${pin}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setState({ text: data.error || 'Could not check right now.', ok: false })
      else if (!data.checked) setState({ text: 'Could not check right now. Order and the shop will confirm.', ok: true })
      else if (!data.served) setState({ text: `Sorry, we do not deliver to ${pin} yet.`, ok: false })
      else setState({ text: `We deliver to ${pin}${data.days ? ` in about ${data.days} day${data.days === 1 ? '' : 's'}` : ''}. ${charge}${data.cod ? ' Cash on delivery available.' : ''}`, ok: true })
    } catch {
      setState({ text: 'Could not check right now.', ok: false })
    }
  }
  return (
    <form onSubmit={check} className="flex flex-col gap-1.5">
      <label htmlFor="pin-check" className="flex gap-2 items-center"><MapPin size={17} className="shrink-0 text-[var(--c)]" /><span>Check delivery to your PIN code</span></label>
      <div className="flex gap-2 pl-[25px]">
        <input id="pin-check" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="PIN code" className="min-w-0 flex-1 h-9 px-3 rounded-lg border border-[#d5ddeb] bg-white text-[14px] text-[#0E1B3D]" />
        <button type="submit" disabled={state?.busy} className="h-9 px-4 rounded-lg bg-[var(--c)] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60">
          {state?.busy ? <Loader2 size={14} className="animate-spin" /> : null} Check
        </button>
      </div>
      {state?.text && <p role="status" className={`pl-[25px] text-[13px] ${state.ok ? 'text-[#0E1B3D]' : 'text-[#b91c1c]'}`}>{state.text}</p>}
    </form>
  )
}

/** A cart key ("product id" or "product id:option id") as the line it stands for, or null if it is gone. */
function lineFor(products: StoreView['products'], key: string) {
  const [productId, variantId] = key.split(':')
  const product = products.find((p) => p.id === productId)
  if (!product) return null
  if (product.variants?.length) {
    const variant = product.variants.find((v) => v.id === variantId)
    if (!variant) return null
    return { product, variant, title: `${product.title} · ${variant.name}`, price: variant.price, image: variant.image || product.image, inStock: variant.inStock }
  }
  if (variantId) return null
  return { product, variant: null, title: product.title, price: product.price, image: product.image, inStock: product.inStock }
}

/** The product's photos (main first) and its video: a big view and a row of small ones to switch. */
function Gallery({ main, images, video, title, dim }: { main: string; images: string[]; video: StoreView['products'][number]['video']; title: string; dim: boolean }) {
  const photos = [main, ...images.filter((u) => u && u !== main)].filter(Boolean)
  const [shown, setShown] = useState<number | 'video'>(0)
  const many = photos.length + (video ? 1 : 0) > 1
  return (
    <div>
      {shown === 'video' && video ? (
        video.kind === 'youtube' ? (
          <iframe src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0`} title={`${title} video`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="w-full aspect-square rounded-xl bg-black" />
        ) : (
          <video src={video.src} controls playsInline className="w-full aspect-square rounded-xl bg-black object-contain" />
        )
      ) : (
        <Picture src={photos[typeof shown === 'number' ? shown : 0] || ''} alt={title} className={`w-full aspect-square rounded-xl ${dim ? 'opacity-60 grayscale' : ''}`} />
      )}
      {many && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="More photos">
          {photos.map((url, i) => (
            <button key={url + i} type="button" role="listitem" aria-label={`Photo ${i + 1}`} aria-pressed={shown === i} onClick={() => setShown(i)} className={`h-16 w-16 shrink-0 rounded-lg overflow-hidden border-2 cursor-pointer ${shown === i ? 'border-[var(--c)]' : 'border-transparent'}`}>
              <Picture src={url} alt="" className="h-full w-full" />
            </button>
          ))}
          {video && (
            <button type="button" role="listitem" aria-label="Play the video" aria-pressed={shown === 'video'} onClick={() => setShown('video')} className={`h-16 w-16 shrink-0 rounded-lg border-2 bg-[#0E1B3D] text-white flex items-center justify-center cursor-pointer ${shown === 'video' ? 'border-[var(--c)]' : 'border-transparent'}`}>
              <Play size={22} fill="currentColor" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
