import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { SHARED_TEMPLATES, findSharedNumber, sharedTemplateStatus, submitSharedTemplates } from '@/lib/shared-whatsapp'

export const runtime = 'nodejs'

/** GET: is WAMA's number set up (and where it comes from), and the status of its booking message templates on Meta. */
export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const source = await findSharedNumber(getSupabaseAdminClient())
  if (!source.config) return NextResponse.json({ configured: false, why: source.why || null, templates: SHARED_TEMPLATES.map((t) => ({ name: t.name, purpose: t.purpose, status: 'NOT SET UP' })) })
  try {
    return NextResponse.json({ configured: true, from: source.from, templates: await sharedTemplateStatus(source.config) })
  } catch (error: any) {
    return NextResponse.json({ configured: true, from: source.from, error: error?.message, templates: [] })
  }
}

/** POST: submit the templates Meta does not have yet. */
export async function POST(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').trim() || new URL(request.url).origin
  try {
    const source = await findSharedNumber(getSupabaseAdminClient())
    const result = await submitSharedTemplates(source.config, appUrl)
    return NextResponse.json({ configured: true, from: source.from, ...result })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'The templates could not be submitted' }, { status: 400 })
  }
}
