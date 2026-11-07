import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { isUuid } from '@/lib/salon/validate'

export const runtime = 'nodejs'

// PATCH { organizationId, id }: the unhappy customer has been called (managers and up)
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  if (!isUuid(body?.id)) return badRequest('Choose the feedback.')
  const { db, organizationId } = access.ctx
  const { data, error } = await db.from('salon_feedback').update({ followed_up_at: new Date().toISOString() }).eq('id', body.id).eq('organization_id', organizationId).select('*').single()
  if (error) return serverError('feedback', error)
  return NextResponse.json({ success: true, feedback: data })
}
