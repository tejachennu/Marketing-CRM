'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react'
import { PhoneField } from '@/components/phone-field'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { Modal, hintClass, inputClass, labelClass, primaryButton, secondaryButton, textareaClass, useDebounced, type ShowToast } from './ui'

interface Line {
  key: string
  productId: string | null
  title: string
  price: string
  quantity: number
  image?: string | null
}

const choice = (active: boolean) =>
  `flex-1 min-w-0 h-10 px-3 rounded-lg border text-[13px] font-semibold cursor-pointer transition-colors ${active ? 'border-[#008069] bg-[#008069]/10 text-[#008069]' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`

/** Add an order taken in the shop or on a phone call: who, what, how they get it, and how they pay. */
export function NewOrderModal({ orgId, currency, onClose, onCreated, showToast }: { orgId: string; currency: string; onClose: () => void; onCreated: (order: any) => void; showToast: ShowToast }) {
  const [channel, setChannel] = useState<'in_store' | 'phone'>('in_store')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [query, setQuery] = useState('')
  const searched = useDebounced(query, 250)
  const [found, setFound] = useState<any[]>([])
  const [handover, setHandover] = useState<'now' | 'pickup' | 'delivery'>('now')
  const [paid, setPaid] = useState(true)
  const [method, setMethod] = useState<'cash' | 'upi' | 'card'>('cash')
  const [address, setAddress] = useState({ address_line_1: '', address_line_2: '', city: '', state: '', pincode: '' })
  const [deliveryFee, setDeliveryFee] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // A phone order is never handed over on the spot
  useEffect(() => {
    if (channel === 'phone' && handover === 'now') setHandover('pickup')
  }, [channel, handover])
  useEffect(() => {
    if (handover === 'now') setPaid(true)
  }, [handover])

  useEffect(() => {
    const term = searched.trim()
    if (term.length < 2) return setFound([])
    let stale = false
    fetch(`/api/commerce/products?organizationId=${orgId}&limit=8&search=${encodeURIComponent(term)}`)
      .then((res) => res.json())
      .then((data) => !stale && setFound(data.products || []))
      .catch(() => !stale && setFound([]))
    return () => {
      stale = true
    }
  }, [searched, orgId])

  const addProduct = (product: any) => {
    setLines((current) => {
      const same = current.find((line) => line.productId === product.id)
      if (same) return current.map((line) => (line === same ? { ...line, quantity: line.quantity + 1 } : line))
      return [...current, { key: product.id, productId: product.id, title: product.title, price: String(product.price ?? ''), quantity: 1, image: product.image_url }]
    })
    setQuery('')
    setFound([])
  }
  const addTyped = () => setLines((current) => [...current, { key: `t${Date.now()}`, productId: null, title: query.trim(), price: '', quantity: 1 }])
  const change = (key: string, changes: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)))

  const subtotal = lines.reduce((sum, line) => sum + (Number(line.price) || 0) * line.quantity, 0)
  const fee = handover === 'delivery' ? Number(deliveryFee) || 0 : 0

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          action: 'create',
          channel,
          customer: { name: name.trim(), phone: phone.trim() },
          items: lines.map((line) => ({ productId: line.productId, title: line.title.trim(), price: line.price === '' ? null : line.price, quantity: line.quantity })),
          handover,
          paid,
          paymentMethod: paid ? method : null,
          shippingFee: handover === 'delivery' && deliveryFee !== '' ? deliveryFee : null,
          address: handover === 'delivery' ? { ...address, full_name: name.trim(), phone_number: phone.trim() } : null,
          note: note.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The order could not be saved')
      showToast('success', `Order #${data.order?.order_number} saved.`)
      onCreated(data.order)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New order" onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div>
          <span className={labelClass}>Where did it come from?</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setChannel('in_store')} className={choice(channel === 'in_store')}>In the shop</button>
            <button type="button" onClick={() => setChannel('phone')} className={choice(channel === 'phone')}>Phone call</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="no-name" className={labelClass}>Customer name{channel === 'in_store' && handover !== 'delivery' ? ' (optional)' : ''}</label>
            <input id="no-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Priya Sharma" className={inputClass} />
          </div>
          <div>
            <label htmlFor="no-phone" className={labelClass}>Phone{channel === 'in_store' ? ' (optional)' : ''}</label>
            <PhoneField id="no-phone" value={phone} onChange={setPhone} inputClassName={inputClass} />
          </div>
        </div>
        <p className={`${hintClass} -mt-2`}>An existing customer is found by their number; a new one is added to your contacts.</p>

        <div>
          <span className={labelClass}>Items</span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your products, or type an item" className={`${inputClass} pl-9`} />
          </div>
          {query.trim().length >= 2 && (
            <ul className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden text-[13px]">
              {found.map((product) => (
                <li key={product.id}>
                  <button type="button" onClick={() => addProduct(product)} className="w-full px-3 py-2 text-left flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <span className="truncate font-medium text-slate-900 dark:text-white">{product.title}</span>
                    <span className="shrink-0 text-slate-500">{formatMoney(product.price, currency)}</span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={addTyped} className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-[#008069] font-semibold">
                  + Add “{query.trim()}” as an item with its own price
                </button>
              </li>
            </ul>
          )}
          <ul className="mt-2 space-y-2">
            {lines.map((line) => (
              <li key={line.key} className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"><ShoppingBag size={14} /></span>
                  {line.productId ? (
                    <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-slate-900 dark:text-white">{line.title}</span>
                  ) : (
                    <input value={line.title} onChange={(e) => change(line.key, { title: e.target.value })} placeholder="Item name" maxLength={150} className={`${inputClass} flex-1 min-w-0`} />
                  )}
                  <button type="button" aria-label="Remove item" onClick={() => setLines((current) => current.filter((x) => x.key !== line.key))} className="h-8 w-8 shrink-0 rounded-lg text-slate-400 hover:text-[#b91c1c] hover:bg-[#fdf0f0] flex items-center justify-center cursor-pointer">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700">
                    <button type="button" aria-label="One less" onClick={() => change(line.key, { quantity: Math.max(1, line.quantity - 1) })} className="h-8 w-8 flex items-center justify-center cursor-pointer"><Minus size={13} /></button>
                    <span className="w-8 text-center text-[13px] font-semibold tabular-nums">{line.quantity}</span>
                    <button type="button" aria-label="One more" onClick={() => change(line.key, { quantity: line.quantity + 1 })} className="h-8 w-8 flex items-center justify-center cursor-pointer"><Plus size={13} /></button>
                  </div>
                  <span className="text-xs text-slate-500">×</span>
                  <input type="number" min={0} step="0.01" value={line.price} onChange={(e) => change(line.key, { price: e.target.value })} aria-label="Price" placeholder="Price" className={`${inputClass} w-28`} />
                  <span className="ml-auto text-[13px] font-bold tabular-nums">{formatMoney((Number(line.price) || 0) * line.quantity, currency)}</span>
                </div>
              </li>
            ))}
          </ul>
          {lines.length === 0 && <p className={hintClass}>Search for a product above, or type the name of anything you sold.</p>}
        </div>

        <div>
          <span className={labelClass}>How does the customer get it?</span>
          <div className="flex flex-wrap gap-2">
            {channel === 'in_store' && <button type="button" onClick={() => setHandover('now')} className={choice(handover === 'now')}>Takes it now</button>}
            <button type="button" onClick={() => setHandover('pickup')} className={choice(handover === 'pickup')}>Picks up later</button>
            <button type="button" onClick={() => setHandover('delivery')} className={choice(handover === 'delivery')}>Delivery</button>
          </div>
        </div>

        {handover === 'delivery' && (
          <div className="grid grid-cols-2 gap-3">
            <input value={address.address_line_1} onChange={(e) => setAddress({ ...address, address_line_1: e.target.value })} placeholder="House, street" aria-label="House, street" className={`${inputClass} col-span-2`} />
            <input value={address.address_line_2} onChange={(e) => setAddress({ ...address, address_line_2: e.target.value })} placeholder="Area, landmark (optional)" aria-label="Area" className={`${inputClass} col-span-2`} />
            <input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} placeholder="City" aria-label="City" className={inputClass} />
            <input value={address.pincode} onChange={(e) => setAddress({ ...address, pincode: e.target.value })} placeholder="PIN code" aria-label="PIN code" className={inputClass} />
            <input value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} placeholder="State (optional)" aria-label="State" className={inputClass} />
            <input type="number" min={0} step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="Delivery charge" aria-label="Delivery charge" className={inputClass} />
            <p className={`${hintClass} col-span-2 -mt-1`}>Leave the delivery charge empty to use your store&apos;s shipping fee.</p>
          </div>
        )}

        <div>
          <span className={labelClass}>Payment</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPaid(true)} className={choice(paid)}>Paid now</button>
            {handover !== 'now' && <button type="button" onClick={() => setPaid(false)} className={choice(!paid)}>{handover === 'delivery' ? 'Pays on delivery' : 'Pays at pick up'}</button>}
          </div>
          {paid && (
            <div className="flex gap-2 mt-2">
              {(['cash', 'upi', 'card'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)} className={choice(method === m)}>{m === 'upi' ? 'UPI' : m === 'cash' ? 'Cash' : 'Card'}</button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="no-note" className={labelClass}>Note (optional)</label>
          <textarea id="no-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={textareaClass} />
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Total{handover === 'delivery' && deliveryFee === '' ? ' (plus your shipping fee)' : ''}</span>
          <span className="font-bold text-lg tabular-nums">{formatMoney(subtotal + fee, currency)}</span>
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 p-2.5 rounded-lg bg-[#fdf0f0] text-xs text-[#b91c1c]">
            <AlertCircle size={14} className="shrink-0 mt-px" /> {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving || lines.length === 0} className={primaryButton}>
            {saving && <Loader2 size={13} className="animate-spin" />} Save order
          </button>
        </div>
      </form>
    </Modal>
  )
}
