import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { can } from '@/lib/rbac'
import { answerDm } from '@/lib/instagram/automation'
import { accountFor, listIgChats, syncDms } from '@/lib/instagram/store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET ?organizationId=&sync=1&list=0: Instagram chats (who, last message, unread). sync=1 checks Instagram for new
 * DMs first (at most once a minute, changed threads only) and lets the AI answer the newest ones when Auto
 * replies allow. `messagesOff`: the Instagram app does not allow access to messages. `waitMinutes`: Instagram
 * asked us to slow down.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const synced = params.get('sync') === '1' ? await syncDms(db, organizationId!) : null
  if (synced?.fresh.length) {
    const account = await accountFor(db, organizationId!).catch(() => null)
    const latest = new Map<string, any>()
    for (const item of synced.fresh) latest.set(item.conversation.id, item) // oldest first, so the newest stays
    if (account) for (const item of latest.values()) await answerDm(db, account, { ...item, at: Date.parse(item.message.created_at) }).catch(() => null)
  }
  // list=0: the inbox only wants Instagram checked (it lists chats itself)
  const chats = params.get('list') === '0' ? [] : await listIgChats(db, organizationId!, { onlyAssignedTo: can(access.user, 'records.view_all') ? null : access.user?.id || '-' })
  return NextResponse.json({ chats, added: synced?.added || 0, messagesOff: synced?.messagesOff === true, waitMinutes: synced?.waitMinutes || 0, syncError: synced?.error || null })
}
