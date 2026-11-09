'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ConciergeBell, FileText, Loader2, ReceiptText, Settings2, Sparkles, Star, Users } from 'lucide-react'
import { can } from '@/lib/rbac'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { resolveRange, type DateRange } from '@/lib/salon/ranges'
import { announceFrontDeskTab, isFrontDeskTab, MANAGER_TABS, OPEN_TAB_EVENT, tabFromSearch, type FrontDeskTab } from '@/lib/front-desk-nav'
import { api, card, secondaryButton, Toast, useToast, useWorkspace } from './ui'
import { SalonSetupTab, type Section } from './salon-setup'
import { SalonCounter } from './salon-counter'
import { SalonInvoices } from './salon-invoices'
import { SalonReviews } from './salon-reviews'
import { SalonTeam } from './salon-team'
import type { SalonSetup } from './types'

type Tab = FrontDeskTab

/** Front Desk: the counter, invoices, reviews, team and setup, for any business that takes appointments. */
export function SalonApp() {
  const { workspace, error: workspaceError } = useWorkspace()
  const { toast, flash } = useToast()
  const [setup, setSetup] = useState<SalonSetup | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('counter')
  const scroller = useRef<HTMLDivElement>(null)
  const [setupSection, setSetupSection] = useState<Section>('services')
  // One date range for Invoices, Reviews and Team, so switching tabs keeps the dates
  const [range, setRange] = useState<DateRange>(() => resolveRange('month'))

  const loadSetup = useCallback(async (orgId: string) => {
    const data = await api(`/api/salon/setup?organizationId=${orgId}`)
    setSetup({ settings: data.settings, services: data.services, staff: data.staff })
    return data
  }, [])

  const canManage = can(workspace?.me, 'automation.manage')
  const allowed = useCallback((value: Tab) => canManage || !MANAGER_TABS.includes(value), [canManage])

  useEffect(() => {
    if (!workspace) return
    loadSetup(workspace.orgId)
      .then((data) => {
        // The tab in the address (?tab=…), else Setup while there is nothing to sell yet
        const asked = tabFromSearch(window.location.search)
        if (asked && (can(workspace.me, 'automation.manage') || !MANAGER_TABS.includes(asked))) setTab(asked)
        else if (!data.services?.length && can(workspace.me, 'automation.manage')) setTab('setup')
      })
      .catch((err) => setError(err.message))
  }, [workspace, loadSetup])

  /** Show a tab: kept in the address, so the phone's Back button returns to the tab before. */
  const shown = useRef<Tab>('counter')
  useEffect(() => { shown.current = tab }, [tab])
  const go = useCallback((next: Tab) => {
    if (!allowed(next)) return
    if (shown.current !== next) {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.pushState(window.history.state, '', url)
      scroller.current?.scrollTo({ top: 0 })
    }
    shown.current = next
    setTab(next)
  }, [allowed])

  // The bottom bar (phones) opens tabs; Back and Forward move between them
  useEffect(() => {
    const open = (event: Event) => { const next = (event as CustomEvent).detail; if (isFrontDeskTab(next)) go(next) }
    const back = () => { const asked = tabFromSearch(window.location.search) || 'counter'; if (allowed(asked)) setTab(asked) }
    window.addEventListener(OPEN_TAB_EVENT, open)
    window.addEventListener('popstate', back)
    return () => { window.removeEventListener(OPEN_TAB_EVENT, open); window.removeEventListener('popstate', back) }
  }, [go, allowed])

  // Setup opens on Services unless asked for a section (the templates reminder opens Templates)
  useEffect(() => { if (tab !== 'setup') setSetupSection('services') }, [tab])

  // Tell the bottom bar which tab is showing
  useEffect(() => { announceFrontDeskTab(tab) }, [tab])
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

  const templatesSetUp = Object.values(setup.settings.message_templates || {}).filter(Boolean).length
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })

  return (
    <div ref={scroller} className="@container flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-6xl mx-auto px-3 min-[400px]:px-4 @xl:px-6 py-4 @xl:py-7 space-y-4 @xl:space-y-5">
        <header className="flex flex-col @4xl:flex-row @4xl:items-center justify-between gap-3 @xl:gap-4">
          <div className="flex items-center gap-3 @xl:gap-3.5 min-w-0 w-full @4xl:w-auto">
            {isSafeLogoUrl(setup.settings.logo_url)
              // eslint-disable-next-line @next/next/no-img-element
              ? <span className="h-12 w-12 @xl:h-14 @xl:w-14 shrink-0 rounded-2xl bg-white border border-[#e3e8f2] dark:border-slate-700 flex items-center justify-center overflow-hidden shadow-sm"><img src={setup.settings.logo_url} alt="" className="max-h-full max-w-full object-contain p-1.5" /></span>
              : <span className="h-12 w-12 @xl:h-14 @xl:w-14 shrink-0 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center shadow-sm"><ConciergeBell size={24} /></span>}
            <div className="min-w-0">
              <h1 className="text-[21px] min-[400px]:text-[24px] @xl:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-tight truncate">{setup.settings.business_name || workspace.orgName || 'Front Desk'}</h1>
              <p className="text-[13.5px] @xl:text-[15px] text-[#4a5672] dark:text-slate-400 truncate"><span className="hidden min-[400px]:inline">Front Desk <span aria-hidden className="mx-1 text-[#c0c8d8]">•</span> </span>{todayLabel}</p>
            </div>
            {/* Phones: the tabs are in the bottom bar; Setup is this button */}
            {canManage && (
              <button type="button" onClick={() => go(tab === 'setup' ? 'counter' : 'setup')} aria-label={tab === 'setup' ? 'Close setup' : 'Setup'} aria-pressed={tab === 'setup'}
                className={`md:hidden ml-auto shrink-0 h-11 w-11 rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${tab === 'setup' ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[#4a5672] dark:text-slate-300'}`}>
                <Settings2 size={20} />
              </button>
            )}
          </div>
          <div role="tablist" aria-label="Front Desk" className="max-md:hidden flex w-full @4xl:w-auto rounded-2xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 shadow-[0_1px_2px_rgba(14,27,61,0.04)]">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go(id)}
                className={`flex-1 @4xl:flex-none min-w-0 inline-flex flex-col @xl:flex-row items-center justify-center gap-0.5 @xl:gap-2 h-[52px] @xl:h-11 px-1 @xl:px-4 rounded-xl text-[11.5px] min-[400px]:text-[12.5px] @xl:text-[15px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${tab === id ? 'bg-[#0E1B3D] text-white shadow-sm dark:bg-white dark:text-[#0E1B3D]' : 'text-[#4a5672] dark:text-slate-300 hover:text-[#0E1B3D] hover:bg-[#f4f6fa] dark:hover:text-white dark:hover:bg-slate-800'}`}>
                <Icon size={18} className="shrink-0" /> <span className="truncate max-w-full">{label}</span>
              </button>
            ))}
          </div>
        </header>

        {tab === 'setup' && canManage && <SalonSetupTab key={setupSection} orgId={workspace.orgId} setup={setup} onChange={setSetup} flash={flash} initialSection={setupSection} />}
        {/* Nothing is sent from a template until the business sets its templates up */}
        {tab === 'counter' && canManage && setup.services.length > 0 && templatesSetUp < 4 && (
          <div className={`${card} px-4 @xl:px-5 py-3.5 flex flex-col @xl:flex-row @xl:items-center gap-3`}>
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span className="h-9 w-9 shrink-0 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><FileText size={18} /></span>
              <p className="text-[14px] text-[#4a5672] dark:text-slate-300"><span className="font-bold text-[#0E1B3D] dark:text-white">WhatsApp templates: {templatesSetUp} of 4 set up.</span> Bills, reminders and feedback reach customers who haven&apos;t messaged you in 24 hours only once their template is set up.</p>
            </div>
            <button type="button" onClick={() => { setSetupSection('templates'); go('setup') }} className={`${secondaryButton} shrink-0`}>Set up templates</button>
          </div>
        )}
        {tab === 'counter' && (setup.services.length === 0
          ? (
            <div className={`${card} px-6 py-12 text-center`}>
              <span className="mx-auto h-14 w-14 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#4a5672] dark:text-slate-300 flex items-center justify-center"><Sparkles size={26} /></span>
              <h2 className="mt-4 text-[19px] font-extrabold text-[#0E1B3D] dark:text-white">Add your services to open the counter</h2>
              <p className="mt-1 text-[15px] text-[#4a5672] dark:text-slate-400 max-w-md mx-auto">{canManage ? 'In Setup, pick your kind of business to add a starter list of services and team in one tap, or add your own. Change anything any time.' : 'Your manager needs to add services in Setup before the counter can be used.'}</p>
              {canManage && <button type="button" onClick={() => go('setup')} className="mt-5 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#0E1B3D] dark:bg-white text-white dark:text-[#0E1B3D] text-[15px] font-bold cursor-pointer"><Settings2 size={17} /> Go to Setup</button>}
            </div>
          )
          : <SalonCounter orgId={workspace.orgId} setup={setup} canWrite={can(workspace.me, 'records.write')} flash={flash} />)}
        {tab === 'team' && canManage && <SalonTeam orgId={workspace.orgId} flash={flash} range={range} onRangeChange={setRange} onOpenReviews={() => go('reviews')} />}
        {tab === 'reviews' && canManage && <SalonReviews orgId={workspace.orgId} flash={flash} range={range} onRangeChange={setRange} />}
        {tab === 'invoices' && <SalonInvoices orgId={workspace.orgId} canWrite={can(workspace.me, 'records.write')} canVoid={canManage} flash={flash} range={range} onRangeChange={setRange} />}
      </div>
      <Toast toast={toast} />
    </div>
  )
}
