import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { billingLimits, getBilling } from '@/lib/billing'
import { sendEmail } from '@/lib/email'
import { teamBlockReason } from '@/lib/plans'
import { getRoleDisplay, getTeamChangeError, isAdmin, isSuperAdmin, storedTeammateRole } from '@/lib/rbac'
import { isUuid } from '@/lib/record-visibility'
import { escapeHtml } from '@/lib/utils'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Only what the team list and the assignment pickers need
const TEAMMATE_COLUMNS = 'id, organization_id, email, full_name, role, see_all, read_only, created_at'

function appOrigin(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  return configured || request.headers.get('origin') || new URL(request.url).origin
}

/** Email a link that lets the teammate choose a password. Returns false when it could not be sent. */
async function sendPasswordLink(
  supabase: any,
  request: NextRequest,
  teammate: { id: string; email: string; role: string },
  organizationName: string
): Promise<boolean> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // One live link per person: an older link stops working when a new one is sent
  await supabase.from('password_setup_tokens').delete().eq('user_id', teammate.id)
  const { error: tokenError } = await supabase
    .from('password_setup_tokens')
    .insert([{ user_id: teammate.id, token, expires_at: expiresAt }])

  if (tokenError) {
    console.error('[API] Failed to store setup token:', tokenError)
    return false
  }

  const setupLink = `${appOrigin(request)}/set-password?token=${token}`
  const orgName = escapeHtml(organizationName)
  const roleLabel = escapeHtml(getRoleDisplay(teammate.role).label)

  const inviteHtml = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e3e8f2; border-radius: 16px; background: #ffffff;">
      <div style="font-size: 18px; font-weight: 800; color: #0E1B3D; margin-bottom: 20px;">WAMA <span style="color: #1D5BEA;">CRM</span></div>
      <h2 style="color: #0E1B3D; font-weight: 800; font-size: 22px; margin: 0 0 8px;">You're invited to ${orgName}</h2>
      <p style="color: #4a5672; font-size: 14px; line-height: 1.6; margin: 0 0 18px;">
        ${orgName} added you to their WAMA CRM workspace as <strong style="color: #0E1B3D;">${roleLabel}</strong>.
        Set your password to sign in. This link works for 24 hours.
      </p>
      <a href="${setupLink}" style="background: #1D5BEA; color: #ffffff; padding: 12px 26px; border-radius: 10px; font-weight: 700; font-size: 14px; text-decoration: none; display: inline-block;">Set my password</a>
      <p style="color: #8a94a8; font-size: 12px; line-height: 1.5; margin: 24px 0 0; border-top: 1px solid #eef1f6; padding-top: 14px;">
        If the button doesn't work, open this link:<br/>
        <a href="${setupLink}" style="color: #1D5BEA; word-break: break-all;">${setupLink}</a>
      </p>
    </div>
  `

  try {
    await sendEmail({
      to: teammate.email,
      subject: `You're invited to ${organizationName} on WAMA CRM`,
      html: inviteHtml,
      text: `${organizationName} added you to their WAMA CRM workspace. Set your password here (valid for 24 hours): ${setupLink}`,
    })
    return true
  } catch (err) {
    console.error('[API] Failed to send invitation email:', err)
    return false
  }
}

/** How many admins the organization has. Platform admins are not counted: they do not run the organization day to day. */
async function countOrgAdmins(supabase: any, organizationId: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('id, role').eq('organization_id', organizationId)
  if (error) throw error
  return (data || []).filter((member: any) => isAdmin(member) && !isSuperAdmin(member)).length
}

/** The plan's team size, or null for no limit (exempt, no billing yet, or a billing read error). */
async function planSeatLimit(supabase: any, organizationId: string): Promise<number | null> {
  try {
    return billingLimits(await getBilling(supabase, organizationId)).team
  } catch {
    return null
  }
}

/** The most people the workspace may have, or null for no limit: the smaller of WAMA CRM's own limit and the plan's. */
async function seatLimit(supabase: any, organizationId: string): Promise<number | null> {
  const { data } = await supabase.from('organizations').select('max_teammates').eq('id', organizationId).maybeSingle()
  const own = data?.max_teammates && data.max_teammates > 0 ? data.max_teammates : null
  const plan = await planSeatLimit(supabase, organizationId)
  return own === null ? plan : plan === null ? own : Math.min(own, plan)
}

async function loadTeammate(supabase: any, userId: string, organizationId: string) {
  const { data, error } = await supabase
    .from('users')
    .select(TEAMMATE_COLUMNS)
    .eq('id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw error
  return data
}

// GET: every member can list the team (the assignment pickers need it)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()
    const { data: teammates, error } = await supabase
      .from('users')
      .select(TEAMMATE_COLUMNS)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Who has not set a password from their invite yet
    const ids = (teammates || []).map((member: any) => member.id)
    const { data: pending } = ids.length
      ? await supabase.from('password_setup_tokens').select('user_id, expires_at').in('user_id', ids)
      : { data: [] as any[] }
    const pendingIds = new Set((pending || []).map((row: any) => row.user_id))

    return NextResponse.json({
      success: true,
      teammates: (teammates || []).map((member: any) => ({ ...member, invite_pending: pendingIds.has(member.id) })),
      seatLimit: await seatLimit(supabase, orgId),
    })
  } catch (error: any) {
    console.error('[API] Get teammates error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve teammates' },
      { status: 500 }
    )
  }
}

// POST: invite a teammate (organization admins only)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    const fullName = String(body?.fullName || '').trim()
    const role = body?.role
    const organizationId = body?.organizationId

    if (!email || !fullName || !role || !organizationId) {
      return NextResponse.json({ error: 'All fields (email, name, role) are required' }, { status: 400 })
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }
    if (fullName.length > 120) {
      return NextResponse.json({ error: 'Name must be at most 120 characters' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'team.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // A new teammate is checked like a role change on someone else: valid role, and not above the inviter's own
    const roleError = getTeamChangeError(authResult.user, { id: null, role: 'sales_employee' }, { role }, { adminCount: Infinity })
    if (roleError) {
      return NextResponse.json({ error: roleError }, { status: 400 })
    }
    // `owner` and `superadmin` cannot be handed out from here
    const storedRole = storedTeammateRole(role)
    if (!storedRole) {
      return NextResponse.json({ error: 'Choose Admin, Manager, Agent or Viewer.' }, { status: 400 })
    }

    const supabase = getSupabaseAdminClient()

    // 1. The organization, and its seat limit (none on the plan unless WAMA CRM set one)
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('name, max_teammates')
      .eq('id', organizationId)
      .single()

    if (orgError) throw orgError

    const ownLimit = orgData?.max_teammates && orgData.max_teammates > 0 ? orgData.max_teammates : null
    const planLimit = await planSeatLimit(supabase, organizationId)
    const limit = ownLimit === null ? planLimit : planLimit === null ? ownLimit : Math.min(ownLimit, planLimit)
    const byPlan = planLimit !== null && limit === planLimit

    // 2. Fetch current teammate count
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)

    if (countError) throw countError

    if (limit !== null && count !== null && count >= limit) {
      return NextResponse.json(
        { error: byPlan ? teamBlockReason({ team: limit } as any, count) : `This workspace can have up to ${limit} people. Remove someone first, or contact support for more.` },
        { status: 400 }
      )
    }

    // Already a member here or elsewhere: say so plainly instead of the auth service's wording
    const { data: existingProfile } = await supabase.from('users').select('id, organization_id').eq('email', email).maybeSingle()
    if (existingProfile) {
      return NextResponse.json(
        { error: existingProfile.organization_id === organizationId ? 'This person is already in your team.' : 'This email already has a WAMA CRM account in another workspace.' },
        { status: 400 }
      )
    }

    // A random password nobody knows: they cannot log in until they set their own
    const randomPassword = randomBytes(24).toString('hex') + 'A1!'

    // 3. Create auth user in Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    // 4. Create user profile in public.users
    const { data: newProfile, error: profileError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          organization_id: organizationId,
          email,
          full_name: fullName,
          role: storedRole,
        },
      ])
      .select(TEAMMATE_COLUMNS)
      .single()

    if (profileError) {
      // Rollback auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw profileError
    }

    // 5. Email the password setup link. The teammate exists either way, so say whether it went out.
    const inviteSent = await sendPasswordLink(supabase, request, newProfile, orgData?.name || 'Your Company')

    return NextResponse.json({ success: true, teammate: newProfile, inviteSent })
  } catch (error: any) {
    console.error('[API] Add teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to add teammate' },
      { status: 500 }
    )
  }
}

// DELETE: remove a teammate (organization admins only)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const orgId = searchParams.get('organizationId')

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }
    if (!isUuid(userId)) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId, { permission: 'team.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    const target = await loadTeammate(supabase, userId, orgId)
    if (!target) {
      return NextResponse.json({ error: 'Teammate not found' }, { status: 404 })
    }

    const refusal = getTeamChangeError(authResult.user, target, { remove: true }, { adminCount: await countOrgAdmins(supabase, orgId) })
    if (refusal) {
      return NextResponse.json({ error: refusal }, { status: 403 })
    }

    // Their conversations, leads and tickets go back to the unassigned pool instead of pointing at a deleted user
    for (const table of ['conversations', 'leads', 'tickets']) {
      const { error: unassignError } = await supabase
        .from(table)
        .update({ assigned_to: null })
        .eq('organization_id', orgId)
        .eq('assigned_to', userId)
      if (unassignError) console.warn(`[API] Could not unassign ${table} from removed teammate:`, unassignError.message)
    }

    // Delete user profile first
    const { error: profileError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId)
      .eq('organization_id', orgId)

    if (profileError) throw profileError

    // Delete auth user
    const { error: authError } = await supabase.auth.admin.deleteUser(userId)
    if (authError) {
      console.warn('Auth user deletion failed:', authError.message)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[API] Delete teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete teammate' },
      { status: 500 }
    )
  }
}

/**
 * PATCH: change one teammate.
 *   { seeAll, readOnly }  access switches for a sales employee — admins and managers
 *   { role }              a different role — organization admins
 *   { resendInvite }      email a new password link — organization admins
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { userId, organizationId, seeAll, readOnly, role, resendInvite } = body || {}

    if (!userId || !organizationId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }
    if (!isUuid(userId)) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const changesAccess = seeAll !== undefined || readOnly !== undefined
    const changesRole = role !== undefined
    if (!changesAccess && !changesRole && !resendInvite) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if ((seeAll !== undefined && typeof seeAll !== 'boolean') || (readOnly !== undefined && typeof readOnly !== 'boolean')) {
      return NextResponse.json({ error: 'seeAll and readOnly must be true or false' }, { status: 400 })
    }

    // Access switches need manager rights; everything else on this route needs admin rights
    const authResult = await verifyOrgAccess(request, organizationId, {
      permission: changesRole || resendInvite ? 'team.manage' : 'team.grant_access',
    })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    const target = await loadTeammate(supabase, userId, organizationId)
    if (!target) {
      return NextResponse.json({ error: 'Teammate not found' }, { status: 404 })
    }

    if (changesAccess || changesRole) {
      const refusal = getTeamChangeError(
        authResult.user,
        target,
        { access: changesAccess || undefined, ...(changesRole ? { role } : {}) },
        { adminCount: await countOrgAdmins(supabase, organizationId) }
      )
      if (refusal) {
        return NextResponse.json({ error: refusal }, { status: 403 })
      }
    }

    const updateFields: Record<string, any> = {}
    if (seeAll !== undefined) updateFields.see_all = seeAll
    if (readOnly !== undefined) updateFields.read_only = readOnly
    if (changesRole) {
      const nextRole = storedTeammateRole(role)
      if (!nextRole) {
        return NextResponse.json({ error: 'Choose Admin, Manager, Agent or Viewer.' }, { status: 400 })
      }
      updateFields.role = nextRole
      // The switches only mean something for an agent; clear them so a later change back starts clean
      if (nextRole !== 'sales_employee') {
        updateFields.see_all = false
        updateFields.read_only = false
      }
    }

    let teammate = target
    if (Object.keys(updateFields).length > 0) {
      const { data: updatedTeammate, error } = await supabase
        .from('users')
        .update(updateFields)
        .eq('id', userId)
        .eq('organization_id', organizationId)
        .select(TEAMMATE_COLUMNS)
        .single()

      if (error) throw error
      teammate = updatedTeammate
    }

    let inviteSent: boolean | undefined
    if (resendInvite) {
      const { data: orgData } = await supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle()
      inviteSent = await sendPasswordLink(supabase, request, teammate, orgData?.name || 'Your Company')
      if (!inviteSent) {
        return NextResponse.json({ error: 'The email could not be sent. Check the email settings and try again.' }, { status: 502 })
      }
    }

    return NextResponse.json({ success: true, teammate, inviteSent })
  } catch (error: any) {
    console.error('[API] Update teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update teammate' },
      { status: 500 }
    )
  }
}
