import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { stopAutoPay } from '@/lib/billing-service'

// POST { organizationId }: stop auto-pay (see stopAutoPay: before the first charge the trial simply continues)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = String(body?.organizationId || '')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'billing.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const result = await stopAutoPay(getSupabaseAdminClient(), organizationId)
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Auto-pay could not be stopped' }, { status: 502 })
  }
}
