import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { applyTracking, sameKey, withShippingSchema } from '@/lib/commerce/shipping'
import { notifyParcel } from '@/lib/commerce/shipping-notify'
import { shiprocketWebhook } from '@/lib/commerce/shiprocket'
import { delhiveryWebhook } from '@/lib/commerce/delhivery'

export const runtime = 'nodejs'

/**
 * POST: tracking updates pushed by a courier partner. Shiprocket (Settings → API → Webhooks) and Delhivery
 * (set up by their team) both send the key WAMA shows the business in the "x-api-key" header. The parcel is
 * found by its AWB and the key must be that business's key. The path has no "shiprocket", "sr" or "kr" in it
 * (Shiprocket refuses such addresses), and the answer is always 200 so couriers do not retry for ever.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const key = request.headers.get('x-api-key') || (request.headers.get('authorization') || '').replace(/^(Bearer|Token)\s+/i, '')
  const update = body?.Shipment || body?.shipment ? delhiveryWebhook(body) : shiprocketWebhook(body)
  if (!update) return NextResponse.json({ ok: true, note: 'nothing to do' })
  const provider = body?.Shipment || body?.shipment ? 'delhivery' : 'shiprocket'
  const db = getSupabaseAdminClient()
  const { data: shipment } = await withShippingSchema(() => db.from('commerce_shipments').select('*').eq('provider', provider).eq('awb', update.awb).maybeSingle())
  if (!shipment) return NextResponse.json({ ok: true, note: 'unknown parcel' })
  const { data: org } = await db.from('organizations').select('id, shipping_webhook_token').eq('id', shipment.organization_id).maybeSingle()
  if (!sameKey(key, org?.shipping_webhook_token)) return NextResponse.json({ ok: false, error: 'Wrong key' }, { status: 401 })
  await applyTracking(db, shipment, update, { notify: (args) => notifyParcel(db, args) })
  return NextResponse.json({ ok: true })
}
