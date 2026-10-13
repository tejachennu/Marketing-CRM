import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { isKnownRole, isSuperAdmin, toStoredRole } from '@/lib/rbac'
import { isUuid } from '@/lib/record-visibility'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await checkSuperAdmin(request)
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const body = await request.json().catch(() => null)
    const email = body?.email === undefined ? undefined : String(body.email).trim().toLowerCase()
    const password = body?.password ? String(body.password) : ''
    const fullName = body?.fullName === undefined ? undefined : String(body.fullName).trim()
    const role = body?.role
    const organizationId = body?.organizationId

    const { data: currentUser } = await supabase
      .from('users')
      .select('id, email, role, organization_id')
      .eq('id', id)
      .maybeSingle()

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (email !== undefined && !EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }
    if (password && password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (role !== undefined && !isKnownRole(role)) {
      return NextResponse.json({ error: 'Choose a valid role' }, { status: 400 })
    }
    // Removing your own super admin role would lock you out of this console
    if (id === actor.id && role !== undefined && !isSuperAdmin({ role })) {
      return NextResponse.json({ error: 'You cannot remove your own super admin role. Ask another super admin to do it.' }, { status: 400 })
    }
    if (organizationId !== undefined && organizationId !== currentUser.organization_id) {
      if (!isUuid(organizationId)) {
        return NextResponse.json({ error: 'Choose an organization' }, { status: 400 })
      }
      const { data: organization } = await supabase.from('organizations').select('id').eq('id', organizationId).maybeSingle()
      if (!organization) {
        return NextResponse.json({ error: 'That organization does not exist' }, { status: 400 })
      }
    }

    // 1. Update Auth user if the email changed or a new password was given
    const authUpdate: Record<string, any> = {}
    if (email && email !== currentUser.email) authUpdate.email = email
    if (password) authUpdate.password = password

    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, authUpdate)
      if (authError) {
        return NextResponse.json({ error: authError.message }, { status: 400 })
      }
    }

    // 2. Update DB Profile
    const dbUpdate: Record<string, any> = {}
    if (fullName !== undefined) dbUpdate.full_name = fullName
    if (role !== undefined) dbUpdate.role = toStoredRole(role)
    if (organizationId !== undefined) dbUpdate.organization_id = organizationId
    if (email !== undefined) dbUpdate.email = email

    if (Object.keys(dbUpdate).length === 0) {
      return NextResponse.json({ success: true, user: currentUser })
    }

    // Work assigned in the old organization stays there, unassigned, when the user moves to another one
    if (dbUpdate.organization_id && dbUpdate.organization_id !== currentUser.organization_id && currentUser.organization_id) {
      for (const table of ['conversations', 'leads', 'tickets']) {
        const { error: unassignError } = await supabase
          .from(table)
          .update({ assigned_to: null })
          .eq('organization_id', currentUser.organization_id)
          .eq('assigned_to', id)
        if (unassignError) console.warn(`[SuperAdmin User Update API] Could not unassign ${table}:`, unassignError.message)
      }
    }

    const { data: updatedUser, error: dbError } = await supabase
      .from('users')
      .update(dbUpdate)
      .eq('id', id)
      .select('*, organization:organizations(name, slug)')
      .single()

    if (dbError) throw dbError

    return NextResponse.json({ success: true, user: updatedUser })
  } catch (error: any) {
    console.error('[SuperAdmin User Update API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await checkSuperAdmin(request)
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }
  if (id === actor.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }

  try {
    const supabase = getSupabaseAdminClient()

    const { data: target } = await supabase.from('users').select('id, organization_id').eq('id', id).maybeSingle()
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Their conversations, leads and tickets go back to the unassigned pool
    for (const table of ['conversations', 'leads', 'tickets']) {
      const { error: unassignError } = await supabase.from(table).update({ assigned_to: null }).eq('assigned_to', id)
      if (unassignError) console.warn(`[SuperAdmin User Delete API] Could not unassign ${table}:`, unassignError.message)
    }

    // Delete profile first
    const { error: profileError } = await supabase
      .from('users')
      .delete()
      .eq('id', id)

    if (profileError) throw profileError

    // Delete user from Supabase auth
    const { error: authError } = await supabase.auth.admin.deleteUser(id)
    if (authError) {
      console.warn('[SuperAdmin User Delete API] Auth user deletion failed or user already deleted:', authError)
    }

    return NextResponse.json({ success: true, message: 'User deleted successfully' })
  } catch (error: any) {
    console.error('[SuperAdmin User Delete API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}
