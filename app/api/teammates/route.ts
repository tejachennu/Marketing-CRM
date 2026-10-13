import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { sendEmail } from '@/lib/email'
import { getRoleDisplay, getTeamChangeError, isAdmin, isSuperAdmin, normalizeRole } from '@/lib/rbac'
import { isUuid } from '@/lib/record-visibility'
import { escapeHtml } from '@/lib/utils'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_TEAMMATE_LIMIT = 4

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
    <div style="font-family: sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; border: 1px solid #e9edef; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="height: 48px; width: 48px; border-radius: 12px; background: linear-gradient(135deg, #00a884, #3b82f6); display: inline-block; line-height: 48px; color: white; font-weight: 900; font-size: 20px;">OM</div>
        <h2 style="color: #111b21; font-weight: 800; font-size: 22px; margin-top: 16px; margin-bottom: 4px;">Welcome to ${orgName}!</h2>
        <p style="color: #667781; font-size: 13px; margin: 0;">You have been invited to join the OmniCRM workspace.</p>
      </div>
      <div style="border-top: 1px solid #e9edef; border-bottom: 1px solid #e9edef; padding: 20px 0; margin-bottom: 24px;">
        <p style="color: #111b21; font-size: 13px; font-weight: 700; margin-bottom: 8px;">Workspace Role:</p>
        <p style="color: #00a884; font-size: 13px; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">${roleLabel}</p>
        <p style="color: #54656f; font-size: 12px; line-height: 1.6; margin-top: 16px; margin-bottom: 0;">
          Before you can access your account, you need to set up a password. Please click the button below to secure your account. This link will expire in 24 hours.
        </p>
      </div>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${setupLink}" style="background-color: #00a884; color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 800; font-size: 13px; text-decoration: none; display: inline-block; box-shadow: 0 4px 10px rgba(0, 168, 132, 0.15);">
          Set Up Password
        </a>
      </div>
      <p style="color: #8696a0; font-size: 10px; line-height: 1.4; margin-top: 24px; border-top: 1px solid #e9edef; padding-top: 16px;">
        If the button doesn't work, copy and paste this link in your browser:<br/>
        <a href="${setupLink}" style="color: #3b82f6; text-decoration: underline;">${setupLink}</a>
      </p>
    </div>
  `

  try {
    await sendEmail({
      to: teammate.email,
      subject: `Set up your password for ${organizationName} on OmniCRM`,
      html: inviteHtml,
      text: `Welcome to ${organizationName}! Open this link to set up your password (valid for 24 hours): ${setupLink}`,
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

    return NextResponse.json({ success: true, teammates })
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
    // Stored under its canonical name; `owner` and `superadmin` cannot be handed out from here
    const storedRole = normalizeRole(role)
    if (storedRole === 'super_admin') {
      return NextResponse.json({ error: 'Super admin accounts are created from the Super Admin console.' }, { status: 400 })
    }

    const supabase = getSupabaseAdminClient()

    // 1. Fetch organization limit
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('name, max_teammates')
      .eq('id', organizationId)
      .single()

    if (orgError) throw orgError

    const limit = orgData?.max_teammates && orgData.max_teammates > 0 ? orgData.max_teammates : DEFAULT_TEAMMATE_LIMIT

    // 2. Fetch current teammate count
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)

    if (countError) throw countError

    if (count !== null && count >= limit) {
      return NextResponse.json(
        { error: `Teammate limit reached. Your organization is limited to ${limit} teammates.` },
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
      const nextRole = normalizeRole(role)
      if (nextRole === 'super_admin') {
        return NextResponse.json({ error: 'Super admin accounts are managed from the Super Admin console.' }, { status: 400 })
      }
      updateFields.role = nextRole
      // The switches only mean something for a sales employee; clear them so a later demotion starts clean
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
