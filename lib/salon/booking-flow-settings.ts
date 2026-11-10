/**
 * The WhatsApp booking flow's settings (Front Desk → Setup → Booking flow): pure, browser-safe.
 * The flow itself is in booking-flow.ts.
 */

export type FlowLanguage = 'en' | 'te' | 'hi'

export interface BookingFlowSettings {
  enabled: boolean
  /** Words that start the flow when a customer sends them ("book", "appointment"…). */
  triggers: string[]
  /** The first message. {name} and {business} are filled in. Empty: the default for the language. */
  welcome: string
  /** Ask which team member they want. */
  ask_staff: boolean
  /** Let the customer pick more than one service ("Add another"), up to MAX_SERVICES. */
  multi_select: boolean
  /**
   * How customers pick services: 'form' = one WhatsApp form with tick boxes by category (needs
   * more than one service allowed; falls back to the list when the form cannot be used),
   * 'list' = WhatsApp lists with "Add another".
   */
  services_style: 'form' | 'list'
  /** How many days ahead customers can book (3 to 30). */
  days_ahead: number
  language: FlowLanguage
  /** The steps, in order (see parseSteps). */
  steps: FlowStep[]
}

export const DEFAULT_TRIGGERS = ['book', 'booking', 'appointment', 'బుక్', 'बुक']
export const DEFAULT_FLOW: BookingFlowSettings = { enabled: false, triggers: DEFAULT_TRIGGERS, welcome: '', ask_staff: false, multi_select: true, services_style: 'form', days_ahead: 7, language: 'en', steps: [{ id: 's1', type: 'services' }, { id: 's2', type: 'datetime' }] }
export const DAYS_AHEAD_CHOICES = [3, 7, 14, 30]
/** Most services in one booking (each rides in WhatsApp's 200-character button ids). */
export const MAX_SERVICES = 5

/** The business's flow settings, cleaned, with defaults for anything missing. */
export function parseBookingFlow(value: unknown): BookingFlowSettings {
  const v = value && typeof value === 'object' ? (value as Record<string, any>) : {}
  const triggers = Array.isArray(v.triggers)
    ? [...new Set(v.triggers.map((t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 12) as string[]
    : DEFAULT_TRIGGERS
  const days = Number(v.days_ahead)
  return {
    enabled: v.enabled === true,
    triggers: triggers.length ? triggers : DEFAULT_TRIGGERS,
    welcome: String(v.welcome ?? '').trim().slice(0, 600),
    ask_staff: Array.isArray(v.steps) && v.steps.length ? v.steps.some((step: any) => step?.type === 'staff') : v.ask_staff === true,
    multi_select: v.multi_select !== false,
    services_style: v.services_style === 'list' ? 'list' : 'form',
    days_ahead: Number.isInteger(days) && days >= 3 && days <= 30 ? days : 7,
    language: (['en', 'te', 'hi'].includes(v.language) ? v.language : 'en') as FlowLanguage,
    steps: parseSteps(v.steps, v.ask_staff === true).steps,
  }
}

/**
 * Whether a customer's message asks to book: a short message with one of the trigger words in
 * it ("Book", "I want to book an appointment"). Long messages go to the assistant instead.
 */
export function isBookingRequest(message: unknown, triggers: string[]): boolean {
  const text = String(message ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text || text.length > 60) return false
  return triggers.some((word) => {
    if (!word) return false
    // Latin words must stand alone ("book", not "facebook"); other scripts match as written
    return /^[a-z0-9 ]+$/.test(word) ? new RegExp(`(^|[^a-z0-9])${word.replace(/ /g, '\\s+')}([^a-z0-9]|$)`).test(text) : text.includes(word)
  })
}


// ── Custom steps ─────────────────────────────────────────────────────────────
// The business arranges the flow: its own questions (with buttons or a typed answer) and short
// messages, around the three booking steps (services, who, day and time). Day and time is always
// last; services come before who. Answers are written on the booking.

export type StepType = 'services' | 'staff' | 'choice' | 'text' | 'message' | 'image' | 'link' | 'location' | 'datetime'

export interface FlowStep {
  id: string
  type: StepType
  /**
   * choice / text: what is asked. message: what is said. image: the caption. link: the words above
   * the button. location: a line sent with the map. services / staff / datetime: the question, in
   * the business's own words (left empty, the built-in words in the flow's language are used).
   */
  text?: string
  /** choice: 2 to 10 answers to tap. */
  options?: string[]
  /** choice / text: the name the answer is saved under on the booking ("Gender", "Allergies"). */
  label?: string
  /** image: the picture's https link. link: the page the button opens. location: a Google Maps link. */
  url?: string
  /** link: the button's words (up to 20 characters). */
  button?: string
  /** location: the place's name and address, and where it is (read from the maps link when it has it). */
  name?: string
  address?: string
  latitude?: number
  longitude?: number
}

export const MAX_STEPS = 12
export const STEP_NAMES: Record<StepType, string> = {
  services: 'Pick services',
  staff: 'Pick who',
  choice: 'Question with buttons',
  text: 'Question with a typed answer',
  message: 'Message',
  image: 'Photo',
  link: 'Link button',
  location: 'Location',
  datetime: 'Pick day and time',
}

/** Steps that send something and go on without waiting for an answer. */
export const SAY_STEPS: StepType[] = ['message', 'image', 'link', 'location']

const httpsUrl = (value: unknown): string => {
  const url = String(value ?? '').trim().slice(0, 1000)
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.includes('.') ? parsed.toString() : ''
  } catch {
    return ''
  }
}

/** Where a Google Maps link points, when the link says it (@lat,lng, ?q=lat,lng, !3d…!4d…). */
export function mapsCoordinates(url: unknown): { latitude: number; longitude: number } | null {
  const text = decodeURIComponent(String(url ?? ''))
  const patterns = [/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/]
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) {
      const latitude = Number(m[1])
      const longitude = Number(m[2])
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude }
    }
  }
  return null
}

/** Words like "[insert map location]" that were meant to be filled in. */
const BLANK = /\[(?:insert|add|your|enter|put)[^\]]*\]/i

const clean = (value: unknown, max: number) => String(value ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max)
const stepId = (i: number) => `s${i + 1}`
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function defaultSteps(askStaff: boolean): FlowStep[] {
  return [{ id: 's1', type: 'services' }, ...(askStaff ? [{ id: 's2', type: 'staff' as const }] : []), { id: askStaff ? 's3' : 's2', type: 'datetime' }]
}

/**
 * The business's steps, checked: unknown or empty steps dropped, one services step and one day
 * and time step (added when missing), day and time last, who after services, at most 12 steps.
 * Returns the steps and, if something had to be fixed, what in plain words.
 */
export function parseSteps(value: unknown, askStaff = false): { steps: FlowStep[]; notes: string[] } {
  const notes: string[] = []
  if (!Array.isArray(value) || !value.length) return { steps: defaultSteps(askStaff), notes }
  const out: FlowStep[] = []
  const seen = new Set<StepType>()
  for (const raw of value.slice(0, 30)) {
    const type = raw?.type as StepType
    if (!STEP_NAMES[type]) continue
    if (['services', 'staff', 'datetime'].includes(type)) {
      if (seen.has(type)) continue
      seen.add(type)
      const own = clean(raw.text, 300)
      out.push({ id: '', type, ...(own ? { text: own } : {}) })
      continue
    }
    if (type === 'image') {
      const url = httpsUrl(raw.url)
      if (!url) { notes.push('A photo step needs the picture; it was left out.'); continue }
      const caption = clean(raw.text, 600)
      out.push({ id: '', type, url, ...(caption ? { text: caption } : {}) })
      continue
    }
    if (type === 'link') {
      const url = httpsUrl(raw.url)
      const text = clean(raw.text, 600)
      if (!url || !text) { notes.push('A link button needs words and an https link; it was left out.'); continue }
      out.push({ id: '', type, text, url, button: clean(raw.button, 20) || 'Open' })
      continue
    }
    if (type === 'location') {
      const url = httpsUrl(raw.url)
      const address = clean(raw.address, 200)
      const name = clean(raw.name, 60)
      if (!url && !address) { notes.push('A location step needs your address or a Google Maps link; it was left out.'); continue }
      const lat = Number(raw.latitude)
      const lng = Number(raw.longitude)
      const where = Number.isFinite(lat) && Number.isFinite(lng) && raw.latitude !== undefined && raw.latitude !== null && raw.latitude !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : mapsCoordinates(url)
      const line = clean(raw.text, 300)
      out.push({ id: '', type, ...(name ? { name } : {}), ...(address ? { address } : {}), ...(url ? { url } : {}), ...(where || {}), ...(line ? { text: line } : {}) })
      continue
    }
    const text = clean(raw.text, type === 'message' ? 600 : 300)
    if (!text) { notes.push('A step with no words was left out.'); continue }
    if (BLANK.test(text)) notes.push(`Fill in "${text.match(BLANK)![0]}" in "${clip(text, 40)}".`)
    if (type === 'message') { out.push({ id: '', type, text }); continue }
    const label = clean(raw.label, 30) || clean(text.replace(/\?.*$/, ''), 30)
    if (type === 'text') { out.push({ id: '', type, text, label }); continue }
    const options = [...new Set((Array.isArray(raw.options) ? raw.options : []).map((o: unknown) => clean(o, 24)).filter(Boolean))].slice(0, 10) as string[]
    if (options.length < 2) { notes.push(`"${text}" needs at least two answers to tap; it was left out.`); continue }
    out.push({ id: '', type, text, label, options })
  }
  if (!seen.has('services')) { out.unshift({ id: '', type: 'services' }); notes.push('Pick services was added: a booking needs it.') }
  // Day and time goes last, who after services
  const datetime = out.findIndex((s) => s.type === 'datetime')
  const last = datetime >= 0 ? out.splice(datetime, 1)[0] : { id: '', type: 'datetime' as const }
  const staff = out.findIndex((s) => s.type === 'staff')
  const services = out.findIndex((s) => s.type === 'services')
  if (staff >= 0 && staff < services) { const [who] = out.splice(staff, 1); out.splice(out.findIndex((s) => s.type === 'services') + 1, 0, who) }
  out.push(last)
  if (out.length > MAX_STEPS) {
    notes.push(`A flow can have up to ${MAX_STEPS} steps; the extra questions were left out.`)
    while (out.length > MAX_STEPS) out.splice(out.findLastIndex((s) => !['services', 'staff', 'datetime'].includes(s.type)), 1)
  }
  return { steps: out.map((s, i) => ({ ...s, id: stepId(i) })), notes }
}

/** What a step still needs before it can be saved, in plain words, or null when it is ready. */
export function stepProblem(step: Partial<FlowStep>): string | null {
  const text = String(step.text ?? '').trim()
  const https = (v: unknown) => /^https:\/\/[^\s]+\.[^\s]+/.test(String(v ?? '').trim())
  switch (step.type) {
    case 'choice': return !text ? 'a question' : (step.options || []).length < 2 ? 'at least two answers' : null
    case 'text':
    case 'message': return text ? null : 'its words'
    case 'image': return https(step.url) ? null : 'a picture'
    case 'link': return !text ? 'its words' : !https(step.url) ? 'an https link' : null
    case 'location': return String(step.address ?? '').trim() || https(step.url) ? null : 'your address or a Google Maps link'
    default: return null
  }
}
