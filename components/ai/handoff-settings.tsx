'use client'

/**
 * Settings → Chat and tickets → "When the AI hands a chat to your team": like a business AI on WhatsApp,
 * the AI stops in a chat it hands over, and comes back when the ticket is resolved. Own load and save.
 */

import { useEffect, useState } from 'react'
import { Loader2, UserRound } from 'lucide-react'
import { DEFAULT_HANDOFF, DEFAULT_HANDOFF_TEXT, type HandoffSettings } from '@/lib/ai/knowledge-rules'
import { DEFAULT_STYLE, PERSON_BUTTON, TONE_LABELS, type ReplyStyle, type Tone } from '@/lib/ai/reply-format'

const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-[#202d36] p-5 sm:p-6'
const input = 'w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#d5ddeb] dark:border-[#2a3942] rounded-lg text-[13px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/20'

function Switch({ on, onChange, label, help }: { on: boolean; onChange: (v: boolean) => void; label: string; help: string }) {
  return (
    <label className="flex items-start justify-between gap-4 py-3 border-t border-[#eef1f6] dark:border-[#202d36] first:border-t-0 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[#0E1B3D] dark:text-white">{label}</span>
        <span className="block text-[12px] text-[#6B7894] dark:text-[#8696a0] mt-0.5">{help}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-[#1D5BEA]' : 'bg-[#d5ddeb] dark:bg-[#2a3942]'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

export function HandoffSettingsCard({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const [settings, setSettings] = useState<HandoffSettings>(DEFAULT_HANDOFF)
  const [style, setStyle] = useState<ReplyStyle>(DEFAULT_STYLE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/ai/handoff?organizationId=${organizationId}`)
      .then((r) => r.json())
      .then((d) => { if (live && d?.settings) setSettings(d.settings); if (live && d?.style) setStyle(d.style) })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [organizationId])

  const set = (patch: Partial<HandoffSettings>) => { setSettings((s) => ({ ...s, ...patch })); setNote(null) }
  const setLook = (patch: Partial<ReplyStyle>) => { setStyle((s) => ({ ...s, ...patch })); setNote(null) }

  async function save() {
    setSaving(true)
    setNote(null)
    try {
      const res = await fetch('/api/ai/handoff', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, settings, style }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Not saved. Try again.')
      setSettings(data.settings)
      if (data.style) setStyle(data.style)
      setNote({ ok: true, text: 'Saved.' })
    } catch (err: any) {
      setNote({ ok: false, text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={card} aria-labelledby="handoff-title">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-9 w-9 shrink-0 rounded-xl bg-[#eef1f6] dark:bg-[#1f2c34] text-[#1D5BEA] flex items-center justify-center"><UserRound size={17} /></span>
          <div className="min-w-0">
            <h3 id="handoff-title" className="text-sm font-bold text-[#0E1B3D] dark:text-white">How the AI replies, and when it hands a chat to your team</h3>
            <p className="text-[12px] text-[#6B7894] dark:text-[#8696a0] mt-0.5">
              The AI answers only from your Knowledge Base. When a customer asks for a person, complains, or asks something it does not know, it does not guess: it tells them your team will reply, and makes a ticket.
            </p>
          </div>
        </div>
        {canEdit && (
          <button type="button" onClick={save} disabled={saving || loading} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] disabled:opacity-50 text-white text-xs font-bold">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-6 flex justify-center"><Loader2 size={18} className="animate-spin text-[#8a94a8]" /></div>
      ) : (
        <fieldset disabled={!canEdit} className="disabled:opacity-70">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#4a5672] dark:text-[#8696a0] pt-1">How it talks</p>
          <div role="radiogroup" aria-label="Tone" className="flex flex-wrap gap-2 py-3">
            {(Object.keys(TONE_LABELS) as Tone[]).map((tone) => (
              <button key={tone} type="button" role="radio" aria-checked={style.tone === tone} onClick={() => setLook({ tone })}
                className={`h-8 px-3 rounded-full text-[12px] font-bold border transition-colors ${style.tone === tone ? 'bg-[#0E1B3D] border-[#0E1B3D] text-white' : 'bg-white dark:bg-[#1f2c34] border-[#d5ddeb] dark:border-[#2a3942] text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa]'}`}>
                {TONE_LABELS[tone]}
              </button>
            ))}
          </div>
          <Switch on={style.buttons} onChange={(v) => setLook({ buttons: v })} label="Quick buttons under answers" help={`Up to two next questions and "${PERSON_BUTTON}". Buttons on WhatsApp, chips on Instagram. A single link shows as a button.`} />
          <Switch on={style.typing} onChange={(v) => setLook({ typing: v })} label='Show "typing…" while the AI writes' help="The customer sees it is being answered, like a person typing." />
          <Switch on={style.emoji} onChange={(v) => setLook({ emoji: v })} label="A smiley now and then" help="At most one, only where it feels natural." />
          <ReplyPreview style={style} />
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#4a5672] dark:text-[#8696a0] pt-4 border-t border-[#eef1f6] dark:border-[#202d36]">When it hands over</p>
          <Switch on={settings.pauseAi} onChange={(v) => set({ pauseAi: v })} label="Stop the AI in that chat" help="Your team takes over. The AI does not reply in that chat until you turn it back on or resolve the ticket." />
          <Switch on={settings.resumeOnResolve} onChange={(v) => set({ resumeOnResolve: v })} label="Turn the AI back on when the ticket is resolved" help="So the next question from this customer is answered again." />
          <Switch on={settings.keepAiWhenUnsure} onChange={(v) => set({ keepAiWhenUnsure: v })} label="Keep the AI on when it only did not know an answer" help="A ticket is still made, but the AI keeps answering the customer's other questions. People who ask for a person or complain always go to the team." />
          <div className="pt-3 border-t border-[#eef1f6] dark:border-[#202d36]">
            <label htmlFor="handoff-message" className="block text-[12px] font-semibold text-[#4a5672] dark:text-[#8696a0] mb-1.5">Message the customer gets (optional)</label>
            <textarea id="handoff-message" rows={2} maxLength={300} value={settings.message} onChange={(e) => set({ message: e.target.value })} placeholder={DEFAULT_HANDOFF_TEXT} className={`${input} resize-y`} />
            <p className="text-[11px] text-[#8a94a8] mt-1">Leave empty and the AI writes it in the customer&apos;s own language (English, Telugu, Hindi…).</p>
          </div>
        </fieldset>
      )}
      {note && <p role="status" className={`mt-3 text-[12px] font-semibold ${note.ok ? 'text-[#1D5BEA]' : 'text-[#b91c1c]'}`}>{note.text}</p>}
    </section>
  )
}

/** How an answer looks on each channel with these settings. */
function ReplyPreview({ style }: { style: ReplyStyle }) {
  const words = style.tone === 'short' ? 'Hair cut is ₹300.' : style.tone === 'professional' ? 'A hair cut costs ₹300. We are open from 10 am to 9 pm.' : `A hair cut is just ₹300${style.emoji ? ' 😊' : ''}. We are open 10 am to 9 pm, all days.`
  const buttons = style.buttons ? ['Sunday timings', PERSON_BUTTON] : []
  return (
    <div className="grid gap-3 sm:grid-cols-2 pb-3">
      <div className="rounded-xl bg-[#f4f6fa] dark:bg-[#0b141a] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B7894] mb-2">WhatsApp</p>
        <div className="max-w-[260px] rounded-lg bg-white dark:bg-[#1f2c34] shadow-sm overflow-hidden">
          <p className="px-3 py-2 text-[12px] text-[#0E1B3D] dark:text-white">{style.tone === 'short' ? <>Hair cut is <b>₹300</b>.</> : words}</p>
          {buttons.map((b) => <p key={b} className="border-t border-[#eef1f6] dark:border-[#2a3942] py-1.5 text-center text-[12px] font-semibold text-[#1D5BEA]">{b}</p>)}
        </div>
      </div>
      <div className="rounded-xl bg-[#f4f6fa] dark:bg-[#0b141a] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B7894] mb-2">Instagram</p>
        <p className="max-w-[260px] rounded-2xl bg-white dark:bg-[#1f2c34] shadow-sm px-3 py-2 text-[12px] text-[#0E1B3D] dark:text-white">{words}</p>
        {buttons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">{buttons.map((b) => <span key={b} className="rounded-full border border-[#d5ddeb] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] px-2.5 py-1 text-[11px] font-semibold text-[#0E1B3D] dark:text-white">{b}</span>)}</div>
        )}
      </div>
    </div>
  )
}
