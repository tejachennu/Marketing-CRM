import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/rbac'
import { executeCounterAction, parseCounterAction } from '@/lib/salon/actions'
import { badRequest, loadSalonSettings, salonAccess } from '@/lib/salon/server'
import { bookingMessage, invoiceLink, invoiceMessage, sendCustomerText } from '@/lib/salon/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

function appOrigin(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  return configured || request.headers.get('origin') || new URL(request.url).origin
}

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
      invoice: (invoice) => sendCustomerText(db, organizationId, invoice.customer_phone, invoiceMessage(invoice, invoiceLink(origin, invoice.public_token))),
      booking: (appointment, staffName) => sendCustomerText(db, organizationId, appointment.customer_phone, bookingMessage(appointment, settings.business_name, staffName)),
    })
    return NextResponse.json({ success: true, ...result, link: result.invoice ? invoiceLink(origin, result.invoice.public_token) : undefined })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'That could not be done. Please try again.' }, { status: 400 })
  }
}
