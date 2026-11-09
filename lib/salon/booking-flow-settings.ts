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
  /** How many days ahead customers can book (3 to 30). */
  days_ahead: number
  language: FlowLanguage
  /** The steps, in order (see parseSteps). */
  steps: FlowStep[]
}

export const DEFAULT_TRIGGERS = ['book', 'booking', 'appointment', 'బుక్', 'बुक']
export const DEFAULT_FLOW: BookingFlowSettings = { enabled: false, triggers: DEFAULT_TRIGGERS, welcome: '', ask_staff: false, multi_select: true, days_ahead: 7, language: 'en', steps: [{ id: 's1', type: 'services' }, { id: 's2', type: 'datetime' }] }
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

export type StepType = 'services' | 'staff' | 'choice' | 'text' | 'message' | 'datetime'

export interface FlowStep {
  id: string
  type: StepType
  /** choice / text: what is asked. message: what is said. */
  text?: string
  /** choice: 2 to 10 answers to tap. */
  options?: string[]
  /** choice / text: the name the answer is saved under on the booking ("Gender", "Allergies"). */
  label?: string
}

export const MAX_STEPS = 12
export const STEP_NAMES: Record<StepType, string> = {
  services: 'Pick services',
  staff: 'Pick who',
  choice: 'Question with buttons',
  text: 'Question with a typed answer',
  message: 'Message',
  datetime: 'Pick day and time',
}

const clean = (value: unknown, max: number) => String(value ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max)
const stepId = (i: number) => `s${i + 1}`

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
      out.push({ id: '', type })
      continue
    }
    const text = clean(raw.text, type === 'message' ? 600 : 300)
    if (!text) { notes.push('A step with no words was left out.'); continue }
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
  if (datetime >= 0) out.splice(datetime, 1)
  const staff = out.findIndex((s) => s.type === 'staff')
  const services = out.findIndex((s) => s.type === 'services')
  if (staff >= 0 && staff < services) { const [who] = out.splice(staff, 1); out.splice(out.findIndex((s) => s.type === 'services') + 1, 0, who) }
  out.push({ id: '', type: 'datetime' })
  if (out.length > MAX_STEPS) {
    notes.push(`A flow can have up to ${MAX_STEPS} steps; the extra questions were left out.`)
    while (out.length > MAX_STEPS) out.splice(out.findLastIndex((s) => !['services', 'staff', 'datetime'].includes(s.type)), 1)
  }
  return { steps: out.map((s, i) => ({ ...s, id: stepId(i) })), notes }
}
