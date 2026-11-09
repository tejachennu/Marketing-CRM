'use client'

/** Every deal, open or closed: search, filter, sort, and download as a spreadsheet (CSV). */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, ListFilter, Search } from 'lucide-react'
import { PRIORITIES, PRIORITY_LABEL, SOURCES, STATUS_LABEL, sourceLabel } from '@/lib/pipeline/rules'
import { api, card, input, secondaryButton } from '../salon/ui'
import { EmptyState, FollowUpBadge, money, personName, PriorityTag, selectInput, shortDate, timeAgo, type Deal, type PipelineData } from './shared'

const PAGE = 50
const SORTS = [
  { id: 'created_at', label: 'Newest first' },
  { id: 'value', label: 'Biggest value' },
  { id: 'next_follow_up_at', label: 'Follow-up soonest' },
  { id: 'last_activity_at', label: 'Recently active' },
  { id: 'expected_close_date', label: 'Closing soonest' },
]

const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function PipelineList({ data, onOpen, refreshKey }: { data: PipelineData; onOpen: (id: string) => void; refreshKey: number }) {
  const { orgId, stages, team, currency, me } = data
  const [filters, setFilters] = useState({ q: '', status: 'active', stage: '', owner: '', priority: '', source: '', sort: 'created_at' })
  const [rows, setRows] = useState<Deal[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const seq = useRef(0)

  const query = useCallback((offset: number) => {
    const params = new URLSearchParams({ organizationId: orgId, limit: String(PAGE), offset: String(offset), status: filters.status, sort: filters.sort })
    for (const key of ['q', 'stage', 'owner', 'priority', 'source'] as const) if (filters[key]) params.set(key, filters[key])
    return api(`/api/pipeline/leads?${params}`)
  }, [orgId, filters])

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await query(0)
        if (id !== seq.current) return
        setRows(result.leads || []); setHasMore(Boolean(result.hasMore)); setError('')
      } catch (err: any) {
        if (id === seq.current) setError(err.message)
      } finally {
        if (id === seq.current) setLoading(false)
      }
    }, filters.q ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [query, filters.q, refreshKey])

  const more = async () => {
    setLoading(true)
    try {
      const result = await query(rows.length)
      setRows((current) => [...current, ...(result.leads || [])]); setHasMore(Boolean(result.hasMore))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name || '—'
  const where = (deal: Deal) => (deal.status === 'active' ? stageName(deal.pipeline_stage_id) : STATUS_LABEL[deal.status])

  const download = () => {
    const header = ['Deal', 'Customer', 'Phone', 'Company', 'Stage', 'Status', `Value (${currency})`, 'Priority', 'Source', 'Owner', 'Next follow-up', 'Expected close', 'Created', 'Won or lost reason']
    const lines = rows.map((d) => [
      d.title, d.contact?.name, d.contact?.phone, d.contact?.company, stageName(d.pipeline_stage_id), STATUS_LABEL[d.status], d.value ?? '', d.priority ? PRIORITY_LABEL[d.priority] : '',
      sourceLabel(d.source), personName(team, d.assigned_to), d.next_follow_up_at ? new Date(d.next_follow_up_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '', d.expected_close_date || '',
      new Date(d.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), d.won_lost_reason || '',
    ].map(csvCell).join(','))
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  const activeFilters = ['stage', 'owner', 'priority', 'source'].filter((k) => filters[k as keyof typeof filters]).length

  return (
    <div className="space-y-3">
      <div className={`${card} p-3 space-y-3`}>
        <div className="flex flex-col @xl:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
            <input value={filters.q} onChange={(e) => set('q', e.target.value)} placeholder="Search deal, customer or number" aria-label="Search deals" className={`${input} pl-10 h-10`} />
          </div>
          <div className="grid grid-cols-2 @xl:flex gap-2">
            <select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status" className={`${selectInput} @xl:w-[130px]`}>
              <option value="active">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="on_hold">On hold</option><option value="all">All deals</option>
            </select>
            <select value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort" className={`${selectInput} @xl:w-[175px]`}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} className={`${secondaryButton} h-10 flex-1 @xl:flex-none`}><ListFilter size={16} /> Filters{activeFilters ? ` (${activeFilters})` : ''}</button>
            <button type="button" onClick={download} disabled={!rows.length} className={`${secondaryButton} h-10 flex-1 @xl:flex-none`} title="Download these deals as a spreadsheet"><Download size={16} /> CSV</button>
          </div>
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 @4xl:grid-cols-4 gap-2 pt-3 border-t border-[#eef1f6] dark:border-slate-800">
            <select value={filters.stage} onChange={(e) => set('stage', e.target.value)} aria-label="Stage" className={selectInput}>
              <option value="">Every stage</option>
              {[...stages].sort((a, b) => a.position - b.position).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {me.seeAll ? (
              <select value={filters.owner} onChange={(e) => set('owner', e.target.value)} aria-label="Owner" className={selectInput}>
                <option value="">Everyone</option><option value="me">Mine</option><option value="none">No owner</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            ) : null}
            <select value={filters.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Priority" className={selectInput}>
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            <select value={filters.source} onChange={(e) => set('source', e.target.value)} aria-label="Source" className={selectInput}>
              <option value="">Any source</option>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <div className={`${card} p-4 text-[15px] text-[#b91c1c]`}>{error}</div>}

      <div className={`${card} overflow-hidden`}>
        {!loading && rows.length === 0 && !error && <EmptyState icon={<Search size={24} />} title="No deals here" text={filters.q || activeFilters ? 'Nothing matches. Try another search or clear the filters.' : 'Deals you add show up here.'} />}
        {rows.length > 0 && (
          <>
            {/* Wide screens: a table */}
            <table className="hidden @4xl:table w-full text-left">
              <thead>
                <tr className="text-[12.5px] font-bold uppercase tracking-wide text-[#6B7894] border-b border-[#eef1f6] dark:border-slate-800">
                  <th className="px-4 py-3 font-bold">Deal</th>
                  <th className="px-3 py-3 font-bold">Stage</th>
                  <th className="px-3 py-3 font-bold text-right">Value</th>
                  <th className="px-3 py-3 font-bold">Follow-up</th>
                  {me.seeAll && <th className="px-3 py-3 font-bold">Owner</th>}
                  <th className="px-4 py-3 font-bold">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deal) => (
                  <tr key={deal.id} onClick={() => onOpen(deal.id)} className="border-b last:border-0 border-[#eef1f6] dark:border-slate-800 hover:bg-[#f8fafd] dark:hover:bg-slate-800/40 cursor-pointer">
                    <td className="px-4 py-3 max-w-[320px]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(deal.id) }} className="block text-left text-[14.5px] font-bold text-[#0E1B3D] dark:text-white truncate max-w-full cursor-pointer hover:text-[#1D5BEA]">{deal.title || 'Untitled deal'}</button>
                      <span className="block text-[13px] text-[#6B7894] truncate">{[deal.contact?.name, deal.contact?.company].filter(Boolean).join(' · ') || 'No contact'}</span>
                    </td>
                    <td className="px-3 py-3 text-[14px] text-[#0E1B3D] dark:text-slate-200 whitespace-nowrap">{where(deal)}<span className="block"><PriorityTag priority={deal.priority} /></span></td>
                    <td className="px-3 py-3 text-[14.5px] font-bold text-[#0E1B3D] dark:text-white text-right whitespace-nowrap">{deal.value == null ? <span className="text-[#8a94a8] font-semibold">—</span> : money(deal.value, currency)}</td>
                    <td className="px-3 py-3">{deal.status === 'active' ? <FollowUpBadge at={deal.next_follow_up_at} /> : <span className="text-[13px] text-[#8a94a8]">{shortDate(deal.won_at || deal.lost_at || deal.updated_at)}</span>}</td>
                    {me.seeAll && <td className="px-3 py-3 text-[14px] text-[#4a5672] dark:text-slate-300 max-w-[160px] truncate">{personName(team, deal.assigned_to)}</td>}
                    <td className="px-4 py-3 text-[13.5px] text-[#6B7894] whitespace-nowrap">{timeAgo(deal.last_activity_at || deal.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phones and tablets: cards */}
            <ul className="@4xl:hidden divide-y divide-[#eef1f6] dark:divide-slate-800">
              {rows.map((deal) => (
                <li key={deal.id}>
                  <button type="button" onClick={() => onOpen(deal.id)} className="w-full text-left px-3.5 py-3 hover:bg-[#f8fafd] dark:hover:bg-slate-800/40 cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{deal.title || 'Untitled deal'}</p>
                        <p className="text-[13px] text-[#6B7894] truncate">{[deal.contact?.name, where(deal), me.seeAll ? personName(team, deal.assigned_to) : null].filter(Boolean).join(' · ')}</p>
                      </div>
                      <span className="text-[15px] font-extrabold text-[#0E1B3D] dark:text-white whitespace-nowrap">{deal.value == null ? '—' : money(deal.value, currency, true)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      {deal.status === 'active' ? <FollowUpBadge at={deal.next_follow_up_at} /> : <span className="text-[12.5px] font-semibold text-[#4a5672]">{STATUS_LABEL[deal.status]} {shortDate(deal.won_at || deal.lost_at || deal.updated_at)}</span>}
                      <PriorityTag priority={deal.priority} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {loading && <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={24} /></div>}
      </div>
      {hasMore && !loading && <div className="flex justify-center"><button type="button" onClick={more} className={secondaryButton}>Show more</button></div>}
    </div>
  )
}
