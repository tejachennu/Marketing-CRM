'use client'

/**
 * Settings → Knowledge Base → "Questions the AI couldn't answer": what customers asked that the Knowledge
 * Base does not cover, most asked first. "Write answer" lets the AI draft the FAQ from what your team replied
 * in that chat (blanks in [brackets] where it does not know); you check it and add it. Ignore hides it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircleQuestion, Sparkles, X } from 'lucide-react'

interface Gap {
  id: string
  question: string
  asked_count: number
  last_asked_at: string
}

const input = 'w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#d5ddeb] dark:border-[#2a3942] rounded-lg text-[13px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/20'
const blue = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] disabled:opacity-50 text-white text-xs font-bold'
const plain = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-[#d5ddeb] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] hover:bg-[#f4f6fa] text-[#4a5672] dark:text-white text-xs font-bold disabled:opacity-50'

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins || 1} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function KnowledgeGaps({ organizationId, onAdded }: { organizationId: string; onAdded?: () => void }) {
  const [gaps, setGaps] = useState<Gap[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ title: '', content: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge/gaps?organizationId=${organizationId}`)
      const data = await res.json().catch(() => ({}))
      setGaps(Array.isArray(data.gaps) ? data.gaps : [])
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, any>) => {
    const res = await fetch('/api/knowledge/gaps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, ...body }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'That did not work. Try again.')
    return data
  }

  function open(gap: Gap) {
    setOpenId(gap.id)
    setDraft({ title: gap.question, content: '' })
    setNote(null)
  }

  async function write(gap: Gap) {
    setBusy(`draft:${gap.id}`)
    setNote(null)
    try {
      const data = await post({ id: gap.id, action: 'draft' })
      setDraft(data.draft)
      setNote({ ok: true, text: data.fromTeam ? 'Written from what your team replied. Check it before adding.' : 'Fill the blanks in [brackets] before adding.' })
    } catch (err: any) {
      setNote({ ok: false, text: err.message })
    } finally {
      setBusy(null)
    }
  }

  async function add(gap: Gap) {
    if (!draft.title.trim() || !draft.content.trim()) return
    if (/\[[^\]]+\]/.test(draft.content)) { setNote({ ok: false, text: 'Fill the blanks in [brackets] first.' }); return }
    setBusy(`add:${gap.id}`)
    setNote(null)
    try {
      const res = await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, type: 'manual', title: draft.title.trim(), content: draft.content.trim() }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The answer could not be added.')
      await post({ id: gap.id, action: 'answered', faqId: data.article?.id || null }).catch(() => null)
      setGaps((list) => list.filter((g) => g.id !== gap.id))
      setOpenId(null)
      onAdded?.()
    } catch (err: any) {
      setNote({ ok: false, text: err.message })
    } finally {
      setBusy(null)
    }
  }

  async function ignore(gap: Gap) {
    setBusy(`ignore:${gap.id}`)
    try {
      await post({ id: gap.id, action: 'ignore' })
      setGaps((list) => list.filter((g) => g.id !== gap.id))
      if (openId === gap.id) setOpenId(null)
    } catch (err: any) {
      setNote({ ok: false, text: err.message })
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null
  return (
    <section className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-[#202d36] p-5 sm:p-6" aria-labelledby="gaps-title">
      <div className="flex items-start gap-3 mb-3">
        <span className="h-9 w-9 shrink-0 rounded-xl bg-[#eef1f6] dark:bg-[#1f2c34] text-[#1D5BEA] flex items-center justify-center"><MessageCircleQuestion size={17} /></span>
        <div className="min-w-0">
          <h3 id="gaps-title" className="text-sm font-bold text-[#0E1B3D] dark:text-white">
            Questions the AI couldn&apos;t answer {gaps.length > 0 && <span className="ml-1 text-[11px] font-bold text-[#b91c1c] bg-[#fdf0f0] px-2 py-0.5 rounded-full">{gaps.length}</span>}
          </h3>
          <p className="text-[12px] text-[#6B7894] dark:text-[#8696a0] mt-0.5">Customers asked these and your Knowledge Base had no answer, so the chat went to your team. Add an answer and the AI will reply next time.</p>
        </div>
      </div>

      {gaps.length === 0 ? (
        <p className="text-[12px] text-[#8a94a8] py-3">Nothing here. The AI has answered every question so far.</p>
      ) : (
        <ul className="divide-y divide-[#eef1f6] dark:divide-[#202d36]">
          {gaps.map((gap) => (
            <li key={gap.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[13px] font-semibold text-[#0E1B3D] dark:text-white break-words">{gap.question}</p>
                  <p className="text-[11px] text-[#8a94a8] mt-0.5">Asked {gap.asked_count} {gap.asked_count === 1 ? 'time' : 'times'} · last {ago(gap.last_asked_at)}</p>
                </div>
                {openId !== gap.id && (
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className={blue} onClick={() => { open(gap); write(gap) }}><Sparkles size={13} /> Write answer</button>
                    <button type="button" className={plain} disabled={busy === `ignore:${gap.id}`} onClick={() => ignore(gap)}>Ignore</button>
                  </div>
                )}
              </div>
              {openId === gap.id && (
                <div className="mt-3 rounded-xl border border-[#e3e8f2] dark:border-[#2a3942] bg-[#f4f6fa] dark:bg-[#0b141a] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#4a5672]">New FAQ</span>
                    <button type="button" aria-label="Close" className="p-1 text-[#6B7894] hover:text-[#0E1B3D]" onClick={() => setOpenId(null)}><X size={14} /></button>
                  </div>
                  <input aria-label="Question" className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="The question" />
                  <textarea aria-label="Answer" rows={3} className={`${input} resize-y`} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder={busy === `draft:${gap.id}` ? 'The AI is writing…' : 'The answer'} />
                  {note && <p role="status" className={`text-[12px] font-semibold ${note.ok ? 'text-[#4a5672]' : 'text-[#b91c1c]'}`}>{note.text}</p>}
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button type="button" className={plain} disabled={Boolean(busy)} onClick={() => write(gap)}>
                      {busy === `draft:${gap.id}` ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Write again
                    </button>
                    <button type="button" className={blue} disabled={Boolean(busy) || !draft.title.trim() || !draft.content.trim()} onClick={() => add(gap)}>
                      {busy === `add:${gap.id}` && <Loader2 size={13} className="animate-spin" />} Add to Knowledge Base
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
