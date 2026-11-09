import { NextRequest, NextResponse } from 'next/server'
import { salonAccess, serverError } from '@/lib/salon/server'
import { listChanges } from '@/lib/salon/change-log'

export const runtime = 'nodejs'

// GET ?organizationId&area&before&limit: the Front Desk change history, newest first (managers and up)
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  try {
    const entries = await listChanges(access.ctx.db, access.ctx.organizationId, {
      limit: Number(params.get('limit')) || 50,
      area: params.get('area'),
      before: params.get('before'),
    })
    return NextResponse.json({ success: true, entries })
  } catch (error) {
    return serverError('history', error)
  }
}
