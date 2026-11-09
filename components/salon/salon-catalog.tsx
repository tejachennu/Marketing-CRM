'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, History, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { formatRupees } from '@/lib/salon/invoice'
import { api, card, Chip, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { Service } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void

interface CatalogItem {
  id: string
  name: string
  price: number
  currency: string
  category: string
  image_url: string | null
  description: string
  available: boolean
  service_id: string | null
  billable: boolean | null
}

const DURATIONS = [15, 30, 45, 60, 90]
const GST_RATES = [0, 5, 12, 18, 28]

/** Product picture, or a quiet box when there is none (or it fails to load). */
export function ItemThumb({ url, size = 44 }: { url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  const safe = url && /^https:\/\//.test(url) && !broken
  return (
    <span style={{ width: size, height: size }} className="shrink-0 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 border border-[#eef1f6] dark:border-slate-700 overflow-hidden flex items-center justify-center text-[#8a94a8]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {safe ? <img src={url!} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : <Package size={Math.round(size * 0.45)} />}
    </span>
  )
}

/** Tick products from the store catalog and add them to Front Desk as services, in one go. */
export function CatalogPicker({ orgId, categories, onClose, onAdded, flash }: {
  orgId: string
  categories: string[]
  onClose: () => void
  onAdded: (services: Service[]) => void
  flash: Flash
}) {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [hint, setHint] = useState('')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All')
  const [ticked, setTicked] = useState<string[]>([])
  const [billable, setBillable] = useState(true)
  const [minutes, setMinutes] = useState(30)
  const [gst, setGst] = useState(18)
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState<'add' | 'refresh' | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/salon/catalog?organizationId=${orgId}`)
      setItems(data.products || [])
      setHint(data.hint || '')
    } catch (err: any) {
      setItems([])
      setHint(err.message)
    }
  }, [orgId])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => ['All', ...[...new Set((items || []).map((item) => item.category || 'Other'))].sort()], [items])
  const words = query.trim().toLowerCase()
  const shown = (items || []).filter((item) => (group === 'All' || (item.category || 'Other') === group) && (!words || item.name.toLowerCase().includes(words) || (item.category || '').toLowerCase().includes(words)))
  const open = shown.filter((item) => !item.service_id)
  const allTicked = open.length > 0 && open.every((item) => ticked.includes(item.id))
  const linked = (items || []).filter((item) => item.service_id).length

  const toggle = (id: string) => setTicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const toggleAll = () => setTicked((list) => (allTicked ? list.filter((id) => !open.some((item) => item.id === id)) : [...new Set([...list, ...open.map((item) => item.id)])]))

  async function add() {
    setBusy('add')
    try {
      const data = await api('/api/salon/catalog', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgId, product_ids: ticked, billable, duration_minutes: minutes, tax_rate: gst, category: category || null }),
      })
      onAdded(data.services || [])
      flash('success', `Added ${data.services?.length || 0} from the catalog${billable ? '' : ' (not on bills)'}.`)
      onClose()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function refresh() {
    setBusy('refresh')
    try {
      const data = await api('/api/salon/catalog', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: 'refresh' }) })
      flash('success', data.changed?.length ? `Updated ${data.changed.length} from the catalog.` : 'Everything already matches the catalog.')
      if (data.changed?.length) onAdded([])
      await load()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal size="lg" icon={<Package size={21} />} title="Add from catalog" subtitle="Tick the items to offer at the front desk" onClose={onClose}
      footer={<>
        {linked > 0 && <button type="button" onClick={refresh} disabled={busy !== null} className={`${secondaryButton} sm:mr-auto`}>{busy === 'refresh' ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />} Update names and prices</button>}
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={add} disabled={busy !== null || ticked.length === 0} className={primaryButton}>{busy === 'add' && <Loader2 size={18} className="animate-spin" />} {ticked.length ? `Add ${ticked.length}` : 'Add'}</button>
      </>}>
      {items === null ? (
        <div className="py-12 flex justify-center text-[#6B7894]"><Loader2 size={24} className="animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center">
          <span className="mx-auto h-14 w-14 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#6B7894] flex items-center justify-center"><Package size={26} /></span>
          <p className="mt-3 text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">Your catalog is empty</p>
          <p className="mt-1 text-[14px] text-[#6B7894] max-w-sm mx-auto">{hint || 'Add products in E-commerce first.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="relative block">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog" className={`${input} pl-9`} />
            </label>
            {groups.length > 2 && (
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none]">
                {groups.map((g) => <Chip key={g} selected={group === g} onClick={() => setGroup(g)}>{g}</Chip>)}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 overflow-hidden">
            <label className="flex items-center gap-3 px-3.5 py-2.5 bg-[#f8fafc] dark:bg-slate-900 border-b border-[#eef1f6] dark:border-slate-800 text-[14px] font-semibold text-[#4a5672] dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={allTicked} disabled={open.length === 0} onChange={toggleAll} className="h-5 w-5 accent-[#1D5BEA] cursor-pointer" aria-label="Tick all shown" />
              <span className="flex-1">Tick all shown</span>
              <span className="text-[13px] font-normal text-[#6B7894]">{ticked.length} ticked</span>
            </label>
            <ul className="max-h-[42dvh] overflow-y-auto divide-y divide-[#eef1f6] dark:divide-slate-800">
              {shown.length === 0 && <li className="px-4 py-6 text-center text-[14px] text-[#6B7894]">Nothing matches.</li>}
              {shown.map((item) => {
                const added = Boolean(item.service_id)
                const on = ticked.includes(item.id)
                return (
                  <li key={item.id}>
                    <label className={`flex items-center gap-3 px-3.5 py-2.5 ${added ? 'opacity-70' : 'cursor-pointer hover:bg-[#f8fafc] dark:hover:bg-slate-900/60'} ${on ? 'bg-[#f5f8ff] dark:bg-blue-950/20' : ''}`}>
                      <input type="checkbox" checked={added || on} disabled={added} onChange={() => toggle(item.id)} className="h-5 w-5 shrink-0 accent-[#1D5BEA] cursor-pointer disabled:cursor-default" aria-label={item.name} />
                      <ItemThumb url={item.image_url} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-[#0E1B3D] dark:text-white truncate">{item.name}</span>
                        <span className="block text-[13px] text-[#6B7894] truncate">{added ? (item.billable === false ? 'Added · not on bills' : 'Already added') : item.category || 'Other'}{!item.available && !added ? ' · out of stock' : ''}</span>
                      </span>
                      <span className="shrink-0 text-[15px] font-bold text-[#0E1B3D] dark:text-white">{formatRupees(Number(item.price) || 0)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>

          {ticked.length > 0 && (
            <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 p-3.5 space-y-3.5">
              <label className="flex items-center justify-between gap-4 text-[15px] text-[#0E1B3D] dark:text-white">
                <span><strong>Use in bills</strong><span className="block text-[13px] text-[#6B7894]">Off: customers can book them, but they never go on a bill.</span></span>
                <Toggle checked={billable} onChange={setBillable} label="Use in bills" />
              </label>
              <Field group label="Time each one takes">
                <div className="flex flex-wrap gap-2">{DURATIONS.map((m) => <Chip key={m} selected={minutes === m} onClick={() => setMinutes(m)}>{m} min</Chip>)}</div>
              </Field>
              <Field group label="GST"><div className="flex flex-wrap gap-2">{GST_RATES.map((rate) => <Chip key={rate} selected={gst === rate} onClick={() => setGst(rate)}>{rate}%</Chip>)}</div></Field>
              <Field group label="Category" hint="Leave on “Same as catalog” to keep each item's own category.">
                <div className="flex flex-wrap gap-2">
                  <Chip selected={!category} onClick={() => setCategory('')}>Same as catalog</Chip>
                  {categories.map((c) => <Chip key={c} selected={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
                </div>
              </Field>
              <p className="text-[12.5px] text-[#6B7894]">You can change any of these per item afterwards.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Change history ───────────────────────────────────────────────────────────

interface ChangeEntry {
  id: string
  user_name: string | null
  area: string
  action: string
  target: string | null
  details: Record<string, any> | null
  created_at: string
}

const AREAS: { id: string; label: string }[] = [
  { id: '', label: 'Everything' },
  { id: 'service', label: 'Services' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'category', label: 'Categories' },
  { id: 'team', label: 'Team' },
  { id: 'business', label: 'Business' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'booking_flow', label: 'Booking flow' },
  { id: 'templates', label: 'Templates' },
]
const AREA_LABEL: Record<string, string> = Object.fromEntries(AREAS.filter((a) => a.id).map((a) => [a.id, a.label]))

const FIELD_LABEL: Record<string, string> = {
  name: 'Name', category: 'Category', price: 'Price', duration_minutes: 'Minutes', tax_rate: 'GST', sac_code: 'SAC code',
  active: 'On offer', billable: 'Use in bills', business_name: 'Business name', prices_include_tax: 'Prices include GST',
  invoice_prefix: 'Invoice number starts with', invoice_note: 'Invoice note', opens_at: 'Opens at', closes_at: 'Closes at',
  chat_assistant: 'WhatsApp assistant', auto_approve_bookings: 'Accept bookings on their own', reminders_enabled: 'Reminders',
  feedback_enabled: 'Feedback after visits', review_link: 'Review link', services: 'Services moved', services_moved: 'Services moved', phone: 'Phone', service_ids: 'Services', commission_percent: 'Commission',
}

function showValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (key === 'price') return formatRupees(Number(value) || 0)
  if (key === 'tax_rate' || key === 'commission_percent') return `${value}%`
  if (Array.isArray(value)) return `${value.length} picked`
  if (typeof value === 'object') return 'changed'
  return String(value).slice(0, 60)
}

/** One line per changed field, in plain words. */
export function describeDetails(details: Record<string, any> | null | undefined): string[] {
  if (!details) return []
  const lines: string[] = []
  for (const [key, value] of Object.entries(details)) {
    if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
      lines.push(`${FIELD_LABEL[key] || key.replace(/_/g, ' ')}: ${showValue(key, value.from)} → ${showValue(key, value.to)}`)
    } else if (key === 'items' && Array.isArray(value)) {
      lines.push(value.map((item: any) => (typeof item === 'string' ? item : item?.name ? `${item.name}${item.to !== undefined ? ` ${showValue('price', item.from)} → ${showValue('price', item.to)}` : ''}` : '')).filter(Boolean).slice(0, 8).join(', ') + (value.length > 8 ? ` and ${value.length - 8} more` : ''))
    } else if (key === 'order' && Array.isArray(value)) {
      lines.push(`New order: ${value.join(', ')}`)
    } else if (key === 'fields' && Array.isArray(value)) {
      lines.push(`Changed: ${value.map((f: string) => FIELD_LABEL[f] || f.replace(/_/g, ' ')).join(', ')}`)
    } else if (key === 'billable') {
      lines.push(value ? 'Use in bills: on' : 'Use in bills: off')
    } else if (key === 'from' || key === 'to') {
      // shown with the rename line below
    } else if (value !== null && value !== undefined && typeof value !== 'object') {
      lines.push(`${FIELD_LABEL[key] || key.replace(/_/g, ' ')}: ${showValue(key, value)}`)
    }
  }
  if (typeof details.from === 'string' && typeof details.to === 'string') lines.unshift(`${details.from} → ${details.to}`)
  return lines.filter(Boolean)
}

function when(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** Everything changed in Front Desk Setup: who, what and when. */
export function ChangeHistory({ orgId }: { orgId: string }) {
  const [area, setArea] = useState('')
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const PAGE = 40

  const load = useCallback(async (before?: string) => {
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams({ organizationId: orgId, limit: String(PAGE) })
      if (area) params.set('area', area)
      if (before) params.set('before', before)
      const data = await api(`/api/salon/history?${params}`)
      const list: ChangeEntry[] = data.entries || []
      setEntries((current) => (before ? [...(current || []), ...list] : list))
      setMore(list.length === PAGE)
    } catch (err: any) {
      setError(err.message)
      if (!before) setEntries([])
    } finally {
      setBusy(false)
    }
  }, [orgId, area])
  useEffect(() => { setEntries(null); load() }, [load])

  return (
    <section className={card}>
      <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-3">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100 flex items-center justify-center"><History size={21} /></span>
        <div className="min-w-0">
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Change history</h2>
          <p className="text-[13.5px] text-[#6B7894]">Every change to services, team and settings: who made it and when.</p>
        </div>
      </div>
      <div className="px-4 @xl:px-5 pt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {AREAS.map((a) => <Chip key={a.id} selected={area === a.id} onClick={() => setArea(a.id)}>{area === a.id && <Check size={14} strokeWidth={3} />} {a.label}</Chip>)}
      </div>
      {error && <p className="mx-4 @xl:mx-5 mt-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-3 py-2 text-[14px]">{error}</p>}
      {entries === null ? (
        <div className="py-12 flex justify-center text-[#6B7894]"><Loader2 size={24} className="animate-spin" /></div>
      ) : entries.length === 0 ? (
        <p className="px-5 py-10 text-center text-[15px] text-[#6B7894]">No changes yet. Changes made from now on show up here.</p>
      ) : (
        <ol className="px-4 @xl:px-5 py-3">
          {entries.map((entry, index) => {
            const lines = describeDetails(entry.details)
            return (
              <li key={entry.id} className="relative flex gap-3 pb-4">
                {index < entries.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-[#e3e8f2] dark:bg-slate-800" aria-hidden />}
                <span className="relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-white dark:border-[#111b21] bg-[#1D5BEA] ring-1 ring-[#d5ddeb] dark:ring-slate-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-[#0E1B3D] dark:text-white break-words">
                    <strong>{entry.user_name || 'Someone'}</strong> {entry.action} <strong>{entry.target || `${AREA_LABEL[entry.area] || 'the'} settings`}</strong>
                  </p>
                  <p className="text-[12.5px] text-[#6B7894]">{AREA_LABEL[entry.area] || entry.area} · {when(entry.created_at)}</p>
                  {lines.length > 0 && (
                    <ul className="mt-1.5 rounded-xl bg-[#f8fafc] dark:bg-slate-900 px-3 py-2 space-y-0.5">
                      {lines.map((line, i) => <li key={i} className="text-[13.5px] text-[#4a5672] dark:text-slate-300 break-words">{line}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {more && entries && (
        <div className="px-4 @xl:px-5 pb-4">
          <button type="button" onClick={() => load(entries[entries.length - 1]?.created_at)} disabled={busy} className={`${secondaryButton} w-full`}>{busy && <Loader2 size={17} className="animate-spin" />} Show older</button>
        </div>
      )}
    </section>
  )
}
