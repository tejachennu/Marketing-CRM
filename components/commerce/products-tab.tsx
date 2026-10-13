'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, BookOpen, Loader2, Pencil, Plus, RefreshCw, Search, Send, ShoppingBag, Trash2, User, X } from 'lucide-react'
import type { CommerceProduct } from '@/lib/types'
import { useAlert, useConfirm } from '@/lib/dialog-context'
import { toDialablePhone } from '@/lib/campaigns/audience'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { Modal, Pager, cardClass, hintClass, iconButton, inputClass, labelClass, primaryButton, secondaryButton, textareaClass, useDebounced, type ShowToast } from './ui'

const PAGE_SIZE = 24
/** WhatsApp shows at most 30 products in one message. */
const MAX_COLLECTION = 30

const EMPTY_FORM = { id: '', title: '', retailer_id: '', price: '', currency: 'INR', description: '', image_url: '', website_url: '', category: '', inventory_count: '', is_available: true }
type ProductForm = typeof EMPTY_FORM

type ShareTarget =
  | { kind: 'product'; product: CommerceProduct }
  | { kind: 'collection'; products: CommerceProduct[] }
  | { kind: 'catalog' }

interface Recipient {
  contactId?: string
  phone?: string
  label: string
}

const fromMeta = (product: CommerceProduct) => product.metadata?.source === 'meta'
const inStock = (product: CommerceProduct) => product.is_available && (product.inventory_count ?? 1) > 0

interface ProductsTabProps {
  orgId: string
  currency: string
  canEdit: boolean
  canManageStore: boolean
  /** A Meta catalog is linked, so products can be sent as WhatsApp catalog messages. */
  catalogLinked: boolean
  onCount: (count: number) => void
  showToast: ShowToast
}

export function ProductsTab({ orgId, currency, canEdit, canManageStore, catalogLinked, onCount, showToast }: ProductsTabProps) {
  const alert = useAlert()
  const confirm = useConfirm()

  const [products, setProducts] = useState<CommerceProduct[]>([])
  const [search, setSearch] = useState('')
  const appliedSearch = useDebounced(search)
  const [availability, setAvailability] = useState<'all' | 'available' | 'unavailable'>('all')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)

  // Products selected for a collection. Kept by id so the selection survives paging and searching.
  const [picked, setPicked] = useState<Map<string, CommerceProduct>>(new Map())

  const [form, setForm] = useState<ProductForm | null>(null)
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [share, setShare] = useState<ShareTarget | null>(null)

  const requestRef = useRef(0)
  const filtered = Boolean(appliedSearch.trim()) || availability !== 'all'

  const load = useCallback(async (targetPage: number, options: { silent?: boolean } = {}) => {
    const requestId = ++requestRef.current
    if (!options.silent) setLoading(true)
    try {
      const params = new URLSearchParams({ organizationId: orgId, page: String(targetPage), limit: String(PAGE_SIZE), availability })
      if (appliedSearch.trim()) params.set('search', appliedSearch.trim())
      const res = await fetch(`/api/commerce/products?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (requestId !== requestRef.current) return
      if (!res.ok) throw new Error(data.error || 'Products could not be loaded')

      setProducts(data.products || [])
      setPagination({ total: data.pagination?.total || 0, pages: data.pagination?.pages || 1 })
      setPage(targetPage)
      setError('')
      // The tab shows how many products the store has, not how many match a search
      if (!appliedSearch.trim() && availability === 'all') onCount(data.pagination?.total || 0)

      if ((data.products || []).length === 0 && (data.pagination?.total || 0) > 0 && targetPage > 1) {
        load(Math.min(targetPage - 1, data.pagination.pages), options)
      }
    } catch (err: any) {
      if (requestId !== requestRef.current) return
      if (!options.silent) setError(err.message || 'Products could not be loaded')
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [orgId, appliedSearch, availability, onCount])

  useEffect(() => {
    load(1)
  }, [load])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setForm(null)
      setShare(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function syncCatalog() {
    setIsSyncing(true)
    try {
      const res = await fetch('/api/commerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'sync_meta' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The catalog could not be synced')
      await load(1, { silent: true })
      const removed = data.removed ? ` ${data.removed} no longer in the catalog ${data.removed === 1 ? 'was' : 'were'} removed.` : ''
      if (data.error) showToast('error', `Synced ${data.synced || 0} of ${data.total || 0} products. Some could not be saved: ${data.error}`)
      else showToast('success', `${data.synced || 0} product${data.synced === 1 ? '' : 's'} synced from your Meta catalog.${removed}`)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setIsSyncing(false)
    }
  }

  const openNew = () => {
    setFormError('')
    setForm({ ...EMPTY_FORM, currency })
  }
  const openEdit = (product: CommerceProduct) => {
    setFormError('')
    setForm({
      id: product.id,
      title: product.title,
      retailer_id: product.retailer_id,
      price: String(product.price ?? ''),
      currency: String(product.currency || currency).toUpperCase(),
      description: product.description || '',
      image_url: product.image_url || '',
      website_url: product.website_url || '',
      category: product.category || '',
      inventory_count: product.inventory_count === null || product.inventory_count === undefined ? '' : String(product.inventory_count),
      is_available: product.is_available !== false,
    })
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return
    setFormError('')
    setIsSaving(true)
    try {
      const { id, ...fields } = form
      const res = await fetch('/api/commerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, product: id ? { id, ...fields } : fields }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The product could not be saved')
      setForm(null)
      await load(id ? page : 1, { silent: true })
      // A ticked product keeps its ticks but shows its new details
      if (data.product && picked.has(data.product.id)) setPicked((current) => new Map(current).set(data.product.id, data.product))
      showToast('success', `“${data.product?.title || 'Product'}” was saved.`)
    } catch (err: any) {
      setFormError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteProduct(product: CommerceProduct) {
    const confirmed = await confirm({
      title: 'Remove this product?',
      message: fromMeta(product)
        ? `“${product.title}” will be removed from this list. It stays in your Meta catalog, and the next catalog sync brings it back.`
        : `“${product.title}” will be removed. Orders that already contain it keep their details.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/commerce/products?organizationId=${orgId}&id=${product.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The product could not be removed')
      setPicked((current) => {
        const next = new Map(current)
        next.delete(product.id)
        return next
      })
      await load(page, { silent: true })
    } catch (err: any) {
      showToast('error', err.message)
    }
  }

  const togglePicked = (product: CommerceProduct) => {
    if (!picked.has(product.id) && picked.size >= MAX_COLLECTION) {
      showToast('error', `WhatsApp shows at most ${MAX_COLLECTION} products in one message.`)
      return
    }
    setPicked((current) => {
      const next = new Map(current)
      if (next.has(product.id)) next.delete(product.id)
      else next.set(product.id, product)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className={`${cardClass} p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
            <input type="text" inputMode="search" aria-label="Search products" placeholder="Search by name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pl-9 pr-8`} />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X size={13} />
              </button>
            )}
          </div>
          <div role="group" aria-label="Filter by availability" className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg self-start">
            {([
              { id: 'all', label: 'All' },
              { id: 'available', label: 'Available' },
              { id: 'unavailable', label: 'Unavailable' },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={availability === option.id}
                onClick={() => setAvailability(option.id)}
                className={`h-8 px-3 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                  availability === option.id ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && catalogLinked && (
            <button type="button" onClick={() => setShare({ kind: 'catalog' })} title="Send a button that opens your whole catalog in WhatsApp" className={secondaryButton}>
              <BookOpen size={13} /> Send catalog
            </button>
          )}
          {canManageStore && (
            <>
              <button type="button" onClick={syncCatalog} disabled={isSyncing || !catalogLinked} title={catalogLinked ? 'Copy products from your Meta catalog' : 'Link a Meta catalog in Store settings first'} className={secondaryButton}>
                <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing…' : 'Sync from Meta'}
              </button>
              <button type="button" onClick={openNew} className={primaryButton}>
                <Plus size={14} /> Add product
              </button>
            </>
          )}
        </div>
      </div>

      {/* Products ticked for one message */}
      {picked.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-lg">
          <p className="text-xs font-medium">
            <strong className="font-bold">{picked.size} product{picked.size === 1 ? '' : 's'}</strong> selected to send together{picked.size >= MAX_COLLECTION ? ' (the most WhatsApp allows)' : ''}.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPicked(new Map())} className="h-8 px-3 rounded-lg text-xs font-semibold hover:bg-white/10 dark:hover:bg-slate-900/10 cursor-pointer">
              Clear
            </button>
            <button type="button" onClick={() => setShare({ kind: 'collection', products: [...picked.values()] })} className="h-8 px-3 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
              <Send size={12} /> Send as a collection
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className={`${cardClass} py-16 flex items-center justify-center gap-2 text-sm text-slate-500`}>
          <Loader2 size={18} className="animate-spin text-emerald-500" /> Loading products…
        </div>
      ) : error ? (
        <div role="alert" className={`${cardClass} py-12 px-6 text-center`}>
          <AlertCircle size={26} className="mx-auto text-rose-500" />
          <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Products could not be loaded</p>
          <p className="mt-1 text-xs text-slate-500 break-words">{error}</p>
          <button type="button" onClick={() => load(page)} className={`${primaryButton} mt-3`}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className={`${cardClass} py-14 px-6 text-center`}>
          <ShoppingBag size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
          <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{filtered ? 'No products match' : 'No products yet'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {filtered
              ? 'Try a different name, SKU or filter.'
              : catalogLinked
                ? 'Press “Sync from Meta” to list what customers can buy on WhatsApp.'
                : 'Link your Meta catalog in Store settings to sell in WhatsApp, or add a product to share as a website link.'}
          </p>
          {filtered && (
            <button type="button" onClick={() => { setSearch(''); setAvailability('all') }} className="mt-3 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer">
              Show all products
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((product) => {
              const available = inStock(product)
              const isPicked = picked.has(product.id)
              // Only items that are in the Meta catalog can go into a WhatsApp cart
              const canCollect = canEdit && catalogLinked && available
              return (
                <div key={product.id} className={`${cardClass} overflow-hidden flex flex-col transition-shadow ${isPicked ? 'ring-2 ring-[#00a884]' : ''}`}>
                  <div className="relative h-40 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    {product.image_url ? (
                      // Catalog images live on arbitrary CDNs, so a plain img is used rather than next/image
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image_url} alt="" loading="lazy" className={`w-full h-full object-cover ${available ? '' : 'opacity-60 grayscale'}`} />
                    ) : (
                      <ShoppingBag size={36} className="text-slate-300 dark:text-slate-600" />
                    )}
                    <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
                      {!available && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-900/80 text-white">{product.is_available ? 'Out of stock' : 'Unavailable'}</span>}
                      {fromMeta(product) && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/90 text-emerald-700 shadow-sm">WhatsApp catalog</span>}
                    </div>
                    {canCollect && (
                      <label className="absolute top-2 right-2 h-7 px-2 rounded-full bg-white/95 dark:bg-slate-900/90 shadow-sm inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none" title="Select several products to send them in one message">
                        <input type="checkbox" checked={isPicked} onChange={() => togglePicked(product)} className="h-3.5 w-3.5 rounded accent-[#00a884] cursor-pointer" />
                        {isPicked ? 'Selected' : 'Select'}
                      </label>
                    )}
                  </div>
                  <div className="p-3.5 flex-1 flex flex-col gap-2.5">
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate" title={product.title}>{product.title}</h3>
                      <p className="text-[11px] text-slate-500 truncate">SKU {product.retailer_id}{product.category ? ` · ${product.category}` : ''}</p>
                      {product.description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{product.description}</p>}
                    </div>
                    <div className="mt-auto pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <span className="font-bold text-base text-slate-900 dark:text-white tabular-nums">{formatMoney(product.price, product.currency)}</span>
                      <div className="flex items-center gap-0.5">
                        {canManageStore && (
                          <>
                            <button type="button" aria-label={`Edit ${product.title}`} title="Edit" onClick={() => openEdit(product)} className={iconButton}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" aria-label={`Remove ${product.title}`} title="Remove" onClick={() => deleteProduct(product)} className={`${iconButton} hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30`}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        {canEdit && (
                          <button type="button" onClick={() => setShare({ kind: 'product', product })} className={`${primaryButton} h-8 px-3 ml-1`}>
                            <Send size={12} /> Share
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <Pager page={page} pages={pagination.pages} total={pagination.total} pageSize={PAGE_SIZE} shown={products.length} noun={filtered ? 'matching products' : 'products'} onPage={(target) => load(target)} />
        </>
      )}

      {share && (
        <ShareModal
          orgId={orgId}
          target={share}
          catalogLinked={catalogLinked}
          onClose={() => setShare(null)}
          onSent={(message) => {
            if (share.kind === 'collection') setPicked(new Map())
            setShare(null)
            showToast('success', message)
          }}
          onError={(message) => alert({ title: 'Message not sent', message })}
        />
      )}

      {form && (
        <Modal title={form.id ? 'Edit product' : 'Add product'} onClose={() => setForm(null)} wide>
          <form onSubmit={saveProduct} className="space-y-3.5">
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {form.id && products.find((product) => product.id === form.id && fromMeta(product))
                ? 'This product is a copy of an item in your Meta catalog. Changes made here are replaced by the next catalog sync; change the price or photo in Commerce Manager to keep them.'
                : 'Products added here are saved in this CRM only. To sell one from the WhatsApp cart, add it to your Meta catalog with the same SKU.'}
            </p>
            {formError && (
              <p role="alert" className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-200">
                <AlertCircle size={14} className="shrink-0 mt-px" /> {formError}
              </p>
            )}
            <div>
              <label htmlFor="product-title" className={labelClass}>Name</label>
              <input id="product-title" type="text" required maxLength={150} autoFocus placeholder="Classic white linen shirt" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label htmlFor="product-sku" className={labelClass}>SKU</label>
                <input id="product-sku" type="text" required maxLength={100} placeholder="SHIRT-001" value={form.retailer_id} onChange={(event) => setForm({ ...form, retailer_id: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="product-price" className={labelClass}>Price</label>
                <input id="product-price" type="number" required min={0} step="0.01" placeholder="1499" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="product-currency" className={labelClass}>Currency</label>
                <select id="product-currency" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} className={inputClass}>
                  {[...new Set([form.currency, currency, 'INR', 'USD', 'EUR', 'GBP'])].map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="product-category" className={labelClass}>Category (optional)</label>
                <input id="product-category" type="text" maxLength={60} placeholder="Shirts" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="product-stock" className={labelClass}>In stock (optional)</label>
                <input id="product-stock" type="number" min={0} step={1} placeholder="Not tracked" value={form.inventory_count} onChange={(event) => setForm({ ...form, inventory_count: event.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label htmlFor="product-description" className={labelClass}>Description (optional)</label>
              <textarea id="product-description" rows={2} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={textareaClass} />
            </div>
            <div>
              <label htmlFor="product-image" className={labelClass}>Image link (optional)</label>
              <input id="product-image" type="url" placeholder="https://…" value={form.image_url} onChange={(event) => setForm({ ...form, image_url: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor="product-url" className={labelClass}>Product page on your website (optional)</label>
              <input id="product-url" type="url" placeholder="https://yourstore.com/products/…" value={form.website_url} onChange={(event) => setForm({ ...form, website_url: event.target.value })} className={inputClass} />
              <p className={hintClass}>Needed to share this product as a website link.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.is_available} onChange={(event) => setForm({ ...form, is_available: event.target.checked })} className="h-4 w-4 rounded accent-[#00a884]" />
              Available to sell
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setForm(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSaving} className={primaryButton}>
                {isSaving && <Loader2 size={13} className="animate-spin" />}
                {isSaving ? 'Saving…' : 'Save product'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Send a product, a collection or the catalog to a customer ───────────────

interface ShareModalProps {
  orgId: string
  target: ShareTarget
  catalogLinked: boolean
  onClose: () => void
  onSent: (message: string) => void
  onError: (message: string) => void
}

function ShareModal({ orgId, target, catalogLinked, onClose, onSent, onError }: ShareModalProps) {
  const product = target.kind === 'product' ? target.product : null
  const canSendCard = catalogLinked
  const canSendLink = Boolean(product?.website_url)

  const [mode, setMode] = useState<'single_product' | 'website_redirect'>(canSendCard ? 'single_product' : 'website_redirect')
  const [query, setQuery] = useState('')
  const appliedQuery = useDebounced(query, 250)
  const [matches, setMatches] = useState<Array<{ id: string; first_name?: string | null; last_name?: string | null; phone_number?: string | null }>>([])
  const [searching, setSearching] = useState(false)
  const [recipient, setRecipient] = useState<Recipient | null>(null)
  const [message, setMessage] = useState(
    target.kind === 'product'
      ? `Check out ${target.product.title} for ${formatMoney(target.product.price, target.product.currency)}:`
      : target.kind === 'collection'
        ? 'Here are a few things we picked for you. Tap one to see it and add it to your cart.'
        : 'Tap below to browse our catalog and place your order.'
  )
  const [isSending, setIsSending] = useState(false)

  // Look contacts up by name or number as the user types
  useEffect(() => {
    const term = appliedQuery.trim()
    if (recipient || term.length < 2) {
      setMatches([])
      return
    }
    let stale = false
    setSearching(true)
    fetch(`/api/contacts?organizationId=${orgId}&fields=basic&limit=6&search=${encodeURIComponent(term)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!stale) setMatches(data.contacts || [])
      })
      .catch(() => {
        if (!stale) setMatches([])
      })
      .finally(() => {
        if (!stale) setSearching(false)
      })
    return () => {
      stale = true
    }
  }, [appliedQuery, orgId, recipient])

  const typedPhone = toDialablePhone(query)
  const title = target.kind === 'product' ? 'Send product on WhatsApp' : target.kind === 'collection' ? `Send ${target.products.length} products on WhatsApp` : 'Send your catalog on WhatsApp'
  const blocked = target.kind === 'product' ? (mode === 'single_product' ? !canSendCard : !canSendLink) : !catalogLinked

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!recipient || blocked) return
    setIsSending(true)
    try {
      const payload =
        target.kind === 'product'
          ? { productRetailerId: target.product.retailer_id, productTitle: target.product.title, bodyText: message, websiteUrl: target.product.website_url || undefined }
          : target.kind === 'collection'
            ? { productRetailerIds: target.products.map((item) => item.retailer_id), bodyText: message }
            : { bodyText: message }
      const res = await fetch('/api/commerce/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          type: target.kind === 'product' ? mode : target.kind === 'collection' ? 'multi_product' : 'catalog',
          ...(recipient.contactId ? { contactId: recipient.contactId } : { phone: recipient.phone }),
          payload,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The message could not be sent')
      const what = target.kind === 'product' ? `“${target.product.title}”` : target.kind === 'collection' ? `${target.products.length} products` : 'Your catalog'
      onSent(`${what} ${target.kind === 'collection' ? 'were' : 'was'} sent to ${recipient.label}.`)
    } catch (err: any) {
      onError(err.message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={send} className="space-y-4">
        {/* What is being sent */}
        {target.kind === 'product' && (
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 flex items-center gap-3">
            {target.product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={target.product.image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-12 h-12 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-400"><ShoppingBag size={20} /></div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{target.product.title}</p>
              <p className="text-xs text-slate-500">{formatMoney(target.product.price, target.product.currency)} · SKU {target.product.retailer_id}</p>
            </div>
          </div>
        )}
        {target.kind === 'collection' && (
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-white mb-1">In this message</p>
            <p className="line-clamp-3">{target.products.map((item) => item.title).join(' · ')}</p>
          </div>
        )}
        {target.kind === 'catalog' && (
          <p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-300">
            The customer gets a button that opens your whole catalog inside WhatsApp, where they can add items to a cart and send it to you.
          </p>
        )}

        {/* Who it goes to */}
        <div>
          <label htmlFor="share-recipient" className={labelClass}>Send to</label>
          {recipient ? (
            <div className="flex items-center justify-between gap-2 h-9 pl-3 pr-1 rounded-lg border border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 text-[13px]">
              <span className="flex items-center gap-2 min-w-0 text-slate-900 dark:text-white">
                <User size={13} className="shrink-0 text-emerald-600" />
                <span className="truncate font-medium">{recipient.label}</span>
              </span>
              <button type="button" aria-label="Choose someone else" onClick={() => { setRecipient(null); setQuery('') }} className={iconButton}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="relative">
              <input id="share-recipient" type="text" autoFocus autoComplete="off" placeholder="Name or WhatsApp number" value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} />
              {query.trim().length >= 2 && (
                <ul className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden text-[13px]">
                  {matches.map((contact) => {
                    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.phone_number || 'Contact'
                    return (
                      <li key={contact.id}>
                        <button type="button" onClick={() => setRecipient({ contactId: contact.id, label: name })} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                          <span className="block font-medium text-slate-900 dark:text-white truncate">{name}</span>
                          <span className="block text-xs text-slate-500">{contact.phone_number || 'No phone number'}</span>
                        </button>
                      </li>
                    )
                  })}
                  {typedPhone && !matches.some((contact) => toDialablePhone(contact.phone_number) === typedPhone) && (
                    <li>
                      <button type="button" onClick={() => setRecipient({ phone: typedPhone, label: typedPhone })} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                        <span className="block font-medium text-slate-900 dark:text-white">Send to {typedPhone}</span>
                        <span className="block text-xs text-slate-500">A number that is not in your contacts</span>
                      </button>
                    </li>
                  )}
                  {matches.length === 0 && !typedPhone && (
                    <li className="px-3 py-2 text-xs text-slate-500">{searching ? 'Searching…' : 'No contact found. Type the full number with its country code to send to it.'}</li>
                  )}
                </ul>
              )}
            </div>
          )}
          <p className={hintClass}>WhatsApp only delivers this if the customer has messaged you in the last 24 hours.</p>
        </div>

        {target.kind === 'product' && (
          <fieldset>
            <legend className={labelClass}>Send as</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { id: 'single_product' as const, title: 'Catalog card', detail: 'The customer can add it to a cart in WhatsApp', disabledReason: canSendCard ? '' : 'Link a Meta catalog in Store settings' },
                { id: 'website_redirect' as const, title: 'Website link', detail: 'Opens the product page on your site', disabledReason: canSendLink ? '' : 'This product has no website link' },
              ].map((option) => (
                <label
                  key={option.id}
                  className={`p-3 rounded-xl border text-xs transition-colors ${option.disabledReason ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
                    mode === option.id && !option.disabledReason ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <input type="radio" name="share-type" className="sr-only" disabled={Boolean(option.disabledReason)} checked={mode === option.id} onChange={() => setMode(option.id)} />
                  <span className="block font-bold text-slate-900 dark:text-white">{option.title}</span>
                  <span className="block mt-0.5 text-slate-500 dark:text-slate-400">{option.disabledReason || option.detail}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor="share-message" className={labelClass}>Message</label>
          <textarea id="share-message" rows={2} maxLength={1000} required value={message} onChange={(event) => setMessage(event.target.value)} className={textareaClass} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={isSending || !recipient || blocked || !message.trim()} className={primaryButton}>
            {isSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
