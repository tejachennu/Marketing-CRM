/**
 * Voice at the salon counter: what was said becomes a draft action that the counter shows and reads
 * back for a tap (or a spoken "yes"). Nothing changes until it is confirmed.
 *
 * 1. Speech to text (OpenAI transcription), told the salon's service and staff names.
 * 2. Understanding (a small model, strict JSON): intent, customer, services, staff, day, time,
 *    payment, discount, in English, Hindi, Telugu or a mix.
 * 3. Resolution, here and testable: names are matched to the salon's own services, staff and today's
 *    appointments. Anything unclear comes back as choices to tap, never a guess.
 * 4. The confirmation is worded here in the speaker's language, from the resolved draft.
 */

import { computeInvoice, formatRupees, type Discount } from './invoice'
import { addDays, formatIstDay, formatIstTime, fromIst, istDate, istTime, matchByName, parseSpokenPhone } from './spoken'

export type VoiceIntent = 'book' | 'arrived' | 'start' | 'bill' | 'walk_in' | 'cancel' | 'no_show' | 'summary' | 'unknown'
export type Language = 'en' | 'hi' | 'te'

/** What the model returns. Fields it did not hear are null or empty. */
export interface ParsedCommand {
  intent: VoiceIntent
  customer_name: string | null
  customer_phone: string | null
  services: string[]
  staff_name: string | null
  date: string | null
  time: string | null
  appointment_time: string | null
  payment_method: 'cash' | 'upi' | 'card' | 'none'
  discount_percent: number | null
  discount_amount: number | null
  language: Language
}

export interface VoiceContext {
  now: number
  services: { id: string; name: string; category?: string; price: number | string; duration_minutes?: number; tax_rate: number | string; active: boolean }[]
  staff: { id: string; name: string; active: boolean }[]
  appointments: { id: string; customer_name: string; customer_phone?: string | null; contact_id?: string | null; starts_at: string; status: string; services: { service_id?: string | null; name: string; price: number | string; tax_rate: number | string }[] }[]
  /** Paid takings today, for the summary */
  collectedToday?: number
  settings?: { gstin?: string | null; prices_include_tax?: boolean }
  /** Contacts matching the spoken name, when one was said (looked up by the server) */
  contacts?: { id: string; name: string; phone: string | null }[]
}

export interface Choice {
  id: string
  label: string
  /** For a customer choice: the contact's full name */
  name?: string
}

export interface VoiceDraft {
  intent: VoiceIntent
  language: Language
  transcript: string
  customer: { contact_id: string | null; name: string; phone: string | null } | null
  /** The name as said, for wording ("I could not find Sita today") */
  said_name: string | null
  service_ids: string[]
  unknown_services: string[]
  staff_id: string | null
  date: string | null
  time: string | null
  appointment_id: string | null
  payment_method: 'cash' | 'upi' | 'card' | null
  discount: Discount | null
  /** What still has to be said or tapped before it can be confirmed */
  missing: ('customer' | 'services' | 'time' | 'appointment')[]
  choices: { appointments?: Choice[]; services?: { spoken: string; options: Choice[] }[]; staff?: Choice[]; customers?: Choice[] }
  /** The sentence shown and read back */
  speech: string
  summary?: { appointments: number; done: number; waiting: number; collected: number; next: string | null }
}

// ── Understanding ────────────────────────────────────────────────────────────

const NULLABLE = (type: string, description?: string) => ({ type: [type, 'null'], ...(description ? { description } : {}) })

/** JSON schema for the model's answer (OpenAI structured outputs, strict). */
export const COMMAND_SCHEMA = {
  name: 'salon_counter_command',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'customer_name', 'customer_phone', 'services', 'staff_name', 'date', 'time', 'appointment_time', 'payment_method', 'discount_percent', 'discount_amount', 'language'],
    properties: {
      intent: { type: 'string', enum: ['book', 'arrived', 'start', 'bill', 'walk_in', 'cancel', 'no_show', 'summary', 'unknown'] },
      customer_name: NULLABLE('string', 'The customer\'s name as said, in English letters'),
      customer_phone: NULLABLE('string', 'The phone number exactly as said, digits or words'),
      services: { type: 'array', items: { type: 'string' }, description: 'Each service, using the exact name from the list when it is one of them' },
      staff_name: NULLABLE('string'),
      date: NULLABLE('string', 'YYYY-MM-DD'),
      time: NULLABLE('string', 'HH:MM, 24-hour'),
      appointment_time: NULLABLE('string', 'HH:MM of the existing appointment being referred to, if said'),
      payment_method: { type: 'string', enum: ['cash', 'upi', 'card', 'none'] },
      discount_percent: NULLABLE('number'),
      discount_amount: NULLABLE('number', 'Rupees off'),
      language: { type: 'string', enum: ['en', 'hi', 'te'] },
    },
  },
}

export function commandSystemPrompt(context: VoiceContext): string {
  const today = istDate(context.now)
  const weekday = new Date(context.now).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })
  const services = context.services.filter((s) => s.active).map((s) => `- ${s.name}`).join('\n') || '- (none yet)'
  const staff = context.staff.filter((s) => s.active).map((s) => s.name).join(', ') || '(none yet)'
  const appointments = context.appointments
    .filter((a) => ['booked', 'arrived', 'in_service'].includes(a.status))
    .map((a) => `- ${formatIstTime(a.starts_at)} ${a.customer_name} (${a.status.replace('_', ' ')}): ${a.services.map((s) => s.name).join(', ')}`)
    .join('\n') || '- (none)'
  return `You turn what a salon receptionist in India says into a JSON command. They speak English, Hindi, Telugu, or a mix written in English letters (Hinglish, Tenglish).

Today is ${weekday}, ${today}. The time now is ${istTime(context.now)} (India).

Services (use these exact names):
${services}

Staff: ${staff}

Today's open appointments:
${appointments}

Intents:
- book: a new appointment for later ("book Priya for haircut at 5", "repu 11 ki facial booking", "kal 4 baje appointment").
- arrived: the customer has come ("Priya vachindi", "Priya aa gayi", "Priya is here").
- start: their service is starting ("start Priya", "Priya ki start cheyyi", "shuru karo").
- bill: finish and bill an existing appointment ("Priya ki bill cheyyi", "Priya ka bill banao", "Priya done, UPI").
- walk_in: bill someone with no appointment, now ("walk-in Ravi beard trim cash", "direct customer").
- cancel: cancel an appointment. no_show: they did not come.
- summary: a question about today ("how many appointments", "aaj kitna collection", "ivala enni").
- unknown: anything else.

Rules:
- Times: salons open about 9 am to 10 pm, so "5", "5 o'clock", "saayantram 5", "shaam 5" mean 17:00; "11" means 11:00; "half past 4" or "4:30" means 16:30.
- Days: today / aaj / ivala = ${today}; tomorrow / kal / repu = ${addDays(today, 1)}. A weekday means its next date. No day said means today.
- Phone: copy the number exactly as said (digits or number words). Do not invent one.
- Payment: GPay, PhonePe, Paytm and UPI mean upi. "none" when not said.
- Discount: "10% off" is discount_percent 10; "100 off" or "100 rupees discount" is discount_amount 100.
- For arrived, start, bill, cancel and no_show, customer_name is the person with the appointment, and appointment_time is its time if said.
- language: en, hi for Hindi or Hinglish, te for Telugu or Tenglish.`
}

/** Ask the model to understand a transcript. `ai` posts to the chat completions endpoint and returns the parsed JSON body. */
export async function understandCommand(transcript: string, context: VoiceContext, post: (body: unknown) => Promise<any>): Promise<ParsedCommand> {
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 300,
    response_format: { type: 'json_schema', json_schema: COMMAND_SCHEMA },
    messages: [{ role: 'system', content: commandSystemPrompt(context) }, { role: 'user', content: transcript }],
  }
  const data = await post(body)
  const content = data?.choices?.[0]?.message?.content
  let parsed: any
  try { parsed = JSON.parse(content || '{}') } catch { parsed = {} }
  return normalizeParsed(parsed)
}

export function normalizeParsed(raw: any): ParsedCommand {
  const intents: VoiceIntent[] = ['book', 'arrived', 'start', 'bill', 'walk_in', 'cancel', 'no_show', 'summary', 'unknown']
  const text = (value: any) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const number = (value: any) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null)
  return {
    intent: intents.includes(raw?.intent) ? raw.intent : 'unknown',
    customer_name: text(raw?.customer_name),
    customer_phone: text(raw?.customer_phone),
    services: Array.isArray(raw?.services) ? raw.services.map(text).filter(Boolean).slice(0, 10) as string[] : [],
    staff_name: text(raw?.staff_name),
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw?.date || '') ? raw.date : null,
    time: /^\d{1,2}:\d{2}$/.test(raw?.time || '') ? raw.time : null,
    appointment_time: /^\d{1,2}:\d{2}$/.test(raw?.appointment_time || '') ? raw.appointment_time : null,
    payment_method: ['cash', 'upi', 'card'].includes(raw?.payment_method) ? raw.payment_method : 'none',
    discount_percent: number(raw?.discount_percent),
    discount_amount: number(raw?.discount_amount),
    language: ['en', 'hi', 'te'].includes(raw?.language) ? raw.language : 'en',
  }
}

// ── "Yes" / "no" to a draft on screen ───────────────────────────────────────

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'confirm', 'confirmed', 'done', 'sure', 'correct', 'right', 'haan', 'haa', 'ha', 'han', 'ji', 'theek', 'thik', 'karo', 'kar', 'do', 'avunu', 'avnu', 'aunu', 'sare', 'saree', 'cheyyi', 'chey', 'cheyandi', 'go', 'ahead',
  // In Hindi and Telugu letters, when the transcript comes back in them
  'हाँ', 'हां', 'हा', 'जी', 'ठीक', 'करो', 'అవును', 'సరే', 'చేయి', 'చెయ్యి', 'ఓకే', 'ओके'])
const NO = new Set(['no', 'nope', 'nah', 'cancel', 'stop', 'wrong', 'leave', 'nahi', 'nahin', 'na', 'mat', 'chhodo', 'chodo', 'vaddu', 'ledu', 'kadu', 'kaadu', 'aapu', 'नहीं', 'नही', 'मत', 'रहने', 'వద్దు', 'లేదు', 'కాదు', 'ఆపు'])
/** Words that go with either answer ("theek hai", "cancel karo", "leave it", "avunu andi") */
const FILLER = new Set(['it', 'that', 'this', 'please', 'ji', 'hai', 'karo', 'kar', 'do', 'cheyyi', 'chey', 'andi', 'sir', 'madam', 'bhai', 'go', 'ahead', 'है', 'दो', 'करो', 'जी', 'दीजिए', 'అండి', 'చేయి', 'చెయ్యి'])

/**
 * A short "yes" or "no" while a draft is waiting; anything longer is a new command. "Cancel karo"
 * counts as no (drop the draft): a spoken word never confirms a cancellation by itself.
 */
export function yesOrNo(transcript: string): 'yes' | 'no' | null {
  const words = transcript.toLowerCase().replace(/[^\p{L}\p{M}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 4) return null
  if (words.some((word) => NO.has(word)) && words.every((word) => NO.has(word) || FILLER.has(word))) return 'no'
  if (words.some((word) => YES.has(word)) && words.every((word) => YES.has(word) || FILLER.has(word))) return 'yes'
  return null
}

// ── Resolution ───────────────────────────────────────────────────────────────

const OPEN_STATUSES: Record<string, string[]> = {
  arrived: ['booked'],
  start: ['booked', 'arrived'],
  bill: ['booked', 'arrived', 'in_service'],
  cancel: ['booked', 'arrived'],
  no_show: ['booked'],
}

/** Turn what the model heard into a draft built only from the salon's own records. */
export function resolveCommand(parsed: ParsedCommand, transcript: string, context: VoiceContext): VoiceDraft {
  const today = istDate(context.now)
  const draft: VoiceDraft = {
    intent: parsed.intent, language: parsed.language, transcript, customer: null, said_name: parsed.customer_name, service_ids: [], unknown_services: [], staff_id: null,
    date: null, time: null, appointment_id: null, payment_method: parsed.payment_method === 'none' ? null : parsed.payment_method,
    discount: parsed.discount_percent ? { type: 'percent', value: Math.min(100, parsed.discount_percent) } : parsed.discount_amount ? { type: 'amount', value: parsed.discount_amount } : null,
    missing: [], choices: {}, speech: '',
  }

  // Services and staff, for the intents that name them
  if (['book', 'walk_in', 'bill'].includes(parsed.intent)) {
    const active = context.services.filter((s) => s.active)
    const switchedOff = context.services.filter((s) => !s.active)
    for (const spoken of parsed.services) {
      // A service the salon has switched off is reported, not swapped for a similar one
      if (matchByName(spoken, switchedOff, (s) => s.name, 0.9).match) { draft.unknown_services.push(spoken); continue }
      const { match, choices } = matchByName(spoken, active, (s) => s.name)
      if (match) { if (!draft.service_ids.includes(match.id)) draft.service_ids.push(match.id) }
      else if (choices.length) (draft.choices.services ||= []).push({ spoken, options: choices.map((s) => ({ id: s.id, label: s.name })) })
      else draft.unknown_services.push(spoken)
    }
    if (parsed.staff_name) {
      const { match, choices } = matchByName(parsed.staff_name, context.staff.filter((s) => s.active), (s) => s.name)
      if (match) draft.staff_id = match.id
      else if (choices.length) draft.choices.staff = choices.map((s) => ({ id: s.id, label: s.name }))
    }
  }

  if (parsed.intent === 'book' || parsed.intent === 'walk_in') {
    const phone = parseSpokenPhone(parsed.customer_phone)
    const contacts = context.contacts || []
    let customer = parsed.customer_name || phone ? { contact_id: null as string | null, name: parsed.customer_name || '', phone } : null
    if (customer && !phone && parsed.customer_name && contacts.length) {
      const { match, choices } = matchByName(parsed.customer_name, contacts, (c) => c.name)
      if (match) customer = { contact_id: match.id, name: match.name, phone: match.phone }
      else if (choices.length > 1) draft.choices.customers = choices.map((c) => ({ id: c.id, name: c.name, label: c.phone ? `${c.name} · ••••${c.phone.slice(-4)}` : c.name }))
    }
    draft.customer = customer
    if (parsed.intent === 'walk_in' && !draft.customer) draft.customer = { contact_id: null, name: 'Walk-in customer', phone: null }
    if (parsed.intent === 'book') {
      draft.date = parsed.date && parsed.date >= today ? parsed.date : today
      draft.time = parsed.time && fromIst(draft.date, parsed.time) ? parsed.time.padStart(5, '0') : null
    }
  }

  if (OPEN_STATUSES[parsed.intent]) {
    const open = context.appointments.filter((a) => OPEN_STATUSES[parsed.intent].includes(a.status))
    let candidates = parsed.customer_name ? open.filter((a) => matchByName(parsed.customer_name, [a], (x) => x.customer_name).match || matchByName(parsed.customer_name, [a], (x) => x.customer_name).choices.length) : open
    if (parsed.appointment_time && candidates.length > 1) {
      const atTime = candidates.filter((a) => istTime(a.starts_at) === parsed.appointment_time!.padStart(5, '0'))
      if (atTime.length) candidates = atTime
    }
    // "Priya" when there is "Priya Sharma" and "Priya Reddy": prefer exact name matches
    if (parsed.customer_name && candidates.length > 1) {
      const exact = candidates.filter((a) => a.customer_name.toLowerCase() === parsed.customer_name!.toLowerCase())
      if (exact.length === 1) candidates = exact
    }
    if (candidates.length === 1) draft.appointment_id = candidates[0].id
    else if (candidates.length > 1) draft.choices.appointments = candidates.map((a) => ({ id: a.id, label: `${formatIstTime(a.starts_at)} · ${a.customer_name}` }))
  }

  if (parsed.intent === 'summary') {
    const live = context.appointments.filter((a) => !['cancelled', 'no_show'].includes(a.status))
    const upcoming = live.filter((a) => a.status === 'booked' && Date.parse(a.starts_at) >= context.now - 15 * 60_000).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    draft.summary = {
      appointments: live.length,
      done: live.filter((a) => a.status === 'completed').length,
      waiting: live.filter((a) => ['booked', 'arrived', 'in_service'].includes(a.status)).length,
      collected: Number(context.collectedToday) || 0,
      next: upcoming ? `${formatIstTime(upcoming.starts_at)} ${upcoming.customer_name}` : null,
    }
  }

  return finalizeDraft(draft, context)
}

/** A booking time that has already gone by (more than 10 minutes ago). */
function isPast(draft: Pick<VoiceDraft, 'date' | 'time'>, now: number): boolean {
  const at = draft.date && draft.time ? fromIst(draft.date, draft.time) : null
  return Boolean(at && at.getTime() < now - 10 * 60_000)
}

/** Work out what is still missing and the sentence to say, after resolving or after a tap. */
export function finalizeDraft(input: VoiceDraft, context: VoiceContext): VoiceDraft {
  const draft: VoiceDraft = { ...input, missing: [] }
  const appointment = context.appointments.find((a) => a.id === draft.appointment_id)
  // Billing an appointment: the services it already has are not added again
  if (draft.intent === 'bill' && appointment) draft.service_ids = draft.service_ids.filter((id) => !appointment.services.some((s) => s.service_id === id))
  if (draft.intent === 'book' || draft.intent === 'walk_in') {
    if (draft.intent === 'book' && !draft.customer) draft.missing.push('customer')
    if (!draft.service_ids.length && !draft.choices.services?.length) draft.missing.push('services')
    if (draft.intent === 'book' && (!draft.time || isPast(draft, context.now))) draft.missing.push('time')
  }
  if (OPEN_STATUSES[draft.intent] && !draft.appointment_id && !draft.choices.appointments?.length) draft.missing.push('appointment')
  draft.speech = speechFor(draft, context)
  return draft
}

export type DraftEdit =
  | { kind: 'appointment'; id: string }
  | { kind: 'service'; id: string; spoken?: string }
  | { kind: 'remove_service'; id: string }
  | { kind: 'staff'; id: string | null }
  /** id 'new' keeps the spoken name as a new customer */
  | { kind: 'customer'; id: string; name?: string }
  | { kind: 'time'; time: string }
  | { kind: 'payment'; method: 'cash' | 'upi' | 'card' | null }
  | { kind: 'discount'; discount: Discount | null }

/** A tap on the "What I understood" card. */
export function applyEdit(input: VoiceDraft, edit: DraftEdit, context: VoiceContext): VoiceDraft {
  const draft: VoiceDraft = { ...input, service_ids: [...input.service_ids], choices: { ...input.choices } }
  switch (edit.kind) {
    case 'appointment':
      draft.appointment_id = edit.id
      delete draft.choices.appointments
      break
    case 'service': {
      if (!draft.service_ids.includes(edit.id)) draft.service_ids.push(edit.id)
      const rest = (draft.choices.services || []).filter((choice) => choice.spoken !== edit.spoken)
      if (rest.length) draft.choices.services = rest
      else delete draft.choices.services
      break
    }
    case 'remove_service':
      draft.service_ids = draft.service_ids.filter((id) => id !== edit.id)
      break
    case 'staff':
      draft.staff_id = edit.id
      delete draft.choices.staff
      break
    case 'customer':
      if (edit.id !== 'new') draft.customer = { contact_id: edit.id, name: edit.name || draft.customer?.name || '', phone: null }
      delete draft.choices.customers
      break
    case 'time':
      draft.date ||= istDate(context.now)
      draft.time = edit.time
      break
    case 'payment':
      draft.payment_method = edit.method
      break
    case 'discount':
      draft.discount = edit.discount
      break
  }
  return finalizeDraft(draft, context)
}

/** The counter action a confirmed draft performs (see lib/salon/actions.ts), or null when it is not ready. */
export function draftToAction(draft: VoiceDraft): Record<string, unknown> | null {
  if (!isReady(draft)) return null
  const customer = draft.customer ? { contact_id: draft.customer.contact_id, name: draft.customer.name, phone: draft.customer.phone } : null
  const status = { arrived: 'arrived', start: 'in_service', cancel: 'cancelled', no_show: 'no_show' } as const
  switch (draft.intent) {
    case 'book': {
      const startsAt = draft.date && draft.time ? fromIst(draft.date, draft.time) : null
      if (!startsAt || !customer) return null
      return { type: 'create_appointment', customer, service_ids: draft.service_ids, staff_id: draft.staff_id, starts_at: startsAt.toISOString(), send_whatsapp: true }
    }
    case 'walk_in':
      return { type: 'walk_in_bill', customer: customer || { name: 'Walk-in customer' }, service_ids: draft.service_ids, staff_id: draft.staff_id, discount: draft.discount, payment_method: draft.payment_method, send_whatsapp: true }
    case 'bill':
      return draft.appointment_id ? { type: 'complete_and_bill', appointment_id: draft.appointment_id, extra_service_ids: draft.service_ids, discount: draft.discount, payment_method: draft.payment_method, send_whatsapp: true } : null
    case 'arrived':
    case 'start':
    case 'cancel':
    case 'no_show':
      return draft.appointment_id ? { type: 'set_status', appointment_id: draft.appointment_id, status: status[draft.intent] } : null
    default:
      return null
  }
}

/** Short spoken replies around the draft. */
export const REPLIES: Record<'done' | 'cancelled' | 'notReady' | 'nothingHeard', Record<Language, string>> = {
  done: { en: 'Done.', hi: 'Ho gaya.', te: 'Ayipoyindi.' },
  cancelled: { en: 'Okay, cancelled.', hi: 'Theek hai, cancel kiya.', te: 'Sare, cancel chesanu.' },
  notReady: { en: 'Not yet. Tap what is missing first.', hi: 'Abhi nahi. Pehle jo baaki hai woh chuniye.', te: 'Inka kaadu. Mundu migilinadi enchukondi.' },
  nothingHeard: { en: 'I did not hear anything. Tap the mic and speak.', hi: 'Kuch sunai nahi diya. Mic dabake boliye.', te: 'Emi vinapadaledu. Mic nokki cheppandi.' },
}

/** Whether a draft can be confirmed as it is (nothing missing, nothing left to choose). */
export function isReady(draft: VoiceDraft): boolean {
  if (draft.intent === 'unknown' || draft.intent === 'summary') return false
  return !draft.missing.length && !draft.choices.appointments?.length && !draft.choices.services?.length && !draft.choices.customers?.length
}

// ── Saying it back ───────────────────────────────────────────────────────────

const DAY_WORDS: Record<Language, [string, string]> = { en: ['today', 'tomorrow'], hi: ['aaj', 'kal'], te: ['ivala', 'repu'] }

function dayWord(date: string | null, language: Language, today: string): string {
  if (!date || date === today) return DAY_WORDS[language][0]
  if (date === addDays(today, 1)) return DAY_WORDS[language][1]
  return formatIstDay(date, today)
}

function list(names: string[], language: Language): string {
  if (names.length <= 1) return names[0] || ''
  const and = language === 'hi' ? 'aur' : language === 'te' ? 'mariyu' : 'and'
  return `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`
}

export function speechFor(draft: VoiceDraft, context: VoiceContext): string {
  const l = draft.language
  const today = istDate(context.now)
  const serviceNames = context.services.filter((s) => draft.service_ids.includes(s.id)).map((s) => s.name)
  const staff = context.staff.find((s) => s.id === draft.staff_id)?.name
  const appointment = context.appointments.find((a) => a.id === draft.appointment_id)
  const name = (draft.customer?.name && draft.customer.name !== 'Walk-in customer' ? draft.customer.name : appointment?.customer_name || draft.said_name || '').split(' ')[0]
  const time = draft.time ? formatIstTime(fromIst(draft.date || today, draft.time) || new Date()) : ''
  const pay = draft.payment_method ? { cash: 'cash', upi: 'UPI', card: 'card' }[draft.payment_method] : ''

  if (draft.intent === 'unknown') return { en: 'Sorry, I did not catch that. Try: book Priya for a haircut at 5.', hi: 'Maaf kijiye, samajh nahi aaya. Boliye: Priya ka haircut 5 baje book karo.', te: 'Kshaminchandi, ardham kaledu. Ila cheppandi: Priya ki 5 ki haircut book cheyyi.' }[l]
  if (draft.intent === 'summary' && draft.summary) {
    const s = draft.summary
    const money = formatRupees(s.collected)
    const count = `${s.appointments} appointment${s.appointments === 1 ? '' : 's'}`
    return {
      en: `Today: ${count}, ${s.done} done, ${money} collected.${s.next ? ` Next: ${s.next}.` : ''}`,
      hi: `Aaj ${count}, ${s.done} ho gaye, ${money} aaye.${s.next ? ` Agla: ${s.next}.` : ''}`,
      te: `Ivala ${count}, ${s.done} ayyayi, ${money} vachindi.${s.next ? ` Next: ${s.next}.` : ''}`,
    }[l]
  }
  // Ask for what is missing first
  if (draft.missing.includes('services')) return { en: 'Which services?', hi: 'Kaun si service?', te: 'Ye service?' }[l]
  if (draft.missing.includes('customer')) return { en: 'Who is the customer?', hi: 'Customer kaun hai?', te: 'Customer evaru?' }[l]
  if (draft.missing.includes('time') && time && isPast(draft, context.now)) return { en: `${time} has already gone. What time?`, hi: `${time} nikal gaya. Kitne baje?`, te: `${time} ayipoyindi. Enni gantalaki?` }[l]
  if (draft.missing.includes('time')) return { en: `What time${name ? ` for ${name}` : ''}?`, hi: `${name ? `${name} ke liye ` : ''}kitne baje?`, te: `${name ? `${name} ki ` : ''}enni gantalaki?` }[l]
  if (draft.missing.includes('appointment')) return { en: `I could not find ${name || 'that appointment'} today.`, hi: `Aaj ${name || 'yeh appointment'} nahi mila.`, te: `Ivala ${name || 'aa appointment'} kanipinchaledu.` }[l]
  if (draft.choices.appointments?.length || draft.choices.customers?.length) return { en: 'Which one? Tap to choose.', hi: 'Kaun sa? Tap karke chuniye.', te: 'Edi? Tap chesi enchukondi.' }[l]
  if (draft.choices.services?.length) return { en: `Which ${draft.choices.services[0].spoken}? Tap to choose.`, hi: `Kaun sa ${draft.choices.services[0].spoken}? Tap karke chuniye.`, te: `Ye ${draft.choices.services[0].spoken}? Tap chesi enchukondi.` }[l]

  const services = list(serviceNames, l)
  switch (draft.intent) {
    case 'book': {
      const day = dayWord(draft.date, l, today)
      return {
        en: `Book ${name} for ${services}${staff ? ` with ${staff}` : ''}, ${day} at ${time}?`,
        hi: `${name} ka ${services}${staff ? `, ${staff} ke saath` : ''}, ${day} ${time} book karun?`,
        te: `${name} ki ${services}${staff ? `, ${staff} tho` : ''}, ${day} ${time} ki book cheyyana?`,
      }[l]
    }
    case 'arrived': return { en: `Mark ${name} as arrived?`, hi: `${name} aa gaye, mark karun?`, te: `${name} vacharu ani mark cheyyana?` }[l]
    case 'start': return { en: `Start ${name}'s service?`, hi: `${name} ki service shuru karun?`, te: `${name} service start cheyyana?` }[l]
    case 'cancel': return { en: `Cancel ${name}'s ${appointment ? formatIstTime(appointment.starts_at) : ''} appointment?`, hi: `${name} ka ${appointment ? formatIstTime(appointment.starts_at) : ''} appointment cancel karun?`, te: `${name} ${appointment ? formatIstTime(appointment.starts_at) : ''} appointment cancel cheyyana?` }[l]
    case 'no_show': return { en: `Mark ${name} as not coming?`, hi: `${name} nahi aaye, mark karun?`, te: `${name} raledu ani mark cheyyana?` }[l]
    case 'bill':
    case 'walk_in': {
      const lines = draft.intent === 'bill' && appointment
        ? [...appointment.services.map((s) => ({ name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate) })), ...context.services.filter((s) => draft.service_ids.includes(s.id)).map((s) => ({ name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate) }))]
        : context.services.filter((s) => draft.service_ids.includes(s.id)).map((s) => ({ name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate) }))
      const registered = Boolean(context.settings?.gstin)
      const total = computeInvoice(lines.map((line) => ({ ...line, tax_rate: registered ? line.tax_rate : 0 })), { pricesIncludeTax: context.settings?.prices_include_tax, discount: draft.discount }).total
      const who = name || { en: 'the customer', hi: 'customer', te: 'customer' }[l]
      return {
        en: `Bill ${who} ${formatRupees(total)}${pay ? ` by ${pay}` : ''}?`,
        hi: `${who} ka bill ${formatRupees(total)}${pay ? `, ${pay} se` : ''}?`,
        te: `${who} ki bill ${formatRupees(total)}${pay ? `, ${pay} lo` : ''}?`,
      }[l]
    }
    default:
      return ''
  }
}

/** The words to bias transcription towards: the salon's own service and staff names. */
export function transcriptionPrompt(context: Pick<VoiceContext, 'services' | 'staff'>): string {
  const services = context.services.filter((s) => s.active).map((s) => s.name).join(', ')
  const staff = context.staff.filter((s) => s.active).map((s) => s.name).join(', ')
  return `Salon front desk in India. Speech is English, Hindi or Telugu, often mixed. Write Hindi and Telugu in English letters, like "Priya ki 5 ki haircut book cheyyi" or "Ravi ka bill banao, UPI". Services: ${services}. Staff: ${staff}.`.slice(0, 900)
}
