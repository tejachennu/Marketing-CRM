import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSuperAdminEmails, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { can, getRoleDisplay, isOwner } from '@/lib/rbac'
import { checkRateLimit } from '@/lib/rate-limiter'
import { cleanReason, deletionEmails, deletionScope, teamRecipients } from '@/lib/account-deletion'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'

/**
 * GET: what "Delete my account" would remove for the signed-in person (the app shows it before they confirm).
 * POST { reason? }: ask for the account to be deleted. The team gets an email to check and delete it; the person
 * gets a copy. Under /api/auth so it stays open after a free trial ends (lib/billing-gate.ts).
 * Only the owner (who made the workspace) asks for the whole workspace to go; any other admin or staff member only
 * removes their own login. Older workspaces with no owner row fall back to their admins.
 */
async function deletesWorkspace(user: any): Promise<boolean> {
  if (!user?.organization_id) return false
  if (isOwner(user)) return true
  if (!can(user, 'settings.manage')) return false
  const { data } = await getSupabaseAdminClient().from('users').select('id').eq('organization_id', user.organization_id).eq('role', 'owner').limit(1)
  return !data?.length
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const wholeWorkspace = await deletesWorkspace(user)
  return NextResponse.json({ success: true, wholeWorkspace, scope: deletionScope(wholeWorkspace) })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  if (!user.email) return NextResponse.json({ error: 'Your account has no email. Write to support@magnetora.ai to delete it.' }, { status: 400 })
  // Each request emails the team: a few an hour is plenty
  if (!checkRateLimit(`delete-account:${user.id}`, 3, 60 * 60_000).allowed) {
    return NextResponse.json({ error: 'We already have your request. Please wait for our email, or try again in an hour.' }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const wholeWorkspace = await deletesWorkspace(user)
  let organizationName: string | null = null
  if (user.organization_id) {
    const { data } = await getSupabaseAdminClient().from('organizations').select('name').eq('id', user.organization_id).maybeSingle()
    organizationName = data?.name || null
  }

  const { team, person } = deletionEmails({
    userId: String(user.id),
    email: String(user.email),
    name: user.full_name || null,
    role: getRoleDisplay(user.role).label,
    organizationId: user.organization_id || null,
    organizationName,
    wholeWorkspace,
    reason: cleanReason(body?.reason),
    at: new Date(),
  })

  // The team must get it: without that, nothing would be deleted
  const sent = await Promise.all(
    teamRecipients(getSuperAdminEmails()).map((to) =>
      sendEmail({ to, ...team }).then(
        (r: any) => r?.success !== false,
        (error: any) => {
          console.error('[delete-account] Team email failed:', error?.message || error)
          return false
        },
      ),
    ),
  )
  if (!sent.some(Boolean)) {
    return NextResponse.json({ error: 'Your request could not be sent just now. Please try again, or write to support@magnetora.ai.' }, { status: 502 })
  }
  const copied = await sendEmail({ to: String(user.email), ...person }).then(
    () => true,
    (error: any) => {
      console.warn('[delete-account] Copy to the person failed:', error?.message || error)
      return false
    },
  )
  console.log(`[delete-account] Request from user ${user.id} (workspace ${user.organization_id || '-'}, whole workspace: ${wholeWorkspace})`)

  return NextResponse.json({
    success: true,
    wholeWorkspace,
    message: `Request sent.${copied ? ` We emailed a copy to ${user.email}.` : ''} Our team will check it is you, then delete ${deletionScope(wholeWorkspace)}.`,
  })
}
