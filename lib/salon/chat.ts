/**
 * The salon on WhatsApp: an assistant that answers questions about the salon's own services,
 * prices, timings and address, and books appointments in the chat.
 *
 * Booking: the assistant works out the services and the day, then sends the free times as a list
 * to tap (the list remembers the services in a salon_chat_offers row). A tap creates the booking,
 * as a request for the counter to approve, or confirmed straight away when the salon approves free
 * slots automatically. It never invents a service, price, offer or time.
 *
 * It runs in the WhatsApp auto-reply before the shopping assistant and the FAQ chatbot; anything
 * that is not about the salon is handed back to them.
 */

import { BUSINESS_TYPES, businessType } from './business'
import { groupByCategory } from './categories'
import { aiFetch, type AiAccess } from '../ai-access'
import { LANGUAGE_RULES } from '../chat-language'
import { buildTextMessage } from '../commerce/commerce-messages'
import { sendWhatsAppMessage } from '../commerce/commerce-webhook-handler'
import { isConsularHelpdesk } from '../workspace-modules'
import { busyFrom, describeHours, freeTimes, isTimeFree, nextOpenDay, type Busy } from './availability'
import { formatRupees } from './invoice'
import { withSalonSchema } from './schema'
import { addDays, formatIstDay, formatIstTime, fromIst, istDate, istDayRange, istTime, matchByName, phoneKey } from './spoken'

const MODEL = 'gpt-4o-mini'
const MAX_TOOL_ROUNDS = 4
export type ChatLanguage = 'en' | 'te' | 'hi'

export interface ChatService { id: string; name: string; category?: string | null; price: number | string; duration_minutes: number; tax_rate?: number | string; active: boolean }
export interface ChatStaff { id: string; name: string; service_ids: string[]; active: boolean }
export interface ChatSetup {
  settings: Record<string, any>
  services: ChatService[]
  staff: ChatStaff[]
}

export interface SalonChatInput {
  supabase: any
  organization: any
  contact: { id: string; first_name?: string | null; last_name?: string | null }
  conversationId: string
  customerPhone: string
  ai?: AiAccess | null
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  fetcher?: typeof fetch
  now?: number
}

export type SalonChatResult = { handled: true; action: 'replied' | 'offered_times' | 'requested' | 'booked' | 'expired' | 'taken' } | { handled: false; reason: string }

/** Whether the salon can talk on this workspace's WhatsApp: connector on, Meta Cloud API connected. */
export function salonChatReady(organization: any): boolean {
  return Boolean(
    organization &&
      Array.isArray(organization.enabled_connectors) && organization.enabled_connectors.includes('salon') &&
      !isConsularHelpdesk(organization) &&
      (!organization.whatsapp_provider || organization.whatsapp_provider === 'facebook') &&
      organization.whatsapp_api_token && organization.whatsapp_phone_number_id
  )
}

export async function loadChatSetup(db: any, organizationId: string): Promise<ChatSetup> {
  const [settings, services, staff] = await Promise.all([
    withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle()),
    withSalonSchema(() => db.from('salon_services').select('*').eq('organization_id', organizationId).order('position')),
    withSalonSchema(() => db.from('salon_staff').select('*').eq('organization_id', organizationId).order('name')),
  ])
  return {
    settings: settings.data || {},
    services: (services.data || []).filter((s: any) => s.active),
    staff: (staff.data || []).filter((s: any) => s.active).map((s: any) => ({ ...s, service_ids: Array.isArray(s.service_ids) ? s.service_ids : [] })),
  }
}

// ── Words ────────────────────────────────────────────────────────────────────

const pick = (language: ChatLanguage, words: Record<ChatLanguage, string>) => words[language] || words.en

export function chooseTimeText(language: ChatLanguage, services: string, day: string): string {
  return pick(language, {
    en: `Here are the free times for ${services} on ${day}. Tap "Choose a time" to pick one.`,
    te: `${day} ${services} ki free times ivi andi. "Choose a time" nokki okati enchukondi.`,
    hi: `${day} ${services} ke liye ye time khali hain. "Choose a time" dabake ek chuniye.`,
  })
}

export function requestReceivedText(language: ChatLanguage, services: string, day: string, time: string): string {
  return pick(language, {
    en: `Thank you! We have your request for ${services} on ${day} at ${time}. We will confirm it shortly.`,
    te: `Thank you andi! ${day} ${time} ki ${services} request vachindi. Konchem sepu lo confirm chestamu.`,
    hi: `Shukriya! ${day} ${time} ke liye ${services} ki request mil gayi. Hum jaldi confirm karenge.`,
  })
}

export function bookedText(language: ChatLanguage, business: string, services: string, day: string, time: string, staff?: string | null): string {
  return pick(language, {
    en: `Confirmed! ${services}${staff ? ` with ${staff}` : ''} at ${business}, ${day} at ${time}. See you soon! ✨`,
    te: `Confirm ayyindi andi! ${day} ${time} ki ${business} lo ${services}${staff ? `, ${staff} tho` : ''}. Twaralo kaluddam! ✨`,
    hi: `Confirm ho gaya! ${day} ${time} baje ${business} mein ${services}${staff ? `, ${staff} ke saath` : ''}. Jaldi milte hain! ✨`,
  })
}

export function takenText(language: ChatLanguage, time: string): string {
  return pick(language, {
    en: `Sorry, ${time} was just taken. Here are the times still free:`,
    te: `Sorry andi, ${time} ippude book ayyindi. Inka free unna times ivi:`,
    hi: `Sorry, ${time} abhi book ho gaya. Ye time abhi bhi khali hain:`,
  })
}

export function expiredText(language: ChatLanguage): string {
  return pick(language, {
    en: 'That list of times has expired. Tell me the service and the day again and I will send fresh times.',
    te: 'Aa times list expire ayyindi andi. Service, roju malli cheppandi, kotha times pamputanu.',
    hi: 'Ye time list purani ho gayi. Service aur din phir se bataiye, naye time bhejta hoon.',
  })
}

// ── WhatsApp list of times ───────────────────────────────────────────────────

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/** A WhatsApp list message: up to 10 times, each a row whose id books it ("sb:<offer>:<HHMM>"). */
export function buildTimesList(phone: string, body: string, day: string, offerId: string, times: string[], date: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(body, 1024) },
      action: {
        button: 'Choose a time',
        sections: [{ title: clip(day, 24), rows: times.slice(0, 10).map((time) => ({ id: `sb:${offerId}:${time.replace(':', '')}`, title: clip(formatIstTime(fromIst(date, time) || new Date()), 24) })) }],
      },
    },
  }
}

export function parseSlotButton(id: unknown): { offerId: string; time: string } | null {
  const match = /^sb:([0-9a-f-]{36}):(\d{2})(\d{2})$/i.exec(String(id || ''))
  return match ? { offerId: match[1].toLowerCase(), time: `${match[2]}:${match[3]}` } : null
}

// ── The assistant ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'reply_to_customer',
      description: 'Send the answer: about services, prices, durations, timings, address, or a question back to the customer (for example which service or which day they want).',
      parameters: { type: 'object', properties: { message: { type: 'string', description: 'Short, warm reply in the customer\'s language and style. At most 4 short lines. No markdown.' } }, required: ['message'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'offer_times',
      description: 'The customer wants to book: send the free times for these services on this day as a list to tap. Call it once you know the services and the day (today if they said today or now).',
      parameters: {
        type: 'object',
        properties: {
          services: { type: 'array', items: { type: 'string' }, description: 'Service names, using the exact names from the list' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          around: { type: ['string', 'null'], description: 'HH:MM (24-hour) if the customer asked for a time, else null' },
          staff_name: { type: ['string', 'null'], description: 'A team member the customer asked for, else null' },
          language: { type: 'string', enum: ['en', 'te', 'hi'], description: 'en, te for Telugu or Tenglish, hi for Hindi or Hinglish' },
        },
        required: ['services', 'date', 'around', 'staff_name', 'language'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'not_for_salon',
      description: 'Hand the message to the general assistant: anything that is not about the business\'s services, prices, timings, address or booking (orders, products, payments, complaints), or when the customer asks for a person.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
]

export function chatSystemPrompt(setup: ChatSetup, organization: any, customerName: string, now = Date.now()): string {
  const s = setup.settings
  const business = s.business_name || organization?.name || 'our business'
  const today = istDate(now)
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i)
    return `${new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })} ${date}`
  }).join(', ')
  const groups = groupByCategory(s.service_categories, setup.services).filter(([, list]) => list.length > 0)
  const menu = groups.map(([category, list]) => `${category}:\n${list.map((x) => `- ${x.name}: ${formatRupees(Number(x.price))}, ${x.duration_minutes} min`).join('\n')}`).join('\n') || '(no services yet)'
  const gst = s.gstin ? (s.prices_include_tax ? 'Prices include GST.' : 'GST (usually 18%) is added to these prices.') : ''
  return `You are the WhatsApp assistant of ${business}, ${BUSINESS_TYPES[businessType(s.business_type)].describe} in India.${customerName ? ` The customer's name is ${customerName}.` : ''}

About the business:
${[s.address && `Address: ${s.address}`, s.phone && `Phone: ${s.phone}`, describeHours(s)].filter(Boolean).join('\n')}
${setup.staff.length ? `Team: ${setup.staff.map((m) => m.name).join(', ')}` : ''}

Services and prices:
${menu}
${gst}

Today is ${week.split(', ')[0]} (India, ${istTime(now)}). The next days: ${week}.

What you do:
- Answer questions about the services, prices, how long they take, timings and the address, from the list above only. Never invent a service, price, discount, offer or time.
- If they ask for something not on the list, say it is not on the menu and suggest the closest service.
- Booking: when the customer wants an appointment, find out the services and the day, then call offer_times. It sends the free times as a list to tap; do not list times yourself. "today" / "ivala" / "aaj" = ${today}; "tomorrow" / "repu" / "kal" = ${addDays(today, 1)}. If they did not say a day, ask. If a service is unclear (for example "haircut" when there are two), ask which one.
- Cancelling or changing an existing booking, complaints, or a request for a person: call not_for_salon.
- Anything not about the business (products, orders, payments): call not_for_salon.
- Always finish by calling reply_to_customer, offer_times or not_for_salon.

${LANGUAGE_RULES}`
}

async function logMessage(input: { supabase: any; organization: any; conversationId: string }, body: string, messageId: string | null) {
  try {
    await input.supabase.from('messages').insert({ organization_id: input.organization.id, conversation_id: input.conversationId, sender_type: 'user', body, twilio_message_sid: messageId ? `FB_${messageId}` : null, status: 'sent' })
  } catch (error: any) {
    console.warn('[Salon chat] Could not log the message:', error?.message)
  }
}

async function sendText(input: SalonChatInput, text: string) {
  const sent = await sendWhatsAppMessage(input.organization, buildTextMessage(input.customerPhone, text))
  if (!sent.ok) throw new Error(sent.error || 'WhatsApp did not accept the reply')
  await logMessage(input, text, sent.messageId || null)
}

const LIST_LIMIT = 10

/** Busy time on a day: every appointment that holds a chair. */
async function busyOn(db: any, organizationId: string, date: string): Promise<Busy[]> {
  const { start, end } = istDayRange(date)
  const { data } = await db.from('salon_appointments').select('starts_at, ends_at, status, staff_id, services').eq('organization_id', organizationId).gte('starts_at', start).lt('starts_at', end)
  return busyFrom(data || [])
}

/** Who can do every one of these services. */
export function staffFor(staff: ChatStaff[], serviceIds: string[]): string[] {
  return staff.filter((m) => !m.service_ids.length || serviceIds.every((id) => m.service_ids.includes(id))).map((m) => m.id)
}

interface OfferArgs { services: string[]; date: string; around?: string | null; staff_name?: string | null; language?: string }

/** Work out the services and send the free times. Returns what to tell the model, or that it was sent. */
async function offerTimes(input: SalonChatInput, setup: ChatSetup, args: OfferArgs): Promise<{ sent: true } | { note: string }> {
  const now = input.now ?? Date.now()
  const language: ChatLanguage = (['en', 'te', 'hi'].includes(String(args.language)) ? args.language : 'en') as ChatLanguage
  const chosen: ChatService[] = []
  for (const spoken of (args.services || []).slice(0, 5)) {
    const { match, choices } = matchByName(spoken, setup.services, (s) => s.name)
    if (match) { if (!chosen.includes(match)) chosen.push(match) }
    else if (choices.length) return { note: `"${spoken}" could be ${choices.map((c) => c.name).join(' or ')}. Ask the customer which one.` }
    else return { note: `"${spoken}" is not on the menu. Tell the customer and suggest the closest service.` }
  }
  if (!chosen.length) return { note: 'Ask which service they want.' }
  const today = istDate(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || args.date < today) return { note: `Use a day from today (${today}) on. Ask which day they want.` }
  if (args.date > addDays(today, 60)) return { note: 'Bookings open up to two months ahead. Ask for an earlier day.' }

  let staffId: string | null = null
  if (args.staff_name) {
    const { match } = matchByName(args.staff_name, setup.staff, (m) => m.name)
    if (!match) return { note: `There is nobody called ${args.staff_name} on the team. Team: ${setup.staff.map((m) => m.name).join(', ') || 'none'}.` }
    if (!staffFor([match], chosen.map((s) => s.id)).length) return { note: `${match.name} does not do ${chosen.map((s) => s.name).join(', ')}. Suggest someone else or anyone.` }
    staffId = match.id
  }
  const minutes = chosen.reduce((sum, s) => sum + (Number(s.duration_minutes) || 30), 0)
  const eligible = staffFor(setup.staff, chosen.map((s) => s.id))
  const base = { now, hours: setup.settings, minutes, eligibleStaff: eligible, staffId }
  const times = freeTimes({ ...base, date: args.date, busy: await busyOn(input.supabase, input.organization.id, args.date), around: args.around || null, limit: LIST_LIMIT })
  if (!times.length) {
    const cache = new Map<string, Busy[]>()
    for (let i = 1; i < 14; i++) { const d = addDays(args.date, i); cache.set(d, await busyOn(input.supabase, input.organization.id, d)) }
    const next = nextOpenDay({ ...base, from: addDays(args.date, 1), busyFor: (d) => cache.get(d) || [] })
    return { note: `No free time on ${args.date}${next ? `. The next day with free times is ${next} (${formatIstDay(next, today)})` : ''}. Tell the customer and offer that day.` }
  }

  const { data: offer, error } = await withSalonSchema(() => input.supabase.from('salon_chat_offers').insert({
    organization_id: input.organization.id, contact_id: input.contact.id, customer_phone: input.customerPhone,
    customer_name: [input.contact.first_name, input.contact.last_name].filter(Boolean).join(' ').trim() || null,
    service_ids: chosen.map((s) => s.id), staff_id: staffId, date: args.date, language,
  }).select('id').single())
  if (error || !offer) throw new Error(error?.message || 'Could not save the times offered')
  const names = chosen.map((s) => s.name).join(', ')
  const day = formatIstDay(args.date, today)
  const body = chooseTimeText(language, names, day)
  const sent = await sendWhatsAppMessage(input.organization, buildTimesList(input.customerPhone, body, day, offer.id, times, args.date))
  if (!sent.ok) throw new Error(sent.error || 'WhatsApp did not accept the list of times')
  await logMessage(input, `${body}\n[Times: ${times.map((t) => formatIstTime(fromIst(args.date, t) || new Date())).join(', ')}]`, sent.messageId || null)
  return { sent: true }
}

/** Answer a customer message. Not handled: the next assistant in the chain answers instead. */
export async function runSalonAssistant(input: SalonChatInput, setupIn?: ChatSetup): Promise<SalonChatResult> {
  if (!salonChatReady(input.organization)) return { handled: false, reason: 'not_ready' }
  const access = input.ai
  if (!access?.allowed || !access.apiKey) return { handled: false, reason: 'ai_unavailable' }
  const setup = setupIn || await loadChatSetup(input.supabase, input.organization.id)
  if (setup.settings.chat_assistant === false) return { handled: false, reason: 'switched_off' }
  if (!setup.services.length) return { handled: false, reason: 'no_services' }
  const fetcher = input.fetcher || fetch
  const name = [input.contact.first_name].filter(Boolean).join(' ').trim()
  const messages: any[] = [
    { role: 'system', content: chatSystemPrompt(setup, input.organization, name, input.now) },
    ...input.history.slice(-8),
    { role: 'user', content: input.message },
  ]
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await aiFetch(input.supabase, access, 'salon_chat', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'required', temperature: 0.2, max_tokens: 400 }),
    }, fetcher)
    if (!res.ok) return { handled: false, reason: `openai_${res.status}` }
    const data = await res.json()
    const reply = data.choices?.[0]?.message
    const calls: any[] = reply?.tool_calls || []
    if (!calls.length) return { handled: false, reason: 'no_tool_call' }
    messages.push(reply)
    for (const call of calls) {
      let args: any = {}
      try { args = JSON.parse(call.function?.arguments || '{}') } catch { args = {} }
      const tool = call.function?.name
      if (tool === 'not_for_salon') return { handled: false, reason: String(args.reason || 'not_for_salon') }
      if (tool === 'reply_to_customer') {
        const text = String(args.message || '').trim()
        if (!text) return { handled: false, reason: 'empty_reply' }
        await sendText(input, text)
        return { handled: true, action: 'replied' }
      }
      let result: unknown
      if (tool === 'offer_times') {
        const outcome = await offerTimes(input, setup, args)
        if ('sent' in outcome) return { handled: true, action: 'offered_times' }
        result = outcome
      } else {
        result = { error: `Unknown tool ${tool}` }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return { handled: false, reason: 'too_many_rounds' }
}

// ── A time tapped in the list ────────────────────────────────────────────────

/**
 * The customer tapped a time: book it (as a request, or confirmed when the salon approves free
 * slots automatically) and tell them. Returns not handled when the button is not a salon time.
 */
export async function handleSlotPick(input: SalonChatInput & { buttonId: string }): Promise<SalonChatResult> {
  const parsed = parseSlotButton(input.buttonId)
  if (!parsed) return { handled: false, reason: 'not_a_slot' }
  const db = input.supabase
  const now = input.now ?? Date.now()
  const { data: offer } = await withSalonSchema(() => db.from('salon_chat_offers').select('*').eq('id', parsed.offerId).eq('organization_id', input.organization.id).maybeSingle())
  const language: ChatLanguage = (offer?.language || 'en') as ChatLanguage
  if (!offer || phoneKey(offer.customer_phone) !== phoneKey(input.customerPhone) || now - Date.parse(offer.created_at) > 3 * 24 * 3600_000) {
    await sendText(input, expiredText(language))
    return { handled: true, action: 'expired' }
  }
  const setup = await loadChatSetup(db, input.organization.id)
  const services = setup.services.filter((s) => (offer.service_ids || []).includes(s.id))
  if (services.length !== (offer.service_ids || []).length || !services.length) {
    await sendText(input, expiredText(language))
    return { handled: true, action: 'expired' }
  }
  const minutes = services.reduce((sum, s) => sum + (Number(s.duration_minutes) || 30), 0)
  const eligible = staffFor(setup.staff, services.map((s) => s.id))
  const base = { now, hours: setup.settings, minutes, eligibleStaff: eligible, staffId: offer.staff_id || null }
  const busy = await busyOn(db, input.organization.id, offer.date)
  const time = parsed.time
  const day = formatIstDay(offer.date, istDate(now))
  const label = formatIstTime(fromIst(offer.date, time) || new Date())
  const names = services.map((s) => s.name).join(', ')

  if (!isTimeFree({ ...base, date: offer.date, time, busy })) {
    const times = freeTimes({ ...base, date: offer.date, busy, around: time, limit: LIST_LIMIT })
    if (!times.length) {
      await sendText(input, `${takenText(language, label).replace(/[:：]$/, '.')} ${expiredText(language)}`)
      return { handled: true, action: 'taken' }
    }
    const sent = await sendWhatsAppMessage(input.organization, buildTimesList(input.customerPhone, takenText(language, label), day, offer.id, times, offer.date))
    if (!sent.ok) throw new Error(sent.error || 'WhatsApp did not accept the list of times')
    await logMessage(input, takenText(language, label), sent.messageId || null)
    return { handled: true, action: 'taken' }
  }

  const startsAt = fromIst(offer.date, time)!
  const autoApprove = setup.settings.auto_approve_bookings === true
  const staffName = offer.staff_id ? setup.staff.find((m) => m.id === offer.staff_id)?.name || null : null
  const booked = services.map((s) => ({ service_id: s.id, name: s.name, price: Number(s.price) || 0, duration_minutes: Number(s.duration_minutes) || 30, tax_rate: Number(s.tax_rate) || 0, sac_code: (s as any).sac_code || null, staff_id: offer.staff_id || null, staff_name: staffName }))
  const { error } = await withSalonSchema(() => db.from('salon_appointments').insert({
    organization_id: input.organization.id, contact_id: input.contact.id || offer.contact_id || null,
    customer_name: offer.customer_name || [input.contact.first_name, input.contact.last_name].filter(Boolean).join(' ').trim() || 'WhatsApp customer',
    customer_phone: input.customerPhone, staff_id: offer.staff_id || null,
    starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
    status: autoApprove ? 'booked' : 'requested', services: booked, notes: 'Booked on WhatsApp', source: 'chat',
  }).select('id').single())
  if (error) throw new Error(error.message)
  // One tap, one booking: the list cannot book a second time
  await db.from('salon_chat_offers').delete().eq('id', offer.id).eq('organization_id', input.organization.id)

  const business = setup.settings.business_name || input.organization.name || 'us'
  await sendText(input, autoApprove ? bookedText(language, business, names, day, label, staffName) : requestReceivedText(language, names, day, label))
  return { handled: true, action: autoApprove ? 'booked' : 'requested' }
}
