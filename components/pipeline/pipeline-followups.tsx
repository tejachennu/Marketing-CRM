'use client'

/**
 * Who to call today: overdue and due follow-ups first, then tomorrow and later, then open deals
 * with no follow-up at all. "Done" notes what happened and sets the next one in one step.
 */

import { useState } from 'react'
import { AlarmClock, Check, Loader2 } from 'lucide-react'
import { followUpPreset, followUpState, type FollowUpState } from '@/lib/pipeline/rules'
import { api, card, input, primaryButton, secondaryButton } from '../salon/ui'
import { FOLLOW_PRESETS } from './deal-sheet'
import { ContactActions, EmptyState, FollowUpBadge, money, personName, type Deal, type PipelineData } from './shared'

const GROUPS: { id: FollowUpState; title: string; empty?: string }[] = [
  { id: 'overdue', title: 'Overdue' },
  { id: 'today', title: 'Today' },
  { id: 'tomorrow', title: 'Tomorrow' },
  { id: 'later', title: 'Later' },
  { id: 'none', title: 'No follow-up set' },
]

export function PipelineFollowUps({ data, deals, onOpen, onUpdated, flash }: {
  data: PipelineData
  deals: Deal[]
  onOpen: (id: string) => void
  onUpdated: (deal: Deal) => void
  flash: (tone: 'success' | 'error', text: string) => void
}) {
  const { orgId, stages, team, currency, me } = data
  const canWrite = !me.readOnly
  const [doing, setDoing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [next, setNext] = useState<string>('3days')
  const [busy, setBusy] = useState<string | null>(null)
  const [showNone, setShowNone] = useState(false)

  const open = deals.filter((d) => d.status === 'active')
  const grouped = new Map<FollowUpState, Deal[]>()
  for (const deal of open) {
    const state = followUpState(deal.next_follow_up_at)
    grouped.set(state, [...(grouped.get(state) || []), deal])
  }
  for (const list of grouped.values()) list.sort((a, b) => (a.next_follow_up_at || '').localeCompare(b.next_follow_up_at || '') || (Number(b.value) || 0) - (Number(a.value) || 0))

  const done = async (deal: Deal) => {
    setBusy(deal.id)
    try {
      const result = await api(`/api/pipeline/leads/${deal.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgId, type: 'call', content: note.trim() || 'Followed up', next_follow_up_at: next === 'none' ? null : followUpPreset(next as any) }),
      })
      onUpdated(result.lead)
      setDoing(null); setNote('')
      flash('success', next === 'none' ? 'Done. No next follow-up set.' : 'Done. Next follow-up set.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  const snooze = async (deal: Deal, preset: string) => {
    setBusy(deal.id)
    try {
      const result = await api(`/api/pipeline/leads/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, next_follow_up_at: followUpPreset(preset as any) }) })
      onUpdated(result.lead)
      flash('success', 'Follow-up moved.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  const dueCount = (grouped.get('overdue')?.length || 0) + (grouped.get('today')?.length || 0)
  if (!open.length) return <div className={card}><EmptyState icon={<AlarmClock size={24} />} title="No open deals" text="Follow-ups for your open deals show up here." /></div>

  return (
    <div className="space-y-4">
      {dueCount === 0 && (
        <div className={`${card} px-4 py-3.5 flex items-center gap-3`}>
          <span className="h-9 w-9 shrink-0 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><Check size={18} /></span>
          <p className="text-[14.5px] text-[#4a5672] dark:text-slate-300"><span className="font-bold text-[#0E1B3D] dark:text-white">Nothing due today.</span> You are on top of your follow-ups.</p>
        </div>
      )}
      {GROUPS.map((group) => {
        const list = grouped.get(group.id) || []
        if (!list.length) return null
        const hidden = group.id === 'none' && !showNone
        return (
          <section key={group.id} className="space-y-2">
            <h3 className={`flex items-center gap-2 text-[14px] font-bold ${group.id === 'overdue' ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>
              {group.title}
              <span className="h-5 min-w-5 px-1.5 rounded-full bg-white dark:bg-slate-800 border border-[#e3e8f2] dark:border-slate-700 text-[12px] font-bold text-[#4a5672] dark:text-slate-300 inline-flex items-center justify-center">{list.length}</span>
              {group.id === 'none' && <button type="button" onClick={() => setShowNone((v) => !v)} className="ml-1 text-[13px] font-semibold text-[#1D5BEA] cursor-pointer">{showNone ? 'Hide' : 'Show'}</button>}
            </h3>
            {!hidden && (
              <ul className={`${card} divide-y divide-[#eef1f6] dark:divide-slate-800`}>
                {list.map((deal) => (
                  <li key={deal.id} className="px-3.5 py-3">
                    <div className="flex flex-col @xl:flex-row @xl:items-center gap-2.5">
                      <button type="button" onClick={() => onOpen(deal.id)} className="min-w-0 flex-1 text-left cursor-pointer group">
                        <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate group-hover:text-[#1D5BEA]">{deal.contact?.name || 'No contact'}<span className="font-semibold text-[#6B7894]"> · {deal.title || 'Untitled deal'}</span></p>
                        <p className="mt-0.5 flex items-center gap-2 flex-wrap text-[13px] text-[#6B7894]">
                          <FollowUpBadge at={deal.next_follow_up_at} />
                          <span className="truncate min-w-0 max-w-full">{[stages.find((s) => s.id === deal.pipeline_stage_id)?.name, deal.value != null ? money(deal.value, currency, true) : null, me.seeAll ? personName(team, deal.assigned_to) : null].filter(Boolean).join(' · ')}</span>
                        </p>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <ContactActions contact={deal.contact} size="sm" />
                        {canWrite && (
                          <>
                            <label className={`${secondaryButton} relative h-9 px-3 text-[13.5px]`}>
                              Snooze
                              <select aria-label={`Snooze the follow-up for ${deal.contact?.name || 'this deal'}`} value="" disabled={busy === deal.id} onChange={(e) => e.target.value && snooze(deal, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full">
                                <option value="" disabled>Snooze until…</option>
                                {FOLLOW_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                              </select>
                            </label>
                            <button type="button" onClick={() => { setDoing(doing === deal.id ? null : deal.id); setNote(''); setNext('3days') }} aria-expanded={doing === deal.id}
                              className={`${doing === deal.id ? secondaryButton : primaryButton} h-9 px-3 text-[13.5px]`}><Check size={15} /> Done</button>
                          </>
                        )}
                      </div>
                    </div>
                    {doing === deal.id && (
                      <div className="mt-3 rounded-xl bg-[#f4f6fa] dark:bg-slate-800/60 p-3 space-y-2.5">
                        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What happened? (optional)" aria-label="What happened" className={input} autoFocus />
                        <div role="radiogroup" aria-label="Next follow-up" className="flex flex-wrap gap-1.5">
                          <span className="self-center text-[13px] font-semibold text-[#4a5672] dark:text-slate-300 mr-1">Next:</span>
                          {[...FOLLOW_PRESETS.filter((p) => p.id !== 'today'), { id: 'none', label: 'No more' } as const].map((p) => (
                            <button key={p.id} type="button" role="radio" aria-checked={next === p.id} onClick={() => setNext(p.id)}
                              className={`h-8 px-3 rounded-full border text-[13px] font-semibold cursor-pointer ${next === p.id ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-transparent text-[#4a5672] dark:text-slate-300'}`}>{p.label}</button>
                          ))}
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setDoing(null)} className={`${secondaryButton} h-10`}>Cancel</button>
                          <button type="button" onClick={() => done(deal)} disabled={busy === deal.id} className={`${primaryButton} h-10`}>{busy === deal.id && <Loader2 size={15} className="animate-spin" />}Save</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
