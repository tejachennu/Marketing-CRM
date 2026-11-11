import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin } from '@/lib/superadmin-auth'
import { SHARED_TEMPLATES, sharedConfig, sharedTemplateStatus, submitSharedTemplates } from '@/lib/shared-whatsapp'

export const runtime = 'nodejs'

/** GET: is WAMA's number set up, and the status of its booking message templates on Meta. */
export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const config = sharedConfig()
  if (!config) return NextResponse.json({ configured: false, templates: SHARED_TEMPLATES.map((t) => ({ name: t.name, purpose: t.purpose, status: 'NOT SET UP' })) })
  try {
    return NextResponse.json({ configured: true, templates: await sharedTemplateStatus() })
  } catch (error: any) {
    return NextResponse.json({ configured: true, error: error?.message, templates: [] }, { status: 200 })
  }
}

/** POST: submit the templates Meta does not have yet. */
export async function POST(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').trim() || new URL(request.url).origin
  try {
    const result = await submitSharedTemplates(appUrl)
    return NextResponse.json({ configured: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'The templates could not be submitted' }, { status: 400 })
  }
}
