import { NextRequest, NextResponse } from 'next/server'
import { loadSalonSetup, salonAccess, serverError } from '@/lib/salon/server'
import { billingRowFor } from '@/lib/billing-gate'
import { billingLimits } from '@/lib/billing'
import { planAllows } from '@/lib/plans'

export const runtime = 'nodejs'

// GET ?organizationId: the salon's business details, services and team (every member)
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'))
  if (!access.ok) return access.response
  try {
    // Starter (₹300) has no own WhatsApp: the booking flow and own templates come with Growth and Pro
    const ownWhatsApp = await billingRowFor(access.ctx.db, access.ctx.organizationId).then((row) => planAllows(billingLimits(row), 'inbox')).catch(() => true)
    return NextResponse.json({ success: true, ...(await loadSalonSetup(access.ctx.db, access.ctx.organizationId)), ownWhatsApp })
  } catch (error) {
    return serverError('setup', error)
  }
}
