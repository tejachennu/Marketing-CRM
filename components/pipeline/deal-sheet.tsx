'use client'

/**
 * One deal: talk to the customer, move it along, set the next follow-up, note what happened,
 * close it as won or lost, and see its history and an AI summary.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, CircleSlash, Loader2, PauseCircle, RotateCcw, Sparkles, Trash2, Trophy } from 'lucide-react'
import { ACTIVITY_LABEL, ACTIVITY_TYPES, followUpPreset, LOST_REASONS, PRIORITIES, PRIORITY_LABEL, SOURCES, STATUS_LABEL, type ActivityType } from '@/lib/pipeline/rules'
import { api, Chip, dangerButton, Field, input, Modal, primaryButton, secondaryButton } from '../salon/ui'
import { ContactActions, FollowUpBadge, money, personName, selectInput, shortDate, timeAgo, type Deal, type HistoryItem, type PipelineData } from './shared'

type Flash = (tone: 'success' | 'error', text: string) => void

/** A time as the value of a date-and-time box, in India time. */
export const toIstInput = (at: string | null | undefined) => {
  if (!at) return ''
  const date = new Date(Date.parse(at) + 5.5 * 3600_000)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16)
}
/** A date-and-time box's value, read as India time. */
export const fromIstInput = (value: string) => (value ? new Date(`${value}:00+05:30`).toISOString() : null)

export const FOLLOW_PRESETS = [
  { id: 'today', label: 'Later today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: '3days', label: 'In 3 days' },
  { id: 'week', label: 'Next week' },
] as const

interface Analysis { summary?: string; suggestions?: string; lead_rating?: string; closure_probability?: string; created_at?: string }

export function DealSheet({ data, dealId, onClose, onChanged, onDeleted, flash }: {
  data: PipelineData
  dealId: string
  onClose: () => void
  onChanged: (deal: Deal) => void
  onDeleted: (id: string) => void
  flash: Flash
}) {
  const { orgId, stages, team, currency, me } = data
  const canWrite = !me.readOnly
  const [deal, setDeal] = useState<Deal | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [closing, setClosing] = useState<null | 'won' | 'lost'>(null)
  const [reason, setReason] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const [activityType, setActivityType] = useState<ActivityType>('note')
  const [activityText, setActivityText] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const fillForm = (lead: Deal) => setForm({
    title: lead.title || '', value: lead.value == null ? '' : String(lead.value), priority: lead.priority || 'medium', source: lead.source || 'other',
    assigned_to: lead.assigned_to || '', expected_close_date: lead.expected_close_date || '', product_service: lead.product_service || '', description: lead.description || '',
  })

  const load = useCallback(async () => {
    try {
      const result = await api(`/api/pipeline/leads/${dealId}?organizationId=${orgId}`)
      setDeal(result.lead); setHistory(result.history || []); setConversationId(result.conversationId || null); fillForm(result.lead)
    } catch (err: any) {
      setError(err.message)
    }
  }, [dealId, orgId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api(`/api/ai/summarize?leadId=${dealId}`).then((result) => setAnalysis(result.analyses?.[0] || null)).catch(() => {})
  }, [dealId])

  const change = async (body: Record<string, unknown>, done?: string, key = 'save') => {
    if (!deal) return false
    setBusy(key)
    try {
      const result = await api(`/api/pipeline/leads/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, ...body }) })
      setDeal(result.lead); fillForm(result.lead); onChanged(result.lead)
      const fresh = await api(`/api/pipeline/leads/${deal.id}?organizationId=${orgId}`).catch(() => null)
      if (fresh) setHistory(fresh.history || [])
      if (done) flash('success', done)
      return true
    } catch (err: any) {
      flash('error', err.message)
      return false
    } finally {
      setBusy('')
    }
  }

  const logActivity = async () => {
    if (!deal || !activityText.trim()) return
    setBusy('activity')
    try {
      const result = await api(`/api/pipeline/leads/${deal.id}/activities`, { method: 'POST', body: JSON.stringify({ organizationId: orgId, type: activityType, content: activityText }) })
      setDeal(result.lead); setHistory(result.history || []); onChanged(result.lead)
      setActivityText('')
      flash('success', `${ACTIVITY_LABEL[activityType]} saved.`)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  const summarize = async () => {
    if (!deal) return
    setBusy('ai')
    try {
      const result = await api('/api/ai/summarize', { method: 'POST', body: JSON.stringify({ leadId: deal.id, conversationId }) })
      setAnalysis(result.analysis || null)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!deal) return
    setBusy('delete')
    try {
      await api(`/api/pipeline/leads/${deal.id}?organizationId=${orgId}`, { method: 'DELETE' })
      flash('success', 'Deal deleted.')
      onDeleted(deal.id)
    } catch (err: any) {
      flash('error', err.message)
      setBusy('')
    }
  }

  const close = async () => {
    if (!closing) return
    const full = closing === 'lost' ? [reason, reasonNote.trim()].filter(Boolean).join(': ') : reasonNote.trim()
    if (closing === 'lost' && !reason) { flash('error', 'Choose why the deal was lost.'); return }
    if (await change({ status: closing, reason: full }, closing === 'won' ? 'Marked as won. Well done!' : 'Marked as lost.', 'status')) {
      setClosing(null); setReason(''); setReasonNote('')
    }
  }

  const saveDetails = async () => {
    const body: Record<string, unknown> = {
      title: form.title, value: form.value === '' ? null : form.value, priority: form.priority, source: form.source,
      expected_close_date: form.expected_close_date || null, product_service: form.product_service, description: form.description,
    }
    if (me.canAssign) body.assigned_to = form.assigned_to || null
    if (await change(body, 'Details saved.')) setShowDetails(false)
  }

  const contact = deal?.contact || null
  const subtitle = deal ? [contact?.name, contact?.company].filter(Boolean).join(' · ') || 'No contact' : ''
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const stageIndex = deal ? ordered.findIndex((s) => s.id === deal.pipeline_stage_id) : -1

  const footer = deal && (
    <>
      {me.canAssign && (confirmDelete
        ? <div className="flex flex-col sm:flex-row gap-2 sm:mr-auto"><button type="button" onClick={remove} disabled={busy === 'delete'} className={dangerButton}>{busy === 'delete' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Yes, delete for good</button><button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>Keep it</button></div>
        : <button type="button" onClick={() => setConfirmDelete(true)} className={`${dangerButton} sm:mr-auto`}><Trash2 size={16} /> Delete</button>)}
      <button type="button" onClick={onClose} className={secondaryButton}>Close</button>
    </>
  )

  return (
    <Modal title={deal?.title || 'Deal'} subtitle={subtitle} onClose={onClose} size="lg" footer={footer}>
      {error && <p className="text-[15px] text-[#b91c1c] py-6">{error}</p>}
      {!deal && !error && <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>}
      {deal && (
        <div className="space-y-5 pb-2">
          {/* Value, owner and talking to the customer */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[26px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-tight">{deal.value == null ? <span className="text-[#8a94a8] text-[18px] font-bold">No value yet</span> : money(deal.value, currency)}</div>
              <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400 truncate">
                {personName(team, deal.assigned_to)} · since {shortDate(deal.created_at)}{contact?.phone ? ` · +${String(contact.phone).replace(/\D/g, '')}` : ''}
              </p>
            </div>
            <div className="flex gap-2 shrink-0"><ContactActions contact={contact} conversationId={conversationId} /></div>
          </div>

          {/* Closed: say how, and let it be reopened */}
          {deal.status !== 'active' && (
            <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-700 bg-[#f4f6fa] dark:bg-slate-800/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0 text-[14.5px] text-[#0E1B3D] dark:text-white">
                <span className="font-bold">{STATUS_LABEL[deal.status]}</span>
                {deal.status === 'won' && deal.won_at && ` on ${shortDate(deal.won_at)}`}
                {deal.status === 'lost' && deal.lost_at && ` on ${shortDate(deal.lost_at)}`}
                {deal.won_lost_reason && <span className="text-[#4a5672] dark:text-slate-300"> · {deal.won_lost_reason}</span>}
              </div>
              {canWrite && <button type="button" onClick={() => change({ status: 'active' }, 'Deal reopened.', 'status')} disabled={!!busy} className={`${secondaryButton} shrink-0`}><RotateCcw size={16} /> Reopen</button>}
            </div>
          )}

          {/* Stage */}
          {deal.status === 'active' && (
            <section>
              <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894] mb-2">Stage</h3>
              <div className="flex flex-wrap gap-1.5">
                {ordered.map((stage, i) => {
                  const current = stage.id === deal.pipeline_stage_id
                  const passed = stageIndex >= 0 && i < stageIndex
                  return (
                    <button key={stage.id} type="button" disabled={!canWrite || !!busy || current} aria-pressed={current}
                      onClick={() => change({ pipeline_stage_id: stage.id }, `Moved to ${stage.name}.`, `stage-${stage.id}`)}
                      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13.5px] font-semibold transition-colors ${current ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : passed ? 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 bg-[#f4f6fa] dark:bg-slate-800' : 'border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300'} ${canWrite && !current ? 'hover:border-[#1D5BEA] cursor-pointer' : ''} disabled:cursor-default`}>
                      {busy === `stage-${stage.id}` ? <Loader2 size={13} className="animate-spin" /> : passed ? <Check size={13} /> : null}{stage.name}
                    </button>
                  )
                })}
              </div>
              {canWrite && !closing && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => { setClosing('won'); setReasonNote('') }} disabled={!!busy} className={`${secondaryButton} px-2`}><Trophy size={16} className="max-[359px]:hidden" /> Won</button>
                  <button type="button" onClick={() => { setClosing('lost'); setReason(''); setReasonNote('') }} disabled={!!busy} className={`${secondaryButton} px-2`}><CircleSlash size={16} className="max-[359px]:hidden" /> Lost</button>
                  <button type="button" onClick={() => change({ status: 'on_hold' }, 'Put on hold.', 'status')} disabled={!!busy} className={`${secondaryButton} px-2`}><PauseCircle size={16} className="max-[359px]:hidden" /> <span className="truncate">On hold</span></button>
                </div>
              )}
              {closing && (
                <div className="mt-3 rounded-2xl border border-[#d5ddeb] dark:border-slate-700 p-3.5 space-y-3">
                  <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">{closing === 'won' ? 'Mark as won' : 'Why was it lost?'}</p>
                  {closing === 'lost' && <div className="flex flex-wrap gap-1.5">{LOST_REASONS.map((r) => <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>}
                  <input value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} maxLength={200} placeholder={closing === 'won' ? 'A note, like "Paid advance" (optional)' : 'Anything to add (optional)'} className={input} />
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" onClick={() => setClosing(null)} className={secondaryButton}>Cancel</button>
                    <button type="button" onClick={close} disabled={busy === 'status' || (closing === 'lost' && !reason)} className={primaryButton}>{busy === 'status' && <Loader2 size={16} className="animate-spin" />}{closing === 'won' ? 'Mark as won' : 'Mark as lost'}</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Next follow-up */}
          {deal.status === 'active' && (
            <section>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894]">Next follow-up</h3>
                <FollowUpBadge at={deal.next_follow_up_at} />
              </div>
              {canWrite && (
                <div className="flex flex-wrap gap-1.5">
                  {FOLLOW_PRESETS.map((p) => (
                    <button key={p.id} type="button" disabled={!!busy} onClick={() => change({ next_follow_up_at: followUpPreset(p.id) }, 'Follow-up set.', `follow-${p.id}`)}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#d5ddeb] dark:border-slate-700 text-[13.5px] font-semibold text-[#0E1B3D] dark:text-slate-200 hover:border-[#1D5BEA] cursor-pointer disabled:opacity-50">
                      {busy === `follow-${p.id}` && <Loader2 size={13} className="animate-spin" />}{p.label}
                    </button>
                  ))}
                  <input type="datetime-local" aria-label="Pick a date and time" value={toIstInput(deal.next_follow_up_at)} disabled={!!busy}
                    onChange={(e) => e.target.value && change({ next_follow_up_at: fromIstInput(e.target.value) }, 'Follow-up set.', 'follow-pick')}
                    className="h-9 px-2.5 rounded-lg border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[14px] text-[#0E1B3D] dark:text-white dark:[color-scheme:dark] max-w-full" />
                  {deal.next_follow_up_at && <button type="button" disabled={!!busy} onClick={() => change({ next_follow_up_at: null }, 'Follow-up cleared.', 'follow-clear')} className="h-9 px-3 rounded-lg text-[13.5px] font-semibold text-[#6B7894] hover:text-[#0E1B3D] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">Clear</button>}
                </div>
              )}
            </section>
          )}

          {/* Note what happened */}
          {canWrite && (
            <section className="rounded-2xl border border-[#e3e8f2] dark:border-slate-700 p-3.5 space-y-2.5">
              <div role="radiogroup" aria-label="What did you do?" className="flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.filter((t) => t !== 'email' || deal.contact?.email).map((type) => (
                  <button key={type} type="button" role="radio" aria-checked={activityType === type} onClick={() => setActivityType(type)}
                    className={`h-8 px-3 rounded-full border text-[13px] font-semibold cursor-pointer transition-colors ${activityType === type ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300'}`}>
                    {ACTIVITY_LABEL[type]}
                  </button>
                ))}
              </div>
              <textarea value={activityText} onChange={(e) => setActivityText(e.target.value)} rows={2} maxLength={4000}
                placeholder={activityType === 'call' ? 'What was said on the call?' : activityType === 'meeting' ? 'How did the meeting go?' : 'Write a note…'}
                className={`${input} h-auto py-2.5 resize-y min-h-[72px]`} />
              <div className="flex justify-end">
                <button type="button" onClick={logActivity} disabled={!activityText.trim() || busy === 'activity'} className={`${primaryButton} h-10`}>{busy === 'activity' && <Loader2 size={16} className="animate-spin" />}Save {ACTIVITY_LABEL[activityType].toLowerCase()}</button>
              </div>
            </section>
          )}

          {/* Details */}
          <section className="rounded-2xl border border-[#e3e8f2] dark:border-slate-700">
            <button type="button" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left cursor-pointer">
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">Details</span>
                <span className="block text-[13px] text-[#6B7894] truncate">{[PRIORITY_LABEL[deal.priority || 'medium'], SOURCES.find((s) => s.value === deal.source)?.label, deal.product_service, deal.expected_close_date && `close by ${shortDate(deal.expected_close_date)}`].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronDown size={18} className={`shrink-0 text-[#6B7894] transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            </button>
            {showDetails && (
              <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-[#eef1f6] dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <Field label="Deal name"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} disabled={!canWrite} className={input} /></Field>
                  <Field label={`Value (${currency})`}><input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} inputMode="decimal" placeholder="85000" disabled={!canWrite} className={input} /></Field>
                  <Field label="Source"><select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} disabled={!canWrite} className={`${selectInput} h-11`}>{SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
                  <Field label="Owner">
                    <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} disabled={!canWrite || !me.canAssign} className={`${selectInput} h-11`}>
                      <option value="">No owner</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                    </select>
                  </Field>
                  <Field label="Expected close"><input type="date" value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} disabled={!canWrite} className={`${input} dark:[color-scheme:dark]`} /></Field>
                  <Field label="Product or service"><input value={form.product_service} onChange={(e) => setForm({ ...form, product_service: e.target.value })} maxLength={120} disabled={!canWrite} className={input} /></Field>
                </div>
                <Field label="Priority" group>
                  <div className="flex gap-1.5">{PRIORITIES.map((p) => <Chip key={p} selected={form.priority === p} disabled={!canWrite} onClick={() => setForm({ ...form, priority: p })}>{PRIORITY_LABEL[p]}</Chip>)}</div>
                </Field>
                <Field label="Description"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} maxLength={2000} disabled={!canWrite} className={`${input} h-auto py-2.5 resize-y`} /></Field>
                {canWrite && <div className="flex justify-end"><button type="button" onClick={saveDetails} disabled={busy === 'save'} className={primaryButton}>{busy === 'save' && <Loader2 size={16} className="animate-spin" />}Save details</button></div>}
              </div>
            )}
          </section>

          {/* AI summary */}
          <section className="rounded-2xl border border-[#e3e8f2] dark:border-slate-700 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-[#0E1B3D] dark:text-white"><Sparkles size={16} className="text-[#1D5BEA]" /> AI summary</h3>
              <button type="button" onClick={summarize} disabled={busy === 'ai'} className={`${secondaryButton} h-9 text-[14px]`}>{busy === 'ai' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{analysis ? 'Refresh' : 'Summarize'}</button>
            </div>
            {analysis ? (
              <div className="mt-2.5 space-y-2 text-[14.5px] text-[#0E1B3D] dark:text-slate-200">
                {analysis.summary && <p>{analysis.summary}</p>}
                {(analysis.lead_rating || analysis.closure_probability) && <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400">{[analysis.lead_rating, analysis.closure_probability && `Chance to close: ${analysis.closure_probability}`].filter(Boolean).join(' · ')}</p>}
                {analysis.suggestions && <div><p className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894] mb-1">Next steps</p><p className="whitespace-pre-line">{analysis.suggestions}</p></div>}
                {analysis.created_at && <p className="text-[12.5px] text-[#8a94a8]">Written {timeAgo(analysis.created_at)}</p>}
              </div>
            ) : <p className="mt-1.5 text-[14px] text-[#6B7894]">Reads the WhatsApp chat and the notes, then says where the deal stands and what to do next.</p>}
          </section>

          {/* History */}
          <section>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894] mb-2">History</h3>
            {history.length === 0 ? <p className="text-[14px] text-[#6B7894]">Nothing yet.</p> : (
              <ol className="space-y-0">
                {history.map((item) => (
                  <li key={item.id} className="relative pl-5 pb-3.5 border-l border-[#e3e8f2] dark:border-slate-700 ml-1.5 last:pb-0">
                    <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${['note', 'call', 'whatsapp', 'meeting', 'email'].includes(item.type) ? 'bg-[#1D5BEA]' : 'bg-[#c0c8d8] dark:bg-slate-600'}`} />
                    <p className="text-[12.5px] text-[#6B7894]"><span className="font-semibold text-[#4a5672] dark:text-slate-300">{ACTIVITY_LABEL[item.type] || item.type}</span> · {item.by} · {timeAgo(item.created_at)}</p>
                    {item.content && <p className="text-[14.5px] text-[#0E1B3D] dark:text-slate-200 whitespace-pre-line [overflow-wrap:anywhere]">{item.content}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
