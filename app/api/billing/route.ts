import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { billingSummary } from '@/lib/billing-service'
import { ensureBillingSwitchedOn } from '@/lib/billing-auto-setup'
import { razorpayKeys } from '@/lib/razorpay'
import { can } from '@/lib/rbac'
import { AI_TOPUP_OPTIONS, MAX_AI_TOPUP, MIN_AI_TOPUP } from '@/lib/billing'
import { FEATURE_GROUPS, USE_CASES } from '@/lib/product-features'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET: the workspace's plan, access and AI credit (as a percentage). Every member may see it.
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    // Payment history is for the people who pay; everyone else sees the plan and AI credit only
    const db = getSupabaseAdminClient()
    const options = { payments: can(access.user, 'billing.manage') }
    let summary = await billingSummary(db, organizationId!, options)
    // Billing tables missing: switch billing on now (once), then read again
    if (!summary.configured && await ensureBillingSwitchedOn()) summary = await billingSummary(db, organizationId!, options)
    return NextResponse.json({
      ...summary,
      topupOptions: AI_TOPUP_OPTIONS,
      minTopup: MIN_AI_TOPUP,
      maxTopup: MAX_AI_TOPUP,
      // The public key Razorpay Checkout needs; the secret never leaves the server
      razorpayKeyId: razorpayKeys()?.keyId || null,
      // ?extras=1 (the app): what the plan includes and how businesses use it, as the web shows
      ...(new URL(request.url).searchParams.get('extras') === '1' ? { featureGroups: FEATURE_GROUPS, useCases: USE_CASES } : {}),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Billing could not be loaded' }, { status: 500 })
  }
}
