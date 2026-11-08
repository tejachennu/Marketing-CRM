'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Blocks, Check, Loader2, Scissors, ShoppingBag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CONNECTORS, type ConnectorKey } from '@/lib/connectors'
import { can } from '@/lib/rbac'
import { api, card, primaryButton, secondaryButton, Toast, Toggle, useToast, useWorkspace } from '@/components/salon/ui'

const ICONS: Record<ConnectorKey, LucideIcon> = { salon: Scissors, ecommerce: ShoppingBag }

const LOOKS: Record<ConnectorKey, { band: string; icon: string; tags: string[]; tick: string }> = {
  salon: { band: 'bg-[#eef3fe] dark:bg-blue-950/30', icon: 'bg-[#1D5BEA]', tags: ['Bookings', 'GST invoices', 'WhatsApp'], tick: 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300' },
  ecommerce: { band: 'bg-[#e8f7f1] dark:bg-emerald-950/30', icon: 'bg-[#00A884]', tags: ['Catalog', 'Payments', 'Orders'], tick: 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300' },
}

export default function ConnectorsPage() {
  const { workspace, error } = useWorkspace()
  const { toast, flash } = useToast()
  const [state, setState] = useState<Record<string, boolean> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (orgId: string) => {
    const data = await api(`/api/connectors?organizationId=${orgId}`)
    setState(Object.fromEntries((data.connectors || []).map((c: any) => [c.key, c.enabled])))
  }, [])

  useEffect(() => {
    if (workspace) load(workspace.orgId).catch((err) => flash('error', err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, load])

  const canSwitch = can(workspace?.me, 'settings.manage')

  async function toggle(key: ConnectorKey, enabled: boolean) {
    if (!workspace) return
    setBusy(key)
    try {
      const data = await api('/api/connectors', { method: 'POST', body: JSON.stringify({ organizationId: workspace.orgId, key, enabled }) })
      setState(Object.fromEntries((data.connectors || []).map((c: any) => [c.key, c.enabled])))
      // The menu picks up the change straight away
      window.dispatchEvent(new Event('organization-features-changed'))
      const name = CONNECTORS.find((c) => c.key === key)?.name
      flash('success', enabled ? `${name} is on. Find it in the menu.` : `${name} is off.`)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex items-center gap-3.5">
          <span className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-[#0E1B3D] dark:bg-white text-white dark:text-[#0E1B3D] flex items-center justify-center shadow-lg shadow-[#0E1B3D]/20"><Blocks size={24} /></span>
          <div>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-tight">Connectors</h1>
            <p className="text-[14.5px] sm:text-[15.5px] text-[#4a5672] dark:text-slate-400">Apps made for your kind of business. Switch one on and it appears in your menu.</p>
          </div>
        </div>

        {error && <div className={`${card} p-5 text-[15px] text-[#b91c1c]`}>{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {CONNECTORS.map((connector) => {
            const Icon = ICONS[connector.key]
            const look = LOOKS[connector.key]
            const on = Boolean(state?.[connector.key])
            return (
              <article key={connector.key} className={`${card} overflow-hidden flex flex-col`}>
                <div className={`h-24 ${look.band} p-5 flex items-start justify-between`}>
                  <span className={`h-14 w-14 rounded-2xl ${look.icon} text-white flex items-center justify-center shadow-sm`}><Icon size={27} /></span>
                  {state === null ? <Loader2 size={18} className="animate-spin text-[#8a94a8]" /> : (
                    <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[13px] font-bold ${on ? 'bg-white text-[#047857] dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-white text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'}`}>
                      {on && <Check size={14} strokeWidth={3} />} {on ? 'On' : 'Off'}
                    </span>
                  )}
                </div>
                <div className="p-5 sm:p-6 flex flex-col flex-1">
                  <h2 className="text-[21px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">{connector.name}</h2>
                  <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-1">{connector.tagline}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {look.tags.map((tag) => <span key={tag} className="inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">{tag}</span>)}
                  </div>
                  <ul className="mt-4 space-y-2.5 flex-1">
                    {connector.points.map((point) => (
                      <li key={point} className="flex items-start gap-2.5 text-[14.5px] text-[#0E1B3D] dark:text-slate-200"><span className={`h-5 w-5 shrink-0 mt-0.5 rounded-full flex items-center justify-center ${look.tick}`}><Check size={12} strokeWidth={3} /></span> {point}</li>
                    ))}
                  </ul>
                  <div className="mt-5 pt-4 border-t border-[#eef1f6] dark:border-slate-800 flex items-center justify-between gap-3">
                    {canSwitch ? (
                      <label className="flex items-center gap-3 text-[15px] font-semibold text-[#0E1B3D] dark:text-white">
                        <Toggle checked={on} disabled={state === null || busy !== null} onChange={(value) => toggle(connector.key, value)} label={`${connector.name} on or off`} />
                        {busy === connector.key ? 'Saving…' : on ? 'Switched on' : 'Switch on'}
                      </label>
                    ) : (
                      <span className="text-[14px] text-[#6B7894]">An admin can switch this on or off.</span>
                    )}
                    {on && (
                      <Link href={connector.href} className={connector.key === 'salon' ? primaryButton : secondaryButton}>Open <ArrowRight size={17} /></Link>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
      <Toast toast={toast} />
    </div>
  )
}
