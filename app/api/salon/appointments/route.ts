import { NextRequest, NextResponse } from 'next/server'
import { salonAccess, serverError } from '@/lib/salon/server'
import { istDate, istDayRange } from '@/lib/salon/spoken'
import { withSalonSchema } from '@/lib/salon/schema'
import { dayNotices } from '@/lib/salon/attendance-store'
import { FRESH_HOURS, SELF_BOOKED_SOURCES, freshBookings } from '@/lib/salon/new-bookings'

export const runtime = 'nodejs'

// GET ?organizationId&date=YYYY-MM-DD: the day's appointments (India time), their invoices and who is away (attendance)
//     &from&to: a range of days; &history=1&contact_id|phone: one customer's past visits
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db: rangeDb, organizationId: rangeOrg } = access.ctx
  const isDate = (v: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')

  // ?history=1&contact_id|phone: a customer's last 20 visits (newest first)
  if (params.get('history')) {
    const contactId = params.get('contact_id') || ''
    const digits = String(params.get('phone') || '').replace(/\D/g, '').slice(-10)
    try {
      let query = rangeDb.from('salon_appointments').select('id, starts_at, status, services, staff_id, invoice_id').eq('organization_id', rangeOrg).order('starts_at', { ascending: false }).limit(20)
      if (/^[0-9a-f-]{36}$/i.test(contactId)) query = query.eq('contact_id', contactId)
      else if (digits.length === 10) query = query.like('customer_phone', `%${digits}`)
      else return NextResponse.json({ visits: [] })
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ visits: data || [] })
    } catch (error) {
      return serverError('appointment history', error)
    }
  }

  // ?from&to: every appointment in those days (at most 62), for the week and list views
  if (isDate(params.get('from')) && isDate(params.get('to'))) {
    const from = params.get('from')!
    const to = params.get('to')! < from ? from : params.get('to')!
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
    if (days > 62) return NextResponse.json({ error: 'Choose at most two months.' }, { status: 400 })
    try {
      const { data: appointments, error } = await rangeDb.from('salon_appointments').select('*').eq('organization_id', rangeOrg)
        .gte('starts_at', istDayRange(from).start).lt('starts_at', istDayRange(to).end).neq('status', 'requested').order('starts_at').limit(3000)
      if (error) throw error
      // A booking still waiting for its online payment is not a booking yet
      return NextResponse.json({ success: true, from, to, appointments: (appointments || []).filter((a: any) => a.status !== 'awaiting_payment') })
    } catch (error) {
      return serverError('appointments', error)
    }
  }

  const date = isDate(params.get('date')) ? params.get('date')! : istDate()
  const { start, end } = istDayRange(date)
  const { db, organizationId } = access.ctx
  try {
    const { data: appointments, error } = await db.from('salon_appointments').select('*').eq('organization_id', organizationId).gte('starts_at', start).lt('starts_at', end).order('starts_at')
    if (error) throw error
    const invoiceIds = (appointments || []).map((a: any) => a.invoice_id).filter(Boolean)
    const { data: invoices } = invoiceIds.length
      ? await db.from('salon_invoices').select('id, number, total, status, payment_method, public_token').eq('organization_id', organizationId).in('id', invoiceIds)
      : { data: [] as any[] }
    // Booking requests from WhatsApp waiting for the counter, from today on (whichever day is shown)
    const [{ data: requests }, attendance, { data: recent }] = await Promise.all([
      withSalonSchema(() => db.from('salon_appointments').select('*').eq('organization_id', organizationId).eq('status', 'requested')
        .gte('starts_at', istDayRange(istDate()).start).order('starts_at').limit(50)),
      // Who is not simply present that day (on leave, absent, week off, half day): the counter warns on their bookings
      dayNotices(db, organizationId, date),
      // Bookings customers made themselves lately (website, WhatsApp, API), whatever day they are for: easy to miss
      // when the counter shows one day at a time
      db.from('salon_appointments').select('id, customer_name, customer_phone, starts_at, created_at, source, status, services, staff_id')
        .eq('organization_id', organizationId).in('source', [...SELF_BOOKED_SOURCES]).eq('status', 'booked')
        .gte('created_at', new Date(Date.now() - FRESH_HOURS * 3_600_000).toISOString()).gte('starts_at', istDayRange(istDate()).start)
        .order('created_at', { ascending: false }).limit(20),
    ])
    return NextResponse.json({ success: true, date, appointments: (appointments || []).filter((a: any) => a.status !== 'requested' && a.status !== 'awaiting_payment'), invoices: invoices || [], requests: requests || [], attendance, fresh: freshBookings(recent || []) })
  } catch (error) {
    return serverError('appointments', error)
  }
}
