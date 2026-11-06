import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { parseSettings } from '@/lib/salon/validate'

export const runtime = 'nodejs'

// PUT { organizationId, ...settings }: business details for invoices and counter preferences (managers and up)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseSettings(body)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { data, error } = await db.from('salon_settings')
    .upsert({ ...parsed.value, organization_id: organizationId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single()
  if (error) return serverError('settings', error)
  return NextResponse.json({ success: true, settings: data })
}
