import { NextResponse } from 'next/server'
import { apiAuth } from '@/lib/public-api/auth'

export const runtime = 'nodejs'

// GET /api/v1/me: the workspace this key belongs to and what it may do (a quick way to test a key)
export async function GET(request: Request) {
  const auth = await apiAuth(request, null)
  if (!auth.ok) return auth.response
  const { organization, key } = auth.ctx
  return NextResponse.json({
    data: {
      workspace: { id: organization.id, name: organization.name },
      key: { id: key.id, name: key.name, scopes: key.scopes },
      whatsapp_connected: Boolean(organization.whatsapp_api_token && organization.whatsapp_phone_number_id),
      front_desk: (organization.enabled_connectors || []).includes('salon'),
    },
  })
}
