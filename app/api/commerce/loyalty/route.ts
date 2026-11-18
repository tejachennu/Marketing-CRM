import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { readLoyaltySettings } from '@/lib/commerce/loyalty'
import { loadLoyaltySettings, pointsBalance, saveLoyaltySettings } from '@/lib/commerce/loyalty-store'

export const runtime = 'nodejs'

/** GET ?organizationId=[&phone=]: loyalty settings, and a customer's points when a phone is given. */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const phone = params.get('phone')
  return NextResponse.json({ settings: await loadLoyaltySettings(db, organizationId!), ...(phone ? { points: await pointsBalance(db, organizationId!, phone) } : {}) })
}

/** PUT { organizationId, settings: { on, percent, minUse, maxPercent } } */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const settings = readLoyaltySettings(body?.settings)
  const { error } = await saveLoyaltySettings(getSupabaseAdminClient(), body.organizationId, settings)
  if (error) return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  return NextResponse.json({ success: true, settings })
}
