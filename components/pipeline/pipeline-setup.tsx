'use client'

/** The stages a deal moves through: rename, reorder, add and remove them (managers and admins). */

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { api, card, input, primaryButton, secondaryButton } from '../salon/ui'
import { selectInput, type Stage } from './shared'

export function PipelineSetup({ orgId, onStagesChange, flash }: { orgId: string; onStagesChange: (stages: Stage[]) => void; flash: (tone: 'success' | 'error', text: string) => void }) {
  const [stages, setStages] = useState<Stage[] | null>(null)
  const [draft, setDraft] = useState<Stage[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState('')
  const [removing, setRemoving] = useState<Stage | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [error, setError] = useState('')

  const apply = (list: Stage[]) => { setStages(list); setDraft(list); onStagesChange(list) }

  useEffect(() => {
    api(`/api/pipeline/stages?organizationId=${orgId}`).then((result) => { setStages(result.stages); setDraft(result.stages) }).catch((err) => setError(err.message))
  }, [orgId])

  const changed = stages && JSON.stringify(draft.map((s) => [s.id, s.name.trim()])) !== JSON.stringify(stages.map((s) => [s.id, s.name]))

  const move = (index: number, by: number) => {
    const next = [...draft]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    setDraft(next)
  }

  const save = async () => {
    setBusy('save')
    try {
      const result = await api('/api/pipeline/stages', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, stages: draft.map((s) => ({ id: s.id, name: s.name })) }) })
      apply(result.stages)
      flash('success', 'Stages saved.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  const add = async () => {
    if (!newName.trim()) return
    setBusy('add')
    try {
      const result = await api('/api/pipeline/stages', { method: 'POST', body: JSON.stringify({ organizationId: orgId, name: newName }) })
      apply(result.stages); setNewName('')
      flash('success', 'Stage added.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy('remove')
    try {
      const params = new URLSearchParams({ organizationId: orgId, id: removing.id })
      if (moveTo) params.set('moveTo', moveTo)
      const result = await api(`/api/pipeline/stages?${params}`, { method: 'DELETE' })
      apply(result.stages); setRemoving(null)
      flash('success', 'Stage removed.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  if (error) return <div className={`${card} p-5 text-[15px] text-[#b91c1c]`}>{error}</div>
  if (!stages) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>

  return (
    <div className="grid grid-cols-1 @4xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <section className={`${card} p-4 @xl:p-5`}>
        <h2 className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">Stages</h2>
        <p className="text-[14px] text-[#4a5672] dark:text-slate-400 mb-4">The steps a deal goes through, in order. Won and lost are not stages: close a deal from its card.</p>
        <ol className="space-y-2">
          {draft.map((stage, i) => (
            <li key={stage.id} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-center text-[13px] font-bold text-[#8a94a8] tabular-nums">{i + 1}</span>
              <input value={stage.name} maxLength={40} aria-label={`Stage ${i + 1} name`} onChange={(e) => setDraft(draft.map((s) => (s.id === stage.id ? { ...s, name: e.target.value } : s)))} className={`${input} flex-1 min-w-0`} />
              <span className="hidden min-[420px]:inline w-[72px] shrink-0 text-[12.5px] text-[#6B7894] text-right">{stage.open || 0} open</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${stage.name} up`} className="h-10 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><ArrowUp size={16} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label={`Move ${stage.name} down`} className="h-10 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><ArrowDown size={16} /></button>
              <button type="button" onClick={() => { setRemoving(stage); setMoveTo(draft.find((s) => s.id !== stage.id)?.id || '') }} disabled={draft.length <= 1 || !!changed} aria-label={`Remove ${stage.name}`} title={changed ? 'Save your changes first' : undefined}
                className="h-10 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#6B7894] hover:text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 disabled:opacity-30 cursor-pointer"><Trash2 size={16} /></button>
            </li>
          ))}
        </ol>
        {removing && (
          <div className="mt-4 rounded-2xl border border-[#f3c7c7] dark:border-red-900 bg-[#fdf0f0] dark:bg-red-950/20 p-3.5 space-y-3">
            <p className="text-[14.5px] text-[#0E1B3D] dark:text-white"><span className="font-bold">Remove &ldquo;{removing.name}&rdquo;?</span> {removing.open ? `Its ${removing.open} open deal${removing.open === 1 ? '' : 's'} move to:` : 'Any deals in it move to:'}</p>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move its deals to" className={`${selectInput} h-11 bg-white`}>
              {draft.filter((s) => s.id !== removing.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} className={secondaryButton}>Keep it</button>
              <button type="button" onClick={remove} disabled={busy === 'remove'} className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-[#b91c1c] hover:bg-[#991b1b] text-white text-[15px] font-bold cursor-pointer disabled:opacity-50">{busy === 'remove' && <Loader2 size={16} className="animate-spin" />}Remove stage</button>
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-col @xl:flex-row gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} maxLength={40} placeholder='New stage, like "Site visit"' aria-label="New stage name" className={`${input} flex-1 min-w-0`} />
          <button type="button" onClick={add} disabled={!newName.trim() || busy === 'add' || draft.length >= 12} className={secondaryButton}>{busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add stage</button>
        </div>
        {changed && (
          <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-[#eef1f6] dark:border-slate-800">
            <button type="button" onClick={() => setDraft(stages)} className={secondaryButton}>Undo changes</button>
            <button type="button" onClick={save} disabled={busy === 'save'} className={primaryButton}>{busy === 'save' && <Loader2 size={16} className="animate-spin" />}Save stages</button>
          </div>
        )}
      </section>
      <aside className={`${card} p-4 @xl:p-5 space-y-2 text-[14px] text-[#4a5672] dark:text-slate-400`}>
        <h3 className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">Good to know</h3>
        <p>Keep it to the steps your team really uses: 4 to 6 works for most businesses.</p>
        <p>Deals from the API and from WhatsApp start in the first stage.</p>
        <p>Admins can switch the Sales Pipeline off in <a href="/dashboard/connectors" className="font-semibold text-[#1D5BEA]">Connectors</a>. Deals are kept.</p>
      </aside>
    </div>
  )
}
