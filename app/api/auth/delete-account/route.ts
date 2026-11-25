import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSuperAdminEmails, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { can, getRoleDisplay } from '@/lib/rbac'
import { cleanReason, deletionEmails, deletionScope, teamRecipients } from '@/lib/account-deletion'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'

/**
 * GET: what "Delete my account" would remove for the signed-in person (the app shows it before they confirm).
 * POST { reason? }: ask for the account to be deleted. The team gets an email to check and delete it; the person
 * gets a copy. Under /api/auth so it stays open after a free trial ends (lib/billing-gate.ts).
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const wholeWorkspace = Boolean(user.organization_id) && can(user, 'settings.manage')
  return NextResponse.json({ success: true, wholeWorkspace, scope: deletionScope(wholeWorkspace) })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  if (!user.email) return NextResponse.json({ error: 'Your account has no email. Write to support@magnetora.ai to delete it.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const wholeWorkspace = Boolean(user.organization_id) && can(user, 'settings.manage')
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
  await sendEmail({ to: String(user.email), ...person }).catch((error: any) => console.warn('[delete-account] Copy to the person failed:', error?.message || error))
  console.log(`[delete-account] Request from user ${user.id} (workspace ${user.organization_id || '-'}, whole workspace: ${wholeWorkspace})`)

  return NextResponse.json({
    success: true,
    wholeWorkspace,
    message: `Request sent. We emailed a copy to ${user.email}. Our team will check it is you, then delete ${deletionScope(wholeWorkspace)}.`,
  })
}
