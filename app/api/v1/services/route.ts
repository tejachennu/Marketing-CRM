import { NextResponse } from 'next/server'
import { apiAuth, frontDeskOff } from '@/lib/public-api/auth'
import { toApiService } from '@/lib/public-api/front-desk'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'

// GET /api/v1/services?include_inactive=true: Front Desk services and prices
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'front_desk:read')
  if (!auth.ok) return auth.response
  const off = frontDeskOff(auth.ctx.organization)
  if (off) return off
  const all = new URL(request.url).searchParams.get('include_inactive') === 'true'
  const { data } = await withSalonSchema(() => auth.ctx.db.from('salon_services').select('*').eq('organization_id', auth.ctx.organizationId).order('position').order('name'))
  return NextResponse.json({ data: (data || []).filter((s: any) => all || s.active !== false).map(toApiService) })
}
