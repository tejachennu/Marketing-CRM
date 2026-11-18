import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { parseInvoiceSettings } from '@/lib/commerce/invoice'
import { canInvoice, creditNotesFor, invoiceForOrder, invoiceLink, issueInvoice, loadInvoiceSettings, saveInvoiceSettings } from '@/lib/commerce/invoice-store'

export const runtime = 'nodejs'

const appUrl = (request: NextRequest) => String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin)
const view = (request: NextRequest, invoice: any) => invoice
  ? { number: invoice.number, status: invoice.status, total: Number(invoice.total) || 0, issuedAt: invoice.issued_at, url: invoiceLink(appUrl(request), invoice.public_token) }
  : null

/**
 * GET ?organizationId=                 the shop's GST invoice settings
 * GET ?organizationId=&orderId=        that order's invoice (null when none yet) and whether it can have one
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const orderId = params.get('orderId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  if (!orderId) return NextResponse.json({ settings: await loadInvoiceSettings(db, organizationId!) })
  const invoice = await invoiceForOrder(db, organizationId!, orderId).catch(() => null)
  const { data: order } = invoice ? { data: null } : await db.from('commerce_orders').select('id, status').eq('id', orderId).eq('organization_id', organizationId).maybeSingle()
  const notes = invoice ? await creditNotesFor(db, organizationId!, orderId) : []
  return NextResponse.json({ invoice: view(request, invoice), canIssue: Boolean(invoice) || canInvoice(order), creditNotes: notes.map((n) => ({ number: n.number, total: Number(n.total) || 0, url: invoiceLink(appUrl(request), n.public_token) })) })
}

/** POST { organizationId, orderId }: the order's invoice, issued now if it has none. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'records.write' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (typeof body.orderId !== 'string' || !body.orderId) return NextResponse.json({ error: 'Which order?' }, { status: 400 })
  try {
    const invoice = await issueInvoice(getSupabaseAdminClient(), body.organizationId, body.orderId)
    if (!invoice) return NextResponse.json({ error: 'An invoice is made once the order is confirmed (paid or cash on delivery). Cancelled orders and orders waiting for payment have none.' }, { status: 409 })
    return NextResponse.json({ success: true, invoice: view(request, invoice) })
  } catch (error: any) {
    console.error('[Shop invoice]', error?.message)
    return NextResponse.json({ error: 'The invoice could not be made. Please try again.' }, { status: 500 })
  }
}

/** PUT { organizationId, settings: { gstin, legalName, address, prefix, defaultRate } } */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const parsed = parseInvoiceSettings(body?.settings)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 })
  const { error } = await saveInvoiceSettings(getSupabaseAdminClient(), body.organizationId, parsed.settings)
  if (error) return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  return NextResponse.json({ success: true, settings: parsed.settings })
}
