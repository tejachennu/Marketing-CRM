import { NextRequest, NextResponse } from 'next/server'
import { salonAccess, serverError } from '@/lib/salon/server'
import { istDate, istDayRange } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

// GET ?organizationId&date=YYYY-MM-DD: the day's appointments (India time) and their invoices
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date')! : istDate()
  const { start, end } = istDayRange(date)
  const { db, organizationId } = access.ctx
  try {
    const { data: appointments, error } = await db.from('salon_appointments').select('*').eq('organization_id', organizationId).gte('starts_at', start).lt('starts_at', end).order('starts_at')
    if (error) throw error
    const invoiceIds = (appointments || []).map((a: any) => a.invoice_id).filter(Boolean)
    const { data: invoices } = invoiceIds.length
      ? await db.from('salon_invoices').select('id, number, total, status, payment_method, public_token').eq('organization_id', organizationId).in('id', invoiceIds)
      : { data: [] as any[] }
    return NextResponse.json({ success: true, date, appointments: appointments || [], invoices: invoices || [] })
  } catch (error) {
    return serverError('appointments', error)
  }
}
