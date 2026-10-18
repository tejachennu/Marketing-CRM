import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials, type MetaCredentials } from '@/lib/flows/meta-client'
import { createTemplate, deleteTemplate, editTemplate, listTemplates } from '@/lib/whatsapp-templates/meta-templates'
import { validateDraft, type TemplateDraft } from '@/lib/whatsapp-templates/template-model'

/** The organization's WhatsApp connection, or a message saying what is missing. */
async function credentialsFor(organizationId: string): Promise<{ credentials?: MetaCredentials; error?: string }> {
  const { data: org } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).maybeSingle()
  if (!org) return { error: 'Organization not found' }
  try {
    return { credentials: getMetaCredentials(org) }
  } catch {
    return { error: 'Connect WhatsApp (Cloud API) in Settings to manage message templates.' }
  }
}

const metaError = (err: any) => {
  const detail = err?.details?.[0]
  const message = detail?.error_user_msg || detail?.error_user_title || err?.message || 'Meta did not accept the request.'
  return NextResponse.json({ error: message, code: detail?.code ?? null, subcode: detail?.error_subcode ?? null }, { status: 422 })
}

// GET: every template on the WhatsApp Business account, live from Meta (all statuses)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const { credentials, error } = await credentialsFor(organizationId!)
  if (!credentials) return NextResponse.json({ error, templates: [] }, { status: 400 })
  try {
    const templates = await listTemplates(credentials)
    return NextResponse.json({ templates, syncedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return metaError(err)
  }
}

async function readBody(request: NextRequest) {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' ? body : {}
}

// POST: submit a new template for review
export async function POST(request: NextRequest) {
  const body = await readBody(request)
  const access = await verifyOrgAccess(request, body.organizationId, { permission: 'campaigns.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const draft = body.draft as TemplateDraft
  const problems = draft ? validateDraft(draft) : [{ field: 'draft', message: 'Nothing to submit.' }]
  if (problems.length) return NextResponse.json({ error: problems[0].message, problems }, { status: 400 })
  const { credentials, error } = await credentialsFor(body.organizationId)
  if (!credentials) return NextResponse.json({ error }, { status: 400 })
  try {
    const result = await createTemplate(credentials, draft)
    return NextResponse.json({ success: true, id: result.id, status: result.status, category: result.category })
  } catch (err) {
    return metaError(err)
  }
}

// PATCH: edit a template's content (name and language stay)
export async function PATCH(request: NextRequest) {
  const body = await readBody(request)
  const access = await verifyOrgAccess(request, body.organizationId, { permission: 'campaigns.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const templateId = String(body.templateId || '')
  if (!/^\d+$/.test(templateId)) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  const draft = body.draft as TemplateDraft
  const problems = draft ? validateDraft(draft) : [{ field: 'draft', message: 'Nothing to save.' }]
  if (problems.length) return NextResponse.json({ error: problems[0].message, problems }, { status: 400 })
  const { credentials, error } = await credentialsFor(body.organizationId)
  if (!credentials) return NextResponse.json({ error }, { status: 400 })
  try {
    // Meta lets the category change only while a template is not approved
    await editTemplate(credentials, templateId, draft, { changeCategory: body.changeCategory === true })
    return NextResponse.json({ success: true })
  } catch (err) {
    return metaError(err)
  }
}

// DELETE: one language of a template (templateId), or every language of the name
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'campaigns.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const name = String(params.get('name') || '')
  const templateId = params.get('templateId')
  if (!/^[a-z0-9_]+$/.test(name) || (templateId && !/^\d+$/.test(templateId))) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  const { credentials, error } = await credentialsFor(organizationId!)
  if (!credentials) return NextResponse.json({ error }, { status: 400 })
  try {
    await deleteTemplate(credentials, name, templateId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return metaError(err)
  }
}
