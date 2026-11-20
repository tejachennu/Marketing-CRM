'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpDown, Banknote, Check, ChevronLeft, ChevronRight, CreditCard, Heart, Home, LayoutGrid, Loader2, MapPin, Phone, Play, MessageCircle, RotateCcw, Share2, ShieldCheck, ShoppingBag, ShoppingCart, SlidersHorizontal, Star, Store, Truck, UserRound, X, Zap } from 'lucide-react'
import { categoryRails, dealProducts, discountPercent, filterCount, filterProducts, searchProducts, sortProducts, SORT_LABELS, topRated, type Filters, type SortKey } from '@/lib/commerce/store-browse'
import { FilterPanel, OffersList, Picture, PriceLine, ProductCard, Rail, RatingChip, SearchBox, Sheet, SortTabs, Stepper, TrustStrip } from './store-parts'
import { PhoneField } from '@/components/phone-field'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { showPhone } from '@/lib/phone-display'
import { AccountPanel, useShopper } from './account'
import { StoreChat } from './store-chat'
import type { StoreView } from '@/lib/commerce/storefront'
import { loyaltyLine, pointsUsable } from '@/lib/commerce/loyalty'
import { findVariant, valueAvailable } from '@/lib/commerce/variants'
import { STORE_PAGE_TITLES } from '@/lib/commerce/store-pages'
import { ratingSummary, type PublicReview } from '@/lib/commerce/reviews'

type Product = StoreView['products'][number]

/** An online payment started but not finished: Razorpay's order, or Stripe's page. */
interface UnpaidOrder { orderNumber: string; total: number; razorpay?: any; stripe?: { sessionId: string; url: string } }
const proofOf = (order: UnpaidOrder) => (order.stripe ? { sessionId: order.stripe.sessionId } : { razorpayOrderId: order.razorpay?.orderId })

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
      <section className="bg-[#0E1B3D] text-white sm:rounded-lg overflow-hidden">
        <div className="px-5 sm:px-10 py-9 sm:py-14 border-l-8 border-[var(--c)]">
          <p className="text-[12px] sm:text-[13px] font-bold uppercase tracking-widest text-white/60">Welcome to</p>
          <h1 className="mt-1 text-[28px] sm:text-[42px] font-extrabold tracking-tight leading-tight">{store.name}</h1>
          {store.tagline && <p className="mt-2 text-[15px] sm:text-[18px] text-white/80 max-w-xl">{store.tagline}</p>}
        </div>
      </section>
    )
  }
  return (
    <section aria-label="Offers">
      <div className="relative sm:rounded-lg overflow-hidden bg-white">
        <div
          ref={strip}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
          className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        >
          {store.banners.map((banner, i) => {
            const open = () => (banner.category ? onCategory(banner.category) : banner.link ? window.open(banner.link, '_blank', 'noopener') : null)
            return (
              <button key={i} type="button" onClick={open} className="relative shrink-0 w-full snap-start aspect-[2/1] sm:aspect-[16/5] text-left cursor-pointer">
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

export function Storefront({ store, startCategory, appUrl = '', basePath = '', productId = null, reviews = [] }: { store: StoreView; startCategory: string | null; appUrl?: string; basePath?: string; productId?: string | null; reviews?: PublicReview[] }) {
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

  // Shop reports: one visit per browser tab, and each product page opened (counts only)
  useEffect(() => {
    try {
      const key = `store-visit:${store.slug}`
      const product = Boolean(productId)
      if (!product && sessionStorage.getItem(key)) return
      if (!product) sessionStorage.setItem(key, '1')
      fetch(`/api/public/store/${store.slug}/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(product ? { product: true } : {}), keepalive: true }).catch(() => {})
    } catch {}
  }, [store.slug, productId])

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
  const [unpaid, setUnpaid] = useState<UnpaidOrder | null>(null)
  const unpaidKey = `store-unpaid:${store.slug}`
  // An unfinished payment survives a reload: ask once whether it was paid after all, else offer it again
  useEffect(() => {
    let saved: UnpaidOrder | null = null
    try {
      saved = JSON.parse(localStorage.getItem(unpaidKey) || 'null')
    } catch {}
    // Back from Stripe's page (?paid= / ?unpaid=): tidy the address; the check below says whether it was paid
    const url = new URL(window.location.href)
    if (url.searchParams.has('paid') || url.searchParams.has('unpaid')) {
      for (const key of ['paid', 'unpaid', 'session']) url.searchParams.delete(key)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    if (!saved?.orderNumber || !(saved.razorpay?.orderId || saved.stripe?.sessionId)) return
    fetch(`/api/public/store/${store.slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: saved.orderNumber, ...proofOf(saved), action: 'check' }) })
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
  // The cart is kept with the phone at checkout, so the shop can send one reminder if no order comes
  useEffect(() => {
    if (panel !== 'checkout' || !lines.length || phone.replace(/\D/g, '').length < 10) return
    const timer = setTimeout(() => {
      fetch(`/api/public/store/${store.slug}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, name, cart }) }).catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, phone, JSON.stringify(cart)])
  // A reminder link (?cart=…) brings the same cart back
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('cart')
    if (!token) return
    fetch(`/api/public/store/${store.slug}/checkout?token=${encodeURIComponent(token)}`).then((r) => r.json()).then((data) => {
      if (data?.cart && Object.keys(data.cart).length) {
        setCart(data.cart)
        if (data.name) setName(data.name)
        if (data.phone) setPhone(data.phone)
        setPanel('cart')
      }
      const params = new URLSearchParams(window.location.search)
      params.delete('cart')
      history.replaceState(null, '', window.location.pathname + (params.toString() ? `?${params}` : ''))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const offOk = offer?.ok === true
  const discountOff = offOk ? Number(offer!.amount) || 0 : 0
  const deliveryToPay = offOk && offer!.freeDelivery ? 0 : delivery
  // Loyalty points: a signed-in shopper ordering with their own saved phone (the server checks again)
  const [usePointsOn, setUsePointsOn] = useState(true)
  const pointsBalanceNow = Number(shopper.account?.points) || 0
  const ownPhone = Boolean(shopper.account?.shopper.phone) && shopper.account!.shopper.phone.replace(/\D/g, '').slice(-10) === phone.replace(/\D/g, '').slice(-10)
  // Front Desk members: their plan discount when it is better than the offer (the server decides again)
  const memberInfo = ownPhone ? shopper.account?.member || null : null
  const memberOff = memberInfo ? Math.round(subtotal * memberInfo.percent) / 100 : 0
  const memberWins = memberOff > 0 && memberOff > discountOff + (offOk && offer!.freeDelivery ? delivery : 0)
  const offerOff = memberWins ? memberOff : discountOff
  const pointsCanUse = store.loyalty?.on && ownPhone ? pointsUsable(pointsBalanceNow, subtotal - offerOff, store.loyalty) : 0
  const pointsOff = usePointsOn ? pointsCanUse : 0
  const toPay = Math.max(0, Math.round((subtotal - offerOff - pointsOff + (memberWins ? delivery : deliveryToPay)) * 100) / 100)
  const short = store.minOrder > 0 && subtotal < store.minOrder

  const confirmPayment = async (order: UnpaidOrder, extra: Record<string, string>) => {
    const res = await fetch(`/api/public/store/${store.slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: order.orderNumber, ...proofOf(order), ...extra }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'The payment could not be confirmed.')
    return data
  }

  /** Open Razorpay for an order (resolves when its window closes, paid or not), or go to Stripe's page. */
  async function payOnline(order: UnpaidOrder) {
    setError('')
    if (order.stripe) {
      try { localStorage.setItem(unpaidKey, JSON.stringify(order)) } catch {}
      window.location.href = order.stripe.url
      return
    }
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
            const data = await confirmPayment(order, { paymentId: response.razorpay_payment_id, signature: response.razorpay_signature })
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
        body: JSON.stringify({ name, phone, handover, pay, code, usePoints: pointsOff > 0, address: handover === 'delivery' ? address : null, note, items: lines.map((l) => ({ productId: l.product.id, ...(l.variant ? { variantId: l.variant.id } : {}), quantity: l.qty })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The order could not be placed. Please try again.')
      setCart({})
      if (shopper.session) shopper.refresh()
      if (data.razorpay || data.stripe) {
        const order: UnpaidOrder = { orderNumber: data.orderNumber, total: data.total, ...(data.razorpay ? { razorpay: data.razorpay } : { stripe: data.stripe }) }
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
      await confirmPayment(unpaid, { action: 'later' })
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


  // ── Browsing: sort, filters, saved, recently viewed ──────────────────────
  const [sort, setSort] = useState<SortKey>('popular')
  const [filters, setFilters] = useState<Filters>({})
  const [sheet, setSheet] = useState<null | 'sort' | 'filter' | 'categories'>(null)
  const [wish, setWish] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const wishKey = `store-wish:${store.slug}`
  const recentKey = `store-recent:${store.slug}`
  useEffect(() => {
    try {
      setWish(JSON.parse(localStorage.getItem(wishKey) || '[]').filter((x: unknown) => typeof x === 'string').slice(0, 50))
      const seen: string[] = JSON.parse(localStorage.getItem(recentKey) || '[]').filter((x: unknown) => typeof x === 'string')
      // The product open now goes first in "Recently viewed"
      const next = productId ? [productId, ...seen.filter((x) => x !== productId)].slice(0, 12) : seen
      setRecent(next)
      localStorage.setItem(recentKey, JSON.stringify(next))
    } catch {}
    // A search sent from a product page (?q=…)
    const q = new URLSearchParams(window.location.search).get('q')
    if (q && !productId) setQuery(q.slice(0, 80))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishKey, recentKey, productId])
  const toggleWish = (id: string) => setWish((list) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list].slice(0, 50)
    try { localStorage.setItem(wishKey, JSON.stringify(next)) } catch {}
    return next
  })
  const byId = useMemo(() => new Map(store.products.map((p) => [p.id, p])), [store.products])
  const q = query.trim()
  const browsing = Boolean(category || q || sort !== 'popular' || filterCount(filters))
  const listed = useMemo(() => {
    const base = q ? searchProducts(store.products, q) : store.products
    const filtered = filterProducts(base, { ...filters, category })
    // A search keeps its best-match order unless another sort is picked
    return q && sort === 'popular' ? filtered : sortProducts(filtered, sort)
  }, [store.products, q, filters, category, sort])
  const deals = useMemo(() => dealProducts(store.products), [store.products])
  const best = useMemo(() => topRated(store.products), [store.products])
  const rails = useMemo(() => categoryRails(store.products, 3), [store.products])
  const recentProducts = recent.filter((id) => id !== productId).map((id) => byId.get(id)).filter(Boolean) as Product[]
  const savedProducts = wish.map((id) => byId.get(id)).filter(Boolean) as Product[]
  const showList = (next: { sort?: SortKey; category?: string | null } = {}) => {
    if (next.sort) setSort(next.sort)
    if (next.category !== undefined) setCategory(next.category)
    setTimeout(() => productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  const searchFromHere = () => {
    if (viewing) { if (q) window.location.href = `${homeHref}?q=${encodeURIComponent(q)}`; return }
    showList()
  }
  // The page's own address for "Ask on WhatsApp", read after loading (the server does not know it)
  const [pageUrl, setPageUrl] = useState('')
  useEffect(() => { setPageUrl(window.location.href) }, [productId])
  const clearAll = () => { setCategory(null); setQuery(''); setSort('popular'); setFilters({}) }

  const layout = store.layout || 'grid'
  const cardFor = (p: Product, compact = false) => (
    <ProductCard key={p.id} p={p} href={productHref(p.id)} money={money} inCart={cart[p.id] || 0} onAdd={() => setQty(p.id, 1)} onQty={(n) => setQty(p.id, n)}
      wished={wish.includes(p.id)} onWish={() => toggleWish(p.id)} freeFrom={store.delivery ? (store.deliveryFee ? store.freeFrom : 1) : 0} compact={compact} wide={layout === 'big'} />
  )
  const railCards = (list: Product[]) => list.map((p) => <div key={p.id} className="w-[44vw] max-w-[200px] min-[480px]:w-[180px] shrink-0 snap-start">{cardFor(p, true)}</div>)
  const listRow = (p: Product) => (
    <article key={p.id} className="bg-white p-3 flex gap-3 min-w-0">
      <a href={productHref(p.id)} className="shrink-0 h-28 w-28 sm:h-36 sm:w-36"><Picture src={p.image} alt={p.title} contain className={`h-full w-full ${p.inStock ? '' : 'opacity-40 grayscale'}`} /></a>
      <div className="flex-1 min-w-0 flex flex-col">
        <a href={productHref(p.id)} className="min-w-0">
          {p.brand && <p className="text-[12px] font-semibold text-[#8a94a8]">{p.brand}</p>}
          <h3 className="text-[15px] text-[#0E1B3D] leading-snug line-clamp-2 hover:text-[var(--c)]">{p.title}</h3>
          {p.rating ? <div className="mt-1"><RatingChip rating={p.rating} count={p.ratingCount} /></div> : null}
          <div className="mt-1"><PriceLine p={p} money={money} /></div>
        </a>
        <div className="mt-auto pt-2 flex justify-end">
          {!p.inStock ? <span className="text-[12.5px] font-semibold text-[#8a94a8]">Not available now</span>
            : p.variants?.length ? <a href={productHref(p.id)} className="h-9 px-4 leading-[34px] rounded-md border border-[var(--c)] text-[var(--c)] text-[13.5px] font-bold">Choose options</a>
            : cart[p.id] ? <Stepper small value={cart[p.id]} onChange={(n) => setQty(p.id, n)} />
            : <button type="button" onClick={() => setQty(p.id, 1)} className="h-9 px-4 rounded-md bg-[var(--c)] text-white text-[13.5px] font-bold cursor-pointer">Add to cart</button>}
        </div>
      </div>
    </article>
  )
  const gridClass = layout === 'list' ? 'grid grid-cols-1 xl:grid-cols-2 gap-px bg-[#eef1f6]'
    : layout === 'big' ? 'grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3 gap-px bg-[#eef1f6]'
    : layout === 'compact' ? 'grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-px bg-[#eef1f6]'
    : 'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-px bg-[#eef1f6]'
  const listTitle = q ? `Results for “${q}”` : category || (sort === 'discount' ? 'Best deals' : sort === 'newest' ? 'New arrivals' : 'All products')
  const nFilters = filterCount(filters)
  const filterPanel = <FilterPanel products={store.products} categories={store.categories.map((c) => c.name)} category={category} onCategory={(c) => { setCategory(c); setSheet(null) }} filters={filters} onFilters={setFilters} money={money} />

  return (
    <div style={{ ['--c' as any]: store.colour }} className="min-h-screen bg-[#f1f3f6] text-[#0E1B3D]">
      {store.announcement && <div className="bg-[#0E1B3D] text-white text-center text-[12.5px] sm:text-[13px] font-semibold px-4 py-1.5">{store.announcement}</div>}

      {/* Header: the shop, a wide search, account and cart */}
      <header className="sticky top-0 z-30 bg-[var(--c)] text-white shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center gap-3 sm:gap-6">
          <a href={homeHref} className="flex items-center gap-2 min-w-0 shrink">
            {store.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.logo} alt="" className="h-9 w-9 sm:h-10 sm:w-10 rounded-md bg-white object-contain shrink-0" />
            ) : (
              <span className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-md bg-white text-[var(--c)] flex items-center justify-center font-extrabold text-[18px]">{store.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="min-w-0">
              <span className="block font-extrabold text-[16px] sm:text-[18px] leading-tight truncate">{store.name}</span>
              {store.tagline && <span className="hidden lg:block text-[11.5px] text-white/80 truncate max-w-[220px]">{store.tagline}</span>}
            </span>
          </a>
          <div className="hidden md:block flex-1 max-w-2xl">
            <SearchBox products={store.products} value={query} onChange={setQuery} onSubmit={searchFromHere} onCategory={(c) => { setQuery(''); viewing ? (window.location.href = categoryHref(c)) : showList({ category: c }) }} productHref={productHref} money={money} />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-3 shrink-0">
            {store.accounts && (
              <button type="button" onClick={() => setAccountView('orders')} aria-label={shopper.session ? 'My orders' : 'Sign in'} className="h-10 px-2 sm:px-3 rounded-md inline-flex items-center gap-2 font-bold text-[14px] hover:bg-white/10 cursor-pointer">
                {shopper.account?.shopper.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shopper.account.shopper.picture} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : <UserRound size={20} />}
                <span className="hidden sm:inline">{shopper.session ? 'My orders' : 'Sign in'}</span>
              </button>
            )}
            <button type="button" onClick={() => setPanel('cart')} aria-label={`Cart, ${count} items`} className="relative h-10 px-2 sm:px-3 rounded-md inline-flex items-center gap-2 font-bold text-[14px] hover:bg-white/10 cursor-pointer">
              <span className="relative">
                <ShoppingCart size={22} />
                {count > 0 && <span className="absolute -top-2 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[var(--c)] text-[11px] font-extrabold flex items-center justify-center border border-[var(--c)]">{count}</span>}
              </span>
              <span className="hidden sm:inline">Cart</span>
            </button>
          </div>
        </div>
        <div className="md:hidden px-3 pb-2.5">
          <SearchBox products={store.products} value={query} onChange={setQuery} onSubmit={searchFromHere} onCategory={(c) => { setQuery(''); viewing ? (window.location.href = categoryHref(c)) : showList({ category: c }) }} productHref={productHref} money={money} />
        </div>
      </header>

      {/* Categories as a bar of round pictures */}
      {!viewing && store.categories.length > 1 && (
        <nav aria-label="Categories" className="bg-white border-b border-[#e3e8f2] shadow-sm">
          <div className="max-w-7xl mx-auto px-2 flex gap-1 sm:gap-3 overflow-x-auto no-scrollbar lg:justify-center py-2.5">
            <button type="button" onClick={() => { clearAll() }} className="shrink-0 w-[72px] sm:w-[88px] flex flex-col items-center gap-1 cursor-pointer">
              <span className={`h-14 w-14 sm:h-16 sm:w-16 rounded-full flex items-center justify-center ${!category ? 'bg-[var(--c)] text-white' : 'bg-[#f1f3f6] text-[var(--c)]'}`}><LayoutGrid size={24} /></span>
              <span className={`text-[12px] sm:text-[13px] leading-tight ${!category ? 'font-bold text-[var(--c)]' : 'font-semibold'}`}>All</span>
            </button>
            {store.categories.map((c) => (
              <button key={c.name} type="button" onClick={() => (category === c.name ? setCategory(null) : showList({ category: c.name }))} className="shrink-0 w-[72px] sm:w-[88px] flex flex-col items-center gap-1 cursor-pointer">
                <span className={`h-14 w-14 sm:h-16 sm:w-16 rounded-full overflow-hidden bg-[#f1f3f6] ring-2 ${category === c.name ? 'ring-[var(--c)]' : 'ring-transparent'}`}><Picture src={c.image} alt="" className="h-full w-full" /></span>
                <span className={`w-full text-center text-[12px] sm:text-[13px] leading-tight line-clamp-2 ${category === c.name ? 'font-bold text-[var(--c)]' : 'font-semibold'}`}>{c.name}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="max-w-7xl mx-auto sm:px-4 pt-2 sm:pt-4 pb-24 sm:pb-10 space-y-2 sm:space-y-4">
        {/* Home: banners, promises, rails */}
        {!viewing && !browsing && (
          <>
            <Banners store={store} onCategory={(c) => showList({ category: c })} />
            <TrustStrip store={store} money={money} />
            {deals.length >= 2 && <Rail title="Deals for you" note="Biggest savings right now" onViewAll={() => showList({ sort: 'discount' })}>{railCards(deals)}</Rail>}
            {recentProducts.length > 0 && <Rail title="Recently viewed">{railCards(recentProducts)}</Rail>}
            {best.length >= 2 && <Rail title="Top rated" note="Loved by customers">{railCards(best)}</Rail>}
            {rails.map((r) => <Rail key={r.category} title={`Best of ${r.category}`} onViewAll={() => showList({ category: r.category })}>{railCards(r.products)}</Rail>)}
            {savedProducts.length > 0 && <Rail title="Saved for later">{railCards(savedProducts)}</Rail>}
          </>
        )}

        {/* The list: side filters on wide screens, sort and filter sheets on phones */}
        {!viewing && (
          <section ref={productsRef} className="scroll-mt-32 lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-4 lg:items-start">
            <aside className="hidden lg:block bg-white rounded-lg border border-[#e3e8f2] sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
              <div className="px-4 py-3 border-b border-[#eef1f6] flex items-center">
                <p className="flex-1 text-[16px] font-extrabold">Filters</p>
                {(nFilters > 0 || category) && <button type="button" onClick={() => { setFilters({}); setCategory(null) }} className="text-[13px] font-bold text-[var(--c)] cursor-pointer">Clear all</button>}
              </div>
              {filterPanel}
            </aside>
            <div className="bg-white sm:rounded-lg border-y sm:border border-[#e3e8f2] min-w-0">
              <div className="px-4 pt-3 sm:pt-4">
                {browsing && <button type="button" onClick={clearAll} className="mb-1 text-[13px] font-semibold text-[#6B7894] hover:text-[var(--c)] cursor-pointer">Home <span aria-hidden>›</span> {listTitle}</button>}
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h1 className="text-[18px] sm:text-[20px] font-extrabold">{listTitle}</h1>
                  <span className="text-[13px] text-[#6B7894]">({listed.length} {listed.length === 1 ? 'product' : 'products'})</span>
                </div>
                <div className="mt-1 border-b border-[#eef1f6]"><SortTabs sort={sort} onSort={setSort} /></div>
              </div>
              {/* Phones: Sort | Filter */}
              <div className="sm:hidden grid grid-cols-2 border-b border-[#eef1f6]">
                <button type="button" onClick={() => setSheet('sort')} className="h-11 inline-flex items-center justify-center gap-2 text-[14px] font-bold border-r border-[#eef1f6] cursor-pointer"><ArrowUpDown size={16} /> Sort</button>
                <button type="button" onClick={() => setSheet('filter')} className="h-11 inline-flex items-center justify-center gap-2 text-[14px] font-bold cursor-pointer"><SlidersHorizontal size={16} /> Filter{nFilters ? ` (${nFilters})` : ''}</button>
              </div>
              <div className="hidden sm:flex lg:hidden px-4 py-2 gap-2 border-b border-[#eef1f6]">
                <button type="button" onClick={() => setSheet('filter')} className="h-9 px-3 rounded-md border border-[#d5ddeb] text-[13.5px] font-bold inline-flex items-center gap-2 cursor-pointer"><SlidersHorizontal size={15} /> Filters{nFilters ? ` (${nFilters})` : ''}</button>
              </div>
              {listed.length === 0 ? (
                <div className="py-16 px-4 text-center">
                  <p className="text-[17px] font-bold">{store.products.length ? 'Sorry, nothing matches' : 'Products are coming soon'}</p>
                  {store.products.length > 0 && <p className="mt-1 text-[14px] text-[#6B7894]">Check the spelling, or try fewer filters.</p>}
                  {browsing && <button type="button" onClick={clearAll} className="mt-4 h-10 px-5 rounded-md bg-[var(--c)] text-white font-bold text-[14px] cursor-pointer">See all products</button>}
                </div>
              ) : (
                <div className={gridClass}>{listed.map((p) => (layout === 'list' ? listRow(p) : cardFor(p)))}</div>
              )}
            </div>
          </section>
        )}

        {/* One product's own page */}
        {viewing && (
          <section className="sm:pb-4">
            <nav aria-label="Where you are" className="px-4 sm:px-0 py-2 flex flex-wrap items-center gap-1.5 text-[13px] text-[#6B7894]">
              <a href={homeHref} className="font-semibold hover:text-[var(--c)]">Home</a><span aria-hidden>›</span>
              <a href={categoryHref(viewing.category)} className="font-semibold hover:text-[var(--c)]">{viewing.category}</a><span aria-hidden>›</span>
              <span className="truncate max-w-[60vw]">{viewing.title}</span>
            </nav>
            <div className="bg-white sm:rounded-lg border-y sm:border border-[#e3e8f2] grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {/* Photos, with Add to cart / Buy now under them on wide screens */}
              <div className="p-3 sm:p-5 md:border-r border-[#eef1f6]">
                <div className="md:sticky md:top-24">
                  <div className="relative">
                    <Gallery key={viewing.id + (chosen?.id || '')} main={viewImage} images={viewing.images || []} video={viewing.video || null} title={viewing.title} dim={!viewInStock} />
                    <button type="button" aria-label={wish.includes(viewing.id) ? 'Remove from saved' : 'Save for later'} aria-pressed={wish.includes(viewing.id)} onClick={() => toggleWish(viewing.id)} className="absolute top-3 right-3 h-10 w-10 rounded-full bg-white shadow flex items-center justify-center cursor-pointer">
                      <Heart size={19} className={wish.includes(viewing.id) ? 'fill-[#b91c1c] text-[#b91c1c]' : 'text-[#8a94a8]'} />
                    </button>
                  </div>
                  {viewInStock && (
                    <div className="hidden md:grid grid-cols-2 gap-3 mt-4">
                      <button type="button" disabled={needsChoice} onClick={() => setQty(viewKey, openQty)} className="h-12 rounded-md border-2 border-[var(--c)] text-[var(--c)] font-extrabold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <ShoppingCart size={18} /> {cart[viewKey] ? 'Update cart' : 'Add to cart'}
                      </button>
                      <button type="button" disabled={needsChoice} onClick={() => { setQty(viewKey, openQty); setPanel('cart') }} className="h-12 rounded-md bg-[var(--c)] text-white font-extrabold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <Zap size={18} /> Buy now
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-6 min-w-0">
                {viewing.brand && <p className="text-[14px] font-bold text-[#8a94a8]">{viewing.brand}</p>}
                <h1 className="text-[19px] sm:text-[22px] font-semibold leading-snug break-words">{viewing.title}</h1>
                {viewing.rating ? <div className="mt-2"><RatingChip rating={viewing.rating} count={viewing.ratingCount} size="md" /> <span className="text-[13px] text-[#6B7894]">ratings</span></div> : null}
                {discountPercent({ ...viewing, price: viewPrice, variants: undefined }) > 0 && <p className="mt-3 text-[13px] font-bold text-[var(--c)]">Special price</p>}
                <div className={discountPercent({ ...viewing, price: viewPrice, variants: undefined }) > 0 ? 'mt-0.5' : 'mt-3'}>
                  <PriceLine p={{ ...viewing, price: viewPrice, variants: undefined }} money={money} size="lg" from={needsChoice && Boolean(viewing.variants?.some((v) => v.price !== viewPrice))} />
                </div>
                <p className="text-[12.5px] text-[#6B7894]">Inclusive of all taxes</p>
                <p className={`mt-2 inline-flex w-fit items-center gap-1.5 h-7 px-2.5 rounded text-[13px] font-bold ${viewInStock ? 'bg-[#eef1f6] text-[#0E1B3D]' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
                  {viewInStock ? <><Check size={14} /> In stock</> : chosen ? `${chosen.name} is out of stock` : 'Out of stock right now'}
                </p>
                {!viewInStock && (!needsChoice || !viewing.variants?.length) && <BackInStock slug={store.slug} productId={viewing.id} variantId={chosen?.id || null} label={chosen ? chosen.name : null} />}

                <OffersList store={store} money={money} />

                {(viewing.options || []).length > 0 && viewing.variants?.length ? (
                  <div className="mt-5 space-y-4">
                    {viewing.options!.map((o) => (
                      <fieldset key={o.name}>
                        <legend className="text-[14px] font-bold text-[#4a5672] mb-2">{o.name}{picked[o.name] ? <span className="text-[#0E1B3D] font-semibold">: {picked[o.name]}</span> : null}</legend>
                        <div className="flex flex-wrap gap-2">
                          {o.values.map((value) => {
                            const on = picked[o.name] === value
                            const can = valueAvailable(viewing.variants!, viewing.options!, picked, o.name, value)
                            return (
                              <button key={value} type="button" aria-pressed={on} onClick={() => setPicked({ ...picked, [o.name]: value })}
                                className={`min-w-12 h-10 px-3.5 rounded-md border-2 text-[14px] font-bold cursor-pointer ${on ? 'border-[var(--c)] text-[var(--c)] bg-[var(--c)]/5' : can ? 'border-[#d5ddeb] bg-white text-[#0E1B3D] hover:border-[var(--c)]' : 'border-[#e3e8f2] bg-[#f4f6fa] text-[#8a94a8] line-through'}`}>
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
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <span className="text-[14px] font-bold text-[#4a5672]">Quantity</span>
                    <Stepper value={openQty} onChange={(n) => setOpenQty(Math.max(1, Math.min(99, n)))} />
                    {needsChoice && <span className="text-[13.5px] text-[#4a5672]">Choose {viewing.options!.filter((o) => !picked[o.name]).map((o) => o.name.toLowerCase()).join(' and ')} first.</span>}
                    {cart[viewKey] > 0 && <span className="text-[13.5px] text-[#4a5672]">{cart[viewKey]} in your cart · <button type="button" onClick={() => setPanel('cart')} className="font-bold text-[var(--c)] underline cursor-pointer">View cart</button></span>}
                  </div>
                )}

                {/* Delivery and services */}
                <div className="mt-5 rounded-lg border border-[#e3e8f2] divide-y divide-[#eef1f6]">
                  {store.delivery && (
                    <div className="p-3 sm:p-4 flex gap-3 text-[14px]">
                      <Truck size={19} className="shrink-0 mt-0.5 text-[var(--c)]" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">Delivery</p>
                        <p className="text-[#4a5672]">{store.deliveryFee ? `${money(store.deliveryFee)}${store.freeFrom ? `, free on orders above ${money(store.freeFrom)}` : ''}` : 'Free home delivery'}</p>
                        {store.pinCheck && <div className="mt-2"><PinCheck slug={store.slug} charge={store.deliveryFee ? `Delivery ${money(store.deliveryFee)}${store.freeFrom ? `, free above ${money(store.freeFrom)}` : ''}.` : 'Free delivery.'} /></div>}
                      </div>
                    </div>
                  )}
                  {store.pickup && <div className="p-3 sm:p-4 flex gap-3 text-[14px]"><Store size={19} className="shrink-0 mt-0.5 text-[var(--c)]" /><div><p className="font-bold">Pick up from the shop</p>{store.address && <p className="text-[#4a5672]">{store.address.split('\n')[0]}</p>}</div></div>}
                  <div className="p-3 sm:p-4 grid grid-cols-1 min-[420px]:grid-cols-2 gap-2 text-[13.5px] text-[#0E1B3D]">
                    {store.payLater && <span className="flex gap-2"><Banknote size={17} className="shrink-0 text-[var(--c)]" /> {store.delivery ? 'Cash on delivery available' : 'Pay at pick up'}</span>}
                    {store.payOnline && <span className="flex gap-2"><ShieldCheck size={17} className="shrink-0 text-[var(--c)]" /> Secure online payment</span>}
                    {store.returns?.on && <span className="flex gap-2"><RotateCcw size={17} className="shrink-0 text-[var(--c)]" /> {store.returns.days}-day return policy</span>}
                    <span className="flex gap-2"><Store size={17} className="shrink-0 text-[var(--c)]" /> Sold by {store.name}</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {store.whatsapp && (
                    <a href={waLink(`Hi ${store.name}, I have a question about ${viewing.title}${chosen ? ` (${chosen.name})` : ''} (${money(viewPrice)}): ${pageUrl}`)} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-md border border-[#d5ddeb] bg-white text-[13.5px] font-bold inline-flex items-center gap-2">
                      <MessageCircle size={16} className="text-[#25D366]" /> Ask on WhatsApp
                    </a>
                  )}
                  <button type="button" onClick={share} className="h-10 px-4 rounded-md border border-[#d5ddeb] bg-white text-[13.5px] font-bold inline-flex items-center gap-2 cursor-pointer">
                    {shared ? <Check size={16} className="text-[var(--c)]" /> : <Share2 size={16} />} {shared ? 'Link copied' : 'Share'}
                  </button>
                </div>

                {viewing.description && (
                  <div className="mt-6 border-t border-[#eef1f6] pt-5">
                    <h2 className="text-[17px] font-extrabold">Product details</h2>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-[#4a5672] whitespace-pre-line break-words">{viewing.description}</p>
                  </div>
                )}
                {reviews.length > 0 && <div className="mt-6 border-t border-[#eef1f6] pt-1"><Reviews reviews={reviews} /></div>}
              </div>
            </div>

            {related.length > 0 && <div className="mt-2 sm:mt-4"><Rail title="Similar products" onViewAll={() => (window.location.href = categoryHref(viewing.category))}>{railCards(related)}</Rail></div>}
            {recentProducts.length > 0 && <div className="mt-2 sm:mt-4"><Rail title="Recently viewed">{railCards(recentProducts)}</Rail></div>}
          </section>
        )}

        {/* The shop's Instagram */}
        {!viewing && !browsing && (store.instagram?.posts.length || store.instagram?.handle || store.instagramFeed?.length) ? (
          <section className="bg-white sm:rounded-lg border-y sm:border border-[#e3e8f2] p-4" aria-label="Instagram">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-[18px] sm:text-[20px] font-extrabold mr-auto">On Instagram</h2>
              {store.instagram.handle && <a href={`https://www.instagram.com/${store.instagram.handle}/`} target="_blank" rel="noreferrer" className="h-9 px-4 rounded-md border border-[#d5ddeb] bg-white text-[13.5px] font-bold inline-flex items-center">Follow @{store.instagram.handle}</a>}
            </div>
            {(store.instagramFeed?.length || 0) > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                {store.instagramFeed!.map((p) => (
                  <a key={p.id} href={p.link} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-[#e3e8f2] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt={p.caption ? p.caption.slice(0, 100) : 'Instagram post'} loading="lazy" className="aspect-square w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
            {store.instagram.posts.length > 0 && !(store.instagramFeed?.length) && (
              <div className="grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 gap-4">
                {store.instagram.posts.slice(0, 6).map((post) => (
                  <iframe key={post} src={`https://www.instagram.com/${post}/embed`} title="Instagram post" loading="lazy" className="w-full h-[520px] rounded-lg border border-[#e3e8f2] bg-white" allowTransparency scrolling="no" />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>

      {/* Footer: about, help, contact, payments */}
      <footer className="bg-[#0E1B3D] text-white/90 pb-16 sm:pb-0">
        <div className="max-w-7xl mx-auto px-4 py-10 grid gap-8 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 text-[14px]">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/60">About</p>
            <p className="mt-3 font-extrabold text-[17px] text-white">{store.name}</p>
            {store.about && <p className="mt-2 text-white/75 whitespace-pre-line leading-relaxed">{store.about}</p>}
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/60">Help</p>
            <ul className="mt-3 space-y-2">
              <li><button type="button" onClick={() => setAccountView(shopper.session ? 'orders' : 'track')} className="hover:underline cursor-pointer">{shopper.session ? 'My orders' : 'Track your order'}</button></li>
              {store.pages.map((key) => <li key={key}><a href={`${basePath}/info/${key}`} className="hover:underline">{STORE_PAGE_TITLES[key]}</a></li>)}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/60">Contact us</p>
            <div className="mt-3 space-y-2.5 text-white/80">
              {store.address && <p className="flex gap-2"><MapPin size={17} className="shrink-0 mt-0.5" /> <span className="whitespace-pre-line">{store.address}</span></p>}
              {store.phone && <a href={`tel:${store.phone}`} className="flex gap-2 font-semibold text-white"><Phone size={17} /> {showPhone(store.phone)}</a>}
              {store.whatsapp && <a href={waLink(`Hi ${store.name}`)} target="_blank" rel="noreferrer" className="inline-flex h-10 px-4 rounded-md bg-[#25D366] text-white font-bold items-center gap-2"><MessageCircle size={17} /> Chat on WhatsApp</a>}
            </div>
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/60">Ways to pay</p>
            <ul className="mt-3 space-y-2 text-white/80">
              {store.payOnline && <li className="flex gap-2"><CreditCard size={17} /> {store.payWith === 'stripe' ? 'Cards, Apple Pay and Google Pay' : 'UPI, cards and net banking'}</li>}
              {store.payLater && <li className="flex gap-2"><Banknote size={17} /> {store.delivery ? 'Cash on delivery' : 'Pay at pick up'}</li>}
              <li className="flex gap-2"><ShieldCheck size={17} /> Safe and secure shopping</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="max-w-7xl mx-auto px-4 py-4 text-[12.5px] text-white/55 flex flex-wrap gap-x-4 gap-y-1 justify-between">
            <span>© {new Date().getFullYear()} {store.name}. All rights reserved.</span>
            <span>Online store by WAMA CRM</span>
          </p>
        </div>
      </footer>

      {/* Phones: Add to cart / Buy now on a product; else Home, Categories, Account, Cart */}
      {viewing && viewInStock && !panel && !accountView ? (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-2 bg-white border-t border-[#e3e8f2] shadow-[0_-2px_10px_rgba(14,27,61,0.08)]">
          <button type="button" disabled={needsChoice} onClick={() => setQty(viewKey, openQty)} className="h-14 font-extrabold text-[15px] text-[#0E1B3D] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
            <ShoppingCart size={18} /> {cart[viewKey] ? 'Update cart' : 'Add to cart'}
          </button>
          <button type="button" disabled={needsChoice} onClick={() => { setQty(viewKey, openQty); setPanel('cart') }} className="h-14 bg-[var(--c)] text-white font-extrabold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
            <Zap size={18} /> Buy now
          </button>
        </div>
      ) : !panel && !accountView ? (
        <nav aria-label="Store menu" className="sm:hidden fixed bottom-0 inset-x-0 z-30 h-14 grid grid-cols-4 bg-white border-t border-[#e3e8f2] shadow-[0_-2px_10px_rgba(14,27,61,0.06)]">
          <a href={homeHref} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-[#0E1B3D]"><Home size={20} /> Home</a>
          <button type="button" onClick={() => setSheet('categories')} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-[#0E1B3D] cursor-pointer"><LayoutGrid size={20} /> Categories</button>
          <button type="button" onClick={() => setAccountView(shopper.session || !store.accounts ? (store.accounts ? 'orders' : 'track') : 'orders')} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-[#0E1B3D] cursor-pointer"><UserRound size={20} /> {store.accounts ? 'Account' : 'Track'}</button>
          <button type="button" onClick={() => setPanel('cart')} className="relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-[#0E1B3D] cursor-pointer">
            <span className="relative"><ShoppingCart size={20} />{count > 0 && <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[var(--c)] text-white text-[10.5px] font-extrabold flex items-center justify-center">{count}</span>}</span>
            Cart
          </button>
        </nav>
      ) : null}

      {/* The AI chat (Website settings → AI chat on your website) */}
      {store.chat && !panel && !accountView && !sheet && (
        <StoreChat slug={store.slug} storeName={store.name} whatsapp={store.whatsapp} money={money} productHref={productHref} raised={Boolean(viewing)}
          onAdd={(id) => setQty(id, (cart[id] || 0) + 1)} />
      )}

      {sheet === 'sort' && (
        <Sheet title="Sort by" onClose={() => setSheet(null)}>
          <div className="p-2">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <label key={key} className="flex items-center gap-3 h-12 px-3 text-[15px] cursor-pointer">
                <input type="radio" name="sort" checked={sort === key} onChange={() => { setSort(key); setSheet(null) }} className="h-4 w-4 accent-[var(--c)]" /> {SORT_LABELS[key]}
              </label>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'filter' && (
        <Sheet title="Filters" onClose={() => setSheet(null)} footer={
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setFilters({}); setCategory(null) }} className="h-11 rounded-md border border-[#d5ddeb] font-bold text-[14px] cursor-pointer">Clear all</button>
            <button type="button" onClick={() => { setSheet(null); showList() }} className="h-11 rounded-md bg-[var(--c)] text-white font-bold text-[14px] cursor-pointer">Show {listed.length} {listed.length === 1 ? 'product' : 'products'}</button>
          </div>
        }>{filterPanel}</Sheet>
      )}
      {sheet === 'categories' && (
        <Sheet title="Categories" onClose={() => setSheet(null)}>
          <div className="grid grid-cols-3 gap-3 p-4">
            {store.categories.map((c) => (
              <button key={c.name} type="button" onClick={() => { setSheet(null); viewing ? (window.location.href = categoryHref(c.name)) : showList({ category: c.name }) }} className="flex flex-col items-center gap-1.5 cursor-pointer">
                <span className="h-16 w-16 rounded-full overflow-hidden bg-[#f1f3f6]"><Picture src={c.image} alt="" className="h-full w-full" /></span>
                <span className="text-[12.5px] font-semibold text-center leading-tight line-clamp-2">{c.name}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {/* Cart, checkout, done */}
      {panel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Your cart" onClick={() => panel !== 'done' && setPanel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-md h-full flex flex-col">
            <div className="h-16 px-4 flex items-center gap-2 border-b border-[#e3e8f2] shrink-0">
              {panel === 'checkout' && <button type="button" aria-label="Back to cart" onClick={() => setPanel('cart')} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><ArrowLeft size={19} /></button>}
              <p className="font-extrabold text-[18px] flex-1">{panel === 'cart' ? `My cart${count ? ` (${count})` : ''}` : panel === 'checkout' ? 'Delivery details' : 'Order placed'}</p>
              <button type="button" aria-label="Close" onClick={() => setPanel(null)} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><X size={19} /></button>
            </div>

            {panel === 'cart' && (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {lines.length === 0 && <p className="py-16 text-center text-[#6B7894]">Your cart is empty.</p>}
                  {lines.map(({ key, product, variant, image, price, qty }) => {
                    const mrp = product.mrp && (!variant || variant.price === product.price) && product.mrp > price ? product.mrp : 0
                    return (
                      <div key={key} className="flex gap-3 pb-3 border-b border-[#eef1f6] last:border-b-0">
                        <Picture src={image} alt="" contain className="h-20 w-20 rounded-md shrink-0 bg-white border border-[#eef1f6]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14.5px] leading-snug line-clamp-2">{product.title}</p>
                          {variant && <p className="text-[13px] text-[#6B7894]">{variant.name}</p>}
                          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[15px] font-extrabold">{money(price * qty)}</span>
                            {mrp > 0 && <s className="text-[12.5px] text-[#8a94a8]">{money(mrp * qty)}</s>}
                            {mrp > 0 && <span className="text-[12.5px] font-bold text-[var(--c)]">{Math.floor((1 - price / mrp) * 100)}% off</span>}
                          </p>
                          <div className="mt-2 flex items-center gap-4">
                            <Stepper small value={qty} onChange={(n) => setQty(key, n)} />
                            <button type="button" onClick={() => setQty(key, 0)} className="text-[13px] font-bold text-[#4a5672] hover:text-[#b91c1c] cursor-pointer">Remove</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {lines.length > 0 && (
                  <div className="p-4 border-t border-[#e3e8f2] space-y-3 shrink-0">
                    {offOk && <p className="text-[13.5px] font-semibold text-[var(--c)]">Offer: {offer!.title}{discountOff > 0 ? ` · you save ${money(discountOff)}` : ''}</p>}
                    {!offOk && store.offers.length > 0 && <p className="text-[13px] text-[#4a5672]">Offers: {store.offers.map((o) => o.title).join(' · ')}</p>}
                    {(() => {
                      // Price details: the MRP total, the saving, the delivery charge
                      const mrpTotal = lines.reduce((sum, l) => sum + ((l.product.mrp && (!l.variant || l.variant.price === l.product.price) && l.product.mrp > l.price ? l.product.mrp : l.price) * l.qty), 0)
                      const saved = Math.max(0, Math.round((mrpTotal - subtotal) * 100) / 100)
                      const fee = store.delivery && !store.pickup ? (store.freeFrom > 0 && subtotal >= store.freeFrom ? 0 : store.deliveryFee) : null
                      return (
                        <div className="rounded-md border border-[#e3e8f2] p-3 space-y-1.5 text-[14px]">
                          <p className="text-[12px] font-bold uppercase tracking-wide text-[#6B7894] pb-1">Price details</p>
                          <div className="flex justify-between"><span>Price ({count} item{count === 1 ? '' : 's'})</span><span>{money(mrpTotal)}</span></div>
                          {saved > 0 && <div className="flex justify-between"><span>Discount</span><span className="font-bold text-[var(--c)]">− {money(saved)}</span></div>}
                          {fee !== null && <div className="flex justify-between"><span>Delivery</span><span>{fee ? money(fee) : <span className="font-bold text-[var(--c)]">Free</span>}</span></div>}
                          <div className="flex justify-between text-[16px] font-extrabold border-t border-dashed border-[#d5ddeb] pt-2"><span>Total</span><span>{money(subtotal + (fee || 0))}</span></div>
                          {saved > 0 && <p className="text-[13px] font-bold text-[var(--c)]">You save {money(saved)} on this order</p>}
                        </div>
                      )
                    })()}
                    {short && <p className="text-[13.5px] text-[#b91c1c] font-semibold">The smallest order here is {money(store.minOrder)}. Add {money(store.minOrder - subtotal)} more.</p>}
                    <button type="button" disabled={short} onClick={() => setPanel('checkout')} className="w-full h-12 rounded-md bg-[var(--c)] text-white font-extrabold text-[15px] disabled:opacity-50 cursor-pointer">Place order</button>
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
                <button type="button" disabled={placing} onClick={() => payOnline(unpaid).catch((err) => setError(err.message))} className="mt-6 w-full h-12 rounded-md bg-[var(--c)] text-white font-bold text-[15px] cursor-pointer disabled:opacity-60">Try paying again</button>
                {store.payLater && (
                  <button type="button" disabled={placing} onClick={payLaterInstead} className="mt-3 w-full h-12 rounded-md border-2 border-[#d5ddeb] font-bold text-[15px] cursor-pointer disabled:opacity-60">
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
                {store.loyalty?.on && pointsCanUse === 0 && <p className="text-[13px] text-[#6B7894]">{loyaltyLine(store.loyalty)}{!shopper.session && store.accounts ? ' Sign in to use your points.' : ''}</p>}
                {pointsCanUse > 0 && (
                  <label className="flex items-center gap-3 rounded-xl border-2 border-[#d5ddeb] p-3 cursor-pointer">
                    <input type="checkbox" checked={usePointsOn} onChange={(e) => setUsePointsOn(e.target.checked)} className="h-5 w-5 accent-[var(--c)]" />
                    <span className="text-[14.5px]"><b>Use {pointsCanUse} points</b> ({money(pointsCanUse)} off). You have {pointsBalanceNow}.</span>
                  </label>
                )}
                <div className="rounded-xl bg-[#f4f6fa] p-4 space-y-1.5 text-[14.5px]">
                  <div className="flex justify-between"><span>Items</span><span>{money(subtotal)}</span></div>
                  {memberWins && <div className="flex justify-between text-[var(--c)] font-semibold"><span>{memberInfo!.title}</span><span>− {money(memberOff)}</span></div>}
                  {!memberWins && offOk && discountOff > 0 && <div className="flex justify-between text-[var(--c)] font-semibold"><span>{offer!.title}</span><span>− {money(discountOff)}</span></div>}
                  {pointsOff > 0 && <div className="flex justify-between text-[var(--c)] font-semibold"><span>{pointsOff} points</span><span>− {money(pointsOff)}</span></div>}
                  {handover === 'delivery' && <div className="flex justify-between"><span>Delivery</span><span>{memberWins ? (delivery ? money(delivery) : 'Free') : deliveryToPay ? money(deliveryToPay) : offOk && offer!.freeDelivery && delivery ? <><s className="text-[#8a94a8] mr-1">{money(delivery)}</s>Free</> : 'Free'}</span></div>}
                  <div className="flex justify-between font-extrabold text-[17px] pt-1"><span>To pay</span><span>{money(toPay)}</span></div>
                  {pay === 'online' ? (
                    <p className="text-[13px] text-[#6B7894] flex gap-1.5"><ShieldCheck size={15} className="shrink-0 mt-px text-[var(--c)]" /> {store.payWith === 'stripe' ? 'Pay securely by card, Apple Pay or Google Pay with Stripe.' : 'Pay securely by UPI, card or net banking with Razorpay.'}</p>
                  ) : (
                    <p className="text-[13px] text-[#6B7894]">Pay cash when you {handover === 'delivery' ? 'get your order' : 'pick it up'}. The shop will confirm your order.</p>
                  )}
                </div>
                {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] p-3 text-[14px] text-[#b91c1c] font-semibold">{error}</p>}
                <button type="submit" disabled={placing} className="w-full h-12 rounded-md bg-[var(--c)] text-white font-bold text-[15px] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer">
                  {placing && <Loader2 size={17} className="animate-spin" />} {pay === 'online' ? `Pay ${money(toPay)}` : 'Place order'}
                </button>
              </form>
            )}

            {panel === 'done' && done && (
              <div className="flex-1 overflow-y-auto p-6 text-center">
                <span className="mx-auto h-16 w-16 rounded-md bg-[var(--c)] text-white flex items-center justify-center"><Check size={32} /></span>
                <p className="mt-4 text-[22px] font-extrabold">Thank you, {name.split(' ')[0]}!</p>
                <p className="mt-1 text-[15px] text-[#4a5672]">
                  {done.paid
                    ? <>Your payment of {money(done.total)} is received. Order <b>#{done.orderNumber}</b> is confirmed with {store.name}.</>
                    : <>Your order <b>#{done.orderNumber}</b> for {money(done.total)} is with {store.name}. They will contact you to confirm it.</>}
                </p>
                {store.whatsapp && (
                  <a href={waLink(`Hi ${store.name}, I just placed order #${done.orderNumber} on your website.`)} target="_blank" rel="noreferrer" className="mt-6 inline-flex h-12 px-6 rounded-full bg-[#25D366] text-white font-bold items-center">Message the shop on WhatsApp</a>
                )}
                <button type="button" onClick={() => { setPanel(null); setAccountView(shopper.session ? 'orders' : 'track') }} className="mt-3 w-full h-12 rounded-md border-2 border-[#d5ddeb] font-bold text-[15px] cursor-pointer">
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
      {accountView && <AccountPanel slug={store.slug} shopper={shopper} money={money} storeName={store.name} returns={store.returns} initialView={accountView} onClose={() => setAccountView(null)} onReorder={(items) => {
        // "Same as last time?": the same products (and sizes / colours) that are still sold and in stock
        const next = { ...cart }
        let added = 0
        for (const item of items) if (lineFor(store.products, item.key)?.inStock) { next[item.key] = Math.min(99, (next[item.key] || 0) + item.quantity); added++ }
        setCart(next)
        setAccountView(null)
        setPanel('cart')
        if (!added) setError('Those products are not available right now.')
      }} />}
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

/** On a sold-out product (or size / colour): leave a WhatsApp number, get one message when it is back. */
function BackInStock({ slug, productId, variantId, label }: { slug: string; productId: string; variantId: string | null; label: string | null }) {
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<{ busy?: boolean; text?: string; ok?: boolean } | null>(null)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState({ busy: true })
    try {
      const res = await fetch(`/api/public/store/${slug}/stock-alert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, variantId, phone }) })
      const data = await res.json().catch(() => ({}))
      setState(data.ok ? { ok: true, text: 'Done! We will message you on WhatsApp when it is back.' } : { ok: false, text: data.reason || 'Could not save it.' })
    } catch {
      setState({ ok: false, text: 'Could not save it.' })
    }
  }
  if (state?.ok) return <p role="status" className="mt-4 rounded-xl bg-[#f4f6fa] p-3 text-[14px] font-semibold">{state.text}</p>
  return (
    <form onSubmit={save} className="mt-4 rounded-xl bg-[#f4f6fa] p-3 space-y-2">
      <p className="text-[14px] font-semibold">Tell me on WhatsApp when {label ? `${label} is` : 'it is'} back</p>
      <div className="flex gap-2">
        <PhoneField value={phone} onChange={setPhone} inputClassName="min-w-0 flex-1 h-10 px-3 rounded-lg border border-[#d5ddeb] bg-white text-[14px]" placeholder="WhatsApp number" />
        <button type="submit" disabled={state?.busy || phone.replace(/\D/g, '').length < 10} className="h-10 px-4 rounded-lg bg-[var(--c)] text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50 shrink-0">Notify me</button>
      </div>
      {state?.text && <p role="status" className="text-[13px] text-[#b91c1c]">{state.text}</p>}
    </form>
  )
}

function StarRow({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= Math.round(value) ? 'text-[#f5a623]' : 'text-[#d5ddeb]'} fill={n <= Math.round(value) ? 'currentColor' : 'none'} />)}
    </span>
  )
}

/** Customer reviews on the product page: the average, then each review with its photos. */
function Reviews({ reviews }: { reviews: PublicReview[] }) {
  const sum = ratingSummary(reviews)
  const [all, setAll] = useState(false)
  const shown = all ? reviews : reviews.slice(0, 5)
  return (
    <section className="mt-6" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="text-[16px] font-extrabold">Customer reviews</h2>
      <p className="mt-1 flex items-center gap-2 text-[14.5px]"><StarRow value={sum.average} size={18} /> <b>{sum.average}</b> <span className="text-[#6B7894]">from {sum.count} review{sum.count === 1 ? '' : 's'}</span></p>
      <ul className="mt-3 space-y-3">
        {shown.map((r, i) => (
          <li key={i} className="rounded-xl bg-[#f4f6fa] p-3">
            <p className="flex items-center gap-2 text-[13.5px]"><StarRow value={r.rating} /> <b>{r.name}</b> <span className="text-[#8a94a8]">{new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></p>
            {r.text && <p className="mt-1.5 text-[14.5px] text-[#4a5672] break-words">{r.text}</p>}
            {r.photos.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {r.photos.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0"><Picture src={url} alt="Customer photo" className="h-20 w-20 rounded-lg" /></a>)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {reviews.length > 5 && !all && <button type="button" onClick={() => setAll(true)} className="mt-2 text-[14px] font-bold text-[var(--c)] underline cursor-pointer">Show all {reviews.length} reviews</button>}
    </section>
  )
}
