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
  /** How many days ahead customers can book (3 to 30). */
  days_ahead: number
  language: FlowLanguage
}

export const DEFAULT_TRIGGERS = ['book', 'booking', 'appointment', 'బుక్', 'बुक']
export const DEFAULT_FLOW: BookingFlowSettings = { enabled: false, triggers: DEFAULT_TRIGGERS, welcome: '', ask_staff: false, days_ahead: 7, language: 'en' }
export const DAYS_AHEAD_CHOICES = [3, 7, 14, 30]

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
    ask_staff: v.ask_staff === true,
    days_ahead: Number.isInteger(days) && days >= 3 && days <= 30 ? days : 7,
    language: (['en', 'te', 'hi'].includes(v.language) ? v.language : 'en') as FlowLanguage,
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

