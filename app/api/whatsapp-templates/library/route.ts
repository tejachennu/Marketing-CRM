import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { createFromLibrary, listLibrary, type LibraryButtonInput } from '@/lib/whatsapp-templates/meta-templates'

async function credentialsFor(organizationId: string) {
  const { data: org } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).maybeSingle()
  try {
    return getMetaCredentials(org || {})
  } catch {
    return null
  }
}

const NOT_CONNECTED = 'Connect WhatsApp (Cloud API) in Settings to use the template library.'

// GET: search Meta's pre-approved template library
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const credentials = await credentialsFor(organizationId!)
  if (!credentials) return NextResponse.json({ error: NOT_CONNECTED, templates: [] }, { status: 400 })
  try {
    const templates = await listLibrary(credentials, {
      search: params.get('search') || undefined,
      topic: params.get('topic') || undefined,
      language: params.get('language') || undefined,
    })
    return NextResponse.json({ templates })
  } catch (err: any) {
    return NextResponse.json({ error: err?.details?.[0]?.error_user_msg || err?.message || 'Meta did not return the library.', templates: [] }, { status: 422 })
  }
}

// POST: create a template from the library
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'campaigns.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const name = String(body.name || '')
  const libraryName = String(body.libraryName || '')
  if (!/^[a-z0-9_]{1,512}$/.test(name)) return NextResponse.json({ error: 'Use only lowercase letters, numbers and underscores in the name.' }, { status: 400 })
  if (!/^[a-z0-9_]+$/.test(libraryName)) return NextResponse.json({ error: 'Choose a template from the library.' }, { status: 400 })
  const buttonInputs: LibraryButtonInput[] = (Array.isArray(body.buttonInputs) ? body.buttonInputs : []).slice(0, 10).flatMap((input: any): LibraryButtonInput[] => {
    if (input?.type === 'URL' && /^https:\/\/\S+$/.test(String(input.url?.base_url || ''))) {
      return [{ type: 'URL', url: { base_url: String(input.url.base_url), ...(input.url.url_suffix_example ? { url_suffix_example: String(input.url.url_suffix_example) } : {}) } }]
    }
    if (input?.type === 'PHONE_NUMBER' && /^\+?[1-9]\d{6,18}$/.test(String(input.phone_number || '').replace(/[\s-]/g, ''))) {
      return [{ type: 'PHONE_NUMBER', phone_number: String(input.phone_number).replace(/[\s-]/g, '') }]
    }
    return []
  })
  const credentials = await credentialsFor(body.organizationId)
  if (!credentials) return NextResponse.json({ error: NOT_CONNECTED }, { status: 400 })
  try {
    const result = await createFromLibrary(credentials, { name, language: String(body.language || 'en_US'), libraryName, buttonInputs })
    return NextResponse.json({ success: true, id: result.id, status: result.status })
  } catch (err: any) {
    return NextResponse.json({ error: err?.details?.[0]?.error_user_msg || err?.message || 'Meta did not create the template.' }, { status: 422 })
  }
}
