import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'
import {
  SHIPPING_ORG_COLUMNS, bookShipment, cancelShipment, loadOrderForShipping, ratesForOrder, readyPartners, refreshShipment,
  shiprocketFor, shipmentsForOrder, withShippingSchema,
} from '@/lib/commerce/shipping'
import { notifyParcel } from '@/lib/commerce/shipping-notify'
import { askForReviewOf } from '@/lib/commerce/review-store'
import { shipBlocker, type ShippingProvider } from '@/lib/commerce/shipping-rules'

export const runtime = 'nodejs'
export const maxDuration = 60

async function loadOrg(db: any, organizationId: string) {
  const { data } = await withShippingSchema(() => db.from('organizations').select(SHIPPING_ORG_COLUMNS).eq('id', organizationId).maybeSingle())
  return data
}

// GET ?organizationId=&orderId=: this order's courier bookings and which partners are ready
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organizationId')
  const orderId = searchParams.get('orderId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const [org, loaded] = await Promise.all([loadOrg(db, organizationId!), loadOrderForShipping(db, organizationId!, orderId!)])
  if (!org || !loaded) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  const shipments = await shipmentsForOrder(db, organizationId!, orderId!)
  return NextResponse.json({ ready: readyPartners(org), blocker: shipBlocker(loaded.order), shipments })
}

/**
 * POST { organizationId, orderId, action }:
 *   rates                                  prices and days from every connected partner
 *   book    { provider, courierId, price } book that courier (AWB, pickup, label)
 *   cancel  { shipmentId }                 cancel before pickup
 *   refresh { shipmentId }                 ask the courier where it is now
 *   label   { shipmentId }                 Shiprocket: make the label again
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { organizationId, orderId, action } = body || {}
  const access = await verifyOrgAccess(request, organizationId, { permission: 'records.write' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isUuid(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const [org, loaded] = await Promise.all([loadOrg(db, organizationId), loadOrderForShipping(db, organizationId, orderId)])
  if (!org || !loaded) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  const notify = (args: any) => notifyParcel(db, args)
  const onDelivered = (id: string) => askForReviewOf(db, organizationId, id, String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin))

  try {
    if (action === 'rates') return NextResponse.json(await ratesForOrder(db, org, loaded))
    if (action === 'book') {
      const provider = body.provider as ShippingProvider
      if (provider !== 'shiprocket' && provider !== 'delhivery') return NextResponse.json({ error: 'Pick a courier.' }, { status: 400 })
      const shipment = await bookShipment(db, org, loaded, { provider, courierId: String(body.courierId || ''), price: body.price ?? null }, (access.user as any)?.id || null)
      // Ask where it is straight away: a pickup that already happened moves the order to Shipped
      await refreshShipment(db, org, shipment, { notify, onDelivered }).catch(() => null)
      return NextResponse.json({ success: true, shipments: await shipmentsForOrder(db, organizationId, orderId) })
    }
    const shipments = await shipmentsForOrder(db, organizationId, orderId)
    const shipment = shipments.find((s: any) => s.id === body.shipmentId)
    if (!shipment) return NextResponse.json({ error: 'That courier booking was not found.' }, { status: 404 })
    if (action === 'cancel') await cancelShipment(db, org, shipment)
    else if (action === 'refresh') await refreshShipment(db, org, shipment, { notify, onDelivered })
    else if (action === 'label') {
      if (shipment.provider !== 'shiprocket' || !shipment.provider_shipment_id) return NextResponse.json({ error: 'Print the Delhivery label from the Delhivery panel.' }, { status: 400 })
      const url = await shiprocketFor(db, org).label(String(shipment.provider_shipment_id))
      if (url) await db.from('commerce_shipments').update({ label_url: url, updated_at: new Date().toISOString() }).eq('id', shipment.id)
    } else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    return NextResponse.json({ success: true, shipments: await shipmentsForOrder(db, organizationId, orderId) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'The courier could not be reached. Try again.' }, { status: error?.status && error.status < 600 ? error.status : 500 })
  }
}
