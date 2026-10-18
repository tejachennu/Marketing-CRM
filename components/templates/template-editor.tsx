'use client'

import { useRef, useState } from 'react'
import { Bold, Code, Copy, ExternalLink, Italic, ListChecks, Loader2, Phone, PhoneCall, Plus, Reply, Smile, Strikethrough, Trash2, Upload, X } from 'lucide-react'
import {
  LIMITS, TTL_LIMITS, describeDuration, emptyCard, extractVariables, nextVariable,
  type ButtonDraft, type CardDraft, type DraftProblem, type HeaderFormat, type TemplateDraft,
} from '@/lib/whatsapp-templates/template-model'

const input = 'w-full h-10 px-3 text-[14px] rounded-lg bg-white dark:bg-slate-900 border border-[#ced0d4] dark:border-slate-700 text-[#1c2b33] dark:text-white placeholder:text-[#8a8d91] focus:outline-none focus:border-[#0064e0] focus:ring-2 focus:ring-[#0064e0]/20 disabled:bg-[#f5f6f7] disabled:text-[#8a8d91] dark:disabled:bg-slate-800'
const textarea = input.replace('h-10 ', '') + ' py-2.5 resize-y leading-relaxed'
const smallButton = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#ced0d4] dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200 hover:bg-[#f5f6f7] dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50'

export function Section({ title, optional, description, children, error }: { title: string; optional?: boolean; description?: string; children: React.ReactNode; error?: string[] }) {
  return (
    <section className="bg-white dark:bg-[#111b21] rounded-xl border border-[#dadde1] dark:border-slate-800 p-4 sm:p-5">
      <h3 className="text-[15px] font-bold text-[#1c2b33] dark:text-white">
        {title}{optional && <span className="ml-1.5 text-[13px] font-normal text-[#65676b] dark:text-slate-400">· Optional</span>}
      </h3>
      {description && <p className="text-[13px] text-[#65676b] dark:text-slate-400 mt-0.5 mb-3">{description}</p>}
      <div className={description ? '' : 'mt-3'}>{children}</div>
      {error && error.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {error.map((message) => <li key={message} className="text-[12.5px] text-[#e41e3f]">{message}</li>)}
        </ul>
      )}
    </section>
  )
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-[12px] tabular-nums ${value.length > max ? 'text-[#e41e3f]' : 'text-[#8a8d91]'}`}>{value.length}/{max}</span>
}

/** Upload a header sample to Meta; keeps a local preview. */
function MediaUpload({ orgId, accept, handle, preview, onUploaded }: { orgId: string; accept: string; handle: string; preview?: string; onUploaded: (handle: string, preview: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  async function upload(file: File) {
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('organizationId', orgId)
      form.append('file', file)
      const res = await fetch('/api/whatsapp-templates/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The file could not be uploaded.')
      onUploaded(data.handle, URL.createObjectURL(file))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={smallButton}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {handle ? 'Choose another file' : 'Choose file'}
        </button>
        {handle && !busy && <span className="text-[12.5px] text-[#31a24c] font-semibold">Sample uploaded to Meta</span>}
        {preview && !handle && <span className="text-[12.5px] text-[#65676b]">Current sample on Meta</span>}
      </div>
      {error && <p className="mt-1.5 text-[12.5px] text-[#e41e3f]">{error}</p>}
    </div>
  )
}

/** A textarea with WhatsApp formatting and "Add variable", like WhatsApp Manager's body field. */
const EMOJIS = ['😀', '😊', '😍', '🥳', '😎', '🤩', '👍', '🙏', '👋', '🎉', '🎁', '🔥', '✨', '⭐', '💯', '✅', '❤️', '💚', '🛍️', '🛒', '📦', '🚚', '💳', '💰', '🏷️', '⏰', '📅', '📍', '📞', '💬', '📚', '🪔']

function RichField({ value, onChange, max, rows, placeholder, addVariable, disabled }: { value: string; onChange: (value: string) => void; max: number; rows: number; placeholder: string; addVariable?: () => string; disabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  function wrap(before: string, after = before) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart, end = el.selectionEnd
    const next = value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, end + before.length) })
  }
  function insert(text: string) {
    const el = ref.current
    const at = el ? el.selectionEnd : value.length
    onChange(value.slice(0, at) + text + value.slice(at))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + text.length, at + text.length) })
  }
  return (
    <div>
      <textarea ref={ref} value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} disabled={disabled} className={textarea} />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
        <div className="flex items-center gap-0.5">
          {[{ icon: Bold, title: 'Bold', mark: '*' }, { icon: Italic, title: 'Italic', mark: '_' }, { icon: Strikethrough, title: 'Strikethrough', mark: '~' }, { icon: Code, title: 'Monospace', mark: '```' }].map(({ icon: Icon, title, mark }) => (
            <button key={title} type="button" title={title} aria-label={title} onClick={() => wrap(mark)} disabled={disabled} className="h-8 w-8 rounded-md flex items-center justify-center text-[#65676b] hover:bg-[#f2f3f5] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"><Icon size={15} /></button>
          ))}
          <span className="relative">
            <button type="button" title="Emoji" aria-label="Emoji" onClick={() => setEmojiOpen(!emojiOpen)} disabled={disabled} className="h-8 w-8 rounded-md flex items-center justify-center text-[#65676b] hover:bg-[#f2f3f5] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"><Smile size={15} /></button>
            {emojiOpen && (
              <span className="absolute z-30 left-0 top-9 w-64 p-2 grid grid-cols-8 gap-0.5 rounded-xl border border-[#dadde1] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => { insert(emoji); setEmojiOpen(false) }} className="h-7 w-7 rounded hover:bg-[#f2f3f5] dark:hover:bg-slate-800 text-[17px] cursor-pointer">{emoji}</button>
                ))}
              </span>
            )}
          </span>
          {addVariable && (
            <button type="button" onClick={() => insert(addVariable())} disabled={disabled} className="ml-1 inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[13px] font-semibold text-[#0064e0] hover:bg-[#e7f0fd] dark:hover:bg-blue-950/40 cursor-pointer disabled:opacity-40">
              <Plus size={14} /> Add variable
            </button>
          )}
        </div>
        <Counter value={value} max={max} />
      </div>
    </div>
  )
}

const BUTTON_CHOICES: Array<{ type: ButtonDraft['type']; label: string; icon: any; group: string }> = [
  { type: 'QUICK_REPLY', label: 'Custom', icon: Reply, group: 'Quick reply buttons' },
  { type: 'URL', label: 'Visit website', icon: ExternalLink, group: 'Call-to-action buttons' },
  { type: 'PHONE_NUMBER', label: 'Call phone number', icon: Phone, group: 'Call-to-action buttons' },
  { type: 'COPY_CODE', label: 'Copy offer code', icon: Copy, group: 'Call-to-action buttons' },
  { type: 'FLOW', label: 'Complete flow', icon: ListChecks, group: 'Call-to-action buttons' },
  { type: 'VOICE_CALL', label: 'Call on WhatsApp', icon: PhoneCall, group: 'Call-to-action buttons' },
]

function newButton(type: ButtonDraft['type']): ButtonDraft {
  switch (type) {
    case 'QUICK_REPLY': return { type, text: '' }
    case 'URL': return { type, text: 'Visit website', url: 'https://' }
    case 'PHONE_NUMBER': return { type, text: 'Call us', phone_number: '+91' }
    case 'COPY_CODE': return { type, example: '' }
    case 'FLOW': return { type, text: 'Open form', flow_id: '' }
    case 'VOICE_CALL': return { type, text: 'Call on WhatsApp' }
  }
}

function ButtonsEditor({ buttons, onChange, allowed, flows }: { buttons: ButtonDraft[]; onChange: (buttons: ButtonDraft[]) => void; allowed: Array<ButtonDraft['type']>; flows: Array<{ id: string; name: string }> }) {
  const [menu, setMenu] = useState(false)
  const update = (index: number, changes: Partial<ButtonDraft>) => onChange(buttons.map((button, i) => (i === index ? ({ ...button, ...changes } as ButtonDraft) : button)))
  const add = (type: ButtonDraft['type']) => {
    // Quick replies stay together, ahead of the call-to-action buttons
    const next = [...buttons, newButton(type)]
    onChange([...next.filter((button) => button.type === 'QUICK_REPLY'), ...next.filter((button) => button.type !== 'QUICK_REPLY')])
    setMenu(false)
  }
  const groups = [...new Set(BUTTON_CHOICES.filter((choice) => allowed.includes(choice.type)).map((choice) => choice.group))]
  return (
    <div className="space-y-2.5">
      {buttons.map((button, index) => {
        const choice = BUTTON_CHOICES.find((item) => item.type === button.type)!
        const Icon = choice.icon
        return (
          <div key={index} className="rounded-lg border border-[#dadde1] dark:border-slate-700 bg-[#f7f8fa] dark:bg-slate-900/60 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200"><Icon size={14} /> {choice.label}</span>
              <button type="button" aria-label="Remove button" onClick={() => onChange(buttons.filter((_, i) => i !== index))} className="h-7 w-7 rounded-md flex items-center justify-center text-[#65676b] hover:bg-[#e4e6eb] dark:hover:bg-slate-800 cursor-pointer"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {button.type !== 'COPY_CODE' && (
                <label className="block">
                  <span className="flex justify-between text-[12px] font-semibold text-[#65676b] mb-1">Button text <Counter value={button.text} max={LIMITS.buttonText} /></span>
                  <input value={button.text} onChange={(event) => update(index, { text: event.target.value })} maxLength={40} className={input} />
                </label>
              )}
              {button.type === 'URL' && (
                <>
                  <label className="block">
                    <span className="block text-[12px] font-semibold text-[#65676b] mb-1">Website URL</span>
                    <input value={button.url} onChange={(event) => update(index, { url: event.target.value })} placeholder="https://www.example.com" className={input} />
                  </label>
                  {extractVariables(button.url).length > 0 ? (
                    <label className="block sm:col-span-2">
                      <span className="block text-[12px] font-semibold text-[#65676b] mb-1">Sample full URL</span>
                      <input value={button.example || ''} onChange={(event) => update(index, { example: event.target.value })} placeholder="https://www.example.com/order/12345" className={input} />
                    </label>
                  ) : (
                    <button type="button" onClick={() => update(index, { url: `${button.url.replace(/\/+$/, '')}/{{1}}` })} className="sm:col-span-2 justify-self-start text-[12.5px] font-semibold text-[#0064e0] cursor-pointer">+ Make it dynamic (add {'{{1}}'} at the end)</button>
                  )}
                </>
              )}
              {button.type === 'PHONE_NUMBER' && (
                <label className="block">
                  <span className="block text-[12px] font-semibold text-[#65676b] mb-1">Phone number</span>
                  <input value={button.phone_number} onChange={(event) => update(index, { phone_number: event.target.value })} placeholder="+91 98765 43210" className={input} />
                </label>
              )}
              {button.type === 'COPY_CODE' && (
                <label className="block sm:col-span-2">
                  <span className="flex justify-between text-[12px] font-semibold text-[#65676b] mb-1">Sample offer code <Counter value={button.example} max={LIMITS.couponCode} /></span>
                  <input value={button.example} onChange={(event) => update(index, { example: event.target.value.toUpperCase() })} placeholder="SAVE20" className={input} />
                </label>
              )}
              {button.type === 'FLOW' && (
                <label className="block">
                  <span className="block text-[12px] font-semibold text-[#65676b] mb-1">Flow</span>
                  {flows.length ? (
                    <select value={button.flow_id} onChange={(event) => update(index, { flow_id: event.target.value })} className={input}>
                      <option value="">Choose a published flow</option>
                      {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
                    </select>
                  ) : (
                    <input value={button.flow_id} onChange={(event) => update(index, { flow_id: event.target.value.replace(/\D/g, '') })} placeholder="Flow ID from Meta" className={input} />
                  )}
                </label>
              )}
            </div>
          </div>
        )
      })}
      {buttons.length < LIMITS.buttons && groups.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => setMenu(!menu)} className={smallButton}><Plus size={14} /> Add button</button>
          {menu && (
            <div className="absolute z-20 mt-1 w-64 rounded-xl border border-[#dadde1] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-1.5">
              {groups.map((group) => (
                <div key={group}>
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-[#65676b]">{group}</p>
                  {BUTTON_CHOICES.filter((choice) => choice.group === group && allowed.includes(choice.type)).map(({ type, label, icon: Icon }) => (
                    <button key={type} type="button" onClick={() => add(type)} className="w-full flex items-center gap-2 px-3 py-2 text-[13.5px] text-[#1c2b33] dark:text-slate-200 hover:bg-[#f2f3f5] dark:hover:bg-slate-800 cursor-pointer text-left">
                      <Icon size={15} className="text-[#65676b]" /> {label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[12px] text-[#65676b] dark:text-slate-400">Up to {LIMITS.buttons} buttons. More than 3 show under “See all options”.</p>
    </div>
  )
}

function SamplesEditor({ names, samples, onChange, prefix = '', label }: { names: string[]; samples: Record<string, string>; onChange: (samples: Record<string, string>) => void; prefix?: string; label: string }) {
  if (names.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] font-semibold text-[#65676b]">{label}</p>
      {names.map((name) => (
        <div key={name} className="flex items-center gap-2">
          <span className="shrink-0 min-w-[84px] text-[13px] font-mono text-[#1c2b33] dark:text-slate-300">{`{{${name}}}`}</span>
          <input value={samples[`${prefix}${name}`] || ''} onChange={(event) => onChange({ ...samples, [`${prefix}${name}`]: event.target.value })} placeholder={`Sample for {{${name}}}`} className={input} />
        </div>
      ))}
    </div>
  )
}

/** Message validity period: how long WhatsApp keeps trying to deliver the message. */
function ValiditySection({ draft, set, error }: { draft: TemplateDraft; set: (changes: Partial<TemplateDraft>) => void; error: string[] }) {
  const limits = TTL_LIMITS[draft.category]
  const choices = [30, 60, 120, 180, 300, 600, 900, 1800, 3600, 10800, 21600, 43200, 86400, 259200, 604800, 1209600, 2592000]
    .filter((seconds) => seconds >= limits.min && seconds <= limits.max)
  return (
    <Section title="Message validity period" optional description="If a message can't be delivered within this time, WhatsApp stops trying. Useful for codes and time-sensitive offers." error={error}>
      <label className="flex items-center gap-2.5 text-[14px] text-[#1c2b33] dark:text-slate-200 cursor-pointer">
        <input type="checkbox" checked={draft.ttlSeconds !== null} onChange={(event) => set({ ttlSeconds: event.target.checked ? (choices.includes(limits.default) ? limits.default : choices[choices.length - 1]) : null })} className="h-4 w-4 accent-[#0064e0]" />
        Set a custom validity period
      </label>
      {draft.ttlSeconds !== null && (
        <select value={draft.ttlSeconds} onChange={(event) => set({ ttlSeconds: Number(event.target.value) })} className={`${input} mt-2 sm:w-64`}>
          {choices.map((seconds) => <option key={seconds} value={seconds}>{describeDuration(seconds)}</option>)}
        </select>
      )}
      {draft.ttlSeconds === null && <p className="text-[12.5px] text-[#65676b] mt-1.5">Meta's default: {describeDuration(limits.default)}.</p>}
    </Section>
  )
}

const FIXED_BUTTONS: Record<string, { label: string; note: string }> = {
  catalog: { label: 'View catalog', note: 'Opens your WhatsApp catalogue. Link a catalogue in Commerce first.' },
  mpm: { label: 'View items', note: 'Opens the products you pick when sending (up to 30, in sections).' },
  spm: { label: 'View', note: 'Opens the product you pick when sending.' },
  product_carousel: { label: 'View', note: 'Each card opens its product.' },
  order_details: { label: 'Review and pay', note: 'Opens the order with the amount, items and payment options you set when sending. Needs a payment setup in WhatsApp Manager.' },
}

export function TemplateEditor({
  draft, onChange, problems, orgId, flows, mode, approved,
}: {
  draft: TemplateDraft
  onChange: (draft: TemplateDraft) => void
  problems: DraftProblem[]
  orgId: string
  flows: Array<{ id: string; name: string }>
  mode: 'create' | 'edit'
  approved: boolean
}) {
  const set = (changes: Partial<TemplateDraft>) => onChange({ ...draft, ...changes })
  const errorsFor = (field: string) => problems.filter((problem) => problem.field === field).map((problem) => problem.message)
  const headerFormats: HeaderFormat[] = draft.type === 'lto' ? ['NONE', 'IMAGE', 'VIDEO'] : draft.type === 'mpm' ? ['TEXT'] : ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']
  const allowedButtons: Array<ButtonDraft['type']> = draft.type === 'coupon' || draft.type === 'lto' ? ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE']
    : draft.type === 'flow' ? ['FLOW']
      : ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'VOICE_CALL']
  const fixedButton = FIXED_BUTTONS[draft.type]
  const hasHeaderSection = !['carousel', 'product_carousel', 'spm'].includes(draft.type)
  const setCard = (index: number, changes: Partial<CardDraft>) => set({ cards: draft.cards.map((card, i) => (i === index ? { ...card, ...changes } : card)) })

  if (draft.type === 'otp') {
    return (
      <div className="space-y-4">
        <Section title="Code delivery setup" description="Choose how customers send the code from WhatsApp to your app.">
          <div className="space-y-2">
            {[
              { value: 'ZERO_TAP', title: 'Zero-tap autofill', text: 'The code is sent to your app automatically, without the customer leaving it. Android only; falls back to one-tap and copy code.' },
              { value: 'ONE_TAP', title: 'One-tap autofill', text: 'The customer taps a button to fill the code in your app. Android only; falls back to copy code.' },
              { value: 'COPY_CODE', title: 'Copy code', text: 'The customer copies the code and pastes it into your app or website.' },
            ].map((option) => (
              <label key={option.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${draft.otp.type === option.value ? 'border-[#0064e0] bg-[#e7f0fd] dark:bg-blue-950/30' : 'border-[#dadde1] dark:border-slate-700'}`}>
                <input type="radio" checked={draft.otp.type === option.value} onChange={() => set({ otp: { ...draft.otp, type: option.value as any } })} className="mt-1 accent-[#0064e0]" />
                <span><span className="block text-[14px] font-semibold text-[#1c2b33] dark:text-white">{option.title}</span><span className="block text-[13px] text-[#65676b] dark:text-slate-400">{option.text}</span></span>
              </label>
            ))}
          </div>
          {draft.otp.type !== 'COPY_CODE' && (
            <div className="mt-3 space-y-2.5">
              <p className="text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200">App setup</p>
              {draft.otp.apps.map((app, index) => (
                <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <label className="block"><span className="block text-[12px] font-semibold text-[#65676b] mb-1">Package name</span><input value={app.packageName} onChange={(event) => set({ otp: { ...draft.otp, apps: draft.otp.apps.map((a, i) => (i === index ? { ...a, packageName: event.target.value } : a)) } })} placeholder="com.example.myapplication" className={input} /></label>
                  <label className="block"><span className="block text-[12px] font-semibold text-[#65676b] mb-1">App signature hash</span><input value={app.signatureHash} onChange={(event) => set({ otp: { ...draft.otp, apps: draft.otp.apps.map((a, i) => (i === index ? { ...a, signatureHash: event.target.value } : a)) } })} placeholder="K8a/AINcGX7" maxLength={11} className={input} /></label>
                  {draft.otp.apps.length > 1 && <button type="button" aria-label={`Remove app ${index + 1}`} onClick={() => set({ otp: { ...draft.otp, apps: draft.otp.apps.filter((_, i) => i !== index) } })} className="h-10 w-10 rounded-lg flex items-center justify-center text-[#65676b] hover:bg-[#e4e6eb] cursor-pointer"><Trash2 size={15} /></button>}
                </div>
              ))}
              {draft.otp.apps.length < LIMITS.otpApps && <button type="button" onClick={() => set({ otp: { ...draft.otp, apps: [...draft.otp.apps, { packageName: '', signatureHash: '' }] } })} className={smallButton}><Plus size={14} /> Add another app</button>}
              {draft.otp.type === 'ZERO_TAP' && (
                <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[#f7f8fa] dark:bg-slate-900/60 text-[13px] text-[#1c2b33] dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={draft.otp.zeroTapTermsAccepted} onChange={(event) => set({ otp: { ...draft.otp, zeroTapTermsAccepted: event.target.checked } })} className="mt-0.5 h-4 w-4 accent-[#0064e0]" />
                  <span>I understand that zero-tap autofill sends the code straight to my app, and I'm responsible for using it as WhatsApp's zero-tap terms describe (<a href="https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/zero-tap-authentication-templates" target="_blank" rel="noreferrer" className="text-[#0064e0] underline">terms</a>).</span>
                </label>
              )}
            </div>
          )}
        </Section>
        <Section title="Content" description="Meta writes the message text for authentication templates. Choose what it includes.">
          <label className="flex items-center gap-2.5 text-[14px] text-[#1c2b33] dark:text-slate-200 cursor-pointer">
            <input type="checkbox" checked={draft.otp.addSecurityRecommendation} onChange={(event) => set({ otp: { ...draft.otp, addSecurityRecommendation: event.target.checked } })} className="h-4 w-4 accent-[#0064e0]" /> Add security recommendation
          </label>
          <label className="flex items-center gap-2.5 text-[14px] text-[#1c2b33] dark:text-slate-200 mt-2.5 cursor-pointer">
            <input type="checkbox" checked={draft.otp.codeExpirationMinutes !== null} onChange={(event) => set({ otp: { ...draft.otp, codeExpirationMinutes: event.target.checked ? 10 : null } })} className="h-4 w-4 accent-[#0064e0]" /> Add expiry time for the code
          </label>
          {draft.otp.codeExpirationMinutes !== null && (
            <div className="flex items-center gap-2 mt-2 ml-6">
              <input type="number" min={1} max={90} value={draft.otp.codeExpirationMinutes} onChange={(event) => set({ otp: { ...draft.otp, codeExpirationMinutes: Number(event.target.value) || 1 } })} className={input.replace('w-full', 'w-24')} />
              <span className="text-[13px] text-[#65676b]">minutes</span>
            </div>
          )}
        </Section>
        <Section title="Buttons" description="The button the customer taps to copy or autofill the code." error={errorsFor('otp')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="flex justify-between text-[12px] font-semibold text-[#65676b] mb-1">Copy code button <Counter value={draft.otp.buttonText} max={LIMITS.buttonText} /></span><input value={draft.otp.buttonText} onChange={(event) => set({ otp: { ...draft.otp, buttonText: event.target.value } })} className={input} /></label>
            {draft.otp.type !== 'COPY_CODE' && <label className="block"><span className="flex justify-between text-[12px] font-semibold text-[#65676b] mb-1">Autofill button <Counter value={draft.otp.autofillText} max={LIMITS.buttonText} /></span><input value={draft.otp.autofillText} onChange={(event) => set({ otp: { ...draft.otp, autofillText: event.target.value } })} className={input} /></label>}
          </div>
        </Section>
        <ValiditySection draft={draft} set={set} error={errorsFor('ttl')} />
      </div>
    )
  }

  const bodyVariables = extractVariables(draft.body)
  const headerVariables = draft.headerFormat === 'TEXT' ? extractVariables(draft.headerText) : []

  return (
    <div className="space-y-4">
      {mode === 'edit' && approved && (
        <p className="rounded-xl border border-[#f7b928] bg-[#fef8e6] dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-[13px] text-[#1c2b33] dark:text-amber-100">
          You can edit an approved template once a day and up to 10 times a month. After you submit, it goes back into review and you can keep sending it meanwhile.
        </p>
      )}

      <Section title="Variable type" description="Choose how variables look in your message: numbers like {{1}} or names like {{first_name}}.">
        <div className="flex gap-2">
          {(['POSITIONAL', 'NAMED'] as const).map((format) => (
            <button key={format} type="button" disabled={mode === 'edit'} onClick={() => set({ parameterFormat: format })} className={`h-9 px-3.5 rounded-lg border text-[13.5px] font-semibold cursor-pointer disabled:cursor-not-allowed ${draft.parameterFormat === format ? 'border-[#0064e0] bg-[#e7f0fd] text-[#0064e0] dark:bg-blue-950/40' : 'border-[#ced0d4] dark:border-slate-700 text-[#1c2b33] dark:text-slate-200'}`}>
              {format === 'POSITIONAL' ? 'Number' : 'Name'}
            </button>
          ))}
        </div>
      </Section>

      {draft.type === 'lto' && (
        <Section title="Limited-time offer" description="A banner above your message with the offer heading and an expiry countdown." error={errorsFor('lto')}>
          <label className="block">
            <span className="flex justify-between text-[12px] font-semibold text-[#65676b] mb-1">Offer heading <Counter value={draft.lto.text} max={LIMITS.ltoText} /></span>
            <input value={draft.lto.text} onChange={(event) => set({ lto: { ...draft.lto, text: event.target.value } })} className={input} />
          </label>
          <label className="flex items-center gap-2.5 text-[14px] text-[#1c2b33] dark:text-slate-200 mt-3 cursor-pointer">
            <input type="checkbox" checked={draft.lto.hasExpiration} onChange={(event) => set({ lto: { ...draft.lto, hasExpiration: event.target.checked } })} className="h-4 w-4 accent-[#0064e0]" /> Show offer expiry (set when you send it)
          </label>
        </Section>
      )}

      {draft.type === 'spm' && (
        <Section title="Header" description="The product's image, name and price show at the top. You pick the product each time you send." >
          <div className="h-9 inline-flex items-center px-3 rounded-lg bg-[#f2f3f5] dark:bg-slate-800 text-[13.5px] font-semibold text-[#1c2b33] dark:text-slate-200">Product</div>
        </Section>
      )}

      {hasHeaderSection && (
        <Section title="Header" optional={draft.type !== 'mpm'} description="Add a title, or choose the type of media you'll send with this header." error={errorsFor('header')}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {headerFormats.map((format) => (
              <button key={format} type="button" onClick={() => set({ headerFormat: format, headerHandle: '', headerPreview: undefined })} className={`h-8 px-3 rounded-full border text-[13px] font-semibold cursor-pointer ${draft.headerFormat === format ? 'border-[#0064e0] bg-[#e7f0fd] text-[#0064e0] dark:bg-blue-950/40' : 'border-[#ced0d4] dark:border-slate-700 text-[#1c2b33] dark:text-slate-200 hover:bg-[#f5f6f7] dark:hover:bg-slate-800'}`}>
                {format === 'NONE' ? 'None' : format.charAt(0) + format.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {draft.headerFormat === 'TEXT' && (
            <div>
              <input value={draft.headerText} onChange={(event) => set({ headerText: event.target.value })} placeholder="Enter header text" className={input} />
              <div className="flex justify-between mt-1.5">
                <button type="button" disabled={headerVariables.length > 0} onClick={() => set({ headerText: `${draft.headerText} ${nextVariable('', draft.parameterFormat, [])}`.trim() })} className="text-[13px] font-semibold text-[#0064e0] disabled:text-[#8a8d91] cursor-pointer disabled:cursor-not-allowed">+ Add variable</button>
                <Counter value={draft.headerText} max={LIMITS.headerText} />
              </div>
            </div>
          )}
          {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(draft.headerFormat) && (
            <div>
              <p className="text-[13px] text-[#65676b] dark:text-slate-400 mb-2">Upload a sample {draft.headerFormat.toLowerCase()} for Meta's review. You choose the real one each time you send.</p>
              <MediaUpload orgId={orgId} accept={draft.headerFormat === 'IMAGE' ? 'image/jpeg,image/png' : draft.headerFormat === 'VIDEO' ? 'video/mp4,video/3gpp' : 'application/pdf'} handle={draft.headerHandle.startsWith('http') ? '' : draft.headerHandle} preview={draft.headerPreview} onUploaded={(handle, preview) => set({ headerHandle: handle, headerPreview: preview })} />
            </div>
          )}
          {draft.headerFormat === 'LOCATION' && <p className="text-[13px] text-[#65676b] dark:text-slate-400">You'll add the location when you send the message.</p>}
        </Section>
      )}

      <Section title="Body" description={draft.type === 'carousel' ? 'The message above the cards.' : 'Enter the text for your message in the language you selected.'} error={errorsFor('body')}>
        <RichField value={draft.body} onChange={(body) => set({ body })} max={LIMITS.body} rows={6} placeholder="Hello {{1}}, …" addVariable={() => nextVariable(draft.body, draft.parameterFormat, headerVariables)} />
      </Section>

      {(bodyVariables.length > 0 || headerVariables.length > 0) && (
        <Section title="Variable samples" description="Include samples of all variables to help Meta review your template. Don't use real customer information." error={errorsFor('samples')}>
          <div className="space-y-4">
            <SamplesEditor label="Header" names={headerVariables} samples={draft.samples} prefix="header:" onChange={(samples) => set({ samples })} />
            <SamplesEditor label="Body" names={bodyVariables} samples={draft.samples} onChange={(samples) => set({ samples })} />
          </div>
        </Section>
      )}

      {draft.type === 'product_carousel' && (
        <Section title="Product cards" description="Each card shows a product from your catalogue, with a View button. You pick the products each time you send." error={errorsFor('cards')}>
          <label className="flex items-center gap-2 text-[14px] text-[#1c2b33] dark:text-slate-200">
            Number of cards
            <select value={draft.productCards} onChange={(event) => set({ productCards: Number(event.target.value) })} className={input.replace('w-full', 'w-24')}>
              {Array.from({ length: LIMITS.cards - LIMITS.minCards + 1 }, (_, i) => i + LIMITS.minCards).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </Section>
      )}

      {draft.type === 'call_permission' && (
        <Section title="Call permission request" description="Below your message, customers see a request to allow calls from your business on WhatsApp, with Allow and Don't allow. Needs WhatsApp Business Calling on your number.">
          <div className="h-9 inline-flex items-center gap-2 px-3 rounded-lg bg-[#f2f3f5] dark:bg-slate-800 text-[13.5px] font-semibold text-[#1c2b33] dark:text-slate-200"><PhoneCall size={14} /> Allow calls?</div>
        </Section>
      )}

      {!['lto', 'carousel', 'product_carousel'].includes(draft.type) && (
        <Section title="Footer" optional description="Add a short line of text to the bottom of your message." error={errorsFor('footer')}>
          <input value={draft.footer} onChange={(event) => set({ footer: event.target.value })} placeholder="Enter text" className={input} />
          <div className="flex justify-end mt-1.5"><Counter value={draft.footer} max={LIMITS.footer} /></div>
        </Section>
      )}

      {draft.type === 'carousel' && (
        <Section title="Carousel cards" description={`${LIMITS.minCards} to ${LIMITS.cards} cards. Every card has the same media type and the same buttons.`} error={errorsFor('cards')}>
          <div className="space-y-3">
            {draft.cards.map((card, index) => (
              <div key={index} className="rounded-lg border border-[#dadde1] dark:border-slate-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13.5px] font-bold text-[#1c2b33] dark:text-white">Card {index + 1}</span>
                  {draft.cards.length > LIMITS.minCards && <button type="button" aria-label={`Remove card ${index + 1}`} onClick={() => set({ cards: draft.cards.filter((_, i) => i !== index) })} className="h-7 w-7 rounded-md flex items-center justify-center text-[#65676b] hover:bg-[#e4e6eb] cursor-pointer"><Trash2 size={14} /></button>}
                </div>
                <div className="flex gap-1.5 mb-2">
                  {(['IMAGE', 'VIDEO'] as const).map((format) => (
                    <button key={format} type="button" onClick={() => set({ cards: draft.cards.map((c) => ({ ...c, headerFormat: format, headerHandle: c.headerFormat === format ? c.headerHandle : '', headerPreview: c.headerFormat === format ? c.headerPreview : undefined })) })} className={`h-7 px-2.5 rounded-full border text-[12.5px] font-semibold cursor-pointer ${card.headerFormat === format ? 'border-[#0064e0] bg-[#e7f0fd] text-[#0064e0]' : 'border-[#ced0d4] text-[#1c2b33] dark:text-slate-200'}`}>{format === 'IMAGE' ? 'Image' : 'Video'}</button>
                  ))}
                </div>
                <MediaUpload orgId={orgId} accept={card.headerFormat === 'IMAGE' ? 'image/jpeg,image/png' : 'video/mp4'} handle={card.headerHandle.startsWith('http') ? '' : card.headerHandle} preview={card.headerPreview} onUploaded={(handle, preview) => setCard(index, { headerHandle: handle, headerPreview: preview })} />
                <div className="mt-2.5">
                  <RichField value={card.body} onChange={(body) => setCard(index, { body })} max={LIMITS.carouselBody} rows={2} placeholder="Card text" addVariable={() => nextVariable(card.body, draft.parameterFormat)} />
                  <div className="mt-2"><SamplesEditor label="Samples" names={extractVariables(card.body)} samples={card.samples} onChange={(samples) => setCard(index, { samples })} /></div>
                </div>
                <div className="mt-2.5">
                  <ButtonsEditor buttons={card.buttons} onChange={(buttons) => setCard(index, { buttons })} allowed={['QUICK_REPLY', 'URL', 'PHONE_NUMBER']} flows={flows} />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {draft.cards.length < LIMITS.cards && <button type="button" onClick={() => set({ cards: [...draft.cards, { ...emptyCard(), headerFormat: draft.cards[0]?.headerFormat || 'IMAGE', buttons: (draft.cards[0]?.buttons || []).map((button) => ({ ...button })) }] })} className={smallButton}><Plus size={14} /> Add card</button>}
              {draft.cards.length > 1 && <button type="button" onClick={() => set({ cards: draft.cards.map((card, i) => (i === 0 ? card : { ...card, buttons: draft.cards[0].buttons.map((button) => ({ ...button })) })) })} className={smallButton}>Use card 1's buttons on every card</button>}
            </div>
          </div>
        </Section>
      )}

      {fixedButton ? (
        <Section title="Buttons" description={fixedButton.note}>
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-[#f2f3f5] dark:bg-slate-800 text-[13.5px] font-semibold text-[#1c2b33] dark:text-slate-200">{fixedButton.label}</div>
        </Section>
      ) : !['carousel', 'call_permission'].includes(draft.type) && (
        <Section title="Buttons" optional={draft.type === 'custom'} description="Create buttons that let customers respond to your message or take action." error={errorsFor('buttons')}>
          <ButtonsEditor buttons={draft.buttons} onChange={(buttons) => set({ buttons })} allowed={allowedButtons} flows={flows} />
        </Section>
      )}

      <ValiditySection draft={draft} set={set} error={errorsFor('ttl')} />

      {mode === 'create' && draft.category !== 'AUTHENTICATION' && (
        <label className="flex items-start gap-2.5 px-1 text-[13px] text-[#65676b] dark:text-slate-400 cursor-pointer">
          <input type="checkbox" checked={draft.allowCategoryChange} onChange={(event) => set({ allowCategoryChange: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[#0064e0]" />
          <span>Allow Meta to change the category if it doesn't match the content, instead of rejecting the template.</span>
        </label>
      )}
    </div>
  )
}
