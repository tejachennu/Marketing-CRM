import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { templateInsights } from '@/lib/whatsapp-templates/meta-templates'

// GET: one template's sent, delivered, read and click counts from Meta
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const templateId = String(params.get('templateId') || '')
  if (!/^\d{1,32}$/.test(templateId)) return NextResponse.json({ error: 'Choose a template.' }, { status: 400 })
  const { data: org } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).maybeSingle()
  let credentials
  try {
    credentials = getMetaCredentials(org || {})
  } catch {
    return NextResponse.json({ error: 'Connect WhatsApp (Cloud API) in Settings to see template insights.' }, { status: 400 })
  }
  try {
    const insights = await templateInsights(credentials, templateId, Number(params.get('days')) || 7)
    return NextResponse.json(insights)
  } catch (err: any) {
    return NextResponse.json({ error: err?.details?.[0]?.error_user_msg || err?.message || 'Meta did not return insights.' }, { status: 422 })
  }
}
