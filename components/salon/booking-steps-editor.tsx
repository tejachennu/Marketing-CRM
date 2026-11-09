'use client'

/**
 * The booking flow's steps, as the business arranges them: their own questions (with buttons or a
 * typed answer) and messages around the booking steps (services, who, day and time), plus "Write
 * with AI" to draft them from a description. And the customer's view of those steps.
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, ExternalLink, ImagePlus, Link2, Loader2, MapPin, MessageSquareText, MousePointerClick, Plus, ScissorsLineDashed, Sparkles, TextCursorInput, Trash2, Upload, UserRound, X } from 'lucide-react'
import { mapsCoordinates, MAX_STEPS, stepProblem, STEP_NAMES, type FlowStep, type StepType } from '@/lib/salon/booking-flow-settings'
import { formatRupees } from '@/lib/salon/invoice'
import { api, input, primaryButton, secondaryButton } from './ui'
import type { Service, StaffMember } from './types'

const ICONS: Record<StepType, typeof Sparkles> = { services: ScissorsLineDashed, staff: UserRound, choice: MousePointerClick, text: TextCursorInput, message: MessageSquareText, image: ImagePlus, link: Link2, location: MapPin, datetime: CalendarDays }
const HINTS: Record<StepType, string> = {
  services: 'Customers pick from your services. Needed for every booking.',
  staff: 'Customers pick who serves them, or anyone free.',
  choice: 'Customers tap one answer. Saved on the booking.',
  text: 'Customers type the answer. Saved on the booking.',
  message: 'A note to the customer. No answer needed.',
  image: 'A photo with a caption: an offer, your menu, your shop.',
  link: 'Words with a button that opens a page: menu, prices, Instagram.',
  location: 'Your shop on the map, so customers find you.',
  datetime: 'Customers pick a day, then a free time. Always last.',
}
/** The built-in question for the booking steps (used when the business writes none). */
export const DEFAULT_QUESTION: Partial<Record<StepType, string>> = {
  services: 'Which service would you like?',
  staff: 'Who would you like for {service}?',
  datetime: 'Which day suits you for {service}?',
}
const FIXED: StepType[] = ['services', 'datetime']
let counter = 0
const newId = () => `n${Date.now()}${counter++}`

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const word = draft.replace(/\s+/g, ' ').trim().slice(0, 24)
    if (word && !options.includes(word) && options.length < 10) onChange([...options, word])
    setDraft('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <span key={o} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full border border-[#d5ddeb] dark:border-slate-700 text-[13.5px] font-semibold text-[#0E1B3D] dark:text-white">
            {o}
            <button type="button" onClick={() => onChange(options.filter((x) => x !== o))} aria-label={`Remove ${o}`} className="h-6 w-6 rounded-full flex items-center justify-center text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><X size={13} /></button>
          </span>
        ))}
      </div>
      {options.length < 10 && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input className={`${input} h-10 flex-1 min-w-0`} value={draft} maxLength={24} onChange={(e) => setDraft(e.target.value)} placeholder="Add an answer, like Yes" aria-label="New answer" />
          <button type="submit" disabled={!draft.trim()} className={`${secondaryButton} h-10 shrink-0`}><Plus size={16} /> Add</button>
        </form>
      )}
      {options.length < 2 && <p className="mt-1 text-[12.5px] font-semibold text-[#b91c1c]">Add at least two answers to tap.</p>}
    </div>
  )
}

export function StepsEditor({ orgId, steps, onChange, onDraft, business = '', address = '' }: {
  orgId: string
  business?: string
  /** The business's address, to fill a location step in one tap */
  address?: string
  steps: FlowStep[]
  onChange: (steps: FlowStep[]) => void
  /** AI drafted a flow: its welcome and language, if it wrote them */
  onDraft: (draft: { welcome?: string; language?: 'en' | 'te' | 'hi' }) => void
}) {
  const [describe, setDescribe] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [aiNote, setAiNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const update = (index: number, patch: Partial<FlowStep>) => onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index))
  const move = (index: number, by: -1 | 1) => {
    const target = index + by
    const next = [...steps]
    ;[next[index], next[target]] = [next[target], next[index]]
    // Day and time stays last; who stays after services
    if (next[next.length - 1].type !== 'datetime') return
    const services = next.findIndex((s) => s.type === 'services')
    const staff = next.findIndex((s) => s.type === 'staff')
    if (staff >= 0 && staff < services) return
    onChange(next)
  }
  const [uploading, setUploading] = useState<string | null>(null)
  async function upload(index: number, file: File) {
    setUploading(steps[index].id)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/media/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !String(data.url || '').startsWith('https://')) throw new Error(data.error || 'The photo could not be uploaded. Paste a link to it instead.')
      update(index, { url: data.url })
    } catch (err: any) {
      setAiNote({ tone: 'error', text: err.message })
    } finally {
      setUploading(null)
    }
  }
  const add = (type: StepType) => {
    const step: FlowStep = type === 'choice' ? { id: newId(), type, text: '', label: '', options: [] }
      : type === 'staff' ? { id: newId(), type }
      : type === 'location' ? { id: newId(), type, name: business, address, text: '' }
      : type === 'link' ? { id: newId(), type, text: '', url: '', button: '' }
      : type === 'image' ? { id: newId(), type, url: '', text: '' }
      : { id: newId(), type, text: '', label: '' }
    const at = type === 'staff' ? steps.findIndex((s) => s.type === 'services') + 1 : steps.length - 1
    onChange([...steps.slice(0, at), step, ...steps.slice(at)])
  }

  async function draft() {
    setDrafting(true)
    setAiNote(null)
    try {
      const data = await api('/api/salon/booking-flow/draft', { method: 'POST', body: JSON.stringify({ organizationId: orgId, description: describe }) })
      onChange(data.draft.steps)
      onDraft({ welcome: data.draft.welcome || undefined, language: data.draft.language })
      setAiNote({ tone: 'ok', text: `Drafted ${data.draft.steps.length} steps. Change anything below, then save.${data.notes?.length ? ` ${data.notes.join(' ')}` : ''}` })
    } catch (err: any) {
      setAiNote({ tone: 'error', text: err.message })
    } finally {
      setDrafting(false)
    }
  }

  const customCount = steps.filter((s) => !['services', 'staff', 'datetime'].includes(s.type)).length
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#cfdcfb] dark:border-blue-900/60 bg-[#f5f8ff] dark:bg-blue-950/20 p-4">
        <p className="flex items-center gap-2 text-[15px] font-bold text-[#0E1B3D] dark:text-white"><Sparkles size={17} className="text-[#1D5BEA]" /> Write with AI</p>
        <p className="text-[13px] text-[#4a5672] dark:text-slate-300 mt-0.5">Say how customers should book, in your own words. The AI drafts the steps; you check and save.</p>
        <textarea className={`${input} h-20 py-2.5 mt-2.5`} value={describe} maxLength={1500} onChange={(e) => setDescribe(e.target.value)}
          placeholder="Ask if it is their first visit, then services, then any allergies (typed), then who, then day and time. Tell them to come 10 minutes early." />
        {aiNote && <p className={`mt-2 text-[13px] font-semibold ${aiNote.tone === 'error' ? 'text-[#b91c1c]' : 'text-[#0E1B3D] dark:text-white'}`}>{aiNote.text}</p>}
        <div className="mt-2.5 flex justify-end">
          <button type="button" onClick={draft} disabled={drafting || describe.trim().length < 10} className={primaryButton}>{drafting ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />} {drafting ? 'Drafting…' : 'Draft my flow'}</button>
        </div>
      </div>

      <ol className="space-y-2.5">
        {steps.map((step, index) => {
          const Icon = ICONS[step.type]
          const last = index === steps.length - 1
          return (
            <li key={step.id} className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 bg-white dark:bg-[#111b21] p-3.5">
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 shrink-0 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-slate-100 flex items-center justify-center"><Icon size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-[#0E1B3D] dark:text-white"><span className="text-[#8a94a8] mr-1">{index + 1}.</span>{STEP_NAMES[step.type]}</p>
                  <p className="text-[12.5px] text-[#6B7894]">{HINTS[step.type]}</p>
                </div>
                <div className="flex shrink-0">
                  {step.type !== 'datetime' && (
                    <>
                      <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" className="h-8 w-8 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><ArrowUp size={16} /></button>
                      <button type="button" onClick={() => move(index, 1)} disabled={index >= steps.length - 2} aria-label="Move down" className="h-8 w-8 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><ArrowDown size={16} /></button>
                    </>
                  )}
                  {!FIXED.includes(step.type) && <button type="button" onClick={() => remove(index)} aria-label="Remove step" className="h-8 w-8 rounded-lg flex items-center justify-center text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer"><Trash2 size={16} /></button>}
                </div>
              </div>
              {(step.type === 'choice' || step.type === 'text') && (
                <div className="mt-3 grid gap-2.5 @xl:grid-cols-[minmax(0,1fr)_180px]">
                  <input className={input} value={step.text || ''} maxLength={300} onChange={(e) => update(index, { text: e.target.value })} placeholder={step.type === 'choice' ? 'Is this your first visit?' : 'Any allergies we should know about?'} aria-label="Question" />
                  <input className={input} value={step.label || ''} maxLength={30} onChange={(e) => update(index, { label: e.target.value })} placeholder="Saved as, like Allergies" aria-label="Saved on the booking as" />
                </div>
              )}
              {step.type === 'choice' && <div className="mt-2.5"><OptionsEditor options={step.options || []} onChange={(options) => update(index, { options })} /></div>}
              {step.type === 'message' && (
                <textarea className={`${input} h-16 py-2.5 mt-3`} value={step.text || ''} maxLength={600} onChange={(e) => update(index, { text: e.target.value })} placeholder="Please come 10 minutes early." aria-label="Message" />
              )}
              {DEFAULT_QUESTION[step.type] && (
                <input className={`${input} mt-3`} value={step.text || ''} maxLength={300} onChange={(e) => update(index, { text: e.target.value })}
                  placeholder={`${DEFAULT_QUESTION[step.type]} (the usual words)`} aria-label="Your own words for this step" />
              )}
              {step.type === 'image' && (
                <div className="mt-3 space-y-2.5">
                  <div className="flex gap-2.5 items-start">
                    {step.url ? <img src={step.url} alt="" className="h-20 w-20 rounded-xl object-cover border border-[#e3e8f2] shrink-0" /> : <span className="h-20 w-20 rounded-xl bg-[#f4f6fa] flex items-center justify-center text-[#8a94a8] shrink-0"><ImagePlus size={22} /></span>}
                    <div className="flex-1 min-w-0 space-y-2">
                      <label className={`${secondaryButton} cursor-pointer w-fit`}>
                        {uploading === step.id ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {step.url ? 'Change photo' : 'Upload a photo'}
                        <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(index, f); e.target.value = '' }} />
                      </label>
                      <input className={input} value={step.url || ''} onChange={(e) => update(index, { url: e.target.value.trim() })} placeholder="or paste a link: https://…jpg" aria-label="Photo link" />
                    </div>
                  </div>
                  <textarea className={`${input} h-14 py-2.5`} value={step.text || ''} maxLength={600} onChange={(e) => update(index, { text: e.target.value })} placeholder="Caption, like: 20% off on facials this week" aria-label="Caption" />
                </div>
              )}
              {step.type === 'link' && (
                <div className="mt-3 grid gap-2.5 @xl:grid-cols-[minmax(0,1fr)_180px]">
                  <textarea className={`${input} h-14 py-2.5 @xl:col-span-2`} value={step.text || ''} maxLength={600} onChange={(e) => update(index, { text: e.target.value })} placeholder="See all our prices before you choose." aria-label="Words above the button" />
                  <input className={input} value={step.url || ''} onChange={(e) => update(index, { url: e.target.value.trim() })} placeholder="https://… (menu, prices, Instagram)" aria-label="Link" />
                  <input className={input} value={step.button || ''} maxLength={20} onChange={(e) => update(index, { button: e.target.value })} placeholder="Button, like See prices" aria-label="Button words" />
                </div>
              )}
              {step.type === 'location' && (
                <div className="mt-3 grid gap-2.5 @xl:grid-cols-2">
                  <input className={input} value={step.name || ''} maxLength={60} onChange={(e) => update(index, { name: e.target.value })} placeholder="Place name, like Glow Salon" aria-label="Place name" />
                  <input className={input} value={step.address || ''} maxLength={200} onChange={(e) => update(index, { address: e.target.value })} placeholder="Address" aria-label="Address" />
                  <input className={`${input} @xl:col-span-2`} value={step.url || ''} onChange={(e) => { const url = e.target.value.trim(); update(index, { url, latitude: undefined, longitude: undefined, ...(mapsCoordinates(url) || {}) }) }}
                    placeholder="Google Maps link (open your shop in Maps, Share, Copy link)" aria-label="Google Maps link" />
                  <p className="@xl:col-span-2 text-[12.5px] text-[#6B7894]">
                    {typeof step.latitude === 'number' ? 'Sent as a map pin.' : 'Sent as your address with an "Open map" button. A Google Maps link with the place in it sends a map pin instead.'}
                    {address && step.address !== address && <button type="button" onClick={() => update(index, { address, name: step.name || business })} className="ml-1.5 font-semibold text-[#1D5BEA] cursor-pointer">Use my business address</button>}
                  </p>
                </div>
              )}
              {stepProblem(step) && step.type !== 'choice' && <p className="mt-1.5 text-[12.5px] font-semibold text-[#b91c1c]">Needs {stepProblem(step)}.</p>}
              {last && null}
            </li>
          )
        })}
      </ol>

      {steps.length < MAX_STEPS ? (
        <div>
          <p className="text-[13px] font-semibold text-[#4a5672] dark:text-slate-300 mb-1.5">Add a step {customCount ? '' : '(before day and time)'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => add('choice')} className={secondaryButton}><MousePointerClick size={16} /> Question with buttons</button>
            <button type="button" onClick={() => add('text')} className={secondaryButton}><TextCursorInput size={16} /> Typed answer</button>
            <button type="button" onClick={() => add('message')} className={secondaryButton}><MessageSquareText size={16} /> Message</button>
            <button type="button" onClick={() => add('location')} className={secondaryButton}><MapPin size={16} /> Location</button>
            <button type="button" onClick={() => add('image')} className={secondaryButton}><ImagePlus size={16} /> Photo</button>
            <button type="button" onClick={() => add('link')} className={secondaryButton}><Link2 size={16} /> Link button</button>
            {!steps.some((s) => s.type === 'staff') && <button type="button" onClick={() => add('staff')} className={secondaryButton}><UserRound size={16} /> Pick who</button>}
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-[#6B7894]">A flow can have up to {MAX_STEPS} steps.</p>
      )}
    </div>
  )
}

// ── The customer's view ──

function Bubble({ mine, children }: { mine?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,0.08)] whitespace-pre-line ${mine ? 'bg-[#d9fdd3] text-[#111b21] rounded-br-sm' : 'bg-white text-[#111b21] rounded-bl-sm'}`}>{children}</div>
    </div>
  )
}

function Media({ image, caption, place, link }: { image?: string; caption?: string; place?: { name?: string; address?: string; pin: boolean }; link?: { text: string; button: string } }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-xl rounded-bl-sm bg-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] overflow-hidden">
        {image !== undefined && (image ? <img src={image} alt="" className="w-full max-h-48 object-cover" /> : <div className="h-28 bg-[#eef1f6] flex items-center justify-center text-[#8a94a8]"><ImagePlus size={24} /></div>)}
        {place?.pin && <div className="h-24 bg-[#e3e8f2] flex items-center justify-center text-[#b91c1c]"><MapPin size={28} /></div>}
        {(caption || place || link) && (
          <p className="px-3 pt-2 pb-2 text-[13px] leading-snug text-[#111b21] whitespace-pre-line">
            {place ? <><span className="font-semibold">{place.name || 'Location'}</span>{place.address ? `\n${place.address}` : ''}</> : link ? link.text : caption}
          </p>
        )}
        {place && !place.pin && <p className="border-t border-[#eef1f6] py-2 text-center text-[13px] font-semibold text-[#027eb5] flex items-center justify-center gap-1"><ExternalLink size={13} /> Open map</p>}
        {link && <p className="border-t border-[#eef1f6] py-2 text-center text-[13px] font-semibold text-[#027eb5] flex items-center justify-center gap-1"><ExternalLink size={13} /> {link.button}</p>}
      </div>
    </div>
  )
}

function Choices({ text, button, rows, buttons }: { text: string; button?: string; rows?: { title: string; note?: string }[]; buttons?: string[] }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-xl rounded-bl-sm bg-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] overflow-hidden">
        <p className="px-3 pt-2 pb-2 text-[13px] leading-snug text-[#111b21] whitespace-pre-line">{text}</p>
        {buttons?.map((b) => <p key={b} className="border-t border-[#eef1f6] py-2 text-center text-[13px] font-semibold text-[#027eb5]">↩ {b}</p>)}
        {rows && (
          <>
            <p className="border-t border-[#eef1f6] py-2 text-center text-[13px] font-semibold text-[#027eb5]">☰ {button}</p>
            <ul className="border-t border-[#eef1f6] bg-[#f8fafc]">
              {rows.map((r) => (
                <li key={r.title} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[#eef1f6] last:border-0">
                  <span className="min-w-0"><span className="block text-[12.5px] font-semibold text-[#111b21] truncate">{r.title}</span>{r.note && <span className="block text-[11px] text-[#6B7894] truncate">{r.note}</span>}</span>
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#8a94a8]" />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

export function StepsPreview({ steps, welcome, trigger, services, staff, multiSelect, autoApprove, business }: {
  steps: FlowStep[]
  welcome: string
  trigger: string
  services: Service[]
  staff: StaffMember[]
  multiSelect: boolean
  autoApprove: boolean
  business: string
}) {
  const first = services[0]
  const second = services[1]
  const picked = multiSelect && second ? `${first?.name}, ${second.name}` : first?.name || 'Haircut'
  const out: React.ReactNode[] = [<Bubble key="t" mine>{trigger.replace(/^./, (c) => c.toUpperCase())}</Bubble>]
  const fill = (text: string) => text.replaceAll('{name}', 'Priya').replaceAll('{business}', business).replaceAll('{service}', picked)
  const ask = (step: FlowStep) => fill(step.text?.trim() || DEFAULT_QUESTION[step.type] || '')
  steps.forEach((step, i) => {
    const intro = i === 0 ? `${welcome}\n\n` : ''
    if (i === 0 && ['image', 'link', 'location'].includes(step.type)) out.push(<Bubble key={`${step.id}w`}>{welcome}</Bubble>)
    const introNoRepeat = (text: string) => (i === 0 && welcome.trim().endsWith('?') && step.type === 'services' ? welcome : `${intro}${text}`)
    if (step.type === 'services') {
      out.push(<Choices key={step.id} text={introNoRepeat(ask(step))} button="Choose a service" rows={services.slice(0, 3).map((s) => ({ title: s.name, note: `${formatRupees(Number(s.price))} · ${s.duration_minutes} min` }))} />)
      out.push(<Bubble key={`${step.id}a`} mine>{first?.name || 'Haircut'}</Bubble>)
      if (multiSelect && second) {
        out.push(<Choices key={`${step.id}b`} text={`Added: ${first!.name}.\nSo far: ${first!.name} · ${formatRupees(Number(first!.price))}, about ${first!.duration_minutes} min.\n\nWould you like another service?`} buttons={['Add another', steps[i + 1]?.type === 'datetime' ? 'Choose a day' : 'Continue']} />)
        out.push(<Bubble key={`${step.id}c`} mine>Add another</Bubble>)
        out.push(<Bubble key={`${step.id}d`} mine>{second.name}</Bubble>)
        out.push(<Bubble key={`${step.id}e`} mine>{steps[i + 1]?.type === 'datetime' ? 'Choose a day' : 'Continue'}</Bubble>)
      }
    } else if (step.type === 'staff') {
      out.push(<Choices key={step.id} text={`${intro}${ask(step)}`} button="Choose who" rows={[{ title: 'Anyone free' }, ...staff.filter((m) => m.active).slice(0, 2).map((m) => ({ title: m.name }))]} />)
      out.push(<Bubble key={`${step.id}a`} mine>Anyone free</Bubble>)
    } else if (step.type === 'choice') {
      const options = (step.options || []).length ? step.options! : ['Answer 1', 'Answer 2']
      out.push(options.length <= 3
        ? <Choices key={step.id} text={`${intro}${fill(step.text || 'Your question')}`} buttons={options} />
        : <Choices key={step.id} text={`${intro}${fill(step.text || 'Your question')}`} button="Choose" rows={options.slice(0, 4).map((o) => ({ title: o }))} />)
      out.push(<Bubble key={`${step.id}a`} mine>{options[0]}</Bubble>)
    } else if (step.type === 'text') {
      out.push(<Bubble key={step.id}>{`${intro}${fill(step.text || 'Your question')}\n(Type your answer, or "cancel" to stop.)`}</Bubble>)
      out.push(<Bubble key={`${step.id}a`} mine>…</Bubble>)
    } else if (step.type === 'message') {
      out.push(<Bubble key={step.id}>{`${intro}${fill(step.text || 'Your message')}`}</Bubble>)
    } else if (step.type === 'image') {
      out.push(<Media key={step.id} image={step.url || ''} caption={fill(step.text || '')} />)
    } else if (step.type === 'link') {
      out.push(<Media key={step.id} link={{ text: fill(step.text || 'Your words'), button: step.button || 'Open' }} />)
    } else if (step.type === 'location') {
      if (step.text) out.push(<Bubble key={`${step.id}t`}>{fill(step.text)}</Bubble>)
      out.push(<Media key={step.id} place={{ name: step.name, address: step.address, pin: typeof step.latitude === 'number' }} />)
    } else {
      out.push(<Choices key={step.id} text={`${intro}${ask(step)}`} button="Choose a day" rows={[{ title: 'Today', note: 'Only days with free times' }, { title: 'Tomorrow' }, { title: 'Wed, 11 Nov' }]} />)
      out.push(<Bubble key={`${step.id}a`} mine>Tomorrow</Bubble>)
      out.push(<Choices key={`${step.id}b`} text={`${picked} on Tomorrow: tap "Choose a time" to pick one.`} button="Choose a time" rows={[{ title: '10:00 am' }, { title: '10:30 am' }, { title: '11:30 am' }]} />)
      out.push(<Bubble key={`${step.id}c`} mine>10:30 am</Bubble>)
      out.push(<Bubble key={`${step.id}d`}>{autoApprove ? `Confirmed! ${picked} at ${business}, Tomorrow at 10:30 am. See you soon! ✨` : `Thank you! We have your request for ${picked} on Tomorrow at 10:30 am. We will confirm it shortly.`}</Bubble>)
    }
  })
  return <>{out}</>
}
