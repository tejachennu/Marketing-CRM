'use client'

import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Loader2, Search } from 'lucide-react'
import { emptyDraft, type ButtonDraft, type TemplateDraft } from '@/lib/whatsapp-templates/template-model'
import type { LibraryButtonInput, LibraryTemplate } from '@/lib/whatsapp-templates/meta-templates'
import { TemplatePreview } from './template-preview'

const TOPICS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All topics' },
  { value: 'ORDER_MANAGEMENT', label: 'Order management' },
  { value: 'PAYMENTS', label: 'Payments' },
  { value: 'ACCOUNT_UPDATES', label: 'Account updates' },
  { value: 'CUSTOMER_FEEDBACK', label: 'Customer feedback' },
  { value: 'EVENT_REMINDER', label: 'Event reminders' },
  { value: 'IDENTITY_VERIFICATION', label: 'Identity verification' },
]

const field = 'h-9 px-3 text-[14px] rounded-lg bg-white dark:bg-slate-900 border border-[#ced0d4] dark:border-slate-700 text-[#1c2b33] dark:text-white focus:outline-none focus:border-[#0064e0]'
const humanize = (name: string) => name.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())

/** A library template as an editor draft, for the preview. */
function toDraft(template: LibraryTemplate): TemplateDraft {
  const draft = emptyDraft('UTILITY', 'custom')
  draft.name = template.name
  draft.language = template.language
  draft.body = template.body || ''
  if (template.header) { draft.headerFormat = 'TEXT'; draft.headerText = template.header }
  draft.samples = Object.fromEntries((template.body_params || []).map((value, index) => [String(index + 1), value]))
  draft.buttons = (template.buttons || []).flatMap((button): ButtonDraft[] => {
    if (button.type === 'URL') return [{ type: 'URL', text: button.text || 'Visit website', url: button.url || '' }]
    if (button.type === 'PHONE_NUMBER') return [{ type: 'PHONE_NUMBER', text: button.text || 'Call', phone_number: button.phone_number || '' }]
    if (button.type === 'QUICK_REPLY') return [{ type: 'QUICK_REPLY', text: button.text || '' }]
    return []
  })
  return draft
}

export function TemplateLibrary({ orgId, existingNames, onCreated, onCancel }: { orgId: string; existingNames: Set<string>; onCreated: (name: string) => void; onCancel: () => void }) {
  const [search, setSearch] = useState('')
  const [topic, setTopic] = useState('')
  const [templates, setTemplates] = useState<LibraryTemplate[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<LibraryTemplate | null>(null)
  const [name, setName] = useState('')
  const [urlInputs, setUrlInputs] = useState<Record<number, { base: string; example: string }>>({})
  const [phoneInputs, setPhoneInputs] = useState<Record<number, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    const timer = setTimeout(async () => {
      setError('')
      try {
        const params = new URLSearchParams({ organizationId: orgId, ...(search.trim() ? { search: search.trim() } : {}), ...(topic ? { topic } : {}) })
        const res = await fetch(`/api/whatsapp-templates/library?${params}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'The template library could not be loaded.')
        setTemplates(data.templates || [])
      } catch (err: any) {
        setError(err.message)
        setTemplates([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [orgId, search, topic])

  function choose(template: LibraryTemplate) {
    setSelected(template)
    let candidate = template.name
    for (let n = 2; existingNames.has(candidate); n++) candidate = `${template.name}_${n}`
    setName(candidate)
    setUrlInputs({})
    setPhoneInputs({})
    setSubmitError('')
  }

  const preview = useMemo(() => (selected ? toDraft(selected) : null), [selected])

  async function create() {
    if (!selected) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const buttonInputs = (selected.buttons || []).flatMap((button, index): LibraryButtonInput[] => {
        if (button.type === 'URL') return [{ type: 'URL', url: { base_url: urlInputs[index]?.base || '', url_suffix_example: urlInputs[index]?.example || undefined } }]
        if (button.type === 'PHONE_NUMBER') return [{ type: 'PHONE_NUMBER', phone_number: phoneInputs[index] || '' }]
        return []
      })
      const res = await fetch('/api/whatsapp-templates/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, name, language: selected.language, libraryName: selected.name, buttonInputs }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Meta did not create the template.')
      onCreated(name)
    } catch (err: any) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
      <div className="bg-white dark:bg-[#111b21] rounded-xl border border-[#dadde1] dark:border-slate-800">
        <div className="p-3 sm:p-4 border-b border-[#dadde1] dark:border-slate-800 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8d91]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates, e.g. delivery, payment, appointment" className={`${field} w-full pl-9`} />
          </div>
          <select value={topic} onChange={(event) => setTopic(event.target.value)} className={field} aria-label="Topic">
            {TOPICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="m-4 text-[13.5px] text-[#c11231]">{error}</p>}
        {templates === null ? (
          <div className="p-10 flex items-center justify-center gap-2 text-[14px] text-[#65676b]"><Loader2 size={18} className="animate-spin" /> Loading Meta's template library…</div>
        ) : templates.length === 0 && !error ? (
          <p className="p-10 text-center text-[14px] text-[#65676b]">No templates match. Try another word or topic.</p>
        ) : (
          <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((template) => (
              <button key={`${template.name}-${template.language}`} type="button" onClick={() => choose(template)} className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${selected?.name === template.name && selected.language === template.language ? 'border-[#0064e0] bg-[#f5f9ff] dark:bg-blue-950/20' : 'border-[#dadde1] dark:border-slate-700 hover:bg-[#f7f8fa] dark:hover:bg-slate-800/50'}`}>
                <span className="block text-[14px] font-semibold text-[#1c2b33] dark:text-white">{humanize(template.name)}</span>
                {template.topic && <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-[#eceef1] dark:bg-slate-800 text-[11.5px] font-semibold text-[#4b4f56] dark:text-slate-300">{humanize(template.topic.toLowerCase())}</span>}
                <span className="block mt-1.5 text-[12.5px] text-[#65676b] dark:text-slate-400 line-clamp-3">{template.body}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lg:sticky lg:top-4 space-y-3">
        {!selected || !preview ? (
          <div className="rounded-xl border border-dashed border-[#ced0d4] dark:border-slate-700 p-6 text-center text-[13.5px] text-[#65676b] dark:text-slate-400">
            <BadgeCheck size={26} className="mx-auto mb-2 text-[#31a24c]" />
            Templates from Meta's library are pre-approved: you can send them as soon as they're created. Choose one to preview it.
          </div>
        ) : (
          <>
            <p className="text-[15px] font-bold text-[#1c2b33] dark:text-white">Template preview</p>
            <TemplatePreview draft={preview} />
            <div className="bg-white dark:bg-[#111b21] rounded-xl border border-[#dadde1] dark:border-slate-800 p-4 space-y-3">
              <label className="block">
                <span className="block text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200 mb-1">Template name</span>
                <input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))} className={`${field} w-full`} />
                {existingNames.has(name) && <span className="block mt-1 text-[12px] text-[#c11231]">You already have a template with this name.</span>}
              </label>
              {(selected.buttons || []).map((button, index) => button.type === 'URL' ? (
                <div key={index} className="space-y-1.5">
                  <span className="block text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200">“{button.text}” button: your website</span>
                  <input value={urlInputs[index]?.base || ''} onChange={(event) => setUrlInputs({ ...urlInputs, [index]: { base: event.target.value, example: urlInputs[index]?.example || '' } })} placeholder="https://www.example.com/orders/{{1}}" className={`${field} w-full`} />
                  {(urlInputs[index]?.base || '').includes('{{1}}') && (
                    <input value={urlInputs[index]?.example || ''} onChange={(event) => setUrlInputs({ ...urlInputs, [index]: { base: urlInputs[index]?.base || '', example: event.target.value } })} placeholder="Sample: https://www.example.com/orders/12345" className={`${field} w-full`} />
                  )}
                </div>
              ) : button.type === 'PHONE_NUMBER' ? (
                <label key={index} className="block">
                  <span className="block text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200 mb-1">“{button.text}” button: your phone number</span>
                  <input value={phoneInputs[index] || ''} onChange={(event) => setPhoneInputs({ ...phoneInputs, [index]: event.target.value })} placeholder="+91 98765 43210" className={`${field} w-full`} />
                </label>
              ) : null)}
              {submitError && <p role="alert" className="text-[13px] text-[#c11231]">Meta: {submitError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={onCancel} className="flex-1 inline-flex items-center justify-center h-9 px-4 rounded-lg bg-[#e4e6eb] dark:bg-slate-800 text-[#1c2b33] dark:text-slate-100 text-[14px] font-semibold cursor-pointer">Cancel</button>
                <button type="button" onClick={create} disabled={submitting || !name || existingNames.has(name)} className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#0064e0] hover:bg-[#0058c7] text-white text-[14px] font-semibold cursor-pointer disabled:opacity-50">
                  {submitting && <Loader2 size={15} className="animate-spin" />} Create template
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
