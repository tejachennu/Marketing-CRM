import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { can } from '@/lib/rbac'
import { listIgChats, syncDms } from '@/lib/instagram/store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET ?organizationId=&sync=1: Instagram chats (who, last message, unread). sync=1 reads recent DMs from
 * Instagram into the inbox first; `messagesOff` says the Instagram app does not allow access to messages.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const synced = params.get('sync') === '1' ? await syncDms(db, organizationId!) : null
  // People who see only their own records get only the chats given to them
  const chats = await listIgChats(db, organizationId!, { onlyAssignedTo: can(access.user, 'records.view_all') ? null : access.user?.id || '-' })
  return NextResponse.json({ chats, messagesOff: synced?.messagesOff === true, syncError: synced?.error || null })
}
