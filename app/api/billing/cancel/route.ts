import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getBilling } from '@/lib/billing'
import { cancelSubscription } from '@/lib/razorpay'

// POST { organizationId }: stop renewing; the workspace keeps access until the paid month ends
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = String(body?.organizationId || '')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'billing.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  try {
    const billing = await getBilling(db, organizationId)
    if (!billing?.razorpay_subscription_id || billing.status !== 'active') return NextResponse.json({ error: 'There is no active plan to cancel.' }, { status: 400 })
    await cancelSubscription(billing.razorpay_subscription_id)
    const { error } = await db.from('organization_billing').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('organization_id', organizationId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, accessUntil: billing.current_period_end })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'The plan could not be cancelled' }, { status: 502 })
  }
}
