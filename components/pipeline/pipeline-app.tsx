'use client'

/**
 * Sales Pipeline: the board, every deal in a list, today's follow-ups, reports and the stages.
 * The tab is in the address (?tab=), and ?deal=<id> opens a deal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlarmClock, BarChart3, KanbanSquare, List, Loader2, Plus, Search, Settings2, TrendingUp } from 'lucide-react'
import { followUpState } from '@/lib/pipeline/rules'
import { resolveRange, type DateRange } from '@/lib/salon/ranges'
import { api, card, input, primaryButton, Toast, useToast, useWorkspace } from '../salon/ui'
import { DealSheet } from './deal-sheet'
import { NewDeal } from './new-deal'
import { PipelineBoard } from './pipeline-board'
import { PipelineFollowUps } from './pipeline-followups'
import { PipelineList } from './pipeline-list'
import { PipelineReports } from './pipeline-reports'
import { PipelineSetup } from './pipeline-setup'
import { money, selectInput, type Deal, type PipelineData, type Stage } from './shared'

type Tab = 'board' | 'list' | 'follow-ups' | 'reports' | 'setup'
const TABS: Tab[] = ['board', 'list', 'follow-ups', 'reports', 'setup']
const BOARD_LIMIT = 500

const readParam = (name: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name))

export function PipelineApp() {
  const { workspace, error: workspaceError } = useWorkspace()
  const { toast, flash } = useToast()
  const [data, setData] = useState<PipelineData | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>(() => { const t = readParam('tab') as Tab; return TABS.includes(t) ? t : 'board' })
  const [openDeal, setOpenDeal] = useState<string | null>(() => readParam('deal'))
  const [creating, setCreating] = useState<{ stageId?: string | null } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [range, setRange] = useState<DateRange>(() => resolveRange('month'))
  const [boardFilter, setBoardFilter] = useState({ q: '', owner: '', priority: '' })

  const orgId = workspace?.orgId

  const loadDeals = useCallback(async (org: string) => {
    const result = await api(`/api/pipeline/leads?organizationId=${org}&status=active&limit=${BOARD_LIMIT}`)
    setDeals(result.leads || []); setTruncated(Boolean(result.hasMore))
  }, [])

  useEffect(() => {
    if (!orgId) return
    (async () => {
      try {
        const [boot] = await Promise.all([api(`/api/pipeline?organizationId=${orgId}`), loadDeals(orgId)])
        setData({ orgId, stages: boot.stages, team: boot.team, currency: boot.currency || 'INR', me: boot.me })
      } catch (err: any) {
        setError(err.message)
      }
    })()
  }, [orgId, loadDeals])

  // The address follows the tab and the open deal, so Back and links work
  const go = useCallback((next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'board') url.searchParams.delete('tab'); else url.searchParams.set('tab', next)
    window.history.pushState({}, '', url)
  }, [])
  const showDeal = useCallback((id: string | null) => {
    setOpenDeal(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('deal', id); else url.searchParams.delete('deal')
    window.history.replaceState({}, '', url)
  }, [])
  useEffect(() => {
    const back = () => {
      const t = readParam('tab') as Tab
      setTab(TABS.includes(t) ? t : 'board')
      setOpenDeal(readParam('deal'))
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  // A changed deal: kept on the board while open, taken off once won, lost or on hold
  const updated = useCallback((deal: Deal) => {
    setDeals((current) => {
      const others = current.filter((d) => d.id !== deal.id)
      return deal.status === 'active' ? [deal, ...others] : others
    })
    setRefreshKey((k) => k + 1)
  }, [])
  const removed = useCallback((id: string) => {
    setDeals((current) => current.filter((d) => d.id !== id))
    setRefreshKey((k) => k + 1)
    showDeal(null)
  }, [showDeal])

  const move = async (deal: Deal, stageId: string) => {
    if (!data || deal.pipeline_stage_id === stageId) return
    const before = deals
    setDeals((current) => current.map((d) => (d.id === deal.id ? { ...d, pipeline_stage_id: stageId } : d)))
    try {
      const result = await api(`/api/pipeline/leads/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ organizationId: data.orgId, pipeline_stage_id: stageId }) })
      updated(result.lead)
      flash('success', `Moved to ${data.stages.find((s) => s.id === stageId)?.name || 'the stage'}.`)
    } catch (err: any) {
      setDeals(before)
      flash('error', err.message)
    }
  }

  const boardDeals = useMemo(() => {
    const q = boardFilter.q.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return deals.filter((d) => {
      if (boardFilter.priority && d.priority !== boardFilter.priority) return false
      if (boardFilter.owner === 'me' && d.assigned_to !== data?.me.id) return false
      if (boardFilter.owner === 'none' && d.assigned_to) return false
      if (boardFilter.owner && !['me', 'none'].includes(boardFilter.owner) && d.assigned_to !== boardFilter.owner) return false
      if (!q) return true
      const text = [d.title, d.contact?.name, d.contact?.company, d.product_service].filter(Boolean).join(' ').toLowerCase()
      return text.includes(q) || (digits.length >= 4 && String(d.contact?.phone || '').replace(/\D/g, '').includes(digits))
    })
  }, [deals, boardFilter, data?.me.id])

  if (workspaceError || error) {
    const off = /switched off/i.test(error)
    return (
      <div className="p-4 @container flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
        <div className={`${card} max-w-xl mx-auto mt-6 p-6 text-center`}>
          <span className="mx-auto h-14 w-14 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#4a5672] flex items-center justify-center"><TrendingUp size={26} /></span>
          <p className={`mt-4 text-[15px] ${off ? 'text-[#0E1B3D] dark:text-white' : 'text-[#b91c1c]'}`}>{workspaceError || error}</p>
          {off && <a href="/dashboard/connectors" className={`${primaryButton} mt-5`}>Open Connectors</a>}
        </div>
      </div>
    )
  }
  if (!workspace || !data) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={30} /></div>

  const { me, currency } = data
  const canWrite = !me.readOnly
  const openValue = deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
  const states = deals.map((d) => followUpState(d.next_follow_up_at))
  const due = states.filter((s) => s === 'overdue' || s === 'today').length
  const overdue = states.filter((s) => s === 'overdue').length

  const tabs: { id: Tab; label: string; short?: string; icon: typeof List; badge?: number }[] = [
    { id: 'board', label: 'Board', icon: KanbanSquare },
    { id: 'list', label: 'List', icon: List },
    { id: 'follow-ups', label: 'Follow-ups', short: 'Due', icon: AlarmClock, badge: due },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    ...(me.canManage ? [{ id: 'setup' as const, label: 'Stages', icon: Settings2 }] : []),
  ]

  return (
    <div className="@container flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className={`${tab === 'board' ? 'max-w-[1600px]' : 'max-w-6xl'} mx-auto px-3 min-[400px]:px-4 @xl:px-6 py-4 @xl:py-7 space-y-4 @xl:space-y-5`}>
        <header className="flex flex-col @4xl:flex-row @4xl:items-center justify-between gap-3 @xl:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-12 w-12 @xl:h-14 @xl:w-14 shrink-0 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center shadow-sm"><TrendingUp size={24} /></span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[21px] min-[400px]:text-[24px] @xl:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-tight truncate">Sales Pipeline</h1>
              <p className="text-[13.5px] @xl:text-[15px] text-[#4a5672] dark:text-slate-400 truncate">
                {deals.length}{truncated ? '+' : ''} open · {money(openValue, currency, true)}
                {due > 0 && <span className="max-[419px]:hidden"> · <span className={overdue ? 'font-semibold text-[#b91c1c]' : 'font-semibold text-[#0E1B3D] dark:text-white'}>{due} follow-up{due === 1 ? '' : 's'} due</span></span>}
              </p>
            </div>
            {canWrite && <button type="button" onClick={() => setCreating({})} className={`${primaryButton} @4xl:hidden shrink-0 px-3.5`} aria-label="New deal"><Plus size={18} /><span className="max-[399px]:hidden">New deal</span></button>}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div role="tablist" aria-label="Sales Pipeline" className="flex flex-1 min-w-0 rounded-2xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 shadow-[0_1px_2px_rgba(14,27,61,0.04)]">
              {tabs.map(({ id, label, short, icon: Icon, badge }) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go(id)}
                  className={`relative flex-1 @4xl:flex-none min-w-0 inline-flex flex-col @xl:flex-row items-center justify-center gap-0.5 @xl:gap-2 h-[52px] @xl:h-11 px-1 @xl:px-3.5 rounded-xl text-[11px] min-[400px]:text-[12px] @xl:text-[14.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${tab === id ? 'bg-[#0E1B3D] text-white shadow-sm dark:bg-white dark:text-[#0E1B3D]' : 'text-[#4a5672] dark:text-slate-300 hover:text-[#0E1B3D] hover:bg-[#f4f6fa] dark:hover:text-white dark:hover:bg-slate-800'}`}>
                  <Icon size={18} className="shrink-0" /> <span className="truncate max-w-full">{short ? <><span className="min-[400px]:hidden">{short}</span><span className="max-[399px]:hidden">{label}</span></> : label}</span>
                  {!!badge && <span className={`absolute top-1 right-1 @xl:static h-[18px] min-w-[18px] px-1 rounded-full text-[11px] font-bold inline-flex items-center justify-center ${overdue ? 'bg-[#b91c1c] text-white' : tab === id ? 'bg-white text-[#0E1B3D] dark:bg-[#0E1B3D] dark:text-white' : 'bg-[#eef1f6] text-[#0E1B3D] dark:bg-slate-700 dark:text-white'}`}>{badge}</span>}
                </button>
              ))}
            </div>
            {canWrite && <button type="button" onClick={() => setCreating({})} className={`${primaryButton} @max-4xl:hidden shrink-0`}><Plus size={18} /> New deal</button>}
          </div>
        </header>

        {tab === 'board' && (
          <>
            <div className="flex flex-col @xl:flex-row gap-2">
              <div className="relative flex-1 min-w-0 @xl:max-w-sm">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
                <input value={boardFilter.q} onChange={(e) => setBoardFilter({ ...boardFilter, q: e.target.value })} placeholder="Find a deal or customer" aria-label="Find a deal" className={`${input} pl-10 h-10 bg-white`} />
              </div>
              <div className="grid grid-cols-2 @xl:flex gap-2">
                {me.seeAll && (
                  <select value={boardFilter.owner} onChange={(e) => setBoardFilter({ ...boardFilter, owner: e.target.value })} aria-label="Whose deals" className={`${selectInput} @xl:w-[170px]`}>
                    <option value="">Everyone</option><option value="me">Mine</option><option value="none">No owner</option>
                    {data.team.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                  </select>
                )}
                <select value={boardFilter.priority} onChange={(e) => setBoardFilter({ ...boardFilter, priority: e.target.value })} aria-label="Priority" className={`${selectInput} @xl:w-[150px] ${me.seeAll ? '' : 'col-span-2'}`}>
                  <option value="">Priority</option><option value="high">Hot</option><option value="medium">Warm</option><option value="low">Cold</option>
                </select>
              </div>
            </div>
            <PipelineBoard data={data} deals={boardDeals} truncated={truncated} onOpen={showDeal} onMove={move} onNew={(stageId) => setCreating({ stageId })} />
          </>
        )}
        {tab === 'list' && <PipelineList data={data} onOpen={showDeal} refreshKey={refreshKey} />}
        {tab === 'follow-ups' && <PipelineFollowUps data={data} deals={deals} onOpen={showDeal} onUpdated={updated} flash={flash} />}
        {tab === 'reports' && <PipelineReports key={refreshKey} data={data} range={range} onRangeChange={setRange} />}
        {tab === 'setup' && me.canManage && <PipelineSetup orgId={data.orgId} flash={flash} onStagesChange={(stages: Stage[]) => setData({ ...data, stages })} />}
      </div>

      {openDeal && <DealSheet key={openDeal} data={data} dealId={openDeal} onClose={() => showDeal(null)} onChanged={updated} onDeleted={removed} flash={flash} />}
      {creating && (
        <NewDeal data={data} stageId={creating.stageId} onClose={() => setCreating(null)} flash={flash}
          onCreated={(deal) => { setCreating(null); updated(deal); showDeal(deal.id) }} />
      )}
      <Toast toast={toast} />
    </div>
  )
}
