import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { dueShipments, refreshShipment, withShippingSchema, SHIPPING_ORG_COLUMNS } from '@/lib/commerce/shipping'
import { notifyParcel } from '@/lib/commerce/shipping-notify'
import { afterDelivered } from '@/lib/commerce/order-delivered'
import { sendDueReminders } from '@/lib/commerce/cart-reminders'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET with "Authorization: Bearer <CRON_SECRET>" (Vercel Cron or any scheduler, every 30 minutes): asks the
 * couriers where open parcels are (for businesses without webhooks, and in case one was missed), and sends
 * the WhatsApp reminder for carts left at checkout an hour ago.
 * Off until CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET || '').trim()
  if (!secret) return NextResponse.json({ error: 'Set CRON_SECRET to use the scheduled shop jobs.' }, { status: 404 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = getSupabaseAdminClient()
  const started = Date.now()
  const due = await dueShipments(db)
  const orgs = new Map<string, any>()
  let checked = 0
  let moved = 0
  const failed: string[] = []
  for (const shipment of due) {
    if (Date.now() - started > 240_000) break
    let org = orgs.get(shipment.organization_id)
    if (!org) {
      const { data } = await withShippingSchema(() => db.from('organizations').select(SHIPPING_ORG_COLUMNS).eq('id', shipment.organization_id).maybeSingle())
      org = data
      orgs.set(shipment.organization_id, org)
    }
    if (!org) continue
    try {
      const result = await refreshShipment(db, org, shipment, { notify: (args) => notifyParcel(db, args), onDelivered: (id) => afterDelivered(db, shipment.organization_id, id, String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin)) })
      checked++
      if (result.moved) moved++
    } catch (error: any) {
      failed.push(`${shipment.awb}: ${error?.message || 'failed'}`)
      // Try this one again next time, not on every run in a row
      await db.from('commerce_shipments').update({ last_checked_at: new Date().toISOString() }).eq('id', shipment.id)
    }
  }
  // Carts left at checkout an hour ago: one WhatsApp reminder each
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  const carts = await sendDueReminders(db, {
    storeLink: (org) => (org.store_domain ? `https://${org.store_domain}/` : `${appUrl}/s/${org.slug}`),
    loadOrg: async (id) => (await db.from('organizations').select('*').eq('id', id).maybeSingle()).data,
  }).catch(() => ({ due: 0, sent: 0 }))
  return NextResponse.json({ success: true, parcels: { due: due.length, checked, moved, failed: failed.slice(0, 20) }, carts })
}
