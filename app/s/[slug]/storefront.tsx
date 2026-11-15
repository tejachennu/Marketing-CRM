'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Banknote, Check, ChevronLeft, ChevronRight, CreditCard, Loader2, MapPin, Minus, Phone, Plus, Search, ShieldCheck, ShoppingBag, Store, Truck, X } from 'lucide-react'
import { PhoneField } from '@/components/phone-field'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import type { StoreView } from '@/lib/commerce/storefront'

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

export function Storefront({ store, startCategory }: { store: StoreView; startCategory: string | null }) {
  const money = (n: number) => formatMoney(n, store.currency)
  const [category, setCategory] = useState<string | null>(startCategory)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Product | null>(null)
  const [openQty, setOpenQty] = useState(1)
  const [cart, setCart] = useState<Cart>({})
  const [panel, setPanel] = useState<null | 'cart' | 'checkout' | 'done'>(null)
  const productsRef = useRef<HTMLDivElement>(null)
  const cartKey = `store-cart:${store.slug}`

  // The cart stays on this phone between visits
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(cartKey) || '{}')
      const valid: Cart = {}
      for (const [id, qty] of Object.entries(saved)) if (store.products.some((p) => p.id === id && p.inStock) && Number(qty) > 0) valid[id] = Math.min(99, Number(qty))
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return store.products.filter((p) => (!category || p.category === category) && (!q || `${p.title} ${p.description} ${p.category}`.toLowerCase().includes(q)))
  }, [store.products, category, query])

  const lines = store.products.filter((p) => cart[p.id]).map((p) => ({ product: p, qty: cart[p.id] }))
  const count = lines.reduce((sum, line) => sum + line.qty, 0)
  const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0)

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
  const delivery = handover === 'delivery' ? (store.freeFrom > 0 && subtotal >= store.freeFrom ? 0 : store.deliveryFee) : 0
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, handover, pay, address: handover === 'delivery' ? address : null, note, items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The order could not be placed. Please try again.')
      setCart({})
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
  const cartText = () => [`Hi ${store.name}, I would like to order:`, ...lines.map((l) => `• ${l.qty} × ${l.product.title} (${money(l.product.price * l.qty)})`), `Total: ${money(subtotal)}`].join('\n')

  return (
    <div style={{ ['--c' as any]: store.colour }} className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]">
      {store.announcement && <div className="bg-[var(--c)] text-white text-center text-[13.5px] font-semibold px-4 py-2">{store.announcement}</div>}

      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#e3e8f2]">
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

      <Banners store={store} onCategory={pickCategory} />

      {store.categories.length > 1 && (
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
            {shown.map((p) => (
              <article key={p.id} className="bg-white rounded-2xl border border-[#e3e8f2] overflow-hidden flex flex-col">
                <button type="button" onClick={() => { setOpen(p); setOpenQty(cart[p.id] || 1) }} className="block text-left cursor-pointer">
                  <div className="relative aspect-square">
                    <Picture src={p.image} alt={p.title} className={`h-full w-full ${p.inStock ? '' : 'opacity-50 grayscale'}`} />
                    {!p.inStock && <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#0E1B3D]/85 text-white text-[11.5px] font-bold">Out of stock</span>}
                  </div>
                  <div className="px-3 pt-2.5">
                    <h3 className="text-[14.5px] font-semibold leading-snug line-clamp-2 min-h-[2.6em]">{p.title}</h3>
                    <p className="mt-1 text-[16px] font-extrabold">{money(p.price)}</p>
                  </div>
                </button>
                <div className="p-3 mt-auto">
                  {!p.inStock ? (
                    <span className="block h-10 leading-10 text-center text-[13.5px] text-[#8a94a8] font-semibold">Not available now</span>
                  ) : cart[p.id] ? (
                    <div className="flex justify-center"><Stepper small value={cart[p.id]} onChange={(n) => setQty(p.id, n)} /></div>
                  ) : (
                    <button type="button" onClick={() => setQty(p.id, 1)} className="w-full h-10 rounded-full border-2 border-[var(--c)] text-[var(--c)] text-[14px] font-bold cursor-pointer hover:bg-[var(--c)] hover:text-white transition-colors">Add</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="bg-white border-t border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 py-8 grid gap-6 sm:grid-cols-2 text-[14.5px]">
          <div>
            <p className="font-extrabold text-[17px]">{store.name}</p>
            {store.about && <p className="mt-2 text-[#4a5672] whitespace-pre-line">{store.about}</p>}
          </div>
          <div className="space-y-2 text-[#4a5672]">
            {store.address && <p className="flex gap-2"><MapPin size={17} className="shrink-0 mt-0.5 text-[var(--c)]" /> <span className="whitespace-pre-line">{store.address}</span></p>}
            {store.phone && <a href={`tel:${store.phone}`} className="flex gap-2 font-semibold text-[#0E1B3D]"><Phone size={17} className="text-[var(--c)]" /> {store.phone}</a>}
            {store.whatsapp && <a href={waLink(`Hi ${store.name}`)} target="_blank" rel="noreferrer" className="inline-flex h-10 px-4 rounded-full bg-[#25D366] text-white font-bold items-center gap-2">Chat on WhatsApp</a>}
          </div>
        </div>
        <p className="pb-6 text-center text-[12.5px] text-[#8a94a8]">Online store by WAMA CRM</p>
      </footer>

      {/* Cart button on phones while shopping */}
      {count > 0 && !panel && !open && (
        <button type="button" onClick={() => setPanel('cart')} className="sm:hidden fixed bottom-4 left-4 right-4 z-30 h-14 rounded-2xl bg-[var(--c)] text-white shadow-xl px-5 flex items-center justify-between font-bold cursor-pointer">
          <span>{count} item{count === 1 ? '' : 's'} · {money(subtotal)}</span>
          <span className="inline-flex items-center gap-1">View cart <ChevronRight size={18} /></span>
        </button>
      )}

      {/* One product */}
      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl max-h-[92dvh] overflow-y-auto sm:grid sm:grid-cols-2">
            <div className="relative">
              <Picture src={open.image} alt={open.title} className="w-full aspect-square" />
              <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="absolute top-3 right-3 h-10 w-10 rounded-full bg-white/90 flex items-center justify-center cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5 sm:p-7 flex flex-col">
              <p className="text-[12.5px] font-semibold text-[#6B7894] uppercase tracking-wide">{open.category}</p>
              <h3 className="mt-1 text-[22px] font-extrabold leading-tight">{open.title}</h3>
              <p className="mt-2 text-[22px] font-extrabold text-[var(--c)]">{money(open.price)}</p>
              {open.description && <p className="mt-3 text-[15px] text-[#4a5672] whitespace-pre-line">{open.description}</p>}
              <div className="mt-auto pt-6 flex items-center gap-3">
                {open.inStock ? (
                  <>
                    <Stepper value={openQty} onChange={(n) => setOpenQty(Math.max(1, Math.min(99, n)))} />
                    <button type="button" onClick={() => { setQty(open.id, openQty); setOpen(null) }} className="flex-1 h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] cursor-pointer">
                      {cart[open.id] ? 'Update cart' : 'Add to cart'} · {money(open.price * openQty)}
                    </button>
                  </>
                ) : (
                  <p className="text-[#b91c1c] font-semibold">Out of stock right now</p>
                )}
              </div>
            </div>
          </div>
        </div>
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
                  {lines.map(({ product, qty }) => (
                    <div key={product.id} className="flex gap-3 items-center">
                      <Picture src={product.image} alt="" className="h-16 w-16 rounded-xl shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14.5px] font-semibold leading-snug line-clamp-2">{product.title}</p>
                        <p className="text-[14px] font-bold mt-0.5">{money(product.price * qty)}</p>
                      </div>
                      <Stepper small value={qty} onChange={(n) => setQty(product.id, n)} />
                    </div>
                  ))}
                </div>
                {lines.length > 0 && (
                  <div className="p-4 border-t border-[#e3e8f2] space-y-3 shrink-0">
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
                  <div className="grid grid-cols-2 gap-2">
                    {([['online', 'Pay now', CreditCard], ['later', handover === 'delivery' ? 'Cash on delivery' : 'Cash at pick up', Banknote]] as const).map(([id, label, Icon]) => (
                      <button key={id} type="button" onClick={() => setPay(id)} className={`h-12 rounded-xl border-2 font-bold text-[14px] inline-flex items-center justify-center gap-2 cursor-pointer ${pay === id ? 'border-[var(--c)] text-[var(--c)] bg-[var(--c)]/5' : 'border-[#d5ddeb] text-[#4a5672]'}`}>
                        <Icon size={17} /> {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="rounded-xl bg-[#f4f6fa] p-4 space-y-1.5 text-[14.5px]">
                  <div className="flex justify-between"><span>Items</span><span>{money(subtotal)}</span></div>
                  {handover === 'delivery' && <div className="flex justify-between"><span>Delivery</span><span>{delivery ? money(delivery) : 'Free'}</span></div>}
                  <div className="flex justify-between font-extrabold text-[17px] pt-1"><span>To pay</span><span>{money(subtotal + delivery)}</span></div>
                  {pay === 'online' ? (
                    <p className="text-[13px] text-[#6B7894] flex gap-1.5"><ShieldCheck size={15} className="shrink-0 mt-px text-[var(--c)]" /> Pay securely by UPI, card or net banking with Razorpay.</p>
                  ) : (
                    <p className="text-[13px] text-[#6B7894]">Pay cash when you {handover === 'delivery' ? 'get your order' : 'pick it up'}. The shop will confirm your order.</p>
                  )}
                </div>
                {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] p-3 text-[14px] text-[#b91c1c] font-semibold">{error}</p>}
                <button type="submit" disabled={placing} className="w-full h-12 rounded-full bg-[var(--c)] text-white font-bold text-[15px] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer">
                  {placing && <Loader2 size={17} className="animate-spin" />} {pay === 'online' ? `Pay ${money(subtotal + delivery)}` : 'Place order'}
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
                <button type="button" onClick={() => setPanel(null)} className="mt-3 block mx-auto text-[14.5px] font-semibold text-[#4a5672] underline cursor-pointer">Continue shopping</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
