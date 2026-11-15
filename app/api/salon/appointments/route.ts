import { NextRequest, NextResponse } from 'next/server'
import { salonAccess, serverError } from '@/lib/salon/server'
import { istDate, istDayRange } from '@/lib/salon/spoken'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'

// GET ?organizationId&date=YYYY-MM-DD: the day's appointments (India time) and their invoices
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
      return NextResponse.json({ success: true, from, to, appointments: appointments || [] })
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
    const { data: requests } = await withSalonSchema(() => db.from('salon_appointments').select('*').eq('organization_id', organizationId).eq('status', 'requested')
      .gte('starts_at', istDayRange(istDate()).start).order('starts_at').limit(50))
    return NextResponse.json({ success: true, date, appointments: (appointments || []).filter((a: any) => a.status !== 'requested'), invoices: invoices || [], requests: requests || [] })
  } catch (error) {
    return serverError('appointments', error)
  }
}
