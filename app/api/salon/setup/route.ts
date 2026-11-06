import { NextRequest, NextResponse } from 'next/server'
import { loadSalonSetup, salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'

// GET ?organizationId: the salon's business details, services and team (every member)
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'))
  if (!access.ok) return access.response
  try {
    return NextResponse.json({ success: true, ...(await loadSalonSetup(access.ctx.db, access.ctx.organizationId)) })
  } catch (error) {
    return serverError('setup', error)
  }
}
