/**
 * The WhatsApp booking flow: a customer sends "Book" (or another word the business chose) and
 * books in a few taps, with no typing and no AI needed:
 *
 *   1. Pick a service (by category first when there are more than 10)
 *   2. Pick who (optional, when the business asks for it)
 *   3. Pick a day (only days with free times)
 *   4. Pick a time: the same list as the WhatsApp assistant, so the tap books it as a request
 *      (or confirmed, when the business approves free slots automatically)
 *
 * Each step's choices ride in the button ids ("bf:…"), so nothing has to be remembered between
 * messages. The business sets it up in Front Desk → Setup → Booking flow.
 */

import { sendWhatsAppMessage } from '../commerce/commerce-webhook-handler'
import { freeTimes, isClosedOn } from './availability'
import { groupByCategory } from './categories'
import { busyOn, loadChatSetup, logMessage, salonChatReady, sendFreeTimes, sendText, staffFor, type ChatLanguage, type ChatService, type ChatSetup, type SalonChatInput } from './chat'
import { formatRupees } from './invoice'
import { addDays, formatIstDay, istDate } from './spoken'
import { parseBookingFlow, type BookingFlowSettings } from './booking-flow-settings'

export { DAYS_AHEAD_CHOICES, DEFAULT_FLOW, DEFAULT_TRIGGERS, isBookingRequest, parseBookingFlow, type BookingFlowSettings } from './booking-flow-settings'

// ── Words ──

const words = {
  welcome: { en: 'Hi {name}! Let\'s book your visit at {business}. Which service would you like?', te: 'Namaste {name} garu! {business} lo mee visit book cheddam. Ee service kavali?', hi: 'Namaste {name}! {business} mein aapki visit book karte hain. Kaunsi service chahiye?' },
  category: { en: 'Choose a category', te: 'Category enchukondi', hi: 'Category chuniye' },
  service: { en: 'Choose a service', te: 'Service enchukondi', hi: 'Service chuniye' },
  whichService: { en: 'Which {category} service would you like?', te: '{category} lo ee service kavali?', hi: '{category} mein kaunsi service chahiye?' },
  who: { en: 'Who would you like for {service}?', te: '{service} ki evaru cheyali?', hi: '{service} kaun kare?' },
  anyone: { en: 'Anyone free', te: 'Evaraina', hi: 'Koi bhi' },
  person: { en: 'Choose who', te: 'Evaru', hi: 'Kaun' },
  day: { en: 'Which day suits you for {service}?', te: '{service} ki ee roju kavali?', hi: '{service} ke liye kaunsa din theek hai?' },
  dayButton: { en: 'Choose a day', te: 'Roju enchukondi', hi: 'Din chuniye' },
  times: { en: '{service} on {day}: tap "Choose a time" to pick one.', te: '{day} {service}: "Choose a time" nokki time enchukondi.', hi: '{day} {service}: "Choose a time" dabake time chuniye.' },
  full: { en: 'Sorry, there are no free times in the next {days} days. Please call us and we will fit you in.', te: 'Sorry andi, next {days} rojullo free times levu. Call cheyandi, adjust chestamu.', hi: 'Sorry, agle {days} din mein koi time khali nahi hai. Call kijiye, hum jagah banayenge.' },
  dayFull: { en: 'Sorry, {day} just filled up. Please choose another day.', te: 'Sorry andi, {day} full ayyindi. Inko roju enchukondi.', hi: 'Sorry, {day} abhi full ho gaya. Koi aur din chuniye.' },
  expired: { en: 'That option is not available any more. Send "Book" to start again.', te: 'Aa option ippudu ledu andi. Malli "Book" ani pampandi.', hi: 'Ye option ab nahi hai. Phir se "Book" bhejiye.' },
  noServices: { en: 'Bookings are not open on WhatsApp yet. Please call us to book.', te: 'WhatsApp lo bookings inka start avvaledu andi. Call chesi book cheyandi.', hi: 'WhatsApp par booking abhi shuru nahi hui. Call karke book kijiye.' },
}

const say = (key: keyof typeof words, language: ChatLanguage, fill: Record<string, string> = {}) =>
  Object.entries(fill).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), words[key][language] || words[key].en)

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/** A WhatsApp list: up to 10 rows, each with an id that carries the choice. */
export function buildList(phone: string, body: string, button: string, rows: { id: string; title: string; description?: string }[]) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(body, 1024) },
      action: {
        button: clip(button, 20),
        sections: [{ title: clip(button, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })) }],
      },
    },
  }
}

// ── Button ids ──
// bf:c:<category index>           a category
// bf:s:<service id>               a service
// bf:p:<service id>:<staff|any>   who
// bf:d:<service id>:<staff|any>:<YYYYMMDD>   a day

export type FlowStep =
  | { step: 'category'; index: number }
  | { step: 'service'; serviceId: string }
  | { step: 'person'; serviceId: string; staffId: string | null }
  | { step: 'day'; serviceId: string; staffId: string | null; date: string }

const ID = '[0-9a-f-]{36}'
export function parseFlowButton(id: unknown): FlowStep | null {
  const text = String(id || '')
  let m = /^bf:c:(\d{1,2})$/.exec(text)
  if (m) return { step: 'category', index: Number(m[1]) }
  m = new RegExp(`^bf:s:(${ID})$`, 'i').exec(text)
  if (m) return { step: 'service', serviceId: m[1].toLowerCase() }
  m = new RegExp(`^bf:p:(${ID}):(${ID}|any)$`, 'i').exec(text)
  if (m) return { step: 'person', serviceId: m[1].toLowerCase(), staffId: m[2] === 'any' ? null : m[2].toLowerCase() }
  m = new RegExp(`^bf:d:(${ID}):(${ID}|any):(\\d{4})(\\d{2})(\\d{2})$`, 'i').exec(text)
  if (m) return { step: 'day', serviceId: m[1].toLowerCase(), staffId: m[2] === 'any' ? null : m[2].toLowerCase(), date: `${m[3]}-${m[4]}-${m[5]}` }
  return null
}

const serviceRow = (s: ChatService) => ({ id: `bf:s:${s.id}`, title: s.name, description: `${formatRupees(Number(s.price) || 0)} · ${s.duration_minutes} min` })

/** Days from today with at least one free time for this service (and person), up to 10. */
export async function openDays(input: SalonChatInput, setup: ChatSetup, service: ChatService, staffId: string | null, daysAhead: number): Promise<string[]> {
  const now = input.now ?? Date.now()
  const today = istDate(now)
  const eligible = staffFor(setup.staff, [service.id])
  const out: string[] = []
  for (let i = 0; i < daysAhead && out.length < 10; i++) {
    const date = addDays(today, i)
    if (isClosedOn(date, setup.settings)) continue
    const times = freeTimes({ now, hours: setup.settings, minutes: Number(service.duration_minutes) || 30, eligibleStaff: eligible, staffId, date, busy: await busyOn(input.supabase, input.organization.id, date), around: null, limit: 1 })
    if (times.length) out.push(date)
  }
  return out
}

async function sendList(input: SalonChatInput, body: string, button: string, rows: { id: string; title: string; description?: string }[]) {
  const sent = await sendWhatsAppMessage(input.organization, buildList(input.customerPhone, body, button, rows))
  if (!sent.ok) throw new Error(sent.error || 'WhatsApp did not accept the list')
  await logMessage(input, `${body}\n[${rows.map((r) => r.title).join(', ')}]`, sent.messageId || null)
}

async function sendDays(input: SalonChatInput, setup: ChatSetup, flow: BookingFlowSettings, service: ChatService, staffId: string | null, intro?: string) {
  const days = await openDays(input, setup, service, staffId, flow.days_ahead)
  if (!days.length) {
    await sendText(input, say('full', flow.language, { days: String(flow.days_ahead) }))
    return
  }
  const today = istDate(input.now ?? Date.now())
  await sendList(input, intro || say('day', flow.language, { service: service.name }), say('dayButton', flow.language),
    days.map((d) => {
      const title = formatIstDay(d, today)
      // "Today" and "Tomorrow" get the date underneath; other days are written as dates already
      const full = formatIstDay(d, '')
      return { id: `bf:d:${service.id}:${staffId || 'any'}:${d.replaceAll('-', '')}`, title, ...(title !== full ? { description: full } : {}) }
    }))
}

export type FlowResult = { handled: true; step: 'started' | 'categories' | 'services' | 'people' | 'days' | 'times' | 'expired' | 'closed' } | { handled: false; reason: string }

/** Start the flow: the welcome, with the services (or categories) to pick from. */
export async function startBookingFlow(input: SalonChatInput, setupIn?: ChatSetup): Promise<FlowResult> {
  if (!salonChatReady(input.organization)) return { handled: false, reason: 'not_ready' }
  const setup = setupIn || await loadChatSetup(input.supabase, input.organization.id)
  const flow = parseBookingFlow(setup.settings.booking_flow)
  if (!flow.enabled) return { handled: false, reason: 'flow_off' }
  if (!setup.services.length) {
    await sendText(input, say('noServices', flow.language))
    return { handled: true, step: 'closed' }
  }
  const name = String(input.contact.first_name || '').trim() || 'there'
  const business = String(setup.settings.business_name || input.organization.name || 'us')
  const welcome = (flow.welcome || words.welcome[flow.language] || words.welcome.en).replaceAll('{name}', name).replaceAll('{business}', business)
  if (setup.services.length <= 10) {
    await sendList(input, welcome, say('service', flow.language), setup.services.map(serviceRow))
    return { handled: true, step: 'started' }
  }
  const groups = groupByCategory(setup.settings.service_categories, setup.services).filter(([, list]) => list.length > 0)
  await sendList(input, welcome, say('category', flow.language), groups.slice(0, 10).map(([category, list], index) => ({ id: `bf:c:${index}`, title: category, description: `${list.length} service${list.length === 1 ? '' : 's'}` })))
  return { handled: true, step: 'categories' }
}

/** A choice tapped in one of the flow's lists: send the next step. */
export async function handleBookingFlowButton(input: SalonChatInput & { buttonId: string }): Promise<FlowResult> {
  const step = parseFlowButton(input.buttonId)
  if (!step) return { handled: false, reason: 'not_a_flow_button' }
  if (!salonChatReady(input.organization)) return { handled: false, reason: 'not_ready' }
  const setup = await loadChatSetup(input.supabase, input.organization.id)
  const flow = parseBookingFlow(setup.settings.booking_flow)
  const expired = async () => {
    await sendText(input, say('expired', flow.language))
    return { handled: true as const, step: 'expired' as const }
  }

  if (step.step === 'category') {
    const groups = groupByCategory(setup.settings.service_categories, setup.services).filter(([, list]) => list.length > 0)
    const group = groups[step.index]
    if (!group) return expired()
    await sendList(input, say('whichService', flow.language, { category: group[0] }), say('service', flow.language), group[1].map(serviceRow))
    return { handled: true, step: 'services' }
  }

  const service = setup.services.find((s) => s.id === step.serviceId)
  if (!service) return expired()

  if (step.step === 'service') {
    const people = setup.staff.filter((m) => staffFor([m], [service.id]).length)
    if (flow.ask_staff && people.length > 1) {
      await sendList(input, say('who', flow.language, { service: service.name }), say('person', flow.language), [
        { id: `bf:p:${service.id}:any`, title: say('anyone', flow.language) },
        ...people.slice(0, 9).map((m) => ({ id: `bf:p:${service.id}:${m.id}`, title: m.name })),
      ])
      return { handled: true, step: 'people' }
    }
    await sendDays(input, setup, flow, service, null)
    return { handled: true, step: 'days' }
  }

  if (step.staffId && !setup.staff.some((m) => m.id === step.staffId && staffFor([m], [service.id]).length)) return expired()

  if (step.step === 'person') {
    await sendDays(input, setup, flow, service, step.staffId)
    return { handled: true, step: 'days' }
  }

  // A day: the free times, as the list the assistant sends (a tap books it)
  const today = istDate(input.now ?? Date.now())
  if (step.date < today) return expired()
  const day = formatIstDay(step.date, today)
  const sent = await sendFreeTimes(input, setup, { services: [service], staffId: step.staffId, date: step.date, language: flow.language, body: say('times', flow.language, { service: service.name, day }) })
  if ('note' in sent) {
    await sendDays(input, setup, flow, service, step.staffId, say('dayFull', flow.language, { day }))
    return { handled: true, step: 'days' }
  }
  return { handled: true, step: 'times' }
}
