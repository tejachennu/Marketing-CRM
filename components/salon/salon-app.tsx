'use client'

import { useCallback, useEffect, useState } from 'react'
import { ConciergeBell, Loader2, ReceiptText, Settings2, Sparkles, Star, Users } from 'lucide-react'
import { can } from '@/lib/rbac'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { resolveRange, type DateRange } from '@/lib/salon/ranges'
import { api, card, Toast, useToast, useWorkspace } from './ui'
import { SalonSetupTab } from './salon-setup'
import { SalonCounter } from './salon-counter'
import { SalonInvoices } from './salon-invoices'
import { SalonReviews } from './salon-reviews'
import { SalonTeam } from './salon-team'
import type { SalonSetup } from './types'

type Tab = 'counter' | 'invoices' | 'reviews' | 'team' | 'setup'

/** Front Desk: the counter, invoices, reviews, team and setup, for any business that takes appointments. */
export function SalonApp() {
  const { workspace, error: workspaceError } = useWorkspace()
  const { toast, flash } = useToast()
  const [setup, setSetup] = useState<SalonSetup | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('counter')
  // One date range for Invoices, Reviews and Team, so switching tabs keeps the dates
  const [range, setRange] = useState<DateRange>(() => resolveRange('month'))

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
  const tabs: { id: Tab; label: string; icon: typeof ConciergeBell }[] = [
    { id: 'counter', label: 'Counter', icon: ConciergeBell },
    { id: 'invoices', label: 'Invoices', icon: ReceiptText },
    ...(canManage ? [{ id: 'reviews' as const, label: 'Reviews', icon: Star }, { id: 'team' as const, label: 'Team', icon: Users }, { id: 'setup' as const, label: 'Setup', icon: Settings2 }] : []),
  ]

  if (workspaceError || error) {
    return <div className="p-6"><div className={`${card} p-6 text-[15px] text-[#b91c1c]`}>{workspaceError || error}</div></div>
  }
  if (!workspace || !setup) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={30} /></div>
  }

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })

  return (
    <div className="@container flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-6xl mx-auto px-3 min-[400px]:px-4 @xl:px-6 py-4 @xl:py-7 space-y-4 @xl:space-y-5">
        <header className="flex flex-col @4xl:flex-row @4xl:items-center justify-between gap-3 @xl:gap-4">
          <div className="flex items-center gap-3 @xl:gap-3.5 min-w-0">
            {isSafeLogoUrl(setup.settings.logo_url)
              // eslint-disable-next-line @next/next/no-img-element
              ? <span className="h-12 w-12 @xl:h-14 @xl:w-14 shrink-0 rounded-2xl bg-white border border-[#e3e8f2] dark:border-slate-700 flex items-center justify-center overflow-hidden shadow-sm"><img src={setup.settings.logo_url} alt="" className="max-h-full max-w-full object-contain p-1.5" /></span>
              : <span className="h-12 w-12 @xl:h-14 @xl:w-14 shrink-0 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center shadow-sm"><ConciergeBell size={24} /></span>}
            <div className="min-w-0">
              <h1 className="text-[21px] min-[400px]:text-[24px] @xl:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-tight truncate">{setup.settings.business_name || workspace.orgName || 'Front Desk'}</h1>
              <p className="text-[13.5px] @xl:text-[15px] text-[#4a5672] dark:text-slate-400 truncate"><span className="hidden min-[400px]:inline">Front Desk <span aria-hidden className="mx-1 text-[#c0c8d8]">•</span> </span>{todayLabel}</p>
            </div>
          </div>
          <div role="tablist" aria-label="Front Desk" className="flex w-full @4xl:w-auto rounded-2xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 shadow-[0_1px_2px_rgba(14,27,61,0.04)]">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex-1 @4xl:flex-none min-w-0 inline-flex flex-col @xl:flex-row items-center justify-center gap-0.5 @xl:gap-2 h-[52px] @xl:h-11 px-1 @xl:px-4 rounded-xl text-[11.5px] min-[400px]:text-[12.5px] @xl:text-[15px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${tab === id ? 'bg-[#0E1B3D] text-white shadow-sm dark:bg-white dark:text-[#0E1B3D]' : 'text-[#4a5672] dark:text-slate-300 hover:text-[#0E1B3D] hover:bg-[#f4f6fa] dark:hover:text-white dark:hover:bg-slate-800'}`}>
                <Icon size={18} className="shrink-0" /> <span className="truncate max-w-full">{label}</span>
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
              <p className="mt-1 text-[15px] text-[#4a5672] dark:text-slate-400 max-w-md mx-auto">{canManage ? 'In Setup, pick your kind of business to add a starter list of services and team in one tap, or add your own. Change anything any time.' : 'Your manager needs to add services in Setup before the counter can be used.'}</p>
              {canManage && <button type="button" onClick={() => setTab('setup')} className="mt-5 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#0E1B3D] dark:bg-white text-white dark:text-[#0E1B3D] text-[15px] font-bold cursor-pointer"><Settings2 size={17} /> Go to Setup</button>}
            </div>
          )
          : <SalonCounter orgId={workspace.orgId} setup={setup} canWrite={can(workspace.me, 'records.write')} flash={flash} />)}
        {tab === 'team' && canManage && <SalonTeam orgId={workspace.orgId} flash={flash} range={range} onRangeChange={setRange} onOpenReviews={() => setTab('reviews')} />}
        {tab === 'reviews' && canManage && <SalonReviews orgId={workspace.orgId} flash={flash} range={range} onRangeChange={setRange} />}
        {tab === 'invoices' && <SalonInvoices orgId={workspace.orgId} canWrite={can(workspace.me, 'records.write')} canVoid={canManage} flash={flash} range={range} onRangeChange={setRange} />}
      </div>
      <Toast toast={toast} />
    </div>
  )
}
