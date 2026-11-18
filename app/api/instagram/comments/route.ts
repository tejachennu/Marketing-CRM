import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { actOnComment, listComments, syncComments } from '@/lib/instagram/store'

export const runtime = 'nodejs'

/** GET ?organizationId=&filter=open|all&sync=1: comments on the business's posts and reels, newest first (sync=1 reads Instagram first). */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const synced = params.get('sync') === '1' ? await syncComments(db, organizationId!) : null
  const comments = await listComments(db, organizationId!, params.get('filter') === 'all' ? 'all' : 'open')
  return NextResponse.json({ comments, syncError: synced?.error || null })
}

/** POST { organizationId, commentId, action: 'reply' | 'private' | 'hide' | 'unhide' | 'delete', text? } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'records.write' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const type = String(body.action || '')
  if (!['reply', 'private', 'hide', 'unhide', 'delete'].includes(type) || typeof body.commentId !== 'string') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const action = type === 'reply' || type === 'private' ? { type, text: String(body.text || '') } as const : { type } as const
  const result = await actOnComment(getSupabaseAdminClient(), body.organizationId, body.commentId, action as any)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ success: true })
}
