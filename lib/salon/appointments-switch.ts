/**
 * "We take appointments": one Front Desk setting per workspace (salon_settings.takes_appointments, on unless it is
 * switched off). Some shops only bill walk-ins and never book a time (owner, 25 Nov 2026: "in some shops they don't
 * need appointment booking, they can hide it"). Switched off:
 * - the Front Desk shows the day's walk-in bills: no appointments, calendar, booking requests or New booking;
 * - Setup hides the booking page links, the WhatsApp booking flow, "confirm free slots" and booking reminders;
 * - the booking page (/b/<slug>) says plainly the business is not taking online bookings (Call / WhatsApp instead),
 *   and the server refuses new bookings there, at the counter and through the public API;
 * - the business website shows no Book buttons, booking form or "Book now" in the phone bar;
 * - on WhatsApp the booking flow does not start and the assistant never offers times; reminders are not sent.
 * Bookings already made stay in the database untouched. Pure and browser-safe; the column is set up in
 * appointments-setting.ts.
 */

/** The setting as it is saved; missing (older workspaces, before the column exists) counts as on. */
export function takesAppointments(settings: { takes_appointments?: unknown } | null | undefined): boolean {
  return settings?.takes_appointments !== false
}

/** The public API's error code when a booking is refused because appointments are off. */
export const APPOINTMENTS_OFF_CODE = 'appointments_off'

/** At the counter (and in the app): a booking asked for while appointments are off. */
export const APPOINTMENTS_OFF_MESSAGE = 'Appointments are switched off for this business. An admin can switch them on in Front Desk → Setup → Appointments.'

/** On the booking page and its API, to customers. */
export const NOT_TAKING_BOOKINGS = 'This business is not taking online bookings right now. Please call or message them, or just walk in during opening hours.'

/** Only the owner or an admin may switch appointments on or off (it changes what customers see). */
export const APPOINTMENTS_ADMIN_ONLY = 'Only the owner or an admin can switch appointments on or off.'

/** Front Desk tabs that only make sense with appointments (hidden on the web and in the phone bottom bar). */
export const APPOINTMENT_TABS = ['appointments'] as const

/** The automatic WhatsApp messages only bookings send: their templates are not asked for while appointments are off. */
export const APPOINTMENT_PURPOSES = ['booking', 'reminder'] as const

/** The Front Desk tabs to show, in their order, for this setting. */
export function frontDeskTabsFor<T extends string>(tabs: readonly T[], takes: boolean): T[] {
  return takes ? [...tabs] : tabs.filter((tab) => !(APPOINTMENT_TABS as readonly string[]).includes(tab))
}

/** The automatic messages to set up templates for (bill, booking, reminder, feedback; without bookings: bill, feedback). */
export function messagePurposesFor<T extends string>(purposes: readonly T[], takes: boolean): T[] {
  return takes ? [...purposes] : purposes.filter((purpose) => !(APPOINTMENT_PURPOSES as readonly string[]).includes(purpose))
}

/** What switching appointments off hides, in plain words (the Setup card and the app). */
export const HIDDEN_WHEN_OFF = [
  'Appointments, the calendar and booking requests on the Front Desk',
  'The New booking and Book buttons',
  'Your booking page, and booking on your website',
  'Booking on WhatsApp: the booking flow, and the assistant offering times',
  'Appointment reminders',
] as const

/** What stays the same when appointments are off. */
export const KEPT_WHEN_OFF = 'Walk-in bills, invoices, reviews, memberships, team and reports stay as they are. Bookings already made are kept.'

export type ReplyLanguage = 'en' | 'te' | 'hi'

/** The WhatsApp reply when someone tries to book (a booking button, a times list) while appointments are off. */
export function noBookingsReply(language: ReplyLanguage, business: string, phone?: string | null): string {
  const name = String(business || '').trim() || 'We'
  const call = String(phone || '').trim()
  const words: Record<ReplyLanguage, string> = {
    en: `Sorry, ${name === 'We' ? 'we are' : `${name} is`} not taking appointments right now. Just walk in during our opening hours${call ? `, or call us on ${call}` : ''}. 🙏`,
    te: `Sorry andi, ippudu appointments teeskovatledu. Opening hours lo direct ga randi${call ? `, leda ${call} ki call cheyyandi` : ''}. 🙏`,
    hi: `Sorry, abhi appointments nahi le rahe hain. Opening hours mein seedha aa jaiye${call ? `, ya ${call} par call kijiye` : ''}. 🙏`,
  }
  return words[language] || words.en
}

/** What the WhatsApp assistant is told about booking (it never offers times while appointments are off). */
export function assistantBookingRule(takes: boolean, today: string, tomorrow: string): string {
  if (takes) {
    return `- Booking: when the customer wants an appointment, find out the services and the day, then call offer_times. It sends the free times as a list to tap; do not list times yourself. "today" / "ivala" / "aaj" = ${today}; "tomorrow" / "repu" / "kal" = ${tomorrow}. If they did not say a day, ask. If a service is unclear (for example "haircut" when there are two), ask which one.`
  }
  return '- This business does not take appointments. If the customer wants to book a time, say kindly that there is no booking: they can just walk in during the opening hours (or call the phone number above). Never offer or promise a time.'
}
