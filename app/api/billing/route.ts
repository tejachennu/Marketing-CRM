import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { billingSummary } from '@/lib/billing-service'
import { razorpayKeys } from '@/lib/razorpay'
import { can } from '@/lib/rbac'
import { AI_TOPUP_OPTIONS, MAX_AI_TOPUP, MIN_AI_TOPUP } from '@/lib/billing'

// GET: the workspace's plan, access and AI credit (as a percentage). Every member may see it.
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    // Payment history is for the people who pay; everyone else sees the plan and AI credit only
    const summary = await billingSummary(getSupabaseAdminClient(), organizationId!, { payments: can(access.user, 'billing.manage') })
    return NextResponse.json({
      ...summary,
      topupOptions: AI_TOPUP_OPTIONS,
      minTopup: MIN_AI_TOPUP,
      maxTopup: MAX_AI_TOPUP,
      // The public key Razorpay Checkout needs; the secret never leaves the server
      razorpayKeyId: razorpayKeys()?.keyId || null,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Billing could not be loaded' }, { status: 500 })
  }
}
