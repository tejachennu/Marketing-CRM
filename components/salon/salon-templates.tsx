'use client'

/**
 * Setup → Templates: the WhatsApp template for each automatic message (bill, booking, reminder,
 * feedback). There is no default: each one stays "Not set up" until the business sets it up, from
 * a suggested text, with AI, or by picking one of its own approved templates and saying what fills
 * each blank. Also: write any other template with AI.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, FileText, Loader2, RefreshCw, Send, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { AiTemplateForm, type AiDraftResult } from '@/components/templates/ai-template-writer'
import { FIELD_LABELS, guessFields, MESSAGE_PURPOSES, PURPOSES, type FieldKey, type MessagePurpose, type MessageTemplateChoice, type MessageTemplates } from '@/lib/salon/message-templates'
import { extractVariables, languageLabel, validateDraft, type TemplateDraft } from '@/lib/whatsapp-templates/template-model'
import { api, card, Modal, primaryButton, secondaryButton } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void
interface AccountTemplate { name: string; language: string; status: string; category: string; body: string; blanks: number; urlButton: boolean }
interface Data { connected: boolean; message?: string; account: AccountTemplate[]; choices: MessageTemplates; suggestions: Record<MessagePurpose, AiDraftResult> }

const STATUS_LABEL: Record<string, string> = { APPROVED: 'Approved', PENDING: 'In review', IN_APPEAL: 'In review', REJECTED: 'Rejected', PAUSED: 'Paused', DISABLED: 'Disabled' }
const select = 'w-full h-11 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15 cursor-pointer'
const textField = 'w-full rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'
const smallButton = 'inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[14px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50'
const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`
const preview = (body: string, samples: Record<string, string>) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => samples[n] || `{{${n}}}`)
const LINK_LABEL: Partial<Record<MessagePurpose, string>> = { bill: 'Opens the bill', feedback: 'Opens the feedback form' }

function Status({ status }: { status: string | null }) {
  if (!status) return <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#6B7894]">Not set up</span>
  const label = STATUS_LABEL[status] || 'Set up'
  return <span className={`shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[12px] font-semibold ${status === 'REJECTED' ? 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300' : status === 'APPROVED' ? 'bg-[#0E1B3D] text-white dark:bg-white dark:text-[#0E1B3D]' : 'bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'}`}>{status === 'APPROVED' && <Check size={12} strokeWidth={3} />}{label}</span>
}

/** The body with each blank shown as what fills it. */
function Blanks({ body, fields }: { body: string; fields: (FieldKey | undefined)[] }) {
  const parts = body.split(/(\{\{\s*\d+\s*\}\})/g)
  return (
    <p className="rounded-xl bg-[#f8fafc] dark:bg-slate-900/60 border border-[#eef1f6] dark:border-slate-800 px-3 py-2.5 text-[13.5px] leading-relaxed text-[#0E1B3D] dark:text-slate-200 [overflow-wrap:anywhere]">
      {parts.map((part, i) => {
        const n = /\{\{\s*(\d+)\s*\}\}/.exec(part)?.[1]
        if (!n) return <span key={i}>{part}</span>
        const field = fields[Number(n) - 1]
        return <span key={i} className={`inline-flex items-center mx-0.5 px-1.5 rounded-md text-[12.5px] font-semibold ${field ? 'bg-[#eef1f6] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>{field ? FIELD_LABELS[field].replace(/ \(.*\)$/, '') : `{{${n}}} ?`}</span>
      })}
    </p>
  )
}

export function SalonTemplates({ orgId, flash, onSaved }: { orgId: string; flash: Flash; onSaved?: (choices: MessageTemplates) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [choices, setChoices] = useState<MessageTemplates>({})
  const [saved, setSaved] = useState('{}')
  const [busy, setBusy] = useState<string | null>(null)
  const [picking, setPicking] = useState<MessagePurpose | null>(null)
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
  const setUp = MESSAGE_PURPOSES.filter((p) => choices[p]).length
  const missingBlanks = MESSAGE_PURPOSES.some((p) => { const c = choices[p]; const t = c && account.find((a) => keyOf(a) === keyOf(c)); return Boolean(t && c!.fields.filter(Boolean).length < t.blanks) })

  async function saveChoices(next = choices, message = 'Saved.') {
    setBusy('save')
    try {
      const result = await api('/api/salon/templates', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, choices: next }) })
      setChoices(result.choices)
      setSaved(JSON.stringify(result.choices))
      onSaved?.(result.choices)
      flash('success', message)
      return true
    } catch (err: any) {
      flash('error', err.message)
      return false
    } finally {
      setBusy(null)
    }
  }

  function pick(purpose: MessagePurpose, value: string) {
    const template = account.find((t) => keyOf(t) === value)
    if (!template) return
    setChoices({ ...choices, [purpose]: { name: template.name, language: template.language, fields: guessFields(purpose, template.blanks), url_field: template.urlButton && PURPOSES[purpose].linkPath ? 'link' : null } })
    setPicking(null)
  }

  function remove(purpose: MessagePurpose) {
    const next = { ...choices }
    delete next[purpose]
    setChoices(next)
  }

  return (
    <div className="space-y-4 @xl:space-y-5">
      <section className={card}>
        <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><FileText size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">WhatsApp templates <span className="ml-1 text-[14px] font-semibold text-[#8a94a8]">{setUp} of {MESSAGE_PURPOSES.length} set up</span></h2>
              <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Set up a template for each message. Without one, a message only reaches customers who messaged you in the last 24 hours.</p>
            </div>
          </div>
          <button type="button" onClick={() => load()} aria-label="Check again with Meta" title="Check again" className="h-10 w-10 shrink-0 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><RefreshCw size={17} /></button>
        </div>
        {!data ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#1D5BEA]" /></div> : (
          <>
            {data.message && <p className="mx-4 @xl:mx-5 mt-4 rounded-xl bg-[#f4f6fa] dark:bg-slate-800/60 text-[#4a5672] dark:text-slate-300 px-4 py-3 text-[14px] flex items-start gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {data.message}</p>}
            <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {MESSAGE_PURPOSES.map((purpose) => {
                const info = PURPOSES[purpose]
                const choice = choices[purpose]
                const template = choice ? account.find((t) => keyOf(t) === keyOf(choice)) : null
                return (
                  <li key={purpose} className="px-4 @xl:px-5 py-4 space-y-3 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">{info.title}</p>
                        <p className="text-[13px] text-[#6B7894]">{info.use}</p>
                      </div>
                      <Status status={choice ? template?.status || 'MISSING' : null} />
                    </div>

                    {!choice && picking !== purpose && (
                      <div className="flex flex-wrap gap-2">
                        {data.connected && <button type="button" onClick={() => setReview({ ...data.suggestions[purpose], problems: [], purpose })} className={smallButton}><FileText size={15} /> Use suggested text</button>}
                        {data.connected && <button type="button" onClick={() => setWriter({ purpose })} className={smallButton}><Sparkles size={15} /> Write with AI</button>}
                        {account.length > 0 && <button type="button" onClick={() => setPicking(purpose)} className={smallButton}>Pick my template</button>}
                        {!data.connected && <p className="text-[13px] text-[#6B7894]">Connect WhatsApp (Meta Cloud API) in Settings to set up templates.</p>}
                      </div>
                    )}

                    {picking === purpose && (
                      <div className="flex flex-col @xl:flex-row gap-2">
                        <select defaultValue="" onChange={(e) => pick(purpose, e.target.value)} aria-label={`Template for ${info.title}`} className={select}>
                          <option value="" disabled>Choose one of your templates</option>
                          {account.map((t) => <option key={keyOf(t)} value={keyOf(t)}>{t.name} · {languageLabel(t.language)} · {(STATUS_LABEL[t.status] || t.status).toLowerCase()}</option>)}
                        </select>
                        <button type="button" onClick={() => setPicking(null)} className={secondaryButton}>Cancel</button>
                      </div>
                    )}

                    {choice && (
                      <div className="space-y-2.5">
                        <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300"><span className="font-semibold text-[#0E1B3D] dark:text-white">{choice.name}</span> · {languageLabel(choice.language)}</p>
                        {template ? <Blanks body={template.body} fields={choice.fields} /> : <p className="text-[13px] text-[#6B7894]">{data.message ? 'Meta could not be checked right now.' : 'Not on your WhatsApp account yet (it may still be on its way to Meta), or it was deleted.'}</p>}
                        {template && template.blanks > 0 && (
                          <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2">
                            {Array.from({ length: template.blanks }, (_, i) => (
                              <label key={i} className="flex items-center gap-2 min-w-0">
                                <span className="shrink-0 w-11 text-[13px] font-semibold text-[#6B7894]">{`{{${i + 1}}}`}</span>
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
                            <span className="shrink-0 text-[13px] font-semibold text-[#6B7894]">Link button</span>
                            <select value={choice.url_field || ''} onChange={(e) => setChoices({ ...choices, [purpose]: { ...choice, url_field: (e.target.value || null) as FieldKey | null } })} className={select} aria-label="Link button">
                              <option value="">Nothing added to the link</option>
                              {info.linkPath && <option value="link">{LINK_LABEL[purpose]} (adds the link code)</option>}
                            </select>
                          </label>
                        )}
                        {template && template.status !== 'APPROVED' && <p className="text-[12.5px] text-[#4a5672] dark:text-slate-300 flex items-center gap-1.5"><AlertTriangle size={14} className="shrink-0" /> {template.status === 'REJECTED' ? 'Meta rejected this template. Set up another one.' : 'Waiting for Meta to approve it. Until then this message only reaches customers who wrote in the last 24 hours.'}</p>}
                        {template && choice.fields.filter(Boolean).length < template.blanks && <p className="text-[12.5px] text-[#b91c1c]">Choose what fills every blank.</p>}
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {account.length > 0 && <button type="button" onClick={() => { remove(purpose); setPicking(purpose) }} className={smallButton}>Change</button>}
                          <button type="button" onClick={() => remove(purpose)} className={smallButton}><Trash2 size={15} /> Remove</button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {dirty && (
              <div className="px-4 @xl:px-5 py-3 border-t border-[#eef1f6] dark:border-slate-800 flex flex-col-reverse @xl:flex-row @xl:items-center @xl:justify-end gap-2 bg-[#f8fafc] dark:bg-slate-900/40 rounded-b-2xl">
                <button type="button" onClick={() => { setChoices(JSON.parse(saved)); setPicking(null) }} className={secondaryButton}>Undo</button>
                <button type="button" onClick={() => saveChoices()} disabled={busy !== null || missingBlanks} className={primaryButton}>{busy === 'save' && <Loader2 size={17} className="animate-spin" />} Save</button>
              </div>
            )}
          </>
        )}
      </section>

      {data?.connected && (
        <section className={`${card} p-4 @xl:p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><Wand2 size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Write another template with AI</h2>
              <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">Offers, greetings, updates for Campaigns: say what it is for, check the draft, send it to Meta.</p>
            </div>
          </div>
          <AiTemplateForm orgId={orgId} onDraft={(result) => setReview({ ...result, purpose: null })} />
        </section>
      )}

      {writer && (
        <Modal size="lg" title={writer.purpose ? `Write the ${PURPOSES[writer.purpose].title.toLowerCase()} template` : 'Write a template with AI'} icon={<Sparkles size={20} />} onClose={() => setWriter(null)}>
          <div className="pb-2"><AiTemplateForm orgId={orgId} purpose={writer.purpose} onDraft={(result) => { setReview({ ...result, purpose: writer.purpose }); setWriter(null) }} /></div>
        </Modal>
      )}
      {review && (
        <ReviewDraft orgId={orgId} result={review} onClose={() => setReview(null)}
          onSubmitted={async (choice) => {
            setReview(null)
            if (review.purpose && choice) await saveChoices({ ...choices, [review.purpose]: choice }, `Sent to Meta for review. ${PURPOSES[review.purpose].title} messages use it once it is approved.`)
            else flash('success', 'Sent to Meta for review. It usually takes minutes to a few hours.')
            load()
          }} />
      )}
    </div>
  )
}

/** Check and change a draft (written by AI, or a suggested text), then send it to Meta and, for a message, set it up. */
function ReviewDraft({ orgId, result, onClose, onSubmitted }: { orgId: string; result: AiDraftResult & { purpose: MessagePurpose | null }; onClose: () => void; onSubmitted: (choice: MessageTemplateChoice | null) => void }) {
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
      onSubmitted(purpose ? { name: draft.name, language: draft.language, fields: variables.map((_, i) => fields[i] || purpose.usualFields[i] || purpose.usualFields[0]), url_field: result.urlField } : null)
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
        <button type="button" onClick={submit} disabled={busy} className={primaryButton}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} {purpose ? `Submit and set up for ${purpose.title.toLowerCase()}` : 'Submit to Meta'}</button>
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
          <div className="rounded-2xl bg-[#f4f6fa] dark:bg-slate-900 p-3">
            <div className="max-w-sm rounded-xl rounded-tl-sm bg-white dark:bg-slate-800 shadow-sm px-3 py-2 text-[14px] text-[#111b21] dark:text-slate-100 [overflow-wrap:anywhere]">
              {draft.headerText && <p className="font-bold mb-1">{draft.headerText}</p>}
              <p className="whitespace-pre-line">{preview(draft.body, draft.samples)}</p>
              {draft.footer && <p className="mt-1 text-[12.5px] text-[#6B7894]">{draft.footer}</p>}
              {draft.buttons.length > 0 && <div className="mt-2 -mx-3 border-t border-[#eef1f6] dark:border-slate-700">{draft.buttons.map((b, i) => <p key={i} className="px-3 py-2 text-center text-[14px] font-semibold text-[#1D5BEA] border-b last:border-b-0 border-[#eef1f6] dark:border-slate-700">{'text' in b ? b.text : 'Copy code'}</p>)}</div>}
            </div>
          </div>
        </div>
        {problems.length > 0 && <ul className="space-y-1">{problems.slice(0, 4).map((p, i) => <li key={i} className="text-[13px] text-[#b91c1c] flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {p.message}</li>)}</ul>}
        {purpose && <p className="text-[12.5px] text-[#8a94a8]">{purpose.title} messages use this template once Meta approves it, usually within minutes.</p>}
      </div>
    </Modal>
  )
}
