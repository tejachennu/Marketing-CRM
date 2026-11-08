import { NextResponse } from 'next/server'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { apiAuth, apiError } from '@/lib/public-api/auth'
import { templateBlanks } from '@/lib/salon/message-templates'
import { listTemplates } from '@/lib/whatsapp-templates/meta-templates'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET /api/v1/templates?status=APPROVED: the workspace's WhatsApp templates (approved ones by default)
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'templates:read')
  if (!auth.ok) return auth.response
  const wanted = (new URL(request.url).searchParams.get('status') || 'APPROVED').toUpperCase()
  let credentials
  try { credentials = getMetaCredentials(auth.ctx.organization) } catch { return apiError(400, 'whatsapp_not_connected', 'Connect WhatsApp (Meta Cloud API) in Settings to use templates.') }
  try {
    const list = await listTemplates(credentials)
    const data = list.filter((t) => wanted === 'ALL' || t.status === wanted).map((t) => {
      const body = String(t.components?.find((c: any) => String(c?.type).toUpperCase() === 'BODY')?.text || '')
      const { blanks, urlButton } = templateBlanks(t)
      return { name: t.name, language: t.language, category: t.category, status: t.status, body, body_parameters: blanks, has_url_button: urlButton }
    })
    return NextResponse.json({ data })
  } catch (error: any) {
    return apiError(502, 'whatsapp_unreachable', `Meta could not be asked right now: ${error?.message || 'please try again'}.`)
  }
}
