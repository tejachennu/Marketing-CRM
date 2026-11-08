import { NextResponse } from 'next/server'
import { apiAuth, frontDeskOff } from '@/lib/public-api/auth'
import { toApiStaff } from '@/lib/public-api/front-desk'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'

// GET /api/v1/staff: the team, and which services each one does (none listed: all)
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const { data } = await withSalonSchema(() => auth.ctx.db.from('salon_staff').select('id, name, active, service_ids').eq('organization_id', auth.ctx.organizationId).order('name'))
  return NextResponse.json({ data: (data || []).map(toApiStaff) })
}
