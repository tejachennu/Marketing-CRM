'use client'

import { useEffect, useState } from 'react'
import { Check, Gift, Loader2, Search } from 'lucide-react'
import { loyaltyLine, type LoyaltySettings } from '@/lib/commerce/loyalty'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton, type ShowToast } from './ui'

/** Offers → Loyalty points: points back on delivered orders, used at checkout; look up a customer's points. */
export function LoyaltyCard({ orgId, showToast }: { orgId: string; showToast: ShowToast }) {
  const [settings, setSettings] = useState<LoyaltySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [phone, setPhone] = useState('')
  const [found, setFound] = useState<number | null>(null)
  useEffect(() => {
    fetch(`/api/commerce/loyalty?organizationId=${orgId}`).then((r) => r.json()).then((d) => setSettings(d.settings || null)).catch(() => {})
  }, [orgId])
  if (!settings) return null
  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/commerce/loyalty', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, settings }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save.')
      setSettings(data.settings)
      showToast('success', 'Loyalty points saved.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setSaving(false)
    }
  }
  async function lookUp() {
    const res = await fetch(`/api/commerce/loyalty?organizationId=${orgId}&phone=${encodeURIComponent(phone)}`).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    setFound(Number(data?.points) || 0)
  }
  const num = (v: string) => (v === '' ? 0 : Number(v))
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`} aria-labelledby="loyalty-title">
      <div className="flex items-start gap-3">
        <Gift size={20} className="text-[#1D5BEA] shrink-0 mt-0.5" />
        <div>
          <h2 id="loyalty-title" className="text-sm font-bold text-slate-900 dark:text-white">Loyalty points</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Customers get points when an order is delivered and use them on the next order (1 point = ₹1). Points go by phone number; to use them, the customer signs in on your store.</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="h-4 w-4 accent-[#1D5BEA]" checked={settings.on} onChange={(e) => setSettings({ ...settings, on: e.target.checked })} />
        Give loyalty points
      </label>
      {settings.on && (
        <div className="grid grid-cols-1 min-[480px]:grid-cols-3 gap-3">
          <div>
            <label className={labelClass} htmlFor="loy-percent">Points back (%)</label>
            <input id="loy-percent" type="number" min={0.5} max={50} step={0.5} className={inputClass} value={settings.percent} onChange={(e) => setSettings({ ...settings, percent: num(e.target.value) })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="loy-min">Use from (points)</label>
            <input id="loy-min" type="number" min={0} className={inputClass} value={settings.minUse} onChange={(e) => setSettings({ ...settings, minUse: num(e.target.value) })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="loy-max">At most (% of order)</label>
            <input id="loy-max" type="number" min={1} max={100} className={inputClass} value={settings.maxPercent} onChange={(e) => setSettings({ ...settings, maxPercent: num(e.target.value) })} />
          </div>
          <p className={`${hintClass} mt-0 min-[480px]:col-span-3`}>Your store says: “{loyaltyLine(settings)}”</p>
        </div>
      )}
      <button type="button" className={primaryButton} disabled={saving} onClick={save}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save points</button>
      {settings.on && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className={labelClass} htmlFor="loy-phone">A customer&apos;s points</label>
          <div className="flex gap-2">
            <input id="loy-phone" inputMode="tel" className={inputClass} placeholder="Phone number" value={phone} onChange={(e) => { setPhone(e.target.value); setFound(null) }} />
            <button type="button" onClick={lookUp} disabled={phone.replace(/\D/g, '').length < 10} className={`${secondaryButton} shrink-0`}><Search size={13} /> Look up</button>
          </div>
          {found !== null && <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{found} points</p>}
        </div>
      )}
    </section>
  )
}
