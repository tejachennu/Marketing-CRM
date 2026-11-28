'use client'

import { useEffect, useState } from 'react'
import { Check, FileText, Loader2 } from 'lucide-react'
import { GST_RATES, type InvoiceSettings } from '@/lib/commerce/invoice'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, textareaClass, type ShowToast } from './ui'

/** Store settings → GST invoices: the shop's GSTIN and what its invoices show. */
export function InvoiceSettingsCard({ orgId, showToast }: { orgId: string; showToast: ShowToast }) {
  const [form, setForm] = useState<InvoiceSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null)
  useEffect(() => {
    fetch(`/api/commerce/invoices?organizationId=${orgId}`).then((r) => r.json()).then((d) => setForm(d.settings || null)).catch(() => {})
  }, [orgId])
  if (!form) return <div className={`${cardClass} py-8 flex justify-center text-sm text-slate-500`}><Loader2 size={16} className="animate-spin" /></div>

  async function save() {
    setSaving(true)
    setFieldError(null)
    try {
      const res = await fetch('/api/commerce/invoices', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, settings: form }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.field) setFieldError({ field: data.field, text: data.error })
        throw new Error(data.error || 'Could not save.')
      }
      setForm(data.settings)
      showToast('success', 'Invoice details saved.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setSaving(false)
    }
  }
  const errorFor = (field: string) => fieldError?.field === field ? <p className="mt-1 text-xs text-[#b91c1c]">{fieldError.text}</p> : null

  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-4`} aria-labelledby="invoice-settings-title">
      <div className="flex items-start gap-3">
        <FileText size={20} className="text-[#008069] shrink-0 mt-0.5" />
        <div>
          <h2 id="invoice-settings-title" className="text-sm font-bold text-slate-900 dark:text-white">GST invoices</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Every order gets an invoice when it is shipped or delivered (or when you tap Invoice on the order). The customer sees it in My orders. Prices on your store include GST. Without a GSTIN the invoice is a plain bill with no GST.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="inv-gstin">GSTIN (optional)</label>
          <input id="inv-gstin" className={inputClass} placeholder="36ABCDE1234F1Z5" maxLength={15} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase().replace(/\s/g, '') })} />
          {errorFor('gstin')}
        </div>
        <div>
          <label className={labelClass} htmlFor="inv-legal">Name on GST certificate (optional)</label>
          <input id="inv-legal" className={inputClass} placeholder="If different from the shop name" maxLength={120} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="inv-address">Address on the invoice (optional)</label>
          <textarea id="inv-address" rows={2} className={textareaClass} placeholder="Uses the shop's contact address when empty" maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div>
          <label className={labelClass} htmlFor="inv-rate">Usual GST rate</label>
          <select id="inv-rate" className={inputClass} value={String(form.defaultRate)} onChange={(e) => setForm({ ...form, defaultRate: Number(e.target.value) })}>
            {[...new Set([...GST_RATES, form.defaultRate])].sort((a, b) => a - b).map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
          </select>
          <p className={hintClass}>For products without their own rate (set one in the product form).</p>
          {errorFor('defaultRate')}
        </div>
        <div>
          <label className={labelClass} htmlFor="inv-prefix">Invoice number starts with</label>
          <input id="inv-prefix" className={inputClass} placeholder="WEB" maxLength={5} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
          <p className={hintClass}>Like {form.prefix || 'WEB'}/26-27/0001. Numbers start again each April.</p>
        </div>
      </div>
      <button type="button" className={primaryButton} disabled={saving} onClick={save}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save invoice details</button>
    </section>
  )
}
