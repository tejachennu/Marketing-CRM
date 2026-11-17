'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, MessageCircle } from 'lucide-react'
import { SHOP_MESSAGE_INFO, SHOP_PURPOSES, type ShopMessageSetting, type ShopPurpose } from '@/lib/commerce/shop-messages'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, type ShowToast } from './ui'

/** Store settings → WhatsApp messages the shop sends by itself, each on / off with its template. */
export function ShopMessagesCard({ orgId, showToast }: { orgId: string; showToast: ShowToast }) {
  const [messages, setMessages] = useState<Record<ShopPurpose, ShopMessageSetting> | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    fetch(`/api/commerce/shop-messages?organizationId=${orgId}`).then((r) => r.json()).then((d) => setMessages(d.messages || null)).catch(() => {})
  }, [orgId])
  if (!messages) return <div className={`${cardClass} py-8 flex justify-center text-sm text-slate-500`}><Loader2 size={16} className="animate-spin" /></div>
  const set = (p: ShopPurpose, change: Partial<ShopMessageSetting>) => setMessages({ ...messages, [p]: { ...messages[p], ...change } })
  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/commerce/shop-messages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, messages }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save.')
      setMessages(data.messages)
      showToast('success', 'WhatsApp messages saved.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-4`} aria-labelledby="shop-messages-title">
      <div className="flex items-start gap-3">
        <MessageCircle size={20} className="text-[#1D5BEA] shrink-0 mt-0.5" />
        <div>
          <h2 id="shop-messages-title" className="text-sm font-bold text-slate-900 dark:text-white">WhatsApp messages the shop sends</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Sent as a normal message when the customer wrote in the last 24 hours. Otherwise WhatsApp needs an approved template: make one in Templates (Utility), then type its name here. Its blanks are filled in the order shown.</p>
        </div>
      </div>
      <ul className="space-y-3">
        {SHOP_PURPOSES.map((p) => {
          const info = SHOP_MESSAGE_INFO[p]
          const m = messages[p]
          return (
            <li key={p} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 mt-0.5 accent-[#1D5BEA]" checked={m.on} onChange={(e) => set(p, { on: e.target.checked })} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-slate-900 dark:text-white">{info.title}</span>
                  <span className={`block ${hintClass} mt-0`}>{info.when}</span>
                </span>
              </label>
              {m.on && (
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2 pl-6">
                  <div className="min-w-0">
                    <label className={labelClass} htmlFor={`tpl-${p}`}>Template name (optional)</label>
                    <input id={`tpl-${p}`} className={inputClass} placeholder="order_cart_reminder" value={m.template} onChange={(e) => set(p, { template: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor={`lang-${p}`}>Language</label>
                    <input id={`lang-${p}`} className={inputClass} placeholder="en" value={m.language} onChange={(e) => set(p, { language: e.target.value })} />
                  </div>
                  <p className={`${hintClass} col-span-2 mt-0`}>Blanks: {info.blanks.map((b, i) => `{{${i + 1}}} ${b}`).join(', ')}{info.buttons ? `. Two quick-reply buttons: ${info.buttons.join(', ')}.` : '.'}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className={primaryButton} disabled={saving} onClick={save}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save messages</button>
    </section>
  )
}
