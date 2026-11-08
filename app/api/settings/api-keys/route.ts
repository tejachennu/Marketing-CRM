import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { generateApiKey, hashApiKey, keyPreview, MAX_KEYS_PER_WORKSPACE, parseScopes } from '@/lib/public-api/keys'
import { withApiKeys } from '@/lib/public-api/schema'
import { isUuid } from '@/lib/salon/validate'

export const runtime = 'nodejs'

const COLUMNS = 'id, name, prefix, scopes, created_at, last_used_at, revoked_at'

/** Only what Settings shows: never the hash, whatever the database returns. */
const safe = (row: any) => row && ({ id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes || [], created_at: row.created_at, last_used_at: row.last_used_at || null, revoked_at: row.revoked_at || null })

// GET ?organizationId: the workspace's API keys (never the keys themselves) — admins
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data, error } = await withApiKeys(() => db.from('api_keys').select(COLUMNS).eq('organization_id', organizationId).order('created_at', { ascending: false }))
  if (error) return NextResponse.json({ keys: [], notice: 'API keys are being set up. Try again in a minute.' })
  return NextResponse.json({ keys: (data || []).map(safe) })
}

// POST { organizationId, name, scopes }: a new key. It is shown this once; only its hash is kept.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const name = String(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: 'Give the key a name, like "Website booking form", so you know what uses it.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const { data: existing, error: countError } = await withApiKeys(() => db.from('api_keys').select('id').eq('organization_id', body.organizationId).is('revoked_at', null))
  if (countError) return NextResponse.json({ error: 'API keys could not be set up on this server. Please try again in a minute.' }, { status: 503 })
  if ((existing || []).length >= MAX_KEYS_PER_WORKSPACE) return NextResponse.json({ error: `A workspace can have ${MAX_KEYS_PER_WORKSPACE} keys. Revoke one you no longer use first.` }, { status: 400 })
  const key = generateApiKey()
  const { data, error } = await db.from('api_keys').insert({
    organization_id: body.organizationId, name, prefix: keyPreview(key), key_hash: hashApiKey(key), scopes: parseScopes(body?.scopes), created_by: access.user?.id || null,
  }).select(COLUMNS).single()
  if (error) return NextResponse.json({ error: 'The key could not be created. Please try again.' }, { status: 500 })
  return NextResponse.json({ key, record: safe(data) }, { status: 201 })
}

// DELETE ?organizationId&id: revoke a key. Apps using it stop working at once.
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const id = params.get('id')
  if (!isUuid(id)) return NextResponse.json({ error: 'Choose a key.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const { data, error } = await db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('organization_id', organizationId).is('revoked_at', null).select(COLUMNS)
  if (error) return NextResponse.json({ error: 'The key could not be revoked. Please try again.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'That key was not found, or is already revoked.' }, { status: 404 })
  return NextResponse.json({ success: true, record: safe(data[0]) })
}
