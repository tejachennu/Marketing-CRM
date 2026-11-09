'use client'

/** The board: open deals in their stages. Drag a card to move it, or use its Move menu (phones). */

import { useState } from 'react'
import { ArrowRightLeft, Plus } from 'lucide-react'
import { boardColumns } from '@/lib/pipeline/rules'
import { Avatar, card } from '../salon/ui'
import { FollowUpBadge, money, personName, PriorityTag, type Deal, type PipelineData } from './shared'

export function PipelineBoard({ data, deals, onOpen, onMove, onNew, truncated }: {
  data: PipelineData
  deals: Deal[]
  onOpen: (id: string) => void
  onMove: (deal: Deal, stageId: string) => void
  onNew: (stageId: string) => void
  truncated: boolean
}) {
  const { stages, team, currency, me } = data
  const canWrite = !me.readOnly
  const columns = boardColumns(deals, stages)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const drop = (stageId: string) => {
    const deal = deals.find((d) => d.id === dragging)
    setDragging(null); setOver(null)
    if (deal && deal.pipeline_stage_id !== stageId) onMove(deal, stageId)
  }

  return (
    <div className="space-y-2">
      {truncated && <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400">Showing the first 500 open deals. Use the List to search all of them.</p>}
      <div className="-mx-3 min-[400px]:-mx-4 @xl:mx-0 px-3 min-[400px]:px-4 @xl:px-0 flex gap-3 overflow-x-auto snap-x snap-mandatory @xl:snap-none pb-3 overscroll-x-contain">
        {columns.map(({ stage, leads, total }) => (
          <section key={stage.id} aria-label={stage.name}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage.id) } }}
            onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
            onDrop={(e) => { e.preventDefault(); drop(stage.id) }}
            className={`snap-start shrink-0 w-[84%] min-[480px]:w-[300px] @4xl:w-[280px] rounded-2xl border transition-colors flex flex-col max-h-[calc(100dvh-260px)] min-h-[200px] ${over === stage.id ? 'border-[#1D5BEA] bg-[#eef3fe] dark:bg-blue-950/20' : 'border-[#e3e8f2] dark:border-slate-800 bg-[#eef1f6]/70 dark:bg-slate-900/40'}`}>
            <header className="flex items-center gap-2 px-3 pt-3 pb-2">
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 text-[14.5px] font-bold text-[#0E1B3D] dark:text-white">
                  <span className="truncate">{stage.name}</span>
                  <span className="shrink-0 h-5 min-w-5 px-1.5 rounded-full bg-white dark:bg-slate-800 text-[12px] font-bold text-[#4a5672] dark:text-slate-300 inline-flex items-center justify-center">{leads.length}</span>
                </h3>
                <p className="text-[12.5px] font-semibold text-[#6B7894]">{money(total, currency, true)}</p>
              </div>
              {canWrite && <button type="button" onClick={() => onNew(stage.id)} aria-label={`New deal in ${stage.name}`} className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-white dark:hover:bg-slate-800 cursor-pointer"><Plus size={17} /></button>}
            </header>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
              {leads.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-[#8a94a8]">{canWrite ? 'Drag a deal here' : 'No deals'}</p>}
              {leads.map((deal) => (
                <article key={deal.id} draggable={canWrite} onDragStart={(e) => { setDragging(deal.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDragging(null); setOver(null) }}
                  className={`${card} p-3 cursor-pointer hover:border-[#9db5ef] transition-colors ${dragging === deal.id ? 'opacity-50' : ''}`}
                  onClick={() => onOpen(deal.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(deal.id) }} tabIndex={0} role="button" aria-label={`Open ${deal.title || 'deal'}`}>
                  <p className="text-[14.5px] font-bold text-[#0E1B3D] dark:text-white leading-snug line-clamp-2 [overflow-wrap:anywhere]">{deal.title || 'Untitled deal'}</p>
                  <p className="text-[13px] text-[#6B7894] dark:text-slate-400 truncate">{[deal.contact?.name, deal.contact?.company].filter(Boolean).join(' · ') || 'No contact'}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[15px] font-extrabold text-[#0E1B3D] dark:text-white truncate">{deal.value == null ? <span className="text-[13px] font-semibold text-[#8a94a8]">No value</span> : money(deal.value, currency)}</span>
                    <PriorityTag priority={deal.priority} />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 min-h-7">
                    <FollowUpBadge at={deal.next_follow_up_at} compact />
                    <span className="ml-auto flex items-center gap-1.5">
                      {me.seeAll && (deal.assigned_to
                        ? <span title={personName(team, deal.assigned_to)}><Avatar name={personName(team, deal.assigned_to)} size={24} /></span>
                        : <span title="No owner" aria-label="No owner" className="h-6 w-6 rounded-full border border-dashed border-[#c0c8d8] dark:border-slate-600" />)}
                      {canWrite && (
                        <label onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="relative h-7 w-7 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer" title="Move to another stage">
                          <ArrowRightLeft size={15} />
                          <select aria-label={`Move ${deal.title || 'deal'} to`} value={deal.pipeline_stage_id || ''} onChange={(e) => onMove(deal, e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full">
                            {[...stages].sort((a, b) => a.position - b.position).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </label>
                      )}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
