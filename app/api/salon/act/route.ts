import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/rbac'
import { executeCounterAction, parseCounterAction } from '@/lib/salon/actions'
import { appOrigin, badRequest, loadSalonSettings, salonAccess } from '@/lib/salon/server'
import { billTemplate, bookingMessage, bookingTemplate, invoiceLink, invoiceMessage, sendCustomerText } from '@/lib/salon/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST { organizationId, action }: do something at the counter (see lib/salon/actions.ts)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'records.write')
  if (!access.ok) return access.response
  const parsed = parseCounterAction(body?.action)
  if ('error' in parsed) return badRequest(parsed.error)
  // Cancelling an issued invoice is for managers and up
  if (parsed.action.type === 'void_invoice' && !can(access.ctx.user, 'automation.manage')) {
    return NextResponse.json({ error: 'Only managers and admins can cancel an invoice.' }, { status: 403 })
  }
  const { db, organizationId } = access.ctx
  try {
    const settings = await loadSalonSettings(db, organizationId)
    const origin = appOrigin(request)
    const result = await executeCounterAction({ ...access.ctx, settings }, parsed.action, {
      invoice: (invoice) => sendCustomerText(db, organizationId, invoice.customer_phone, invoiceMessage(invoice, invoiceLink(origin, invoice.public_token)), billTemplate(invoice)),
      booking: (appointment, staffName) => sendCustomerText(db, organizationId, appointment.customer_phone, bookingMessage(appointment, settings.business_name, staffName), bookingTemplate(appointment, settings.business_name, staffName)),
      text: (phone, body) => sendCustomerText(db, organizationId, phone, body),
    })
    return NextResponse.json({ success: true, ...result, link: result.invoice ? invoiceLink(origin, result.invoice.public_token) : undefined })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'That could not be done. Please try again.' }, { status: 400 })
  }
}
