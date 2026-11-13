import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { withPushSchema } from '@/lib/push'

export const runtime = 'nodejs'

const TOKEN = /^[A-Za-z0-9_:\-.]{20,4096}$/

/** POST { token, platform }: this phone gets the signed-in person's notifications (a phone has one owner at a time). */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user?.organization_id) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const token = String(body?.token || '')
  if (!TOKEN.test(token)) return NextResponse.json({ error: 'That phone could not be registered.' }, { status: 400 })
  const platform = body?.platform === 'ios' ? 'ios' : 'android'
  const db = getSupabaseAdminClient()
  const now = new Date().toISOString()
  const { error } = await withPushSchema(() => db.from('device_tokens').upsert({ token, user_id: user.id, organization_id: user.organization_id, platform, last_seen_at: now }, { onConflict: 'token' }))
  if (error) return NextResponse.json({ error: 'That phone could not be registered.' }, { status: 500 })
  return NextResponse.json({ success: true })
}

/** DELETE { token }: stop notifications on this phone (sign out). */
export async function DELETE(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const token = String(body?.token || new URL(request.url).searchParams.get('token') || '')
  if (!TOKEN.test(token)) return NextResponse.json({ success: true })
  await getSupabaseAdminClient().from('device_tokens').delete().eq('token', token).eq('user_id', user.id)
  return NextResponse.json({ success: true })
}
