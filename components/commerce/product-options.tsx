'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { MAX_OPTIONS, buildVariants, cleanOptions, type ProductOption, type Variant } from '@/lib/commerce/variants'
import { hintClass, inputClass, labelClass, primaryButton, secondaryButton, squareButton, type ShowToast } from './ui'

type OptionRow = { name: string; values: string }
type Edit = { price: string; stock: string; sku: string; active: boolean }
const keyOf = (picked: Record<string, string>) => JSON.stringify(Object.entries(picked).sort())

/**
 * In the product form: Size, Colour… and a row per combination with its own price, stock and SKU.
 * Saved on its own button (the product itself is saved by the form above).
 */
export function ProductOptions({ orgId, productId, productPrice, canEdit, showToast }: { orgId: string; productId: string; productPrice: number; canEdit: boolean; showToast: ShowToast }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<OptionRow[]>([])
  const [saved, setSaved] = useState<Variant[]>([])
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/commerce/products/options?organizationId=${orgId}&productId=${productId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!live) return
        setRows((data.options || []).map((o: ProductOption) => ({ name: o.name, values: o.values.join(', ') })))
        setSaved(data.variants || [])
        const start: Record<string, Edit> = {}
        for (const v of (data.variants || []) as Variant[]) start[keyOf(v.options)] = { price: v.price === null ? '' : String(v.price), stock: v.stock === null ? '' : String(v.stock), sku: v.sku || '', active: v.active !== false }
        setEdits(start)
      })
      .catch(() => {})
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [orgId, productId])

  const checked = useMemo(() => cleanOptions(rows.map((r) => ({ name: r.name, values: r.values }))), [rows])
  const combos = useMemo(() => ('options' in checked ? buildVariants(checked.options, saved) : []), [checked, saved])

  const current = (v: Variant): Edit => edits[keyOf(v.options)] || { price: v.price === null ? '' : String(v.price), stock: v.stock === null ? '' : String(v.stock), sku: v.sku || '', active: v.active }
  const edit = (v: Variant, change: Partial<Edit>) => setEdits((all) => ({ ...all, [keyOf(v.options)]: { ...current(v), ...change } }))

  async function save() {
    if ('error' in checked) { showToast('error', checked.error); return }
    setSaving(true)
    try {
      const variants = combos.map((v) => {
        const e = edits[keyOf(v.options)]
        return { options: v.options, price: e ? e.price : v.price, stock: e ? e.stock : v.stock, sku: e ? e.sku : v.sku, active: e ? e.active : v.active }
      })
      const res = await fetch('/api/commerce/products/options', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, productId, options: checked.options, variants }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The options could not be saved.')
      setSaved(data.variants || [])
      showToast('success', checked.options.length ? `Saved ${data.variants?.length || 0} choices.` : 'Options removed.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading options…</p>

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold text-slate-900 dark:text-white">Options (size, colour…)</p>
        <p className={hintClass}>Customers pick one of each on your store page. Each combination can have its own price and stock. Leave the price blank to use ₹{productPrice}.</p>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] gap-2 items-end">
          <div>
            <label className={labelClass} htmlFor={`opt-name-${i}`}>Option</label>
            <input id={`opt-name-${i}`} className={inputClass} placeholder="Size" maxLength={30} value={row.name} disabled={!canEdit} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} />
          </div>
          <div className="min-w-0">
            <label className={labelClass} htmlFor={`opt-values-${i}`}>Choices, with commas</label>
            <input id={`opt-values-${i}`} className={inputClass} placeholder="S, M, L, XL" value={row.values} disabled={!canEdit} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, values: e.target.value } : r)))} />
          </div>
          {canEdit && <button type="button" aria-label={`Remove ${row.name || 'option'}`} title="Remove" className={squareButton} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
        </div>
      ))}
      {canEdit && rows.length < MAX_OPTIONS && (
        <button type="button" className={secondaryButton} onClick={() => setRows([...rows, { name: rows.length ? 'Colour' : 'Size', values: '' }])}><Plus size={13} /> Add an option</button>
      )}
      {'error' in checked && rows.length > 0 && <p className="text-xs text-[#b91c1c]">{checked.error}</p>}

      {combos.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2.5rem] gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span>Price ₹</span><span>Stock</span><span>SKU</span><span className="text-center">Sell</span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
            {combos.map((v) => {
              const e = current(v)
              return (
                <li key={v.name} className="grid grid-cols-[repeat(3,minmax(0,1fr))_2.5rem] gap-x-2 gap-y-1 px-3 py-2 items-center">
                  <span className="col-span-4 text-[13px] font-semibold text-slate-800 dark:text-slate-100 break-words">{v.name}</span>
                  <input aria-label={`${v.name} price`} type="number" min={0} inputMode="decimal" className={`${inputClass} h-8`} placeholder={String(productPrice)} value={e.price} disabled={!canEdit} onChange={(ev) => edit(v, { price: ev.target.value })} />
                  <input aria-label={`${v.name} stock`} type="number" min={0} inputMode="numeric" className={`${inputClass} h-8`} placeholder="Not counted" value={e.stock} disabled={!canEdit} onChange={(ev) => edit(v, { stock: ev.target.value })} />
                  <input aria-label={`${v.name} SKU`} className={`${inputClass} h-8`} placeholder="Optional" value={e.sku} disabled={!canEdit} onChange={(ev) => edit(v, { sku: ev.target.value })} />
                  <label className="flex justify-center cursor-pointer"><input type="checkbox" aria-label={`Sell ${v.name}`} className="h-4 w-4 accent-[#1D5BEA]" checked={e.active} disabled={!canEdit} onChange={(ev) => edit(v, { active: ev.target.checked })} /></label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {canEdit && (rows.length > 0 || saved.length > 0) && (
        <button type="button" className={primaryButton} disabled={saving || ('error' in checked && rows.length > 0)} onClick={save}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save options
        </button>
      )}
    </div>
  )
}
