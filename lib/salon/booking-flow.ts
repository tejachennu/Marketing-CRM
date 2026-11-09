/**
 * The WhatsApp booking flow: a customer sends "Book" (or another word the business chose) and
 * books in a few taps, with no typing and no AI needed:
 *
 *   1. Pick a service (by category first when there are more than 10). WhatsApp lists take one
 *      tap, so for more than one service the customer is asked "Add another?" after each pick,
 *      like a cart, up to 5 services
 *   2. Pick who (optional, when the business asks for it): someone who does all of them
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
import { MAX_SERVICES, parseBookingFlow, type BookingFlowSettings } from './booking-flow-settings'

export { DAYS_AHEAD_CHOICES, DEFAULT_FLOW, MAX_SERVICES, DEFAULT_TRIGGERS, isBookingRequest, parseBookingFlow, type BookingFlowSettings } from './booking-flow-settings'

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
  added: { en: 'Added: {service}.\nSo far: {list} · {total}, about {minutes} min.\n\nWould you like another service?', te: 'Add chesamu: {service}.\nIppativaraku: {list} · {total}, sumaru {minutes} min.\n\nInko service kavala?', hi: 'Jod diya: {service}.\nAb tak: {list} · {total}, lagbhag {minutes} min.\n\nKoi aur service chahiye?' },
  addAnother: { en: 'Add another', te: 'Inkokati add', hi: 'Aur jodiye' },
  next: { en: 'Choose a day', te: 'Roju enchukondi', hi: 'Din chuniye' },
  whichMore: { en: 'Which other service would you like? (You have: {list})', te: 'Inka ee service kavali? (Ippativaraku: {list})', hi: 'Aur kaunsi service chahiye? (Ab tak: {list})' },
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

/** WhatsApp reply buttons (up to 3), each id carrying the choice. */
export function buildButtons(phone: string, body: string, buttons: { id: string; title: string }[]) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(body, 1024) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) },
    },
  }
}

// ── Button ids ──
// The services picked so far ride in every id, each as 22 characters (the 16 bytes of its id),
// joined by "." — up to 5 fit in WhatsApp's 200-character limit with the day and the person.
//   bf:c:<category index>[:<picked>]     a category
//   bf:s:<picked>                        services picked (the last one just tapped)
//   bf:m:<picked>                        "Add another"
//   bf:n:<picked>                        "Choose a day" (done picking)
//   bf:p:<picked>:<person|any>           who
//   bf:d:<picked>:<person|any>:<YYYYMMDD> a day
// Older lists sent full ids (bf:s:<uuid>), which still work.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function packId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url')
}

export function unpackId(value: string): string | null {
  if (UUID.test(value)) return value.toLowerCase()
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null
  const hex = Buffer.from(value, 'base64url').toString('hex')
  return hex.length === 32 ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null
}

export const packIds = (ids: string[]) => ids.map(packId).join('.')

function unpackIds(value: string): string[] | null {
  const ids = value.split('.').map(unpackId)
  if (!ids.length || ids.length > MAX_SERVICES || ids.some((id) => !id)) return null
  return [...new Set(ids as string[])]
}

const person = (value: string) => (value === 'any' ? null : unpackId(value))

export type FlowStep =
  | { step: 'category'; index: number; picked: string[] }
  | { step: 'service'; picked: string[] }
  | { step: 'more'; picked: string[] }
  | { step: 'next'; picked: string[] }
  | { step: 'person'; picked: string[]; staffId: string | null }
  | { step: 'day'; picked: string[]; staffId: string | null; date: string }

export function parseFlowButton(id: unknown): FlowStep | null {
  const parts = String(id || '').split(':')
  if (parts[0] !== 'bf' || parts.length < 3) return null
  const [, kind, a, b, c] = parts
  if (kind === 'c') {
    if (!/^\d{1,2}$/.test(a)) return null
    const picked = b ? unpackIds(b) : []
    return picked && parts.length <= 4 ? { step: 'category', index: Number(a), picked } : null
  }
  const picked = unpackIds(a)
  if (!picked) return null
  if ((kind === 's' || kind === 'm' || kind === 'n') && parts.length === 3) return { step: kind === 's' ? 'service' : kind === 'm' ? 'more' : 'next', picked }
  if (kind === 'p' && parts.length === 4) {
    const staffId = person(b)
    return b === 'any' || staffId ? { step: 'person', picked, staffId } : null
  }
  if (kind === 'd' && parts.length === 5) {
    const staffId = person(b)
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(c || '')
    return (b === 'any' || staffId) && m ? { step: 'day', picked, staffId, date: `${m[1]}-${m[2]}-${m[3]}` } : null
  }
  return null
}

/** Categories that have services, in the business's order (the index rides in the button id). */
const categoriesOf = (setup: ChatSetup) => groupByCategory(setup.settings.service_categories, setup.services).filter(([, list]) => list.length > 0)

const serviceRow = (picked: string[]) => (s: ChatService) => ({ id: `bf:s:${packIds([...picked, s.id])}`, title: s.name, description: `${formatRupees(Number(s.price) || 0)} · ${s.duration_minutes} min` })
const minutesOf = (services: ChatService[]) => services.reduce((sum, s) => sum + (Number(s.duration_minutes) || 30), 0)
const namesOf = (services: ChatService[]) => services.map((s) => s.name).join(', ')

/** Days from today with at least one free time for these services (and person), up to 10. */
export async function openDays(input: SalonChatInput, setup: ChatSetup, services: ChatService[], staffId: string | null, daysAhead: number): Promise<string[]> {
  const now = input.now ?? Date.now()
  const today = istDate(now)
  const eligible = staffFor(setup.staff, services.map((s) => s.id))
  const out: string[] = []
  for (let i = 0; i < daysAhead && out.length < 10; i++) {
    const date = addDays(today, i)
    if (isClosedOn(date, setup.settings)) continue
    const times = freeTimes({ now, hours: setup.settings, minutes: minutesOf(services), eligibleStaff: eligible, staffId, date, busy: await busyOn(input.supabase, input.organization.id, date), around: null, limit: 1 })
    if (times.length) out.push(date)
  }
  return out
}

async function sendPayload(input: SalonChatInput, payload: unknown, logBody: string) {
  const sent = await sendWhatsAppMessage(input.organization, payload)
  if (!sent.ok) throw new Error(sent.error || 'WhatsApp did not accept the message')
  await logMessage(input, logBody, sent.messageId || null)
}

const sendList = (input: SalonChatInput, body: string, button: string, rows: { id: string; title: string; description?: string }[]) =>
  sendPayload(input, buildList(input.customerPhone, body, button, rows), `${body}\n[${rows.map((r) => r.title).join(', ')}]`)

/** The services to pick from (not already picked): as a list, or by category when more than 10. */
async function sendServices(input: SalonChatInput, setup: ChatSetup, flow: BookingFlowSettings, picked: string[], body: string): Promise<'services' | 'categories'> {
  const left = setup.services.filter((s) => !picked.includes(s.id))
  if (left.length <= 10) {
    await sendList(input, body, say('service', flow.language), left.map(serviceRow(picked)))
    return 'services'
  }
  const rows = categoriesOf(setup)
    .map(([category, list], index) => ({ category, index, count: list.filter((s) => !picked.includes(s.id)).length }))
    .filter((g) => g.count > 0)
    .slice(0, 10)
    .map((g) => ({ id: `bf:c:${g.index}${picked.length ? `:${packIds(picked)}` : ''}`, title: g.category, description: `${g.count} service${g.count === 1 ? '' : 's'}` }))
  await sendList(input, body, say('category', flow.language), rows)
  return 'categories'
}

async function sendDays(input: SalonChatInput, setup: ChatSetup, flow: BookingFlowSettings, services: ChatService[], staffId: string | null, intro?: string) {
  const days = await openDays(input, setup, services, staffId, flow.days_ahead)
  if (!days.length) {
    await sendText(input, say('full', flow.language, { days: String(flow.days_ahead) }))
    return
  }
  const today = istDate(input.now ?? Date.now())
  const picked = packIds(services.map((s) => s.id))
  const who = staffId ? packId(staffId) : 'any'
  await sendList(input, intro || say('day', flow.language, { service: namesOf(services) }), say('dayButton', flow.language),
    days.map((d) => {
      const title = formatIstDay(d, today)
      // "Today" and "Tomorrow" get the date underneath; other days are written as dates already
      const full = formatIstDay(d, '')
      return { id: `bf:d:${picked}:${who}:${d.replaceAll('-', '')}`, title, ...(title !== full ? { description: full } : {}) }
    }))
}

/** Done picking: who (when asked and more than one person does them all), else the days. */
async function afterPicking(input: SalonChatInput, setup: ChatSetup, flow: BookingFlowSettings, services: ChatService[]): Promise<'people' | 'days'> {
  const ids = services.map((s) => s.id)
  const people = setup.staff.filter((m) => staffFor([m], ids).length)
  if (flow.ask_staff && people.length > 1) {
    const picked = packIds(ids)
    await sendList(input, say('who', flow.language, { service: namesOf(services) }), say('person', flow.language), [
      { id: `bf:p:${picked}:any`, title: say('anyone', flow.language) },
      ...people.slice(0, 9).map((m) => ({ id: `bf:p:${picked}:${packId(m.id)}`, title: m.name })),
    ])
    return 'people'
  }
  await sendDays(input, setup, flow, services, null)
  return 'days'
}

export type FlowResult = { handled: true; step: 'started' | 'categories' | 'services' | 'added' | 'people' | 'days' | 'times' | 'expired' | 'closed' } | { handled: false; reason: string }

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
  const sent = await sendServices(input, setup, flow, [], welcome)
  return { handled: true, step: sent === 'services' ? 'started' : 'categories' }
}

/** A choice tapped in one of the flow's lists or buttons: send the next step. */
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
  const services = step.picked.map((id) => setup.services.find((s) => s.id === id))
  if (services.some((s) => !s)) return expired()
  const picked = services as ChatService[]
  const listOf = () => `${namesOf(picked)}`

  if (step.step === 'category') {
    const group = categoriesOf(setup)[step.index]
    const left = group?.[1].filter((s) => !step.picked.includes(s.id)) || []
    if (!left.length) return expired()
    const body = picked.length ? say('whichMore', flow.language, { list: listOf() }) : say('whichService', flow.language, { category: group![0] })
    await sendList(input, body, say('service', flow.language), left.map(serviceRow(step.picked)))
    return { handled: true, step: 'services' }
  }

  if (!picked.length) return expired()

  if (step.step === 'service') {
    const left = setup.services.filter((s) => !step.picked.includes(s.id))
    // One at a time, like a cart: "Add another" or go on to the day
    if (flow.multi_select && picked.length < MAX_SERVICES && left.length) {
      const last = picked[picked.length - 1]
      const total = formatRupees(picked.reduce((sum, s) => sum + (Number(s.price) || 0), 0))
      const body = say('added', flow.language, { service: last.name, list: listOf(), total, minutes: String(minutesOf(picked)) })
      const ids = packIds(step.picked)
      await sendPayload(input, buildButtons(input.customerPhone, body, [
        { id: `bf:m:${ids}`, title: say('addAnother', flow.language) },
        { id: `bf:n:${ids}`, title: say('next', flow.language) },
      ]), `${body}\n[${say('addAnother', flow.language)} | ${say('next', flow.language)}]`)
      return { handled: true, step: 'added' }
    }
    return { handled: true, step: await afterPicking(input, setup, flow, picked) }
  }

  if (step.step === 'more') {
    if (picked.length >= MAX_SERVICES) return { handled: true, step: await afterPicking(input, setup, flow, picked) }
    const sent = await sendServices(input, setup, flow, step.picked, say('whichMore', flow.language, { list: listOf() }))
    return { handled: true, step: sent }
  }

  if (step.step === 'next') return { handled: true, step: await afterPicking(input, setup, flow, picked) }

  if (step.staffId && !setup.staff.some((m) => m.id === step.staffId && staffFor([m], step.picked).length)) return expired()

  if (step.step === 'person') {
    await sendDays(input, setup, flow, picked, step.staffId)
    return { handled: true, step: 'days' }
  }

  // A day: the free times for all of them together, as the list the assistant sends (a tap books it)
  const today = istDate(input.now ?? Date.now())
  if (step.date < today) return expired()
  const day = formatIstDay(step.date, today)
  const sent = await sendFreeTimes(input, setup, { services: picked, staffId: step.staffId, date: step.date, language: flow.language, body: say('times', flow.language, { service: listOf(), day }) })
  if ('note' in sent) {
    await sendDays(input, setup, flow, picked, step.staffId, say('dayFull', flow.language, { day }))
    return { handled: true, step: 'days' }
  }
  return { handled: true, step: 'times' }
}
