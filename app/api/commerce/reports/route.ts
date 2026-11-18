import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { readPeriod } from '@/lib/commerce/shop-reports'
import { loadShopReport } from '@/lib/commerce/shop-reports-store'

export const runtime = 'nodejs'

/** GET ?organizationId=&days=7|30|90: visits, orders, sales, what sells, carts left, best customers. */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    return NextResponse.json({ report: await loadShopReport(getSupabaseAdminClient(), organizationId!, readPeriod(params.get('days'))) })
  } catch (error: any) {
    console.error('[Shop reports]', error?.message)
    return NextResponse.json({ error: 'The report could not be made. Please try again.' }, { status: 500 })
  }
}
