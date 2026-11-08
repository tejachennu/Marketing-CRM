'use client'

/**
 * Setup → Templates: which WhatsApp template goes out for each automatic message (the built-in
 * one, or any of the business's own: "template 1 for bills, template 2 for reminders") and what
 * fills each blank; writing a new template with AI; and the built-in pack, submitted in one tap.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, FileCheck2, Loader2, Megaphone, RefreshCw, Send, Sparkles, Wand2 } from 'lucide-react'
import { AiTemplateForm, type AiDraftResult } from '@/components/templates/ai-template-writer'
import { FIELD_LABELS, guessFields, MESSAGE_PURPOSES, PURPOSES, type FieldKey, type MessagePurpose, type MessageTemplateChoice, type MessageTemplates } from '@/lib/salon/message-templates'
import { extractVariables, languageLabel, validateDraft, type TemplateDraft } from '@/lib/whatsapp-templates/template-model'
import { api, card, Modal, primaryButton, secondaryButton } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void
interface AccountTemplate { name: string; language: string; status: string; category: string; body: string; blanks: number; urlButton: boolean }
interface Data { connected: boolean; message?: string; templates: any[]; account: AccountTemplate[]; choices: MessageTemplates }

const STATUS: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300'],
  PENDING: ['In review', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  IN_APPEAL: ['In review', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  REJECTED: ['Rejected', 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300'],
  PAUSED: ['Paused', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
  DISABLED: ['Disabled', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
  NOT_SUBMITTED: ['Not submitted', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
  UNKNOWN: ['Not checked', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
}
const Pill = ({ status }: { status: string }) => { const [label, tone] = STATUS[status] || STATUS.PENDING; return <span className={`shrink-0 inline-flex items-center h-6 px-2 rounded-md text-[12px] font-bold ${tone}`}>{label}</span> }
const preview = (body: string, samples: Record<string, string>) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => samples[n] || `{{${n}}}`)
const select = 'w-full h-11 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15 cursor-pointer'
const textField = 'w-full rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'
const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`
const LINK_LABEL: Partial<Record<MessagePurpose, string>> = { bill: 'Opens the bill', feedback: 'Opens the feedback form' }

/** The body with each blank shown as what fills it. */
function Blanks({ body, fields }: { body: string; fields: (FieldKey | undefined)[] }) {
  const parts = body.split(/(\{\{\s*\d+\s*\}\})/g)
  return (
    <p className="rounded-xl bg-[#e8f7f1]/60 dark:bg-emerald-950/20 px-3 py-2.5 text-[13.5px] leading-relaxed text-[#0E1B3D] dark:text-slate-200 [overflow-wrap:anywhere]">
      {parts.map((part, i) => {
        const n = /\{\{\s*(\d+)\s*\}\}/.exec(part)?.[1]
        if (!n) return <span key={i}>{part}</span>
        const field = fields[Number(n) - 1]
        return <span key={i} className={`inline-flex items-center mx-0.5 px-1.5 rounded-md text-[12.5px] font-bold ${field ? 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/50 dark:text-blue-300' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>{field ? FIELD_LABELS[field].replace(/ \(.*\)$/, '') : `{{${n}}} ?`}</span>
      })}
    </p>
  )
}

export function SalonTemplates({ orgId, flash }: { orgId: string; flash: Flash }) {
  const [data, setData] = useState<Data | null>(null)
  const [choices, setChoices] = useState<MessageTemplates>({})
  const [saved, setSaved] = useState('{}')
  const [busy, setBusy] = useState<string | null>(null)
  const [writer, setWriter] = useState<{ purpose: MessagePurpose | null } | null>(null)
  const [review, setReview] = useState<(AiDraftResult & { purpose: MessagePurpose | null }) | null>(null)

  const load = useCallback(async () => {
    try {
      const next: Data = await api(`/api/salon/templates?organizationId=${orgId}`)
      setData(next)
      setChoices(next.choices || {})
      setSaved(JSON.stringify(next.choices || {}))
    } catch (err: any) { flash('error', err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])
  useEffect(() => { load() }, [load])

  const dirty = JSON.stringify(choices) !== saved
  const account = data?.account || []
  const pack = data?.templates || []
  const waiting = pack.filter((t) => t.status === 'NOT_SUBMITTED').length

  async function submitPack(keys?: string[]) {
    setBusy(keys?.[0] || 'all')
    try {
      const result = await api('/api/salon/templates', { method: 'POST', body: JSON.stringify({ organizationId: orgId, keys }) })
      setData((current) => (current ? { ...current, templates: result.templates } : current))
      const failed = Object.entries(result.results || {}).filter(([, r]: any) => !r.ok)
      if (failed.length) flash('error', `${failed.length} not accepted: ${(failed[0][1] as any).error}`)
      else flash('success', 'Sent to Meta for review. It usually takes minutes to a few hours.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function saveChoices(next = choices, message = 'Saved. These templates go out from now on.') {
    setBusy('save')
    try {
      const result = await api('/api/salon/templates', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, choices: next }) })
      setChoices(result.choices)
      setSaved(JSON.stringify(result.choices))
      flash('success', message)
      return true
    } catch (err: any) {
      flash('error', err.message)
      return false
    } finally {
      setBusy(null)
    }
  }

  function choose(purpose: MessagePurpose, value: string) {
    if (!value) { const next = { ...choices }; delete next[purpose]; setChoices(next); return }
    const template = account.find((t) => keyOf(t) === value)
    if (!template) return
    setChoices({ ...choices, [purpose]: { name: template.name, language: template.language, fields: guessFields(purpose, template.blanks), url_field: template.urlButton && PURPOSES[purpose].linkPath ? 'link' : null } })
  }

  return (
    <div className="space-y-4 @xl:space-y-5">
      {/* Which template goes for each message */}
      <section className={card}>
        <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-start @xl:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300 flex items-center justify-center"><FileCheck2 size={21} /></span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Automatic messages</h2>
              <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">After 24 hours without a message from the customer, WhatsApp only delivers approved templates. Pick which one goes for each.</p>
            </div>
          </div>
          <button type="button" onClick={() => load()} aria-label="Check again with Meta" title="Check again" className="h-10 w-10 shrink-0 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><RefreshCw size={17} /></button>
        </div>
        {!data ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#1D5BEA]" /></div> : (
          <>
            {data.message && <p className="mx-4 @xl:mx-5 mt-4 rounded-xl bg-[#fff7e8] dark:bg-amber-950/30 text-[#92400e] dark:text-amber-200 px-4 py-3 text-[14px]">{data.message}</p>}
            <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {MESSAGE_PURPOSES.map((purpose) => {
                const info = PURPOSES[purpose]
                const choice = choices[purpose]
                const builtIn = pack.find((t) => t.key === info.defaultKey)
                const template = choice ? account.find((t) => keyOf(t) === keyOf(choice)) : null
                return (
                  <li key={purpose} className="px-4 @xl:px-5 py-4 space-y-3 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">{info.title}</p>
                        <p className="text-[13px] text-[#6B7894]">{info.use}</p>
                      </div>
                      {data.connected && <button type="button" onClick={() => setWriter({ purpose })} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13.5px] font-semibold text-[#1D5BEA] dark:text-blue-300 hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer"><Sparkles size={15} /> <span className="hidden min-[400px]:inline">Write with AI</span><span className="min-[400px]:hidden">AI</span></button>}
                    </div>
                    <select value={choice ? keyOf(choice) : ''} onChange={(e) => choose(purpose, e.target.value)} aria-label={`Template for ${info.title}`} className={select}>
                      <option value="">Built-in: {builtIn?.name || info.defaultKey} ({(STATUS[builtIn?.status || 'UNKNOWN'] || STATUS.UNKNOWN)[0].toLowerCase()})</option>
                      {account.length > 0 && <optgroup label="Your templates">
                        {account.map((t) => <option key={keyOf(t)} value={keyOf(t)}>{t.name} · {languageLabel(t.language)} · {(STATUS[t.status] || STATUS.PENDING)[0].toLowerCase()}</option>)}
                      </optgroup>}
                      {choice && !template && <option value={keyOf(choice)}>{choice.name} · {languageLabel(choice.language)} (not found on Meta)</option>}
                    </select>
                    {!choice && builtIn && (
                      <div className="space-y-1.5">
                        <p className="rounded-xl bg-[#f8fafc] dark:bg-slate-900/60 px-3 py-2.5 text-[13.5px] text-[#4a5672] dark:text-slate-300 [overflow-wrap:anywhere]">{preview(builtIn.body, builtIn.samples)}</p>
                        {builtIn.status !== 'APPROVED' && builtIn.status !== 'UNKNOWN' && <p className="text-[12.5px] text-[#b45309] dark:text-amber-300 flex items-center gap-1.5"><AlertTriangle size={14} /> Not approved yet. Submit the built-in templates below, or pick one of yours.</p>}
                      </div>
                    )}
                    {choice && (
                      <div className="space-y-2.5">
                        {template ? <Blanks body={template.body} fields={choice.fields} /> : <p className="text-[13px] text-[#b91c1c]">This template is not on your WhatsApp account any more. Pick another; until then the built-in one goes.</p>}
                        {template && template.blanks > 0 && (
                          <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2">
                            {Array.from({ length: template.blanks }, (_, i) => (
                              <label key={i} className="flex items-center gap-2 min-w-0">
                                <span className="shrink-0 w-11 text-[13px] font-bold text-[#6B7894]">{`{{${i + 1}}}`}</span>
                                <select value={choice.fields[i] || ''} onChange={(e) => { const fields = [...choice.fields]; fields[i] = e.target.value as FieldKey; setChoices({ ...choices, [purpose]: { ...choice, fields } }) }} className={select} aria-label={`What fills blank ${i + 1}`}>
                                  <option value="" disabled>Choose what goes here</option>
                                  {info.fields.filter((f) => f !== 'link').map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                                </select>
                              </label>
                            ))}
                          </div>
                        )}
                        {template?.urlButton && (
                          <label className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0 text-[13px] font-bold text-[#6B7894]">Link button</span>
                            <select value={choice.url_field || ''} onChange={(e) => setChoices({ ...choices, [purpose]: { ...choice, url_field: (e.target.value || null) as FieldKey | null } })} className={select} aria-label="Link button">
                              <option value="">Nothing added to the link</option>
                              {info.linkPath && <option value="link">{LINK_LABEL[purpose]} (adds the link code)</option>}
                            </select>
                          </label>
                        )}
                        {template && template.status !== 'APPROVED' && <p className="text-[12.5px] text-[#b45309] dark:text-amber-300 flex items-center gap-1.5"><AlertTriangle size={14} className="shrink-0" /> {template.status === 'REJECTED' ? 'Meta rejected this template.' : 'Not approved yet.'} Until it is, the built-in template goes.</p>}
                        {template && choice.fields.length < template.blanks && <p className="text-[12.5px] text-[#b91c1c]">Choose what fills every blank.</p>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {dirty && (
              <div className="px-4 @xl:px-5 py-3 border-t border-[#eef1f6] dark:border-slate-800 flex flex-col-reverse @xl:flex-row @xl:items-center @xl:justify-end gap-2 bg-[#f8fafc] dark:bg-slate-900/40 rounded-b-2xl">
                <button type="button" onClick={() => setChoices(JSON.parse(saved))} className={secondaryButton}>Undo</button>
                <button type="button" onClick={() => saveChoices()} disabled={busy !== null || MESSAGE_PURPOSES.some((p) => { const c = choices[p]; const t = c && account.find((a) => keyOf(a) === keyOf(c)); return Boolean(t && c!.fields.filter(Boolean).length < t.blanks) })} className={primaryButton}>{busy === 'save' && <Loader2 size={17} className="animate-spin" />} Save choices</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* A new template, written by AI */}
      {data?.connected && (
        <section className={`${card} p-4 @xl:p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#0E1B3D] text-white dark:bg-white dark:text-[#0E1B3D] flex items-center justify-center"><Wand2 size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Write a new template with AI</h2>
              <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Offers, greetings, updates: say what it is for, check the draft, send it to Meta.</p>
            </div>
          </div>
          <AiTemplateForm orgId={orgId} onDraft={(result) => setReview({ ...result, purpose: null })} />
        </section>
      )}

      {/* The built-in pack */}
      <section className={card}>
        <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex flex-col @xl:flex-row @xl:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Built-in templates</h2>
            <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Ready to submit. Used for each message unless you pick your own above.</p>
          </div>
          {data?.connected && waiting > 0 && <button type="button" onClick={() => submitPack()} disabled={busy !== null} className={`${primaryButton} h-10 shrink-0`}>{busy === 'all' ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} Submit all {waiting}</button>}
        </div>
        {!data ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#1D5BEA]" /></div> : (
          <div className="p-4 @xl:p-5 space-y-5">
            {([{ title: 'Sent automatically', hint: 'Bill, booking, reminder, feedback', category: 'UTILITY', icon: FileCheck2 }, { title: 'Marketing', hint: 'Send them from Campaigns', category: 'MARKETING', icon: Megaphone }] as const).map((group) => (
              <div key={group.category}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8] flex items-center gap-1.5 min-w-0"><group.icon size={14} className="shrink-0" /> {group.title} <span className="normal-case tracking-normal font-semibold truncate">· {group.hint}</span></p>
                  {group.category === 'MARKETING' && <Link href="/dashboard/campaigns" className="shrink-0 inline-flex items-center gap-1 text-[13.5px] font-bold text-[#1D5BEA] dark:text-blue-300 hover:underline">Campaigns <ArrowRight size={14} /></Link>}
                </div>
                <ul className="grid grid-cols-1 @2xl:grid-cols-2 gap-3">
                  {pack.filter((t) => t.category === group.category).map((template) => (
                    <li key={template.key} className="min-w-0 rounded-2xl border border-[#e3e8f2] dark:border-slate-800 p-4 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">{template.title}</p>
                          <p className="text-[12.5px] text-[#8a94a8] truncate">{template.name}</p>
                        </div>
                        <Pill status={template.status} />
                      </div>
                      <div className="mt-3 rounded-xl bg-[#e8f7f1]/60 dark:bg-emerald-950/20 px-3 py-2.5 text-[13.5px] text-[#0E1B3D] dark:text-slate-200 flex-1 [overflow-wrap:anywhere]">
                        {preview(template.body, template.samples)}
                        {template.buttons.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{template.buttons.map((b: string) => <span key={b} className="inline-flex items-center h-7 px-2.5 rounded-lg bg-white dark:bg-slate-900 text-[12.5px] font-semibold text-[#1D5BEA] dark:text-blue-300 border border-[#d5ddeb] dark:border-slate-700">{b}</span>)}</div>}
                      </div>
                      {template.status === 'REJECTED' && template.rejectedReason && <p className="mt-2 text-[12.5px] text-[#b91c1c] dark:text-red-300">Meta: {String(template.rejectedReason).replace(/_/g, ' ').toLowerCase()}</p>}
                      {data.connected && template.status === 'NOT_SUBMITTED' && (
                        <button type="button" onClick={() => submitPack([template.key])} disabled={busy !== null} className={`${secondaryButton} h-9 mt-3 self-start text-[14px]`}>{busy === template.key ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />} Submit</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {writer && (
        <Modal size="lg" title={writer.purpose ? `Write the ${PURPOSES[writer.purpose].title.toLowerCase()} template` : 'Write a template with AI'} icon={<Sparkles size={20} />} onClose={() => setWriter(null)}>
          <div className="pb-2"><AiTemplateForm orgId={orgId} purpose={writer.purpose} onDraft={(result) => { setReview({ ...result, purpose: writer.purpose }); setWriter(null) }} /></div>
        </Modal>
      )}
      {review && (
        <ReviewDraft orgId={orgId} result={review} flash={flash} onClose={() => setReview(null)}
          onSubmitted={async (choice) => {
            setReview(null)
            if (review.purpose && choice) await saveChoices({ ...choices, [review.purpose]: choice }, `Sent to Meta for review. ${PURPOSES[review.purpose].title} messages use it once it is approved; until then the built-in template goes.`)
            else flash('success', 'Sent to Meta for review. It usually takes minutes to a few hours.')
            load()
          }} />
      )}
    </div>
  )
}

/** Check and change the AI's draft, then send it to Meta (and use it for the message it was written for). */
function ReviewDraft({ orgId, result, flash, onClose, onSubmitted }: { orgId: string; result: AiDraftResult & { purpose: MessagePurpose | null }; flash: Flash; onClose: () => void; onSubmitted: (choice: MessageTemplateChoice | null) => void }) {
  const [draft, setDraft] = useState<TemplateDraft>(result.draft)
  const [fields, setFields] = useState<FieldKey[]>(result.fields)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const purpose = result.purpose ? PURPOSES[result.purpose] : null
  const variables = useMemo(() => extractVariables(draft.body), [draft.body])
  const problems = useMemo(() => validateDraft(draft), [draft])

  async function submit() {
    setError('')
    if (problems.length) { setError(problems[0].message); return }
    setBusy(true)
    try {
      await api('/api/whatsapp-templates', { method: 'POST', body: JSON.stringify({ organizationId: orgId, draft }) })
      onSubmitted(purpose ? { name: draft.name, language: draft.language, fields: variables.map((_, i) => fields[i] || purpose.defaultFields[i] || purpose.defaultFields[0]), url_field: result.urlField } : null)
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
        <button type="button" onClick={submit} disabled={busy} className={primaryButton}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} {purpose ? `Submit and use for ${purpose.title.toLowerCase()}` : 'Submit to Meta'}</button>
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
            <p className="text-[13px] font-semibold text-[#6B7894]">{purpose ? 'Blanks: what fills each one, and an example for Meta' : 'Examples for each blank (Meta needs them to review)'}</p>
            {variables.map((name, i) => (
              <div key={name} className="grid grid-cols-[44px_minmax(0,1fr)] @xl:grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center">
                <span className="text-[13px] font-bold text-[#6B7894]">{`{{${name}}}`}</span>
                {purpose && (
                  <select value={fields[i] || ''} onChange={(e) => { const next = [...fields]; next[i] = e.target.value as FieldKey; setFields(next) }} className={select} aria-label={`What fills blank ${name}`}>
                    <option value="" disabled>Choose</option>
                    {purpose.fields.filter((f) => f !== 'link').map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                  </select>
                )}
                <input value={draft.samples[name] || ''} onChange={(e) => setDraft({ ...draft, samples: { ...draft.samples, [name]: e.target.value } })} placeholder="Example" aria-label={`Example for blank ${name}`} className={`${textField} h-11 px-3 ${purpose ? 'col-start-2 @xl:col-start-auto' : ''}`} />
              </div>
            ))}
          </div>
        )}
        {draft.footer && <p className="text-[13px] text-[#6B7894]">Footer: {draft.footer}</p>}
        <div>
          <p className="text-[13px] font-semibold text-[#6B7894] mb-1.5">How it looks</p>
          <div className="rounded-2xl bg-[#efeae2] dark:bg-slate-900 p-3">
            <div className="max-w-sm rounded-xl rounded-tl-sm bg-white dark:bg-[#1f2c34] shadow-sm px-3 py-2 text-[14px] text-[#111b21] dark:text-slate-100 [overflow-wrap:anywhere]">
              {draft.headerText && <p className="font-bold mb-1">{draft.headerText}</p>}
              <p className="whitespace-pre-line">{preview(draft.body, draft.samples)}</p>
              {draft.footer && <p className="mt-1 text-[12.5px] text-[#667781]">{draft.footer}</p>}
              {draft.buttons.length > 0 && <div className="mt-2 -mx-3 border-t border-[#e9edef] dark:border-slate-700">{draft.buttons.map((b, i) => <p key={i} className="px-3 py-2 text-center text-[14px] font-semibold text-[#027eb5] border-b last:border-b-0 border-[#e9edef] dark:border-slate-700">{'text' in b ? b.text : 'Copy code'}</p>)}</div>}
            </div>
          </div>
        </div>
        {problems.length > 0 && <ul className="space-y-1">{problems.slice(0, 4).map((p, i) => <li key={i} className="text-[13px] text-[#b91c1c] flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {p.message}</li>)}</ul>}
        {purpose && <p className="text-[12.5px] text-[#8a94a8]">{purpose.title} messages switch to this template once Meta approves it. Until then the built-in one goes.</p>}
      </div>
    </Modal>
  )
}
