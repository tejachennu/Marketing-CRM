/**
 * What the salon counter can do, in one place: book, mark arrived or started, complete and bill,
 * bill a walk-in, take a payment, void, and send a bill. The tap screens and voice both end here,
 * so every action is checked the same way whichever way it was asked for.
 */

import { randomBytes } from 'crypto'
import { computeInvoice, formatInvoiceNumber, formatRupees, type Discount } from './invoice'
import { formatIstDay, formatIstTime, istDate, parseSpokenPhone, phoneKey } from './spoken'
import { isUuid } from './validate'
import { withSalonSchema } from './schema'
import type { SalonContext } from './server'

export type PaymentMethod = 'cash' | 'upi' | 'card'
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'upi', 'card']
export const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }

export interface CustomerRef {
  contact_id?: string | null
  name: string
  phone?: string | null
}

export type CounterAction =
  | { type: 'create_appointment'; customer: CustomerRef; service_ids: string[]; staff_id?: string | null; staff_ids?: (string | null)[]; starts_at: string; notes?: string | null; send_whatsapp?: boolean }
  | { type: 'set_status'; appointment_id: string; status: 'booked' | 'arrived' | 'in_service' | 'cancelled' | 'no_show' }
  | { type: 'complete_and_bill'; appointment_id: string; extra_service_ids?: string[]; staff_ids?: (string | null)[]; discount?: Discount | null; payment_method?: PaymentMethod | null; send_whatsapp?: boolean }
  | { type: 'walk_in_bill'; customer: CustomerRef; service_ids: string[]; staff_id?: string | null; staff_ids?: (string | null)[]; discount?: Discount | null; payment_method?: PaymentMethod | null; send_whatsapp?: boolean }
  | { type: 'approve_request'; appointment_id: string; starts_at?: string | null; send_whatsapp?: boolean }
  | { type: 'decline_request'; appointment_id: string; send_whatsapp?: boolean }
  | { type: 'pay_invoice'; invoice_id: string; payment_method: PaymentMethod }
  | { type: 'void_invoice'; invoice_id: string }
  | { type: 'send_invoice'; invoice_id: string }

export const STATUS_CHANGES = ['booked', 'arrived', 'in_service', 'cancelled', 'no_show'] as const

// ── Checking an action ───────────────────────────────────────────────────────

function parseCustomer(value: any): CustomerRef | { error: string } {
  const name = String(value?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const rawPhone = String(value?.phone ?? '').trim()
  const phone = rawPhone ? parseSpokenPhone(rawPhone) : null
  if (rawPhone && !phone) return { error: 'That phone number does not look right. Say or enter the 10-digit mobile number.' }
  if (!name && !phone) return { error: 'Who is the customer? Give a name or a phone number.' }
  return { contact_id: isUuid(value?.contact_id) ? String(value.contact_id) : null, name: name || 'Walk-in customer', phone }
}

function parseDiscount(value: any): Discount | null {
  if (!value) return null
  const amount = Number(value.value)
  if (!(amount > 0)) return null
  return value.type === 'percent' ? { type: 'percent', value: Math.min(100, amount) } : { type: 'amount', value: amount }
}

function parsePayment(value: any): PaymentMethod | null {
  return PAYMENT_METHODS.includes(value) ? value : null
}

/** Who did each service, in the same order as the services (null: nobody in particular). */
function staffIds(value: any): (string | null)[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, 40).map((id) => (isUuid(id) ? String(id) : null))
}

function serviceIds(value: any): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(isUuid))].slice(0, 20)
}

/** Check an action sent by the counter. Returns the action, or what is wrong in words. */
export function parseCounterAction(body: any): { action: CounterAction } | { error: string } {
  switch (body?.type) {
    case 'create_appointment': {
      const customer = parseCustomer(body.customer)
      if ('error' in customer) return customer
      const ids = serviceIds(body.service_ids)
      if (!ids.length) return { error: 'Choose at least one service.' }
      const startsAt = Date.parse(String(body.starts_at || ''))
      if (!Number.isFinite(startsAt)) return { error: 'Choose a date and time.' }
      if (startsAt < Date.now() - 12 * 60 * 60 * 1000) return { error: 'That time has already passed.' }
      return { action: { type: 'create_appointment', customer, service_ids: ids, staff_id: isUuid(body.staff_id) ? body.staff_id : null, staff_ids: staffIds(body.staff_ids), starts_at: new Date(startsAt).toISOString(), notes: String(body.notes ?? '').trim().slice(0, 300) || null, send_whatsapp: body.send_whatsapp !== false } }
    }
    case 'set_status':
      if (!isUuid(body.appointment_id)) return { error: 'Choose an appointment.' }
      if (!STATUS_CHANGES.includes(body.status)) return { error: 'Unknown status.' }
      return { action: { type: 'set_status', appointment_id: body.appointment_id, status: body.status } }
    case 'complete_and_bill':
      if (!isUuid(body.appointment_id)) return { error: 'Choose an appointment.' }
      return { action: { type: 'complete_and_bill', appointment_id: body.appointment_id, extra_service_ids: serviceIds(body.extra_service_ids), staff_ids: staffIds(body.staff_ids), discount: parseDiscount(body.discount), payment_method: parsePayment(body.payment_method), send_whatsapp: body.send_whatsapp !== false } }
    case 'walk_in_bill': {
      const customer = parseCustomer(body.customer ?? { name: 'Walk-in customer' })
      if ('error' in customer) return customer
      const ids = serviceIds(body.service_ids)
      if (!ids.length) return { error: 'Choose at least one service.' }
      return { action: { type: 'walk_in_bill', customer, service_ids: ids, staff_id: isUuid(body.staff_id) ? body.staff_id : null, staff_ids: staffIds(body.staff_ids), discount: parseDiscount(body.discount), payment_method: parsePayment(body.payment_method), send_whatsapp: body.send_whatsapp !== false } }
    }
    case 'approve_request': {
      if (!isUuid(body.appointment_id)) return { error: 'Choose a booking request.' }
      let startsAt: string | null = null
      if (body.starts_at) {
        const at = Date.parse(String(body.starts_at))
        if (!Number.isFinite(at)) return { error: 'Choose a date and time.' }
        if (at < Date.now() - 15 * 60 * 1000) return { error: 'That time has already passed.' }
        startsAt = new Date(at).toISOString()
      }
      return { action: { type: 'approve_request', appointment_id: body.appointment_id, starts_at: startsAt, send_whatsapp: body.send_whatsapp !== false } }
    }
    case 'decline_request':
      if (!isUuid(body.appointment_id)) return { error: 'Choose a booking request.' }
      return { action: { type: 'decline_request', appointment_id: body.appointment_id, send_whatsapp: body.send_whatsapp !== false } }
    case 'pay_invoice': {
      if (!isUuid(body.invoice_id)) return { error: 'Choose an invoice.' }
      const method = parsePayment(body.payment_method)
      if (!method) return { error: 'Choose how they paid: cash, UPI or card.' }
      return { action: { type: 'pay_invoice', invoice_id: body.invoice_id, payment_method: method } }
    }
    case 'void_invoice':
    case 'send_invoice':
      if (!isUuid(body.invoice_id)) return { error: 'Choose an invoice.' }
      return { action: { type: body.type, invoice_id: body.invoice_id } }
    default:
      return { error: 'Unknown action.' }
  }
}

// ── Doing it ─────────────────────────────────────────────────────────────────

export interface ActionResult {
  appointment?: any
  invoice?: any
  whatsapp?: { sent: boolean; error?: string; windowClosed?: boolean } | null
  /** Short message for the counter, e.g. "Booked Priya at 5:00 pm" */
  message: string
  warning?: string
}

async function checked<T = any>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

/** The customer's contact: the one given, or found by phone, or saved now (so they appear in the inbox). */
export async function resolveCustomer(db: any, organizationId: string, customer: CustomerRef): Promise<{ contact_id: string | null; name: string; phone: string | null }> {
  if (customer.contact_id) {
    const contact = await checked(db.from('contacts').select('id, first_name, last_name, phone_number').eq('id', customer.contact_id).eq('organization_id', organizationId).maybeSingle())
    if (contact) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
      return { contact_id: contact.id, name: customer.name && customer.name !== 'Walk-in customer' ? customer.name : name || customer.name, phone: customer.phone || contact.phone_number || null }
    }
  }
  if (!customer.phone) return { contact_id: null, name: customer.name, phone: null }
  const key = phoneKey(customer.phone)
  const matches = await checked(db.from('contacts').select('id, first_name, last_name, phone_number').eq('organization_id', organizationId).ilike('phone_number', `%${key}`).limit(1))
  if (matches?.[0]) return { contact_id: matches[0].id, name: customer.name, phone: customer.phone }
  const [first, ...rest] = customer.name === 'Walk-in customer' ? ['Customer'] : customer.name.split(' ')
  const created = await checked(db.from('contacts').insert({
    organization_id: organizationId, first_name: first, last_name: rest.join(' ') || null,
    phone_number: customer.phone, whatsapp_number: `whatsapp:${customer.phone}`, tags: ['Salon'],
  }).select('id').single())
  return { contact_id: created?.id || null, name: customer.name, phone: customer.phone }
}

async function loadServices(db: any, organizationId: string, ids: string[]) {
  if (!ids.length) return []
  const rows = await checked(db.from('salon_services').select('*').eq('organization_id', organizationId).in('id', ids))
  const byId = new Map((rows || []).map((row: any) => [row.id, row]))
  const missing = ids.filter((id) => !byId.has(id))
  if (missing.length) throw new Error('One of those services is no longer on your list.')
  return ids.map((id) => {
    const row: any = byId.get(id)
    return { service_id: row.id, name: row.name, price: Number(row.price) || 0, duration_minutes: Number(row.duration_minutes) || 30, tax_rate: Number(row.tax_rate) || 0, sac_code: row.sac_code || null }
  })
}

type StaffMember = { id: string; name: string }

/** The team members named, by id. Any that are not on this salon's list are refused. */
async function loadStaffMembers(db: any, organizationId: string, ids: (string | null | undefined)[]): Promise<Map<string, StaffMember>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[]
  if (!unique.length) return new Map()
  const rows: StaffMember[] = await checked(db.from('salon_staff').select('id, name').eq('organization_id', organizationId).in('id', unique))
  const members = new Map((rows || []).map((row) => [row.id, row]))
  if (unique.some((id) => !members.has(id))) throw new Error('That team member is no longer on your list.')
  return members
}

/**
 * Who did each service. With a list from the counter, each service gets the person chosen for it;
 * otherwise the person it was booked with, or the one chosen for the whole visit.
 */
export function assignStaff<T extends object>(services: T[], chosen: (string | null)[] | undefined, fallback: string | null | undefined, members: Map<string, StaffMember>): (T & { staff_id: string | null; staff_name: string | null })[] {
  return services.map((service, index) => {
    const id = chosen && index < chosen.length ? chosen[index] : (service as { staff_id?: string | null }).staff_id || fallback || null
    const member = id ? members.get(id) : undefined
    return { ...service, staff_id: member?.id || null, staff_name: member?.name || null }
  })
}

/** The people on a visit: the first one's id (for the board) and everyone's names. */
export function staffSummary(services: { staff_id?: string | null; staff_name?: string | null }[]): { staff_id: string | null; staff_name: string | null } {
  const ids = [...new Set(services.map((s) => s.staff_id).filter(Boolean))] as string[]
  const names = [...new Set(services.map((s) => s.staff_name).filter(Boolean))] as string[]
  return { staff_id: ids[0] || null, staff_name: names.join(', ') || null }
}

function makeToken(): string {
  return randomBytes(18).toString('base64url')
}

/** Issue a GST invoice with the next number. Retries if two counters bill at the same moment. */
export async function issueInvoice(db: any, ctx: { organizationId: string; userId?: string | null; settings: any }, input: {
  customer: { contact_id: string | null; name: string; phone: string | null }
  lines: { service_id: string | null; name: string; price: number; tax_rate: number; sac_code: string | null }[]
  discount?: Discount | null
  payment_method?: PaymentMethod | null
  appointment_id?: string | null
  staff_name?: string | null
}) {
  const settings = ctx.settings
  // Without a GSTIN a business cannot charge GST: the bill carries no tax
  const registered = Boolean(settings.gstin)
  const totals = computeInvoice(input.lines.map((line) => ({ ...line, tax_rate: registered ? line.tax_rate : 0 })), { pricesIncludeTax: Boolean(settings.prices_include_tax), discount: input.discount })
  const business = { name: settings.business_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, note: settings.invoice_note, logo_url: settings.logo_url || null }
  const now = new Date().toISOString()
  const askFeedback = settings.feedback_enabled !== false && Boolean(input.customer.phone)
  const feedbackDueAt = askFeedback ? new Date(Date.now() + (Number(settings.feedback_delay_minutes) || 120) * 60_000).toISOString() : null
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await checked(db.from('salon_invoices').select('seq').eq('organization_id', ctx.organizationId).order('seq', { ascending: false }).limit(1))
    const seq = (Number(last?.[0]?.seq) || 0) + 1
    const { data, error } = await withSalonSchema(() => db.from('salon_invoices').insert({
      organization_id: ctx.organizationId, seq, number: formatInvoiceNumber(settings.invoice_prefix, seq),
      appointment_id: input.appointment_id || null, contact_id: input.customer.contact_id, customer_name: input.customer.name,
      customer_phone: input.customer.phone, staff_name: input.staff_name || null, items: totals.lines,
      prices_include_tax: Boolean(settings.prices_include_tax), subtotal: totals.subtotal, discount: totals.discount, taxable: totals.taxable,
      cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total,
      status: input.payment_method ? 'paid' : 'unpaid', payment_method: input.payment_method || null, paid_at: input.payment_method ? now : null,
      public_token: makeToken(), business, created_by: ctx.userId || null, issued_at: now,
      ...(feedbackDueAt ? { feedback_due_at: feedbackDueAt } : {}),
    }).select('*').single())
    if (!error) return data
    if (!(error.code === '23505' || /duplicate key/i.test(error.message || ''))) throw new Error(error.message)
  }
  throw new Error('The invoice could not be numbered. Please try again.')
}

function servicesText(services: { name: string }[]): string {
  return services.map((service) => service.name).join(', ')
}

/** Do a counter action. `send` delivers WhatsApp messages (left out in tests). */
export async function executeCounterAction(
  ctx: SalonContext & { settings: any },
  action: CounterAction,
  send?: { invoice: (invoice: any) => Promise<ActionResult['whatsapp']>; booking: (appointment: any, staffName: string | null) => Promise<ActionResult['whatsapp']>; text?: (phone: string, body: string) => Promise<ActionResult['whatsapp']> }
): Promise<ActionResult> {
  const { db, organizationId } = ctx
  const userId = ctx.user?.id || null
  const now = new Date().toISOString()

  switch (action.type) {
    case 'create_appointment': {
      const [loaded, members, customer] = await Promise.all([
        loadServices(db, organizationId, action.service_ids),
        loadStaffMembers(db, organizationId, [action.staff_id, ...(action.staff_ids || [])]),
        resolveCustomer(db, organizationId, action.customer),
      ])
      const services = assignStaff(loaded, action.staff_ids, action.staff_id, members)
      const team = staffSummary(services)
      const minutes = services.reduce((sum, service) => sum + service.duration_minutes, 0)
      const endsAt = new Date(Date.parse(action.starts_at) + minutes * 60 * 1000).toISOString()
      let warning: string | undefined
      const busyIds = [...new Set(services.map((s) => s.staff_id).filter(Boolean))] as string[]
      if (busyIds.length) {
        const overlapping = await checked(db.from('salon_appointments').select('id, customer_name, starts_at, staff_id').eq('organization_id', organizationId).in('staff_id', busyIds)
          .lt('starts_at', endsAt).gt('ends_at', action.starts_at).in('status', ['booked', 'arrived', 'in_service']))
        if (overlapping?.length) warning = `${members.get(overlapping[0].staff_id)?.name || 'They'} already has ${overlapping[0].customer_name} at ${formatIstTime(overlapping[0].starts_at)}.`
      }
      const appointment = await checked(db.from('salon_appointments').insert({
        organization_id: organizationId, contact_id: customer.contact_id, customer_name: customer.name, customer_phone: customer.phone,
        staff_id: team.staff_id, starts_at: action.starts_at, ends_at: endsAt, status: 'booked', services, notes: action.notes || null, created_by: userId,
      }).select('*').single())
      const whatsapp = action.send_whatsapp && customer.phone && send ? await send.booking(appointment, team.staff_name) : null
      return { appointment, whatsapp, warning, message: `Booked ${customer.name} · ${formatIstDay(istDate(action.starts_at))} ${formatIstTime(action.starts_at)}` }
    }

    case 'set_status': {
      const appointment = await checked(db.from('salon_appointments').select('*').eq('id', action.appointment_id).eq('organization_id', organizationId).maybeSingle())
      if (!appointment) throw new Error('That appointment was not found.')
      if (appointment.status === 'completed') throw new Error('This appointment is already billed.')
      const updated = await checked(db.from('salon_appointments').update({ status: action.status, updated_at: now }).eq('id', appointment.id).eq('organization_id', organizationId).select('*').single())
      const words: Record<string, string> = { booked: 'is booked again', arrived: 'has arrived', in_service: 'is being served', cancelled: '— appointment cancelled', no_show: 'did not come' }
      return { appointment: updated, message: `${appointment.customer_name} ${words[action.status]}` }
    }

    case 'complete_and_bill': {
      const appointment = await checked(db.from('salon_appointments').select('*').eq('id', action.appointment_id).eq('organization_id', organizationId).maybeSingle())
      if (!appointment) throw new Error('That appointment was not found.')
      if (appointment.status === 'cancelled') throw new Error('This appointment was cancelled.')
      if (appointment.invoice_id) {
        const existing = await checked(db.from('salon_invoices').select('*').eq('id', appointment.invoice_id).eq('organization_id', organizationId).maybeSingle())
        if (existing) return { appointment, invoice: existing, message: `${appointment.customer_name} is already billed (${existing.number})` }
      }
      const extra = await loadServices(db, organizationId, action.extra_service_ids || [])
      const all: any[] = [...(appointment.services || []), ...extra]
      // Staff chosen now must be on the list; anyone booked earlier who has since left is simply left off
      const members = await loadStaffMembers(db, organizationId, action.staff_ids || [])
      const bookedIds = [...new Set([appointment.staff_id, ...all.map((s) => s.staff_id)].filter((id) => id && !members.has(id)))]
      if (bookedIds.length) {
        const booked: StaffMember[] = await checked(db.from('salon_staff').select('id, name').eq('organization_id', organizationId).in('id', bookedIds))
        for (const member of booked || []) members.set(member.id, member)
      }
      const services = assignStaff(all, action.staff_ids, appointment.staff_id, members)
      const team = staffSummary(services)
      const invoice = await issueInvoice(db, { organizationId, userId, settings: ctx.settings }, {
        customer: { contact_id: appointment.contact_id, name: appointment.customer_name, phone: appointment.customer_phone },
        lines: services, discount: action.discount, payment_method: action.payment_method,
        appointment_id: appointment.id, staff_name: team.staff_name,
      })
      const updated = await checked(db.from('salon_appointments').update({ status: 'completed', invoice_id: invoice.id, services, staff_id: team.staff_id || appointment.staff_id || null, updated_at: now }).eq('id', appointment.id).eq('organization_id', organizationId).select('*').single())
      const whatsapp = action.send_whatsapp && invoice.customer_phone && send ? await send.invoice(invoice) : null
      return { appointment: updated, invoice, whatsapp, message: `${invoice.number} · ${formatRupees(Number(invoice.total))}${invoice.status === 'paid' ? ` paid by ${PAYMENT_LABELS[invoice.payment_method as PaymentMethod]}` : ' (not paid yet)'}` }
    }

    case 'walk_in_bill': {
      const [loaded, members, customer] = await Promise.all([
        loadServices(db, organizationId, action.service_ids),
        loadStaffMembers(db, organizationId, [action.staff_id, ...(action.staff_ids || [])]),
        resolveCustomer(db, organizationId, action.customer),
      ])
      const services = assignStaff(loaded, action.staff_ids, action.staff_id, members)
      const team = staffSummary(services)
      const minutes = services.reduce((sum, service) => sum + service.duration_minutes, 0)
      const startsAt = new Date(Date.now() - minutes * 60 * 1000).toISOString()
      const appointment = await checked(db.from('salon_appointments').insert({
        organization_id: organizationId, contact_id: customer.contact_id, customer_name: customer.name, customer_phone: customer.phone,
        staff_id: team.staff_id, starts_at: startsAt, ends_at: now, status: 'completed', services, notes: 'Walk-in', created_by: userId,
      }).select('*').single())
      const invoice = await issueInvoice(db, { organizationId, userId, settings: ctx.settings }, {
        customer, lines: services, discount: action.discount, payment_method: action.payment_method, appointment_id: appointment.id, staff_name: team.staff_name,
      })
      const updated = await checked(db.from('salon_appointments').update({ invoice_id: invoice.id }).eq('id', appointment.id).eq('organization_id', organizationId).select('*').single())
      const whatsapp = action.send_whatsapp && invoice.customer_phone && send ? await send.invoice(invoice) : null
      return { appointment: updated, invoice, whatsapp, message: `${invoice.number} · ${formatRupees(Number(invoice.total))} · ${customer.name}` }
    }

    case 'approve_request':
    case 'decline_request': {
      const appointment = await checked(db.from('salon_appointments').select('*').eq('id', action.appointment_id).eq('organization_id', organizationId).maybeSingle())
      if (!appointment) throw new Error('That booking request was not found.')
      if (appointment.status !== 'requested') throw new Error(appointment.status === 'cancelled' ? 'This request was already declined.' : 'This request was already handled.')
      if (action.type === 'decline_request') {
        const updated = await checked(db.from('salon_appointments').update({ status: 'cancelled', notes: [appointment.notes, 'Declined at the counter'].filter(Boolean).join(' · '), updated_at: now }).eq('id', appointment.id).eq('organization_id', organizationId).select('*').single())
        const when = `${formatIstDay(istDate(appointment.starts_at))} ${formatIstTime(appointment.starts_at)}`
        const whatsapp = action.send_whatsapp && appointment.customer_phone && send?.text
          ? await send.text(appointment.customer_phone, `Sorry, we cannot take ${when} for ${servicesText(appointment.services || [])}. Reply here with another day or time and we will find you a slot. 🙏`)
          : null
        return { appointment: updated, whatsapp, message: `Declined ${appointment.customer_name}'s request` }
      }
      const length = Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)
      const startsAt = action.starts_at || appointment.starts_at
      const updated = await checked(db.from('salon_appointments').update({
        status: 'booked', starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + Math.max(length, 15 * 60_000)).toISOString(), updated_at: now,
      }).eq('id', appointment.id).eq('organization_id', organizationId).select('*').single())
      const team = staffSummary(updated.services || [])
      const whatsapp = action.send_whatsapp && updated.customer_phone && send ? await send.booking(updated, team.staff_name) : null
      return { appointment: updated, whatsapp, message: `Booked ${updated.customer_name} · ${formatIstDay(istDate(startsAt))} ${formatIstTime(startsAt)}` }
    }

    case 'pay_invoice': {
      const invoice = await checked(db.from('salon_invoices').select('*').eq('id', action.invoice_id).eq('organization_id', organizationId).maybeSingle())
      if (!invoice) throw new Error('That invoice was not found.')
      if (invoice.status === 'void') throw new Error('This invoice was cancelled.')
      const updated = await checked(db.from('salon_invoices').update({ status: 'paid', payment_method: action.payment_method, paid_at: invoice.paid_at || now, updated_at: now }).eq('id', invoice.id).eq('organization_id', organizationId).select('*').single())
      return { invoice: updated, message: `${invoice.number} paid by ${PAYMENT_LABELS[action.payment_method]}` }
    }

    case 'void_invoice': {
      const invoice = await checked(db.from('salon_invoices').select('*').eq('id', action.invoice_id).eq('organization_id', organizationId).maybeSingle())
      if (!invoice) throw new Error('That invoice was not found.')
      const updated = await checked(db.from('salon_invoices').update({ status: 'void', updated_at: now }).eq('id', invoice.id).eq('organization_id', organizationId).select('*').single())
      return { invoice: updated, message: `${invoice.number} cancelled. It stays on record, marked void.` }
    }

    case 'send_invoice': {
      const invoice = await checked(db.from('salon_invoices').select('*').eq('id', action.invoice_id).eq('organization_id', organizationId).maybeSingle())
      if (!invoice) throw new Error('That invoice was not found.')
      if (!invoice.customer_phone) throw new Error('This customer has no phone number.')
      const whatsapp = send ? await send.invoice(invoice) : null
      return { invoice, whatsapp, message: whatsapp?.sent ? `Bill sent to ${invoice.customer_name} on WhatsApp` : 'The bill could not be sent on WhatsApp' }
    }
  }
}

export { servicesText }
