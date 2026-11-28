'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, RotateCcw, X } from 'lucide-react'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { RETURN_LABELS, type ReturnRequest } from '@/lib/commerce/returns'
import { Modal, cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton, sectionTitle, type ShowToast } from './ui'

interface Refund { id: string; amount: number; reason: string | null; method: string; status: string; restocked: boolean; createdAt: string }
interface State { return: ReturnRequest | null; refunds: Refund[]; paid: number; refunded: number; left: number; viaRazorpay: boolean }

/** Order details → Returns and refunds: answer the customer's return ask, refund all or part. */
export function OrderReturns({ orgId, orderId, currency, canEdit, onChanged, showToast }: { orgId: string; orderId: string; currency: string; canEdit: boolean; onChanged: () => void; showToast: ShowToast }) {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [form, setForm] = useState({ amount: '', reason: '', restock: false })
  const money = (n: number) => formatMoney(n, currency)

  const load = useCallback(() => {
    fetch(`/api/commerce/returns?organizationId=${orgId}&orderId=${orderId}`).then((r) => r.json()).then((d) => { if (!d.error) setState(d) }).catch(() => {})
  }, [orgId, orderId])
  useEffect(() => { load() }, [load])

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(String(body.action))
    try {
      const res = await fetch('/api/commerce/returns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, orderId, ...body }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'That did not work.')
      showToast('success', done)
      setRefunding(false)
      load()
      onChanged()
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!state) return null
  const ask = state.return
  if (!ask && state.paid <= 0 && !state.refunds.length) return null

  return (
    <section>
      <h4 className={sectionTitle}>Returns and refunds</h4>
      {ask && (
        <div className={`p-3 rounded-xl text-xs space-y-2 ${ask.status === 'asked' ? 'bg-[#fdf0f0] text-[#b91c1c]' : 'bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300'}`}>
          <p className="flex items-start gap-2"><RotateCcw size={14} className="shrink-0 mt-px" /><span><strong className="font-semibold">{RETURN_LABELS[ask.status]}:</strong> {ask.reason}{ask.note ? ` — “${ask.note}”` : ''}</span></p>
          {ask.status === 'asked' && canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => post({ action: 'accept' }, 'Return accepted. The customer was told on WhatsApp.')} className={`${secondaryButton} h-8`}>{busy === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accept</button>
              <button type="button" disabled={busy !== null} onClick={() => post({ action: 'decline' }, 'Return declined. The customer was told on WhatsApp.')} className={`${secondaryButton} h-8`}>{busy === 'decline' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Decline</button>
            </div>
          )}
        </div>
      )}
      {state.refunds.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
          {state.refunds.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{new Date(r.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })} · {r.method === 'razorpay' || r.method === 'stripe' ? `Through ${r.method === 'stripe' ? 'Stripe' : 'Razorpay'}${r.status === 'pending' ? ' (on its way)' : ''}` : 'Paid back by hand'}{r.reason ? ` · ${r.reason}` : ''}</span>
              <span className="font-semibold tabular-nums shrink-0">− {money(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {state.left > 0 && canEdit && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className={`${hintClass} mt-0`}>{state.refunded > 0 ? `${money(state.left)} of ${money(state.paid)} can still be refunded.` : `Paid ${money(state.paid)}.`}</p>
          <button type="button" onClick={() => { setForm({ amount: String(state.left), reason: ask?.reason || '', restock: Boolean(ask) }); setRefunding(true) }} className={`${secondaryButton} h-8 px-3`}><RotateCcw size={13} /> Refund</button>
        </div>
      )}

      {refunding && (
        <Modal title="Refund this order" onClose={() => setRefunding(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">{state.viaRazorpay
              ? 'The customer paid online, so the money goes back through your Razorpay to the same card, UPI or bank account (5–7 working days).'
              : 'This order was not paid through your Razorpay. Pay the customer back yourself (UPI, cash, bank), then record it here.'}</p>
            <div>
              <label className={labelClass} htmlFor="refund-amount">Amount (at most {money(state.left)})</label>
              <input id="refund-amount" type="number" min={1} step="0.01" max={state.left} className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="refund-reason">Reason (optional)</label>
              <input id="refund-reason" className={inputClass} maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-[#008069]" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} />
              Put the sizes / colours back in stock (the items came back)
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setRefunding(false)} className={secondaryButton}>Cancel</button>
              <button type="button" disabled={busy !== null} onClick={() => post({ action: 'refund', amount: Number(form.amount), reason: form.reason, restock: form.restock }, state.viaRazorpay ? 'Refund sent through Razorpay.' : 'Refund recorded.')} className={primaryButton}>
                {busy === 'refund' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {state.viaRazorpay ? 'Refund through Razorpay' : 'Record refund'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Store settings → Returns: customers can ask in My orders within N days of delivery. */
export function ReturnsSettingsCard({ orgId, showToast }: { orgId: string; showToast: ShowToast }) {
  const [settings, setSettings] = useState<{ on: boolean; days: number } | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    fetch(`/api/commerce/returns?organizationId=${orgId}`).then((r) => r.json()).then((d) => setSettings(d.settings || null)).catch(() => {})
  }, [orgId])
  if (!settings) return null
  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/commerce/returns', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, settings }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save.')
      setSettings(data.settings)
      showToast('success', 'Returns saved.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`} aria-labelledby="returns-title">
      <div className="flex items-start gap-3">
        <RotateCcw size={20} className="text-[#008069] shrink-0 mt-0.5" />
        <div>
          <h2 id="returns-title" className="text-sm font-bold text-slate-900 dark:text-white">Returns</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Customers ask in My orders; you accept or decline on the order and refund from there. Online payments go back through your Razorpay.</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="h-4 w-4 accent-[#008069]" checked={settings.on} onChange={(e) => setSettings({ ...settings, on: e.target.checked })} />
        Customers can ask for a return
      </label>
      {settings.on && (
        <div className="max-w-[12rem]">
          <label className={labelClass} htmlFor="returns-days">Days after delivery</label>
          <input id="returns-days" type="number" min={1} max={60} className={inputClass} value={settings.days} onChange={(e) => setSettings({ ...settings, days: Number(e.target.value) })} />
        </div>
      )}
      <button type="button" className={primaryButton} disabled={saving} onClick={save}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save returns</button>
    </section>
  )
}
