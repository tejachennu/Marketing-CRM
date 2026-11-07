'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mic, ReceiptText, Scissors, Settings2, Sparkles, Users } from 'lucide-react'
import { can } from '@/lib/rbac'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { api, card, Toast, useToast, useWorkspace } from './ui'
import { SalonSetupTab } from './salon-setup'
import { SalonCounter } from './salon-counter'
import { SalonInvoices } from './salon-invoices'
import { SalonTeam } from './salon-team'
import { VoiceBar } from './voice-bar'
import type { SalonSetup } from './types'

type Tab = 'counter' | 'invoices' | 'team' | 'setup'

/** The Spa & Salon connector: the counter, invoices and setup. */
export function SalonApp() {
  const { workspace, error: workspaceError } = useWorkspace()
  const { toast, flash } = useToast()
  const [setup, setSetup] = useState<SalonSetup | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('counter')

  const loadSetup = useCallback(async (orgId: string) => {
    const data = await api(`/api/salon/setup?organizationId=${orgId}`)
    setSetup({ settings: data.settings, services: data.services, staff: data.staff })
    return data
  }, [])

  useEffect(() => {
    if (!workspace) return
    loadSetup(workspace.orgId)
      .then((data) => { if (!data.services?.length && can(workspace.me, 'automation.manage')) setTab('setup') })
      .catch((err) => setError(err.message))
  }, [workspace, loadSetup])

  const canManage = can(workspace?.me, 'automation.manage')
  const tabs: { id: Tab; label: string; icon: typeof Mic }[] = [
    { id: 'counter', label: 'Counter', icon: Mic },
    { id: 'invoices', label: 'Invoices', icon: ReceiptText },
    ...(canManage ? [{ id: 'team' as const, label: 'Team', icon: Users }, { id: 'setup' as const, label: 'Setup', icon: Settings2 }] : []),
  ]

  if (workspaceError || error) {
    return <div className="p-6"><div className={`${card} p-6 text-[15px] text-[#b91c1c]`}>{workspaceError || error}</div></div>
  }
  if (!workspace || !setup) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={30} /></div>
  }

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-5">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {isSafeLogoUrl(setup.settings.logo_url)
              // eslint-disable-next-line @next/next/no-img-element
              ? <span className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-white border border-[#e3e8f2] dark:border-slate-700 flex items-center justify-center overflow-hidden shadow-sm"><img src={setup.settings.logo_url} alt="" className="max-h-full max-w-full object-contain p-1.5" /></span>
              : <span className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center shadow-sm"><Scissors size={24} /></span>}
            <div className="min-w-0">
              <h1 className="text-[24px] sm:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-tight truncate">{setup.settings.business_name || workspace.orgName || 'Salon'}</h1>
              <p className="text-[14px] sm:text-[15px] text-[#4a5672] dark:text-slate-400 truncate">Spa & Salon counter <span aria-hidden className="mx-1 text-[#c0c8d8]">•</span> {todayLabel}</p>
            </div>
          </div>
          <div role="tablist" aria-label="Salon" className="flex w-full md:w-auto rounded-2xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 shadow-[0_1px_2px_rgba(14,27,61,0.04)]">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex-1 md:flex-none inline-flex items-center justify-center gap-2 h-10 px-2 sm:px-4 rounded-xl text-[14px] sm:text-[15px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${tab === id ? 'bg-[#0E1B3D] text-white shadow-sm dark:bg-white dark:text-[#0E1B3D]' : 'text-[#4a5672] dark:text-slate-300 hover:text-[#0E1B3D] hover:bg-[#f4f6fa] dark:hover:text-white dark:hover:bg-slate-800'}`}>
                <Icon size={17} className="hidden sm:block" /> {label}
              </button>
            ))}
          </div>
        </header>

        {tab === 'setup' && canManage && <SalonSetupTab orgId={workspace.orgId} setup={setup} onChange={setSetup} flash={flash} />}
        {tab === 'counter' && (setup.services.length === 0
          ? (
            <div className={`${card} px-6 py-12 text-center`}>
              <span className="mx-auto h-14 w-14 rounded-2xl bg-[#fdeef6] dark:bg-pink-950/40 text-[#be185d] dark:text-pink-300 flex items-center justify-center"><Sparkles size={26} /></span>
              <h2 className="mt-4 text-[19px] font-extrabold text-[#0E1B3D] dark:text-white">Add your services to open the counter</h2>
              <p className="mt-1 text-[15px] text-[#4a5672] dark:text-slate-400 max-w-md mx-auto">{canManage ? 'In Setup, "Add sample salon" adds a full list of services and staff in one tap. Change prices any time.' : 'Your manager needs to add services in Setup before the counter can be used.'}</p>
              {canManage && <button type="button" onClick={() => setTab('setup')} className="mt-5 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#0E1B3D] dark:bg-white text-white dark:text-[#0E1B3D] text-[15px] font-bold cursor-pointer"><Settings2 size={17} /> Go to Setup</button>}
            </div>
          )
          : <SalonCounter orgId={workspace.orgId} setup={setup} canWrite={can(workspace.me, 'records.write')} flash={flash}
              voice={(handle) => <VoiceBar orgId={workspace.orgId} setup={setup} handle={handle} />} />)}
        {tab === 'team' && canManage && <SalonTeam orgId={workspace.orgId} flash={flash} />}
        {tab === 'invoices' && <SalonInvoices orgId={workspace.orgId} canWrite={can(workspace.me, 'records.write')} canVoid={canManage} flash={flash} />}
      </div>
      <Toast toast={toast} />
    </div>
  )
}
