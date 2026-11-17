'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BadgePercent, Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { KIND_LABELS, isOpen, type Discount, type DiscountKind } from '@/lib/commerce/discounts'
import { Modal, cardClass, hintClass, iconButton, inputClass, labelClass, primaryButton, secondaryButton, type ShowToast } from './ui'

type Form = { id?: string; title: string; automatic: boolean; code: string; kind: DiscountKind; value: string; buy_qty: string; get_qty: string; min_order: string; max_uses: string; once_per_phone: boolean; first_order_only: boolean; starts_at: string; ends_at: string; active: boolean }
const EMPTY: Form = { title: '', automatic: false, code: '', kind: 'percent', value: '10', buy_qty: '2', get_qty: '1', min_order: '', max_uses: '', once_per_phone: true, first_order_only: false, starts_at: '', ends_at: '', active: true }
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/** E-commerce → Offers: discount codes and offers that apply by themselves on the store page. */
export function Offers({ orgId, canManage, showToast }: { orgId: string; canManage: boolean; showToast: ShowToast }) {
  const [list, setList] = useState<Discount[] | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/commerce/discounts?organizationId=${orgId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Offers could not be loaded.')
      setList(data.discounts)
    } catch (err: any) {
      setError(err.message)
    }
  }, [orgId])
  useEffect(() => { load() }, [load])

  const edit = (d: Discount) => setForm({
    id: d.id, title: d.title, automatic: d.code === null, code: d.code || '', kind: d.kind, value: String(d.value || ''), buy_qty: String(d.buy_qty || 2), get_qty: String(d.get_qty || 1),
    min_order: d.min_order ? String(d.min_order) : '', max_uses: d.max_uses ? String(d.max_uses) : '', once_per_phone: d.once_per_phone, first_order_only: d.first_order_only,
    starts_at: local(d.starts_at), ends_at: local(d.ends_at), active: d.active,
  })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    try {
      const discount = { ...form, code: form.automatic ? null : form.code, starts_at: fromLocal(form.starts_at), ends_at: fromLocal(form.ends_at) }
      const res = await fetch('/api/commerce/discounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, discount }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save.')
      setForm(null)
      showToast('success', 'Offer saved.')
      load()
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(d: Discount) {
    if (!window.confirm(`Remove "${d.title}"? Orders that used it keep their discount.`)) return
    await fetch(`/api/commerce/discounts?organizationId=${orgId}&id=${d.id}`, { method: 'DELETE' })
    load()
  }

  if (error) return <div role="alert" className={`${cardClass} p-5 text-sm text-[#b91c1c] flex gap-2`}><AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}</div>
  if (!list) return <div className={`${cardClass} py-12 flex items-center justify-center gap-2 text-sm text-slate-500`}><Loader2 size={18} className="animate-spin" /> Loading offers…</div>

  const stateOf = (d: Discount) => {
    const now = Date.now()
    if (!d.active) return { text: 'Off', red: false }
    if (d.ends_at && Date.parse(d.ends_at) <= now) return { text: 'Ended', red: false }
    if (d.starts_at && Date.parse(d.starts_at) > now) return { text: `Starts ${day(d.starts_at)}`, red: false }
    if (d.max_uses !== null && (d.uses || 0) >= d.max_uses) return { text: 'Used up', red: true }
    return { text: 'On', red: false }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <section className={`${cardClass} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start gap-3">
          <BadgePercent size={20} className="text-[#1D5BEA] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 basis-60">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Offers and discount codes</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">A code like DIWALI10 that customers type, or an offer that applies by itself (free delivery above ₹999, buy 2 get 1 free, first order). One offer per order: the best one.</p>
          </div>
          {canManage && <button type="button" className={primaryButton} onClick={() => setForm({ ...EMPTY })}><Plus size={14} /> New offer</button>}
        </div>
      </section>

      {list.length === 0 ? (
        <p className={`${cardClass} p-6 text-sm text-center text-slate-500`}>No offers yet.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((d) => {
            const state = stateOf(d)
            return (
              <li key={d.id} className={`${cardClass} p-3 sm:p-4 flex flex-wrap items-center gap-3`}>
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    {d.code ? <span className="font-mono text-[13px] font-bold rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-900 dark:text-white">{d.code}</span> : <span className="text-[11px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-700 dark:text-slate-200">Applies by itself</span>}
                    <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${state.red ? 'bg-[#fdf0f0] text-[#b91c1c]' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>{state.text}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] font-semibold text-slate-900 dark:text-white">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    Used {d.uses || 0}{d.max_uses ? ` of ${d.max_uses}` : ''} time{(d.uses || 0) === 1 ? '' : 's'}
                    {d.first_order_only ? ' · first order only' : ''}{d.once_per_phone ? ' · once per customer' : ''}
                    {d.ends_at ? ` · till ${day(d.ends_at)}` : ''}
                  </p>
                </div>
                {d.code && <button type="button" className={iconButton} aria-label={`Copy ${d.code}`} onClick={() => navigator.clipboard?.writeText(d.code!).then(() => showToast('success', 'Code copied.'))}><Copy size={14} /></button>}
                {canManage && <button type="button" className={iconButton} aria-label={`Edit ${d.title}`} onClick={() => edit(d)}><Pencil size={14} /></button>}
                {canManage && <button type="button" className={iconButton} aria-label={`Remove ${d.title}`} onClick={() => remove(d)}><Trash2 size={14} /></button>}
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <Modal title={form.id ? 'Edit offer' : 'New offer'} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-2">
              {([[false, 'Customers type a code'], [true, 'Applies by itself']] as const).map(([auto, label]) => (
                <button key={label} type="button" aria-pressed={form.automatic === auto} onClick={() => setForm({ ...form, automatic: auto })} className={`h-10 rounded-lg border-2 text-xs font-bold cursor-pointer ${form.automatic === auto ? 'border-[#1D5BEA] text-[#1D5BEA] bg-[#1D5BEA]/5' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}>{label}</button>
              ))}
            </div>
            {!form.automatic && (
              <div>
                <label className={labelClass} htmlFor="offer-code">Code</label>
                <input id="offer-code" className={`${inputClass} uppercase font-mono`} placeholder="DIWALI10" maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} />
              </div>
            )}
            <div>
              <label className={labelClass} htmlFor="offer-kind">What it gives</label>
              <select id="offer-kind" className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as DiscountKind })}>
                {(Object.keys(KIND_LABELS) as DiscountKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
            {(form.kind === 'percent' || form.kind === 'flat') && (
              <div>
                <label className={labelClass} htmlFor="offer-value">{form.kind === 'percent' ? 'Percent off' : 'Rupees off'}</label>
                <input id="offer-value" type="number" min={1} inputMode="decimal" className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </div>
            )}
            {form.kind === 'buy_get' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass} htmlFor="offer-buy">Buy</label><input id="offer-buy" type="number" min={1} className={inputClass} value={form.buy_qty} onChange={(e) => setForm({ ...form, buy_qty: e.target.value })} /></div>
                <div><label className={labelClass} htmlFor="offer-get">Get free</label><input id="offer-get" type="number" min={1} className={inputClass} value={form.get_qty} onChange={(e) => setForm({ ...form, get_qty: e.target.value })} /></div>
                <p className={`${hintClass} col-span-2`}>The cheapest items in the cart are the free ones.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass} htmlFor="offer-min">Orders of at least ₹ (optional)</label><input id="offer-min" type="number" min={0} className={inputClass} value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} /></div>
              <div><label className={labelClass} htmlFor="offer-max">Total uses (optional)</label><input id="offer-max" type="number" min={1} className={inputClass} placeholder="No limit" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} /></div>
              <div><label className={labelClass} htmlFor="offer-start">Starts (optional)</label><input id="offer-start" type="datetime-local" className={inputClass} value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></div>
              <div><label className={labelClass} htmlFor="offer-end">Ends (optional)</label><input id="offer-end" type="datetime-local" className={inputClass} value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-[#1D5BEA]" checked={form.first_order_only} onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })} /> First order only (new customers)</label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-[#1D5BEA]" checked={form.once_per_phone} onChange={(e) => setForm({ ...form, once_per_phone: e.target.checked })} /> Once per customer (by phone number)</label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-[#1D5BEA]" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> On</label>
            <div>
              <label className={labelClass} htmlFor="offer-title">Name customers see (optional)</label>
              <input id="offer-title" className={inputClass} maxLength={80} placeholder="Made from the offer, like 10% off" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className={primaryButton} disabled={busy}>{busy && <Loader2 size={13} className="animate-spin" />} Save offer</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
