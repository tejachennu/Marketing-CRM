'use client'

/**
 * The WhatsApp templates for the messages a connector sends by itself (Front Desk: bill, booking, reminder,
 * feedback; E-commerce: cart reminder, Cash on Delivery check, review ask, back in stock, refunds, order updates).
 * Each message comes with a suggested wording: the business sends it to Meta for approval as it is, or edits it
 * first; then it sees where it stands (In review, Approved, Rejected with Meta's reason) and can edit and send it
 * again. Once Meta approves it, that message uses it by itself. Rules in lib/whatsapp-templates/auto-messages.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileText, Loader2, Lock, Pencil, RefreshCw, Send, Sparkles } from 'lucide-react'
import { api, card, Modal, primaryButton, secondaryButton, Toggle } from '@/components/salon/ui'
import { FRONT_DESK_MESSAGES } from '@/lib/salon/templates'
import { SHOP_MESSAGE_DEFS } from '@/lib/commerce/shop-messages'
import { autoDraft, AUTO_LANGUAGES, fieldForToken, toEditorText, type AutoField, type AutoMessageDef, type AutoMessageView } from '@/lib/whatsapp-templates/auto-messages'

type Flash = (tone: 'success' | 'error', text: string) => void
type Kind = 'desk' | 'shop'

interface AccountTemplate { name: string; language: string; status: string; body: string; blanks: number; urlButton: boolean; quickReplies?: number }
export interface AutoTemplatesData {
  connected: boolean
  ownWhatsApp?: boolean
  message?: string
  account: AccountTemplate[]
  autoMessages: AutoMessageView[]
  /** Front Desk: the choice for each message; E-commerce: each message's settings */
  choices?: Record<string, any>
  messages?: Record<string, any>
}

const PATHS: Record<Kind, string> = { desk: '/api/salon/templates', shop: '/api/commerce/shop-messages' }
const smallButton = 'inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[14px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50'
const smallPrimary = 'inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[14px] font-bold cursor-pointer disabled:opacity-50'
const linkButton = 'text-[13px] font-semibold text-[#1D5BEA] hover:underline cursor-pointer disabled:opacity-50'
const field = 'w-full rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'

const defFor = (kind: Kind, view: AutoMessageView): AutoMessageDef => ({ ...(kind === 'desk' ? (FRONT_DESK_MESSAGES as Record<string, AutoMessageDef>) : (SHOP_MESSAGE_DEFS as Record<string, AutoMessageDef>))[view.purpose], fields: view.fields })

function StatusChip({ view }: { view: AutoMessageView }) {
  const base = 'shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[12px] font-semibold whitespace-nowrap'
  const c = view.current
  if (!c) return <span className={`${base} bg-[#f4f6fa] dark:bg-slate-800 text-[#6B7894]`}>Not set up</span>
  if (c.state === 'approved') return <span className={`${base} bg-[#0E1B3D] text-white dark:bg-white dark:text-[#0E1B3D]`}><Check size={12} strokeWidth={3} /> Approved</span>
  if (c.state === 'rejected' || c.state === 'missing') return <span className={`${base} bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300`}>{c.label}</span>
  if (c.state === 'review') return <span className={`${base} bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300`}>In review</span>
  return <span className={`${base} bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300`}>{c.label}</span>
}

/** The message as the customer sees it on WhatsApp, with each blank filled with its example (shown in bold). */
function Bubble({ text, fields, buttons }: { text: string; fields: AutoField[]; buttons: string[] }) {
  const parts = text.split(/(\{[^{}\n]{1,60}\})/g)
  return (
    <div className="rounded-2xl bg-[#f4f6fa] dark:bg-slate-900 p-3">
      <div className="max-w-md rounded-xl rounded-tl-sm bg-white dark:bg-slate-800 shadow-sm px-3 py-2 text-[14px] leading-relaxed text-[#111b21] dark:text-slate-100 [overflow-wrap:anywhere]">
        <p className="whitespace-pre-line">
          {parts.map((part, i) => {
            const token = /^\{(.+)\}$/.exec(part)?.[1]
            const f = token ? fieldForToken(token, fields) : null
            if (!token) return <span key={i}>{part}</span>
            return f ? <strong key={i} className="font-semibold">{f.sample}</strong> : <span key={i} className="text-[#b91c1c]">{part}</span>
          })}
        </p>
        {buttons.length > 0 && (
          <div className="mt-2 -mx-3 border-t border-[#eef1f6] dark:border-slate-700">
            {buttons.map((b, i) => <p key={i} className="px-3 py-2 text-center text-[14px] font-semibold text-[#1D5BEA] border-b last:border-b-0 border-[#eef1f6] dark:border-slate-700">{b || 'Button'}</p>)}
          </div>
        )}
      </div>
    </div>
  )
}

function Note({ children, tone = 'grey' }: { children: React.ReactNode; tone?: 'grey' | 'red' }) {
  return <p className={`rounded-xl px-3 py-2.5 text-[13px] leading-relaxed flex items-start gap-2 ${tone === 'red' ? 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/30 dark:text-red-300' : 'bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800/60 dark:text-slate-300'}`}>{tone === 'red' && <AlertTriangle size={15} className="shrink-0 mt-0.5" />}<span>{children}</span></p>
}

export function AutoMessageTemplates({ orgId, kind, flash, heading, intro, onChanged }: { orgId: string; kind: Kind; flash: Flash; heading: string; intro: string; onChanged?: (data: AutoTemplatesData) => void }) {
  const [data, setData] = useState<AutoTemplatesData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<AutoMessageView | null>(null)
  const [picking, setPicking] = useState<AutoMessageView | null>(null)
  const path = PATHS[kind]
  // The latest callback, so a load that finishes later never reports to an old one
  const changed = useRef(onChanged)
  useEffect(() => { changed.current = onChanged })

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy('load')
    try {
      const next: AutoTemplatesData = await api(`${path}?organizationId=${orgId}`)
      setData(next)
      setError('')
      changed.current?.(next)
    } catch (err: any) {
      setError(err.message)
    } finally {
      if (!quiet) setBusy(null)
    }
  }, [orgId, path])
  useEffect(() => { load() }, [load])

  async function submit(view: AutoMessageView, input: { text: string; language: string; buttons: string[] }) {
    await api(path, { method: 'POST', body: JSON.stringify({ organizationId: orgId, purpose: view.purpose, ...input }) })
    flash('success', `${view.title}: sent to Meta for approval. It is used by itself once Meta approves it, usually within minutes.`)
    await load(true)
  }

  async function sendSuggested(view: AutoMessageView) {
    setBusy(view.purpose)
    try {
      await submit(view, { text: view.suggestion.text, language: 'en', buttons: view.suggestion.buttons })
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function toggle(view: AutoMessageView, on: boolean) {
    if (!data?.messages) return
    setBusy(`on:${view.purpose}`)
    try {
      await api(path, { method: 'PUT', body: JSON.stringify({ organizationId: orgId, messages: { ...data.messages, [view.purpose]: { ...data.messages[view.purpose], on } } }) })
      await load(true)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  /** Use one of the account's own approved templates (null: stop using a template for this message). */
  async function pick(view: AutoMessageView, chosen: { name: string; language: string; fields: string[]; urlButton: boolean } | null) {
    setBusy(`pick:${view.purpose}`)
    try {
      if (kind === 'desk') {
        const choices = { ...(data?.choices || {}) }
        if (chosen) choices[view.purpose] = { name: chosen.name, language: chosen.language, fields: chosen.fields, url_field: chosen.urlButton && defFor(kind, view).urlField ? 'link' : null }
        else delete choices[view.purpose]
        await api(path, { method: 'PUT', body: JSON.stringify({ organizationId: orgId, choices }) })
      } else {
        await api(path, { method: 'PUT', body: JSON.stringify({ organizationId: orgId, purpose: view.purpose, pick: chosen ? { template: chosen.name, language: chosen.language, fields: chosen.fields } : null }) })
      }
      flash('success', chosen ? `${view.title} now uses ${chosen.name}.` : `${view.title} no longer uses a template.`)
      setPicking(null)
      await load(true)
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  const views = data?.autoMessages || []
  const approvedCount = views.filter((v) => v.current?.state === 'approved').length
  const approvedAccount = (data?.account || []).filter((t) => t.status === 'APPROVED')
  const locked = data?.ownWhatsApp === false

  return (
    <section className={card} aria-labelledby={`auto-templates-${kind}`}>
      <div className="px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><FileText size={20} /></span>
          <div className="min-w-0">
            <h2 id={`auto-templates-${kind}`} className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">{heading}{data && !locked && <span className="ml-1.5 text-[14px] font-semibold text-[#8a94a8] whitespace-nowrap">{approvedCount} of {views.length} approved</span>}</h2>
            {!locked && <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">{intro}</p>}
          </div>
        </div>
        {!locked && <button type="button" onClick={() => load()} disabled={busy === 'load'} aria-label="Check status with Meta" title="Check status with Meta" className="h-10 w-10 shrink-0 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"><RefreshCw size={17} className={busy === 'load' ? 'animate-spin' : ''} /></button>}
      </div>

      {!data ? (
        error ? <div className="p-4 sm:p-5 space-y-3"><Note tone="red">{error}</Note><button type="button" onClick={() => load()} className={smallButton}>Try again</button></div>
          : <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
      ) : locked ? (
        <div className="p-4 sm:p-5 space-y-3">
          <p className="flex items-start gap-2.5 text-[14px] text-[#4a5672] dark:text-slate-300 leading-relaxed"><Lock size={17} className="shrink-0 mt-0.5 text-[#6B7894]" /> {kind === 'desk'
            ? 'On your plan these messages go from WAMA\'s WhatsApp number with fixed wording that is already approved, so there is nothing to set up here. Your own wording, sent from your own WhatsApp number, comes with Growth.'
            : 'These messages go from your own WhatsApp number, which comes with Growth. On your plan, customers get their order confirmation from WAMA\'s WhatsApp number.'}</p>
          <a href="/dashboard/billing" className={smallButton}>See plans</a>
        </div>
      ) : (
        <>
          {(data.message || !data.connected) && <div className="px-4 sm:px-5 pt-4"><Note>{data.message || 'Connect WhatsApp (Meta Cloud API) in Settings to send templates for approval.'}</Note></div>}
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {views.map((view) => {
              const c = view.current
              const text = c?.text ?? view.suggestion.text
              const buttons = c?.buttons ?? view.suggestion.buttons
              const working = busy === view.purpose
              const fallbackInUse = c?.previous?.state === 'approved'
              return (
                <li key={view.purpose} className="px-4 sm:px-5 py-4 space-y-3 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">{view.title}</p>
                      <p className="text-[13px] text-[#6B7894]">{view.when}</p>
                    </div>
                    <StatusChip view={view} />
                  </div>
                  {view.switchable && (
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-[#eef1f6] dark:border-slate-800 px-3 py-2">
                      <span className="text-[13.5px] font-semibold text-[#0E1B3D] dark:text-white">Send this message</span>
                      <Toggle checked={view.on !== false} disabled={busy === `on:${view.purpose}`} onChange={(on) => toggle(view, on)} label={`Send the ${view.title.toLowerCase()} message`} />
                    </label>
                  )}
                  <Bubble text={text} fields={view.fields} buttons={buttons} />
                  {c && <p className="text-[12.5px] text-[#6B7894] [overflow-wrap:anywhere]">On WhatsApp as <span className="font-semibold text-[#4a5672] dark:text-slate-300">{c.name}</span> · {c.languageLabel}</p>}

                  {!c && <p className="text-[13px] text-[#6B7894]">Not set up yet: this message only reaches customers who wrote to you in the last 24 hours. Send the wording above for approval as it is, or edit it first.</p>}
                  {c?.state === 'review' && <Note>Meta is checking it, usually within minutes and at most a day.{fallbackInUse ? ' Until then your earlier approved wording is used.' : ' Until then this message only reaches customers who wrote to you in the last 24 hours.'}</Note>}
                  {c?.state === 'approved' && <p className="text-[13px] text-[#4a5672] dark:text-slate-300 flex items-start gap-1.5"><Check size={15} className="shrink-0 mt-0.5" /> Used by itself when the customer has not written in the last 24 hours.{c.category === 'MARKETING' ? ' Meta approved it as a marketing message: it still works, and Meta charges its marketing rate for it.' : ''}</p>}
                  {c?.state === 'rejected' && <Note tone="red"><span className="font-semibold">Meta did not approve it.</span> {c.reason}{fallbackInUse ? ' Your earlier approved wording is still used.' : ''}</Note>}
                  {c?.state === 'paused' && <Note>{c.reason}</Note>}
                  {c?.state === 'missing' && <Note tone="red">It is no longer on your WhatsApp account. Send it for approval again.</Note>}

                  {data.connected && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {(!c || c.state === 'missing') && <button type="button" onClick={() => sendSuggested(view)} disabled={busy !== null} className={smallPrimary}>{working ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send for approval</button>}
                      {c?.state === 'rejected'
                        ? <button type="button" onClick={() => setEditing(view)} disabled={busy !== null} className={smallPrimary}><Pencil size={15} /> Edit and send again</button>
                        : <button type="button" onClick={() => setEditing(view)} disabled={busy !== null} className={smallButton}><Pencil size={15} /> {c ? 'Edit wording' : 'Edit first'}</button>}
                      {c?.state === 'review' && <button type="button" onClick={() => load()} disabled={busy !== null} className={smallButton}><RefreshCw size={15} className={busy === 'load' ? 'animate-spin' : ''} /> Check status</button>}
                    </div>
                  )}
                  {data.connected && (approvedAccount.length > 0 || c) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {approvedAccount.length > 0 && <button type="button" onClick={() => setPicking(view)} disabled={busy !== null} className={linkButton}>Use one I already have</button>}
                      {c && <button type="button" onClick={() => pick(view, null)} disabled={busy !== null} className="text-[13px] font-semibold text-[#6B7894] hover:underline cursor-pointer disabled:opacity-50">Stop using a template</button>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {editing && <TemplateEditor orgId={orgId} kind={kind} view={editing} onClose={() => setEditing(null)} onSubmit={async (input) => { await submit(editing, input); setEditing(null) }} />}
      {picking && <PickExisting view={picking} def={defFor(kind, picking)} account={approvedAccount} busy={busy === `pick:${picking.purpose}`} onClose={() => setPicking(null)} onPick={(chosen) => pick(picking, chosen)} />}
    </section>
  )
}

/** Change the wording, the button words and the language, then send it to Meta for approval. */
function TemplateEditor({ orgId, kind, view, onClose, onSubmit }: { orgId: string; kind: Kind; view: AutoMessageView; onClose: () => void; onSubmit: (input: { text: string; language: string; buttons: string[] }) => Promise<void> }) {
  const def = useMemo(() => defFor(kind, view), [kind, view])
  const [text, setText] = useState(view.current?.text ?? view.suggestion.text)
  const [buttons, setButtons] = useState<string[]>(view.buttons.map((b, i) => view.current?.buttons?.[i] ?? view.suggestion.buttons[i] ?? b.text))
  const [language, setLanguage] = useState(view.current?.language || 'en')
  const [busy, setBusy] = useState<'send' | 'ai' | null>(null)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const origin = typeof window === 'undefined' ? 'https://wamacrm.magnetora.in' : window.location.origin
  const problems = useMemo(() => autoDraft(def, { text, language, buttons }, { name: def.baseName, origin }).problems, [def, text, language, buttons, origin])

  function insert(label: string) {
    const el = box.current
    const token = `{${label}}`
    if (!el) { setText((t) => `${t} ${token}`); return }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const before = text.slice(0, start)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${pad}${token}${text.slice(end)}`
    setText(next)
    requestAnimationFrame(() => { el.focus(); const at = before.length + pad.length + token.length; el.setSelectionRange(at, at) })
  }

  async function writeWithAi() {
    setBusy('ai')
    setError('')
    try {
      const result = await api('/api/whatsapp-templates/ai-draft', { method: 'POST', body: JSON.stringify({ organizationId: orgId, purpose: view.purpose, language, category: 'UTILITY', description: `${view.title}: ${view.when}` }) })
      setText(toEditorText(String(result.draft?.body || ''), result.fields || [], view.fields))
      const urlText = (result.draft?.buttons || []).find((b: any) => b.type === 'URL')?.text
      if (urlText && view.buttons[0]?.type === 'URL') setButtons([urlText])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    setTried(true)
    setError('')
    if (problems.length) return
    setBusy('send')
    try {
      await onSubmit({ text, language, buttons })
    } catch (err: any) {
      setError(err.message)
      setBusy(null)
    }
  }

  return (
    <Modal size="lg" title={view.title} subtitle="Change the words, then send it to Meta for approval" icon={<Pencil size={19} />} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={send} disabled={busy !== null || (tried && problems.length > 0)} className={primaryButton}>{busy === 'send' ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} Send for approval</button>
      </>}>
      <div className="space-y-4 min-w-0">
        {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-2.5 text-[14px]">{error}</p>}
        {view.current?.state === 'rejected' && view.current.reason && <Note tone="red"><span className="font-semibold">Why Meta did not approve it:</span> {view.current.reason}</Note>}
        <div>
          <div className="flex items-end justify-between gap-2 mb-1">
            <label htmlFor="auto-template-text" className="text-[13px] font-semibold text-[#6B7894]">Message</label>
            <div className="flex gap-3">
              {kind === 'desk' && <button type="button" onClick={writeWithAi} disabled={busy !== null} className={`${linkButton} inline-flex items-center gap-1`}>{busy === 'ai' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Write with AI</button>}
              <button type="button" onClick={() => { setText(view.suggestion.text); setButtons([...view.suggestion.buttons]) }} className={linkButton}>Use the suggestion</button>
            </div>
          </div>
          <textarea id="auto-template-text" ref={box} value={text} rows={5} maxLength={1100} onChange={(e) => setText(e.target.value)} className={`${field} px-3 py-2.5 leading-relaxed`} />
          <p className="mt-1 text-[12.5px] text-[#8a94a8]">Words in braces are filled for each customer. Tap one to add it where the cursor is.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {view.fields.map((f) => (
              <button key={f.key} type="button" onClick={() => insert(f.label)} className="inline-flex items-center h-8 px-2.5 rounded-lg border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] font-semibold text-[#0E1B3D] dark:text-slate-100 hover:border-[#1D5BEA] hover:text-[#1D5BEA] cursor-pointer">+ {f.label}</button>
            ))}
          </div>
        </div>

        {view.buttons.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] font-semibold text-[#6B7894]">{view.buttons.length === 1 ? 'Button' : 'Buttons'}</p>
            {view.buttons.map((b, i) => (
              <label key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1 sm:gap-3 sm:items-center">
                <input value={buttons[i] ?? ''} maxLength={25} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Button ${i + 1} words`} className={`${field} h-11 px-3`} />
                <span className="text-[12.5px] text-[#6B7894]">{b.note}</span>
              </label>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className="block text-[13px] font-semibold text-[#6B7894] mb-1">Language of the words</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${field} h-11 px-3 cursor-pointer`}>
              {AUTO_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <div className="min-w-0">
            <span className="block text-[13px] font-semibold text-[#6B7894] mb-1">Kind</span>
            <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300 leading-snug">Utility: an update about a visit or an order. Keep it to the facts, without offers, so Meta approves it as one.</p>
          </div>
        </div>

        <div>
          <p className="text-[13px] font-semibold text-[#6B7894] mb-1.5">How it looks</p>
          <Bubble text={text} fields={view.fields} buttons={buttons} />
        </div>
        {(tried || text !== (view.current?.text ?? view.suggestion.text)) && problems.length > 0 && (
          <ul className="space-y-1">{problems.slice(0, 4).map((p, i) => <li key={i} className="text-[13px] text-[#b91c1c] flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {p}</li>)}</ul>
        )}
        <p className="text-[12.5px] text-[#8a94a8]">It goes to Meta as a new template on your WhatsApp account. {view.current?.state === 'approved' ? 'Your approved wording keeps going out until Meta approves this one.' : 'Meta usually answers within minutes.'}</p>
      </div>
    </Modal>
  )
}

/** Use one of the account's own approved templates, and say what fills each of its blanks. */
function PickExisting({ view, def, account, busy, onClose, onPick }: { view: AutoMessageView; def: AutoMessageDef; account: AccountTemplate[]; busy: boolean; onClose: () => void; onPick: (chosen: { name: string; language: string; fields: string[]; urlButton: boolean }) => void }) {
  const hasLink = def.buttons.some((b) => b.type === 'URL')
  const options = account.filter((t) => hasLink || !t.urlButton)
  const [key, setKey] = useState('')
  const template = options.find((t) => `${t.name}|${t.language}` === key) || null
  const [fields, setFields] = useState<string[]>([])
  const choose = (value: string) => {
    setKey(value)
    const t = options.find((o) => `${o.name}|${o.language}` === value)
    setFields(Array.from({ length: t?.blanks || 0 }, (_, i) => def.suggestion.fields[i] || view.fields[i]?.key || view.fields[0]?.key || ''))
  }
  const ready = template && fields.length === template.blanks && fields.every(Boolean)
  const parts = (template?.body || '').split(/(\{\{\s*\d+\s*\}\})/g)
  return (
    <Modal title="Use one I already have" subtitle={view.title} icon={<FileText size={19} />} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" disabled={!ready || busy} onClick={() => template && onPick({ name: template.name, language: template.language, fields, urlButton: template.urlButton })} className={primaryButton}>{busy && <Loader2 size={17} className="animate-spin" />} Use it</button>
      </>}>
      <div className="space-y-3 min-w-0">
        <p className="text-[13.5px] text-[#6B7894]">Only your approved templates are listed{hasLink ? '' : ' (without a link button: this message has no link to open)'}.</p>
        <select value={key} onChange={(e) => choose(e.target.value)} aria-label="Template" className={`${field} h-11 px-3 cursor-pointer`}>
          <option value="" disabled>Choose a template</option>
          {options.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</option>)}
        </select>
        {template && (
          <>
            <p className="rounded-xl bg-[#f8fafc] dark:bg-slate-900/60 border border-[#eef1f6] dark:border-slate-800 px-3 py-2.5 text-[13.5px] leading-relaxed text-[#0E1B3D] dark:text-slate-200 [overflow-wrap:anywhere]">
              {parts.map((part, i) => {
                const n = /\{\{\s*(\d+)\s*\}\}/.exec(part)?.[1]
                if (!n) return <span key={i}>{part}</span>
                const f = view.fields.find((x) => x.key === fields[Number(n) - 1])
                return <span key={i} className="inline-flex items-center mx-0.5 px-1.5 rounded-md text-[12.5px] font-semibold bg-[#eef1f6] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100">{f ? f.label : `{{${n}}}`}</span>
              })}
            </p>
            {Array.from({ length: template.blanks }, (_, i) => (
              <label key={i} className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-16 text-[13px] font-semibold text-[#6B7894]">{`Blank ${i + 1}`}</span>
                <select value={fields[i] || ''} onChange={(e) => setFields(fields.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`What fills blank ${i + 1}`} className={`${field} h-11 px-3 cursor-pointer`}>
                  {view.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}
