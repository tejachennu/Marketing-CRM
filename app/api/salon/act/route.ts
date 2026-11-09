import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/rbac'
import { claimClientRef, isClientRef, releaseClientRef, saveClientResult } from '@/lib/salon/action-log'
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
  // From the mobile app's offline queue: the same reference means the same action, done once
  const clientRef = isClientRef(body?.client_ref) ? body.client_ref : null
  if (clientRef) {
    try {
      const claim = await claimClientRef(db, organizationId, clientRef)
      if (!claim.fresh) {
        if (claim.result) return NextResponse.json({ ...claim.result, replayed: true })
        return NextResponse.json({ error: 'This is still being saved. Try again in a moment.' }, { status: 409 })
      }
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'That could not be saved. Please try again.' }, { status: 500 })
    }
  }
  try {
    const settings = await loadSalonSettings(db, organizationId)
    const origin = appOrigin(request)
    const result = await executeCounterAction({ ...access.ctx, settings }, parsed.action, {
      invoice: (invoice) => sendCustomerText(db, organizationId, invoice.customer_phone, invoiceMessage(invoice, invoiceLink(origin, invoice.public_token)), billTemplate(invoice)),
      booking: (appointment, staffName) => sendCustomerText(db, organizationId, appointment.customer_phone, bookingMessage(appointment, settings.business_name, staffName), bookingTemplate(appointment, settings.business_name, staffName)),
      text: (phone, body) => sendCustomerText(db, organizationId, phone, body),
    })
    const response = { success: true, ...result, link: result.invoice ? invoiceLink(origin, result.invoice.public_token) : undefined }
    if (clientRef) await saveClientResult(db, organizationId, clientRef, response)
    return NextResponse.json(response)
  } catch (error: any) {
    if (clientRef) await releaseClientRef(db, organizationId, clientRef).catch(() => {})
    return NextResponse.json({ error: error?.message || 'That could not be done. Please try again.' }, { status: 400 })
  }
}
