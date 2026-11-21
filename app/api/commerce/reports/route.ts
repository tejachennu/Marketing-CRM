import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { readChannel, readPeriod, readRange } from '@/lib/commerce/shop-reports'
import { loadShopReport } from '@/lib/commerce/shop-reports-store'

export const runtime = 'nodejs'

/** GET ?organizationId=&days=1|7|30|90 (or &from=YYYY-MM-DD&to=YYYY-MM-DD)&channel=website|in_chat|in_store|phone: visits, orders, sales, what sells, carts left, best customers. */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  // Dates the owner picked, or one of the ready periods
  let days: number = readPeriod(params.get('days'))
  let end = new Date()
  if (params.get('from') || params.get('to')) {
    const range = readRange(params.get('from'), params.get('to'))
    if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 })
    days = range.days
    end = range.end
  }
  try {
    return NextResponse.json({ report: await loadShopReport(getSupabaseAdminClient(), organizationId!, days, end, readChannel(params.get('channel'))) })
  } catch (error: any) {
    console.error('[Shop reports]', error?.message)
    return NextResponse.json({ error: 'The report could not be made. Please try again.' }, { status: 500 })
  }
}
