'use client'

/**
 * Setup → Templates: the WhatsApp template for each automatic message (bill, booking, reminder, feedback). Each one
 * has a suggested wording the business sends to Meta for approval as it is or after editing it, then sees where it
 * stands (In review, Approved, Rejected with the reason) and can edit and send it again. There is no default: a
 * message uses a template only after the business sent it and Meta approved it. Also: write any other template
 * with AI (for Campaigns).
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Send, Sparkles, Wand2 } from 'lucide-react'
import { AiTemplateForm, type AiDraftResult } from '@/components/templates/ai-template-writer'
import { AutoMessageTemplates } from '@/components/templates/auto-message-templates'
import type { MessageTemplates } from '@/lib/salon/message-templates'
import { extractVariables, languageLabel, validateDraft, type TemplateDraft } from '@/lib/whatsapp-templates/template-model'
import { api, card, Modal, primaryButton, secondaryButton } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void
const textField = 'w-full rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/15'
const preview = (body: string, samples: Record<string, string>) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => samples[n] || `{{${n}}}`)

export function SalonTemplates({ orgId, flash, onSaved }: { orgId: string; flash: Flash; onSaved?: (choices: MessageTemplates) => void }) {
  const [connected, setConnected] = useState(false)
  const [review, setReview] = useState<AiDraftResult | null>(null)

  return (
    <div className="space-y-4 @xl:space-y-5">
      <AutoMessageTemplates orgId={orgId} kind="desk" flash={flash}
        heading="WhatsApp templates"
        intro="WhatsApp needs an approved template for customers who have not written to you in the last 24 hours. Send the suggested wording for approval, or change it first."
        onChanged={(data) => { setConnected(Boolean(data.connected && data.ownWhatsApp !== false)); if (data.choices) onSaved?.(data.choices as MessageTemplates) }} />

      {connected && (
        <section className={`${card} p-4 @xl:p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><Wand2 size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Write another template with AI</h2>
              <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Offers, greetings, updates for Campaigns: say what it is for, check the draft, send it to Meta.</p>
            </div>
          </div>
          <AiTemplateForm orgId={orgId} onDraft={(result) => setReview(result)} />
        </section>
      )}

      {review && (
        <ReviewDraft orgId={orgId} result={review} onClose={() => setReview(null)}
          onSubmitted={() => { setReview(null); flash('success', 'Sent to Meta for review. It usually takes minutes to a few hours.') }} />
      )}
    </div>
  )
}

/** Check and change a template written by AI, then send it to Meta (it shows on the Templates page for Campaigns). */
function ReviewDraft({ orgId, result, onClose, onSubmitted }: { orgId: string; result: AiDraftResult; onClose: () => void; onSubmitted: () => void }) {
  const [draft, setDraft] = useState<TemplateDraft>(result.draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const variables = useMemo(() => extractVariables(draft.body), [draft.body])
  const problems = useMemo(() => validateDraft(draft), [draft])

  async function submit() {
    setError('')
    if (problems.length) { setError(problems[0].message); return }
    setBusy(true)
    try {
      await api('/api/whatsapp-templates', { method: 'POST', body: JSON.stringify({ organizationId: orgId, draft }) })
      onSubmitted()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal size="lg" title="Check the template" subtitle={`${draft.category === 'UTILITY' ? 'Update (utility)' : 'Marketing'} · ${languageLabel(draft.language)}`} icon={<Sparkles size={20} />} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} className={primaryButton}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} Submit to Meta</button>
      </>}>
      <div className="space-y-4 min-w-0">
        {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-2.5 text-[14px]">{error}</p>}
        <label className="block">
          <span className="block text-[13px] font-semibold text-[#6B7894] mb-1">Name on WhatsApp</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 512) })} className={`${textField} h-11 px-3`} />
        </label>
        {draft.headerFormat === 'TEXT' && (
          <label className="block">
            <span className="block text-[13px] font-semibold text-[#6B7894] mb-1">Title</span>
            <input value={draft.headerText} maxLength={60} onChange={(e) => setDraft({ ...draft, headerText: e.target.value })} className={`${textField} h-11 px-3`} />
          </label>
        )}
        <label className="block">
          <span className="block text-[13px] font-semibold text-[#6B7894] mb-1">Message</span>
          <textarea value={draft.body} rows={5} maxLength={1024} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${textField} px-3 py-2.5`} />
        </label>
        {variables.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] font-semibold text-[#6B7894]">Examples for each blank (Meta needs them to review)</p>
            {variables.map((name) => (
              <div key={name} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 items-center">
                <span className="text-[13px] font-bold text-[#6B7894]">{`{{${name}}}`}</span>
                <input value={draft.samples[name] || ''} onChange={(e) => setDraft({ ...draft, samples: { ...draft.samples, [name]: e.target.value } })} placeholder="Example" aria-label={`Example for blank ${name}`} className={`${textField} h-11 px-3`} />
              </div>
            ))}
          </div>
        )}
        {draft.footer && <p className="text-[13px] text-[#6B7894]">Footer: {draft.footer}</p>}
        <div>
          <p className="text-[13px] font-semibold text-[#6B7894] mb-1.5">How it looks</p>
          <div className="rounded-2xl bg-[#f4f6fa] dark:bg-slate-900 p-3">
            <div className="max-w-sm rounded-xl rounded-tl-sm bg-white dark:bg-slate-800 shadow-sm px-3 py-2 text-[14px] text-[#111b21] dark:text-slate-100 [overflow-wrap:anywhere]">
              {draft.headerText && <p className="font-bold mb-1">{draft.headerText}</p>}
              <p className="whitespace-pre-line">{preview(draft.body, draft.samples)}</p>
              {draft.footer && <p className="mt-1 text-[12.5px] text-[#6B7894]">{draft.footer}</p>}
              {draft.buttons.length > 0 && <div className="mt-2 -mx-3 border-t border-[#eef1f6] dark:border-slate-700">{draft.buttons.map((b, i) => <p key={i} className="px-3 py-2 text-center text-[14px] font-semibold text-[#008069] border-b last:border-b-0 border-[#eef1f6] dark:border-slate-700">{'text' in b ? b.text : 'Copy code'}</p>)}</div>}
            </div>
          </div>
        </div>
        {problems.length > 0 && <ul className="space-y-1">{problems.slice(0, 4).map((p, i) => <li key={i} className="text-[13px] text-[#b91c1c] flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {p.message}</li>)}</ul>}
      </div>
    </Modal>
  )
}
