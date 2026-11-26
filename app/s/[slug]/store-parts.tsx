'use client'

/**
 * The store's building blocks, in a big-marketplace style: colour header with a wide search and suggestions,
 * category bar, trust strip, product cards with brand / stars / MRP and % off, rails that scroll sideways,
 * sort and filter (a side panel on wide screens, bottom sheets on phones), and a full footer.
 * Colours come from the shop's own colour (--c); no gradients.
 */

import { useEffect, useRef, useState } from 'react'
import { BadgePercent, Banknote, ChevronRight, Heart, LayoutGrid, Minus, Plus, RotateCcw, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Star, Truck, X } from 'lucide-react'
import { discountPercent, priceRanges, searchSuggestions, shownPrice, SORT_LABELS, type Filters, type SortKey } from '@/lib/commerce/store-browse'
import type { StoreView } from '@/lib/commerce/storefront'

export type Product = StoreView['products'][number]

export function Picture({ src, alt, className, contain = false }: { src: string; alt: string; className: string; contain?: boolean }) {
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLImageElement>(null)
  // A photo that failed before the page came alive never fires onError: check once it has
  useEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [src])
  if (!src || failed) {
    return (
      <div className={`${className} bg-[#f4f6fa] flex items-center justify-center text-[#8a94a8]`}>
        <ShoppingBag size={28} />
      </div>
    )
  }
  // Product photos come from any address the business uses (Meta's catalog, its own site), so a plain img
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`${className} ${contain ? 'object-contain' : 'object-cover'}`} />
}

export function Stepper({ value, onChange, small }: { value: number; onChange: (n: number) => void; small?: boolean }) {
  const size = small ? 'h-8 w-8' : 'h-10 w-10'
  return (
    <div className="inline-flex items-center rounded-md border border-[#d5ddeb] bg-white">
      <button type="button" aria-label="One less" onClick={() => onChange(value - 1)} className={`${size} flex items-center justify-center text-[#0E1B3D] cursor-pointer hover:bg-[#f4f6fa]`}><Minus size={small ? 14 : 16} /></button>
      <span className={`${small ? 'w-7 text-[14px]' : 'w-9 text-[15px]'} text-center font-bold tabular-nums border-x border-[#d5ddeb] leading-8`}>{value}</span>
      <button type="button" aria-label="One more" onClick={() => onChange(value + 1)} className={`${size} flex items-center justify-center text-[#0E1B3D] cursor-pointer hover:bg-[#f4f6fa]`}><Plus size={small ? 14 : 16} /></button>
    </div>
  )
}

/** "4.3 ★" chip, with the number of ratings beside it. */
export function RatingChip({ rating, count, size = 'sm' }: { rating?: number; count?: number; size?: 'sm' | 'md' }) {
  if (!rating) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-0.5 rounded bg-[var(--c)] text-white font-bold ${size === 'md' ? 'h-6 px-2 text-[13px]' : 'h-5 px-1.5 text-[11.5px]'}`}>
        {rating.toFixed(1)} <Star size={size === 'md' ? 12 : 10} className="fill-white" />
      </span>
      {count ? <span className={`text-[#6B7894] font-semibold ${size === 'md' ? 'text-[13.5px]' : 'text-[12px]'}`}>({count.toLocaleString('en-IN')})</span> : null}
    </span>
  )
}

/** ₹799  ~~₹1,599~~  50% off */
export function PriceLine({ p, money, size = 'sm', from }: { p: Product; money: (n: number) => string; size?: 'sm' | 'lg'; from?: boolean }) {
  const price = shownPrice(p)
  const off = discountPercent(p)
  const big = size === 'lg'
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={`font-extrabold text-[#0E1B3D] ${big ? 'text-[28px]' : 'text-[16px]'}`}>
        {from ? <span className={`font-semibold text-[#6B7894] ${big ? 'text-[15px]' : 'text-[12px]'}`}>from </span> : null}{money(price)}
      </span>
      {off > 0 && <s className={`text-[#8a94a8] ${big ? 'text-[16px]' : 'text-[13px]'}`}>{money(p.mrp!)}</s>}
      {off > 0 && <span className={`font-bold text-[var(--c)] ${big ? 'text-[16px]' : 'text-[13px]'}`}>{off}% off</span>}
    </span>
  )
}

const hasManyPrices = (p: Product) => Boolean(p.variants?.length && p.variants.some((v) => v.price !== shownPrice(p)))

/** One product: photo on white, wish heart, brand, name, stars, price with saving, add / choose. */
export function ProductCard({ p, href, money, inCart, onAdd, onQty, wished, onWish, freeFrom, compact = false, wide = false }: {
  p: Product; href: string; money: (n: number) => string; inCart: number; onAdd: () => void; onQty: (n: number) => void
  wished: boolean; onWish: () => void; freeFrom: number; compact?: boolean; wide?: boolean
}) {
  const free = freeFrom > 0 && shownPrice(p) >= freeFrom
  return (
    <article className={`group relative bg-white flex flex-col min-w-0 ${compact ? 'rounded-lg border border-[#e3e8f2]' : 'h-full'} hover:shadow-[0_2px_12px_rgba(14,27,61,0.12)] transition-shadow`}>
      <button type="button" aria-label={wished ? `Remove ${p.title} from saved` : `Save ${p.title}`} aria-pressed={wished} onClick={onWish}
        className="absolute top-2 right-2 z-10 h-8 w-8 rounded-full bg-white/95 shadow-sm flex items-center justify-center cursor-pointer">
        <Heart size={16} className={wished ? 'fill-[#b91c1c] text-[#b91c1c]' : 'text-[#8a94a8]'} />
      </button>
      <a href={href} className="block">
        <div className={`relative ${wide ? 'aspect-[4/5]' : 'aspect-square'} p-3 bg-white`}>
          <Picture src={p.image} alt={p.title} contain className={`h-full w-full ${p.inStock ? '' : 'opacity-40 grayscale'}`} />
          {!p.inStock && <span className="absolute inset-x-0 bottom-3 mx-auto w-fit px-2.5 py-1 rounded bg-[#0E1B3D]/85 text-white text-[11.5px] font-bold">Out of stock</span>}
        </div>
        <div className={compact ? 'px-2.5 pb-1' : 'px-3 pb-1'}>
          {p.brand && <p className="text-[12px] font-semibold text-[#8a94a8] truncate">{p.brand}</p>}
          <h3 className={`text-[#0E1B3D] leading-snug line-clamp-2 group-hover:text-[var(--c)] ${compact ? 'text-[13px] min-h-[2.5em]' : 'text-[14px] min-h-[2.6em]'}`}>{p.title}</h3>
          {p.rating ? <div className="mt-1"><RatingChip rating={p.rating} count={p.ratingCount} /></div> : null}
          <div className="mt-1"><PriceLine p={p} money={money} from={hasManyPrices(p)} /></div>
          {free && !compact && <p className="mt-0.5 text-[12px] text-[#4a5672]">Free delivery</p>}
        </div>
      </a>
      <div className={`mt-auto ${compact ? 'p-2.5 pt-1.5' : 'p-3 pt-2'}`}>
        {!p.inStock ? (
          <p className="h-9 leading-9 text-center text-[12.5px] font-semibold text-[#8a94a8]">Not available now</p>
        ) : p.variants?.length ? (
          <a href={href} className="block h-9 leading-[34px] text-center rounded-md border border-[var(--c)] text-[var(--c)] text-[13.5px] font-bold hover:bg-[var(--c)] hover:text-white transition-colors">Choose options</a>
        ) : inCart ? (
          <div className="flex justify-center"><Stepper small value={inCart} onChange={onQty} /></div>
        ) : (
          <button type="button" onClick={onAdd} className="w-full h-9 rounded-md bg-[var(--c)] text-white text-[13.5px] font-bold cursor-pointer hover:opacity-90">Add to cart</button>
        )}
      </div>
    </article>
  )
}

/** A titled row of products that scrolls sideways, with "View all". */
export function Rail({ title, note, onViewAll, children }: { title: string; note?: string; onViewAll?: () => void; children: React.ReactNode }) {
  return (
    <section className="bg-white sm:rounded-lg border-y sm:border border-[#e3e8f2]">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-[#eef1f6]">
        <div className="min-w-0 mr-auto">
          <h2 className="text-[18px] sm:text-[20px] font-extrabold text-[#0E1B3D] truncate">{title}</h2>
          {note && <p className="text-[12.5px] text-[#6B7894]">{note}</p>}
        </div>
        {onViewAll && (
          <button type="button" onClick={onViewAll} className="shrink-0 h-9 px-3.5 rounded-md bg-[var(--c)] text-white text-[13px] font-bold inline-flex items-center gap-1 cursor-pointer">
            View all <ChevronRight size={15} />
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar p-3 sm:p-4 snap-x">{children}</div>
    </section>
  )
}

/** The four promises every good shop states up front. */
export function TrustStrip({ store, money }: { store: StoreView; money: (n: number) => string }) {
  const items = [
    store.delivery && { icon: Truck, title: store.deliveryFee && store.freeFrom ? `Free delivery above ${money(store.freeFrom)}` : store.deliveryFee ? 'Home delivery' : 'Free home delivery', note: store.pinCheck ? 'Check your PIN code' : 'To your door' },
    store.payLater && { icon: Banknote, title: store.delivery ? 'Cash on delivery' : 'Pay at pick up', note: 'Pay when you get it' },
    store.returns?.on && { icon: RotateCcw, title: `${store.returns.days}-day returns`, note: 'Easy return requests' },
    { icon: ShieldCheck, title: store.payOnline ? 'Secure payments' : 'Trusted local shop', note: store.payOnline ? 'UPI, cards, net banking' : 'Order on WhatsApp too' },
  ].filter(Boolean) as { icon: typeof Truck; title: string; note: string }[]
  return (
    <section aria-label="Why shop here" className={`bg-white sm:rounded-lg border-y sm:border border-[#e3e8f2] grid grid-cols-2 ${['lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4'][items.length - 1]}`}>
      {items.map(({ icon: Icon, title, note }, i) => (
        // An odd last one takes the whole row on phones (no half-empty row)
        <div key={title} className={`flex items-center gap-3 p-3 sm:p-4 min-w-0 ${i % 2 ? 'border-l' : ''} ${i >= 2 ? 'border-t lg:border-t-0' : ''} ${items.length % 2 && i === items.length - 1 ? 'col-span-2 lg:col-span-1' : ''} lg:border-l lg:first:border-l-0 border-[#eef1f6]`}>
          <span className="h-10 w-10 shrink-0 rounded-full bg-[var(--c)]/10 text-[var(--c)] flex items-center justify-center"><Icon size={19} /></span>
          <span className="min-w-0">
            <span className="block text-[13px] sm:text-[14px] font-bold text-[#0E1B3D] leading-tight">{title}</span>
            <span className="block text-[11.5px] sm:text-[12.5px] text-[#6B7894] truncate">{note}</span>
          </span>
        </div>
      ))}
    </section>
  )
}

/** The search box with suggestions (categories, then products) as you type; forgiving of spelling. */
export function SearchBox({ products, value, onChange, onSubmit, onCategory, productHref, money, autoFocus }: {
  products: Product[]; value: string; onChange: (v: string) => void; onSubmit: () => void; onCategory: (name: string) => void
  productHref: (id: string) => string; money: (n: number) => string; autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const suggestions = open ? searchSuggestions(products, value, 7) : []
  return (
    <form ref={box} role="search" onSubmit={(e) => { e.preventDefault(); setOpen(false); onSubmit() }} className="relative w-full">
      <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--c)]" aria-hidden />
      <input
        value={value} autoFocus={autoFocus} onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        placeholder="Search for products, brands and more" aria-label="Search products" enterKeyHint="search"
        className="w-full h-11 pl-11 pr-10 rounded-md bg-white text-[15px] text-[#0E1B3D] placeholder:text-[#8a94a8] shadow-sm focus:outline-none focus:ring-2 focus:ring-white/60"
      />
      {value && <button type="button" aria-label="Clear search" onClick={() => { onChange(''); onSubmit() }} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full text-[#6B7894] flex items-center justify-center cursor-pointer"><X size={16} /></button>}
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Suggestions" className="absolute z-40 left-0 right-0 top-full mt-1 rounded-md bg-white shadow-xl border border-[#e3e8f2] overflow-hidden text-[#0E1B3D]">
          {suggestions.map((s) => s.kind === 'category' ? (
            <li key={`c:${s.name}`}>
              <button type="button" onClick={() => { setOpen(false); onCategory(s.name) }} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f4f6fa] cursor-pointer">
                <LayoutGrid size={16} className="text-[#8a94a8]" /> <span className="text-[14px]"><b>{s.name}</b> <span className="text-[#6B7894]">in categories</span></span>
              </button>
            </li>
          ) : (
            <li key={s.product.id}>
              <a href={productHref(s.product.id)} className="flex items-center gap-3 px-4 py-2 hover:bg-[#f4f6fa]">
                <Picture src={s.product.image} alt="" contain className="h-10 w-10 shrink-0 rounded bg-white" />
                <span className="min-w-0 flex-1 text-[14px] truncate">{s.product.title}</span>
                <span className="shrink-0 text-[13.5px] font-bold">{money(shownPrice(s.product))}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

// ── Sort and filter ─────────────────────────────────────────────────────────

const DISCOUNTS = [10, 25, 50]
const RATINGS = [4, 3]

/** The filters as a list of sections (the side panel and the phone sheet show the same). */
export function FilterPanel({ products, categories, category, onCategory, filters, onFilters, money }: {
  products: Product[]; categories: string[]; category: string | null; onCategory: (c: string | null) => void
  filters: Filters; onFilters: (f: Filters) => void; money: (n: number) => string
}) {
  const ranges = priceRanges(products)
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean) as string[])].sort().slice(0, 12)
  const hasRatings = products.some((p) => p.rating)
  const hasDeals = products.some((p) => discountPercent(p) > 0)
  const box = 'py-4 border-b border-[#eef1f6]'
  const head = 'text-[12px] font-bold uppercase tracking-wide text-[#4a5672] mb-2.5'
  const option = 'flex items-center gap-2.5 py-1.5 text-[14px] text-[#0E1B3D] cursor-pointer'
  const rangeLabel = ([lo, hi]: [number, number | null]) => (lo === 0 ? `Under ${money(hi!)}` : hi === null ? `${money(lo)} and above` : `${money(lo)} – ${money(hi)}`)
  return (
    <div className="px-4">
      {categories.length > 1 && (
        <div className={box}>
          <p className={head}>Categories</p>
          <ul>
            <li><button type="button" onClick={() => onCategory(null)} className={`py-1.5 text-[14px] cursor-pointer ${!category ? 'font-bold text-[var(--c)]' : 'text-[#0E1B3D]'}`}>All products</button></li>
            {categories.map((c) => (
              <li key={c}><button type="button" onClick={() => onCategory(c)} className={`py-1.5 text-left text-[14px] cursor-pointer ${category === c ? 'font-bold text-[var(--c)]' : 'text-[#0E1B3D]'}`}>{c}</button></li>
            ))}
          </ul>
        </div>
      )}
      {ranges.length > 0 && (
        <fieldset className={box}>
          <legend className={head}>Price</legend>
          {ranges.map((r) => {
            const on = filters.price?.[0] === r[0] && filters.price?.[1] === r[1]
            return (
              <label key={r.join('-')} className={option}>
                <input type="radio" name="price" checked={on} onChange={() => onFilters({ ...filters, price: r })} className="h-4 w-4 accent-[var(--c)]" /> {rangeLabel(r)}
              </label>
            )
          })}
          {filters.price && <button type="button" onClick={() => onFilters({ ...filters, price: null })} className="mt-1 text-[13px] font-semibold text-[var(--c)] cursor-pointer">Any price</button>}
        </fieldset>
      )}
      {hasDeals && (
        <fieldset className={box}>
          <legend className={head}>Discount</legend>
          {DISCOUNTS.map((d) => (
            <label key={d} className={option}>
              <input type="radio" name="discount" checked={filters.minDiscount === d} onChange={() => onFilters({ ...filters, minDiscount: d })} className="h-4 w-4 accent-[var(--c)]" /> {d}% or more
            </label>
          ))}
          {filters.minDiscount ? <button type="button" onClick={() => onFilters({ ...filters, minDiscount: 0 })} className="mt-1 text-[13px] font-semibold text-[var(--c)] cursor-pointer">Any discount</button> : null}
        </fieldset>
      )}
      {hasRatings && (
        <fieldset className={box}>
          <legend className={head}>Customer ratings</legend>
          {RATINGS.map((r) => (
            <label key={r} className={option}>
              <input type="radio" name="rating" checked={filters.minRating === r} onChange={() => onFilters({ ...filters, minRating: r })} className="h-4 w-4 accent-[var(--c)]" /> {r}★ and above
            </label>
          ))}
          {filters.minRating ? <button type="button" onClick={() => onFilters({ ...filters, minRating: 0 })} className="mt-1 text-[13px] font-semibold text-[var(--c)] cursor-pointer">Any rating</button> : null}
        </fieldset>
      )}
      {brands.length > 1 && (
        <fieldset className={box}>
          <legend className={head}>Brand</legend>
          {brands.map((b) => {
            const on = filters.brands?.includes(b) || false
            return (
              <label key={b} className={option}>
                <input type="checkbox" checked={on} onChange={() => onFilters({ ...filters, brands: on ? (filters.brands || []).filter((x) => x !== b) : [...(filters.brands || []), b] })} className="h-4 w-4 accent-[var(--c)]" /> {b}
              </label>
            )
          })}
        </fieldset>
      )}
      <div className="py-4">
        <label className={option}>
          <input type="checkbox" checked={filters.inStock === true} onChange={(e) => onFilters({ ...filters, inStock: e.target.checked })} className="h-4 w-4 accent-[var(--c)]" /> Only what is in stock
        </label>
      </div>
    </div>
  )
}

/** Sort choices as tabs (wide screens). */
export function SortTabs({ sort, onSort }: { sort: SortKey; onSort: (s: SortKey) => void }) {
  return (
    <div role="tablist" aria-label="Sort by" className="hidden sm:flex items-center gap-1 text-[14px] overflow-x-auto no-scrollbar">
      <span className="shrink-0 font-bold text-[#0E1B3D] mr-2">Sort by</span>
      {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
        <button key={key} type="button" role="tab" aria-selected={sort === key} onClick={() => onSort(key)}
          className={`shrink-0 h-9 px-3 cursor-pointer border-b-2 ${sort === key ? 'border-[var(--c)] text-[var(--c)] font-bold' : 'border-transparent text-[#4a5672] hover:text-[#0E1B3D]'}`}>
          {SORT_LABELS[key]}
        </button>
      ))}
    </div>
  )
}

/** A sheet that slides up from the bottom (phones): sort or filter. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-md max-h-[85vh] rounded-t-2xl sm:rounded-2xl flex flex-col">
        <div className="h-14 px-4 flex items-center border-b border-[#eef1f6] shrink-0">
          <p className="flex-1 text-[16px] font-extrabold text-[#0E1B3D]">{title}</p>
          <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 rounded-full hover:bg-[#f4f6fa] flex items-center justify-center cursor-pointer"><X size={19} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="p-3 border-t border-[#eef1f6] shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

export function OffersList({ store, money }: { store: StoreView; money: (n: number) => string }) {
  const lines = [
    ...store.offers.map((o) => o.title),
    ...(store.hasCodes ? ['Have a code? Use it at checkout.'] : []),
    ...(store.loyalty?.on ? [`Get ${store.loyalty.percent}% back as points on every order.`] : []),
    ...(store.delivery && store.deliveryFee && store.freeFrom ? [`Free delivery on orders above ${money(store.freeFrom)}.`] : []),
  ]
  if (!lines.length) return null
  return (
    <div className="mt-5">
      <h2 className="text-[15px] font-extrabold text-[#0E1B3D]">Available offers</h2>
      <ul className="mt-2 space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-[14px] text-[#0E1B3D]"><BadgePercent size={17} className="shrink-0 mt-px text-[var(--c)]" /> <span><b>Offer</b> · {line}</span></li>
        ))}
      </ul>
    </div>
  )
}

export { SlidersHorizontal }
