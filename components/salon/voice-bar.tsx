'use client'

/**
 * The voice bar at the top of the counter. Tap the mic and say what to do, in English, Hindi,
 * Telugu or a mix. The counter shows (and reads out) what it understood; one tap on Confirm, or a
 * spoken "yes" / "haan" / "avunu", does it. Anything unclear comes back as buttons to tap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Keyboard, Loader2, Mic, Pencil, Square, Volume2, VolumeX, X } from 'lucide-react'
import { formatRupees } from '@/lib/salon/invoice'
import { bookingSlots, formatIstDay, formatIstTime, fromIst, istDate } from '@/lib/salon/spoken'
import { applyEdit, draftToAction, isReady, REPLIES, type DraftEdit, type VoiceContext, type VoiceDraft } from '@/lib/salon/voice'
import { authSessionManager } from '@/lib/auth-context'
import { api, card, Chip, input, primaryButton, secondaryButton } from './ui'
import type { CounterHandle } from './salon-counter'
import type { Appointment, SalonSetup } from './types'

type Phase = 'idle' | 'listening' | 'thinking' | 'acting'

const MAX_SECONDS = 20
/** Stop by itself after this much quiet once speech has started */
const SILENCE_MS = 1600

const TITLES: Record<VoiceDraft['intent'], string> = {
  book: 'Book an appointment', arrived: 'Customer arrived', start: 'Start service', bill: 'Bill', walk_in: 'Walk-in bill',
  cancel: 'Cancel appointment', no_show: 'Did not come', summary: 'Today so far', unknown: 'Not understood',
}
const PAY_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card' } as const
const confirmButton = 'inline-flex items-center justify-center gap-2 h-12 px-5 sm:min-w-[200px] rounded-xl bg-[#00A884] hover:bg-[#008f70] text-white text-[16px] font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const EXAMPLES = ['Book Priya for haircut at 5', 'Priya vachindi', 'Ravi ka bill banao, UPI', 'Walk-in beard trim, cash', 'Aaj kitna collection?']

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    try { if (MediaRecorder.isTypeSupported(type)) return type } catch {}
  }
  return ''
}

function speak(text: string, enabled: boolean) {
  if (!enabled || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/₹/g, 'rupees '))
    // Replies are in English letters (Hinglish and Tenglish too), which an Indian English voice reads best
    utterance.lang = 'en-IN'
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang === 'en-IN') || window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('en'))
    if (voice) utterance.voice = voice
    utterance.rate = 1.02
    window.speechSynthesis.speak(utterance)
  } catch {}
}

export function VoiceBar({ orgId, setup, handle }: { orgId: string; setup: SalonSetup; handle: CounterHandle }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [draft, setDraft] = useState<VoiceDraft | null>(null)
  const [answer, setAnswer] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [heard, setHeard] = useState('')
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [canRecord, setCanRecord] = useState(true)
  const [muted, setMuted] = useState(false)
  /** Today's appointments as the server saw them with the last draft (the board may show another day) */
  const [todays, setTodays] = useState<Appointment[] | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stopTimers = useRef<() => void>(() => {})
  const draftRef = useRef<VoiceDraft | null>(null)
  draftRef.current = draft

  const replies = setup.settings.voice_replies !== false && !muted

  useEffect(() => {
    setCanRecord(typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined')
    try { setMuted(window.localStorage.getItem('salon-voice-muted') === '1') } catch {}
    // Some browsers load their voices late
    try { window.speechSynthesis?.getVoices() } catch {}
    return () => { stopTimers.current(); try { recorder.current?.stop() } catch {} }
  }, [])

  const context = useCallback((): VoiceContext => ({
    now: Date.now(),
    services: setup.services,
    staff: setup.staff,
    appointments: todays || handle.appointments,
    settings: { gstin: setup.settings.gstin, prices_include_tax: setup.settings.prices_include_tax },
  }), [setup, todays, handle.appointments])

  function show(next: VoiceDraft | null, say = true) {
    setDraft(next)
    if (next && say) speak(next.speech, replies)
  }

  function tell(text: string, tone: 'info' | 'error' = 'info') {
    setAnswer({ text, tone })
    if (tone === 'info') speak(text, replies)
  }

  // ── Doing it ───────────────────────────────────────────────────────────────

  async function confirm(current = draftRef.current) {
    if (!current) return
    const action = draftToAction(current)
    if (!action) { tell(REPLIES.notReady[current.language], 'info'); return }
    setPhase('acting')
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action }) })
      setDraft(null)
      setAnswer(null)
      setHeard('')
      handle.afterAction(result, current.intent === 'book')
      speak(`${REPLIES.done[current.language]}${result.message ? ` ${result.message.replace(/\s*·\s*/g, ', ')}` : ''}`, replies)
    } catch (err: any) {
      tell(err.message, 'error')
    } finally {
      setPhase('idle')
    }
  }

  function change() {
    const current = draftRef.current
    if (!current) return
    const customer = current.customer && current.customer.name !== 'Walk-in customer' ? current.customer : null
    const booking = { contact_id: customer?.contact_id, name: customer?.name || '', phone: customer?.phone || '', service_ids: current.service_ids, staff_id: current.staff_id, date: current.date || undefined, time: current.missing.includes('time') ? undefined : current.time || undefined }
    if (current.intent === 'book') handle.openBooking(booking)
    else if (current.intent === 'walk_in') handle.openWalkIn(booking)
    else if (current.intent === 'bill') {
      const appointment = (todays || handle.appointments).find((a) => a.id === current.appointment_id)
      if (!appointment) return
      handle.openBill(appointment, { extra_service_ids: current.service_ids, discount: current.discount, payment_method: current.payment_method })
    }
    setDraft(null)
    setAnswer(null)
  }

  function dismiss(say = false) {
    const current = draftRef.current
    setDraft(null)
    setAnswer(null)
    setHeard('')
    if (say && current) speak(REPLIES.cancelled[current.language], replies)
  }

  function edit(change: DraftEdit) {
    const current = draftRef.current
    if (!current) return
    const next = applyEdit(current, change, context())
    // Once everything is chosen, say the confirmation; otherwise just update the card
    show(next, isReady(next) && !isReady(current))
  }

  // ── Understanding ──────────────────────────────────────────────────────────

  async function understand(send: () => Promise<any>) {
    setPhase('thinking')
    setAnswer(null)
    try {
      const result = await send()
      if (result.kind === 'empty') { tell(REPLIES.nothingHeard[draftRef.current?.language || 'en'], 'info'); return }
      setHeard(result.transcript || '')
      if (result.kind === 'confirm') { await confirm(); return }
      if (result.kind === 'reject') { dismiss(true); return }
      const next: VoiceDraft = result.draft
      if (Array.isArray(result.appointments)) setTodays(result.appointments)
      if (next.intent === 'summary' || next.intent === 'unknown') { setDraft(null); tell(next.speech, 'info'); return }
      // Commands about appointments are about today: show today's board alongside
      if (next.intent !== 'book' && next.intent !== 'walk_in') handle.goToday()
      show(next)
    } catch (err: any) {
      tell(err.message || 'That could not be understood. Please try again.', 'error')
    } finally {
      setPhase((current) => (current === 'thinking' ? 'idle' : current))
    }
  }

  async function sendAudio(blob: Blob) {
    const form = new FormData()
    form.append('audio', blob, 'counter')
    form.append('organizationId', orgId)
    if (draftRef.current) form.append('pending', '1')
    await understand(async () => {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch('/api/salon/voice', { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}). Please try again.`)
      return data
    })
  }

  async function sendTyped() {
    const text = typed.trim()
    if (!text) return
    setTyped('')
    await understand(() => api('/api/salon/voice', { method: 'POST', body: JSON.stringify({ organizationId: orgId, transcript: text, pending: Boolean(draftRef.current) }) }))
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  async function startListening() {
    setAnswer(null)
    try { window.speechSynthesis?.cancel() } catch {}
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err: any) {
      const blocked = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      tell(blocked ? 'The microphone is blocked. Allow it for this site in the browser (the icon next to the address), or type the command.' : 'No microphone was found. Connect one, or type the command.', 'error')
      setTyping(true)
      return
    }
    const mimeType = pickMimeType()
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorder.current = rec
    rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }

    // Level meter and stopping by itself after a pause
    let audioContext: AudioContext | null = null
    let frame = 0
    const started = Date.now()
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      audioContext = new AudioCtx()
      audioContext.resume().catch(() => {})
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      audioContext.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      let spoke = false
      let quietSince = 0
      const tick = () => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2
        const rms = Math.sqrt(sum / samples.length)
        setLevel(Math.min(1, rms * 6))
        const now = Date.now()
        if (rms > 0.04) { spoke = true; quietSince = 0 } else if (spoke) quietSince ||= now
        if (spoke && quietSince && now - quietSince > SILENCE_MS && now - started > 1200) { stop(); return }
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    } catch {}
    const clock = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000)
      setSeconds(elapsed)
      if (elapsed >= MAX_SECONDS) stop()
    }, 250)

    function stop() {
      if (rec.state !== 'inactive') rec.stop()
    }
    stopTimers.current = () => {
      cancelAnimationFrame(frame)
      window.clearInterval(clock)
      audioContext?.close().catch(() => {})
      stream.getTracks().forEach((track) => track.stop())
    }
    rec.onstop = () => {
      stopTimers.current()
      setLevel(0)
      setSeconds(0)
      recorder.current = null
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })
      if (blob.size < 1200 || Date.now() - started < 500) { setPhase('idle'); tell(REPLIES.nothingHeard[draftRef.current?.language || 'en'], 'info'); return }
      sendAudio(blob)
    }
    rec.start(250)
    setPhase('listening')
  }

  function stopListening() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    try { window.localStorage.setItem('salon-voice-muted', next ? '1' : '0') } catch {}
    if (next) try { window.speechSynthesis?.cancel() } catch {}
  }

  // Space bar starts and stops the mic (when not typing in a field)
  useEffect(() => {
    if (!canRecord) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      if (phase === 'listening') stopListening()
      else if (phase === 'idle') startListening()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const status = phase === 'listening' ? `Listening… ${seconds ? `${seconds}s · ` : ''}tap to stop`
    : phase === 'thinking' ? 'Understanding…'
    : phase === 'acting' ? 'Doing it…'
    : draft ? 'Say "yes" or "no"'
    : 'Tap and speak'

  return (
    <section aria-label="Voice" className={`${card} p-4 sm:p-5`}>
      <div className="flex items-center gap-4">
        {canRecord ? (
          <button type="button" onClick={phase === 'listening' ? stopListening : startListening} disabled={phase === 'thinking' || phase === 'acting'}
            aria-label={phase === 'listening' ? 'Stop listening' : 'Speak a command'}
            className={`relative shrink-0 h-16 w-16 sm:h-[68px] sm:w-[68px] rounded-full flex items-center justify-center text-white shadow-lg transition-colors cursor-pointer disabled:cursor-wait ${phase === 'listening' ? 'bg-[#e11d48]' : 'bg-[#1D5BEA] hover:bg-[#174bc4]'} disabled:opacity-70`}>
            {phase === 'listening' && <span aria-hidden className="absolute inset-0 rounded-full bg-[#e11d48]/30" style={{ transform: `scale(${1.08 + level * 0.45})`, transition: 'transform 80ms linear' }} />}
            {phase === 'thinking' || phase === 'acting' ? <Loader2 size={28} className="animate-spin relative" /> : phase === 'listening' ? <Square size={24} className="relative" fill="currentColor" /> : <Mic size={30} className="relative" />}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[17px] sm:text-[18px] font-extrabold text-[#0E1B3D] dark:text-white" aria-live="polite">{canRecord ? status : 'Type what to do'}</p>
          <p className="text-[13.5px] text-[#6B7894] mt-0.5 line-clamp-2">
            {phase === 'idle' && !draft ? <>English, Hindi or Telugu · e.g. “{EXAMPLES[new Date().getMinutes() % EXAMPLES.length]}”</> : heard ? <>You said: “{heard}”</> : draft ? 'or a new command' : 'Book, arrived, start, bill, walk-in, cancel'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {setup.settings.voice_replies !== false && (
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Read replies aloud' : 'Stop reading replies aloud'} title={muted ? 'Replies are silent' : 'Replies are read aloud'}
              className="h-10 w-10 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800 cursor-pointer">{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
          )}
          {canRecord && (
            <button type="button" onClick={() => setTyping(!typing)} aria-label="Type a command" aria-pressed={typing}
              className={`h-10 w-10 rounded-lg flex items-center justify-center cursor-pointer ${typing ? 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40' : 'text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800'}`}><Keyboard size={19} /></button>
          )}
        </div>
      </div>

      {(typing || !canRecord) && (
        <form className="flex gap-2 mt-4" onSubmit={(event) => { event.preventDefault(); sendTyped() }}>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="e.g. book Priya 9876543210 facial tomorrow 11" aria-label="Command" className={input} maxLength={300} />
          <button type="submit" disabled={!typed.trim() || phase !== 'idle'} className={`${primaryButton} shrink-0`}>Go</button>
        </form>
      )}

      {answer && !draft && (
        <div role={answer.tone === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-[15px] font-medium ${answer.tone === 'error' ? 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/30 dark:text-red-300' : 'bg-[#eef3fe] text-[#0E1B3D] dark:bg-blue-950/30 dark:text-blue-100'}`}>
          <span>{answer.text}</span>
          <button type="button" onClick={() => setAnswer(null)} aria-label="Dismiss" className="shrink-0 -mr-1 h-7 w-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 cursor-pointer"><X size={16} /></button>
        </div>
      )}

      {draft && <DraftCard draft={draft} setup={setup} appointments={todays || handle.appointments} busy={phase === 'acting'} answer={answer}
        onEdit={edit} onConfirm={() => confirm()} onChange={change} onCancel={() => dismiss(false)} />}
    </section>
  )
}

// ── "What I understood" ────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2">
      <span className="sm:w-28 shrink-0 text-[13px] font-bold uppercase tracking-wide text-[#6B7894] sm:pt-2">{label}</span>
      <div className="flex flex-wrap gap-2 min-w-0">{children}</div>
    </div>
  )
}

const Missing = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center min-h-10 px-3 rounded-xl border border-dashed border-[#f0b4b4] text-[#b91c1c] dark:text-red-300 text-[14.5px] font-semibold">{children}</span>
const Value = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center min-h-10 px-3.5 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white text-[15px] font-semibold">{children}</span>

function DraftCard({ draft, setup, appointments, busy, answer, onEdit, onConfirm, onChange, onCancel }: {
  draft: VoiceDraft
  setup: SalonSetup
  appointments: Appointment[]
  busy: boolean
  answer: { text: string; tone: 'info' | 'error' } | null
  onEdit: (edit: DraftEdit) => void
  onConfirm: () => void
  onChange: () => void
  onCancel: () => void
}) {
  const ready = isReady(draft)
  const today = istDate()
  const appointment = appointments.find((a) => a.id === draft.appointment_id)
  const services = setup.services.filter((s) => draft.service_ids.includes(s.id))
  const staff = setup.staff.find((s) => s.id === draft.staff_id)
  const openFor: Record<string, string[]> = { arrived: ['booked'], start: ['booked', 'arrived'], bill: ['booked', 'arrived', 'in_service'], cancel: ['booked', 'arrived'], no_show: ['booked'] }
  const pickable = openFor[draft.intent] ? appointments.filter((a) => openFor[draft.intent].includes(a.status)) : []
  const slots = useMemo(() => (draft.missing.includes('time') ? bookingSlots(draft.date || today, Date.now()) : []), [draft.missing, draft.date, today])
  const showsCustomer = draft.intent === 'book' || draft.intent === 'walk_in'
  const showsServices = draft.intent === 'book' || draft.intent === 'walk_in' || (draft.intent === 'bill' && services.length > 0)
  const showsPayment = draft.intent === 'bill' || draft.intent === 'walk_in'
  const canChange = draft.intent === 'book' || draft.intent === 'walk_in' || (draft.intent === 'bill' && Boolean(appointment))

  return (
    <div className="mt-4 rounded-2xl border-2 border-[#1D5BEA]/25 bg-[#fbfcff] dark:bg-[#0b141a] p-4 sm:p-5">
      <div className="text-[12.5px] font-bold uppercase tracking-wide text-[#1D5BEA]">What I understood · {TITLES[draft.intent]}</div>
      <p className="text-[20px] sm:text-[22px] font-extrabold text-[#0E1B3D] dark:text-white mt-1 leading-snug">{draft.speech}</p>

      <div className="mt-3 divide-y divide-[#eef1f6] dark:divide-slate-800">
        {(appointment || draft.choices.appointments?.length || draft.missing.includes('appointment')) && (
          <Row label="Appointment">
            {appointment && <Value>{formatIstTime(appointment.starts_at)} · {appointment.customer_name} · {appointment.services.map((s) => s.name).join(', ')}</Value>}
            {draft.choices.appointments?.map((choice) => <Chip key={choice.id} onClick={() => onEdit({ kind: 'appointment', id: choice.id })}>{choice.label}</Chip>)}
            {draft.missing.includes('appointment') && (pickable.length
              ? pickable.map((a) => <Chip key={a.id} onClick={() => onEdit({ kind: 'appointment', id: a.id })}>{formatIstTime(a.starts_at)} · {a.customer_name}</Chip>)
              : <Missing>No open appointment today</Missing>)}
          </Row>
        )}

        {showsCustomer && (
          <Row label="Customer">
            {draft.customer ? <Value>{draft.customer.name || 'Customer'}{draft.customer.phone ? ` · ${draft.customer.phone}` : ''}{draft.customer.contact_id ? ' · saved' : ''}</Value> : <Missing>Say the name or number</Missing>}
            {draft.choices.customers?.length ? <>
              {draft.choices.customers.map((choice) => <Chip key={choice.id} onClick={() => onEdit({ kind: 'customer', id: choice.id, name: choice.name })}>{choice.label}</Chip>)}
              <Chip onClick={() => onEdit({ kind: 'customer', id: 'new' })}>New customer</Chip>
            </> : null}
          </Row>
        )}

        {showsServices && (
          <Row label={draft.intent === 'bill' ? 'Add' : 'Services'}>
            {services.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 min-h-10 pl-3.5 pr-1.5 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white text-[15px] font-semibold">
                {s.name} <span className="font-normal opacity-70">{formatRupees(Number(s.price))}</span>
                <button type="button" onClick={() => onEdit({ kind: 'remove_service', id: s.id })} aria-label={`Remove ${s.name}`} className="h-7 w-7 rounded-md flex items-center justify-center text-[#6B7894] hover:bg-white dark:hover:bg-slate-700 cursor-pointer"><X size={15} /></button>
              </span>
            ))}
            {draft.choices.services?.map((group) => group.options.map((option) => (
              <Chip key={`${group.spoken}-${option.id}`} onClick={() => onEdit({ kind: 'service', id: option.id, spoken: group.spoken })}>{option.label}?</Chip>
            )))}
            {draft.missing.includes('services') && setup.services.filter((s) => s.active).map((s) => (
              <Chip key={s.id} onClick={() => onEdit({ kind: 'service', id: s.id })}>{s.name}</Chip>
            ))}
            {draft.unknown_services.length > 0 && <span className="self-center text-[13.5px] text-[#b45309]">Not on your list: {draft.unknown_services.join(', ')}</span>}
          </Row>
        )}

        {(staff || draft.choices.staff?.length) && (draft.intent === 'book' || draft.intent === 'walk_in') ? (
          <Row label="With">
            {staff && <Value>{staff.name}</Value>}
            {draft.choices.staff?.map((choice) => <Chip key={choice.id} onClick={() => onEdit({ kind: 'staff', id: choice.id })}>{choice.label}?</Chip>)}
          </Row>
        ) : null}

        {draft.intent === 'book' && (
          <Row label="When">
            {draft.time && !draft.missing.includes('time') ? <Value>{formatIstDay(draft.date || today, today)} · {formatIstTime(fromIst(draft.date || today, draft.time) || new Date())}</Value> : <>
              <Missing>{formatIstDay(draft.date || today, today)}: pick a time</Missing>
              {slots.map((slot) => <Chip key={slot} onClick={() => onEdit({ kind: 'time', time: slot })}>{formatIstTime(fromIst(draft.date || today, slot) || new Date())}</Chip>)}
            </>}
          </Row>
        )}

        {showsPayment && (
          <Row label="Paid by">
            {(['cash', 'upi', 'card'] as const).map((method) => <Chip key={method} selected={draft.payment_method === method} onClick={() => onEdit({ kind: 'payment', method })}>{PAY_LABEL[method]}</Chip>)}
            <Chip selected={!draft.payment_method} onClick={() => onEdit({ kind: 'payment', method: null })}>Not paid yet</Chip>
          </Row>
        )}
        {showsPayment && draft.discount && (
          <Row label="Discount">
            <span className="inline-flex items-center gap-1.5 min-h-10 pl-3.5 pr-1.5 rounded-xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white text-[15px] font-semibold">
              {draft.discount.type === 'percent' ? `${draft.discount.value}% off` : `${formatRupees(draft.discount.value)} off`}
              <button type="button" onClick={() => onEdit({ kind: 'discount', discount: null })} aria-label="Remove discount" className="h-7 w-7 rounded-md flex items-center justify-center text-[#6B7894] hover:bg-white dark:hover:bg-slate-700 cursor-pointer"><X size={15} /></button>
            </span>
          </Row>
        )}
      </div>

      {answer && <div role={answer.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-xl px-4 py-3 text-[14.5px] font-medium ${answer.tone === 'error' ? 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/30 dark:text-red-300' : 'bg-[#eef3fe] text-[#0E1B3D] dark:bg-blue-950/30 dark:text-blue-100'}`}>{answer.text}</div>}

      <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryButton}><X size={17} /> Cancel</button>
        {canChange && <button type="button" onClick={onChange} disabled={busy} className={secondaryButton}><Pencil size={16} /> Change</button>}
        <button type="button" onClick={onConfirm} disabled={!ready || busy} className={confirmButton}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={19} />} {ready ? 'Yes, do it' : 'Pick what is missing'}
        </button>
      </div>
    </div>
  )
}
