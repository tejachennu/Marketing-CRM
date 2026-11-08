'use client'

/**
 * Describe a message in your own words and AI writes the WhatsApp template: name, category,
 * text with blanks and examples, and buttons, following Meta's rules. Used on the Templates page
 * (the draft opens in the editor) and in Front Desk (for one of its automatic messages).
 */

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { api } from '@/components/salon/ui'
import type { DraftProblem, TemplateDraft } from '@/lib/whatsapp-templates/template-model'
import { TEMPLATE_LANGUAGES } from '@/lib/whatsapp-templates/template-model'
import type { FieldKey, MessagePurpose } from '@/lib/salon/message-templates'

export interface AiDraftResult { draft: TemplateDraft; fields: FieldKey[]; urlField: FieldKey | null; problems: DraftProblem[] }

const IDEAS: { label: string; text: string; category: 'MARKETING' | 'UTILITY' }[] = [
  { label: 'Festival offer', text: 'Wish customers a happy festival and tell them about our festive offer. Ask them to reply to book.', category: 'MARKETING' },
  { label: 'New service', text: 'Tell customers about a new service we have started, with its price, and ask them to reply to book a slot.', category: 'MARKETING' },
  { label: 'We miss you', text: 'Customers who have not visited in a while: say we miss them and offer a small discount on their next visit.', category: 'MARKETING' },
  { label: 'Payment due', text: 'Remind the customer politely that a payment is due, with the amount and the due date.', category: 'UTILITY' },
  { label: 'Order ready', text: 'Tell the customer their order or job is ready to collect, with the order number and our timings.', category: 'UTILITY' },
]

const PURPOSE_HINTS: Record<MessagePurpose, string> = {
  bill: 'Thank them for visiting and share the bill: number and amount, with a button to view it.',
  booking: 'Confirm the booking with the day, time and services. Warm and short.',
  reminder: 'Remind them of today\'s appointment time and services, and ask them to reply if they need to change it.',
  feedback: 'Thank them for visiting and ask how it was, with a button to the short feedback form.',
}

const field = 'w-full rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[15px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'

export function AiTemplateForm({ orgId, purpose, onDraft, submitLabel = 'Write it with AI' }: { orgId: string; purpose?: MessagePurpose | null; onDraft: (result: AiDraftResult) => void; submitLabel?: string }) {
  const [description, setDescription] = useState(purpose ? PURPOSE_HINTS[purpose] : '')
  const [language, setLanguage] = useState('en')
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setError('')
    if (description.trim().length < 5) { setError('Describe the message in a few words first.'); return }
    setBusy(true)
    try {
      const result = await api('/api/whatsapp-templates/ai-draft', { method: 'POST', body: JSON.stringify({ organizationId: orgId, description, language, purpose: purpose || undefined, category: purpose ? 'UTILITY' : category }) })
      onDraft({ draft: result.draft, fields: result.fields || [], urlField: result.urlField || null, problems: result.problems || [] })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 min-w-0">
      {!purpose && (
        <div className="flex flex-wrap gap-1.5">
          {IDEAS.map((idea) => (
            <button key={idea.label} type="button" onClick={() => { setDescription(idea.text); setCategory(idea.category) }}
              className="inline-flex items-center h-8 px-3 rounded-full border border-[#d5ddeb] dark:border-slate-700 text-[13px] font-semibold text-[#4a5672] dark:text-slate-300 hover:border-[#9db5ef] hover:text-[#1D5BEA] cursor-pointer">{idea.label}</button>
          ))}
        </div>
      )}
      <label className="block">
        <span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">What should the message say?</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1500}
          placeholder="e.g. Tell customers about our Diwali offer: 20% off all services till 5 Nov. Ask them to reply to book."
          className={`${field} px-3.5 py-2.5`} />
      </label>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <label className="block sm:w-48">
          <span className="block text-[13px] font-semibold text-[#6B7894] mb-1">Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${field} h-11 px-3 cursor-pointer`}>
            {TEMPLATE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        {!purpose && (
          <div role="radiogroup" aria-label="Kind of message" className="inline-flex rounded-xl bg-[#eef1f6] dark:bg-slate-900 p-1 self-start sm:self-auto">
            {(['MARKETING', 'UTILITY'] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)}
                className={`h-9 px-3.5 rounded-lg text-[14px] font-semibold cursor-pointer ${category === c ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#6B7894]'}`}>{c === 'MARKETING' ? 'Marketing' : 'Update (utility)'}</button>
            ))}
          </div>
        )}
        <button type="button" onClick={generate} disabled={busy}
          className="sm:ml-auto inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#0E1B3D] dark:bg-white text-white dark:text-[#0E1B3D] text-[15px] font-bold cursor-pointer disabled:opacity-60">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />} {busy ? 'Writing…' : submitLabel}
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-2.5 text-[14px]">{error}</p>}
      <p className="text-[12.5px] text-[#8a94a8]">Uses AI credit. You can change everything before it goes to Meta for review.</p>
    </div>
  )
}
