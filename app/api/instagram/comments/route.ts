import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { answerComment } from '@/lib/instagram/automation'
import { accountFor, actOnComment, listComments, syncComments } from '@/lib/instagram/store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET ?organizationId=&filter=open|all&sync=1: comments on the business's posts and reels, newest first,
 * each with its post's picture. sync=1 checks Instagram first (at most once a minute) and runs Auto replies
 * on new comments; `waitMinutes` says Instagram asked us to slow down.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const synced = params.get('sync') === '1' ? await syncComments(db, organizationId!) : null
  const account = await accountFor(db, organizationId!).catch(() => null)
  if (synced?.fresh.length && account) for (const row of synced.fresh) await answerComment(db, account, row).catch(() => null)
  const posts = new Map<string, any>((Array.isArray(account?.feed) ? account.feed : []).map((p: any) => [p.id, p]))
  const comments = (await listComments(db, organizationId!, params.get('filter') === 'all' ? 'all' : 'open'))
    .map((c: any) => { const p = posts.get(c.media_id); return { ...c, post: p ? { image: p.image || '', link: p.link, caption: p.caption } : null } })
  return NextResponse.json({ comments, waitMinutes: synced?.waitMinutes || 0, syncError: synced?.error || null })
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
