import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { saveBusinessCurrency } from '@/lib/business-currency'
import { businessCurrency, CURRENCIES } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * The business's currency (lib/money.ts): one for Front Desk, E-commerce and the Sales Pipeline.
 * GET ?organizationId: the currency and the choices (anyone in the workspace).
 * PUT { organizationId, currency }: change it (admins).
 */
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: organization } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).maybeSingle()
  return NextResponse.json({ currency: businessCurrency(organization), choices: CURRENCIES.map(({ code, symbol, name }) => ({ code, symbol: symbol.trim(), name })) })
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const saved = await saveBusinessCurrency(getSupabaseAdminClient(), body.organizationId, body?.currency)
  if ('error' in saved) return NextResponse.json({ error: saved.error }, { status: 400 })
  return NextResponse.json({ success: true, currency: saved.currency })
}
