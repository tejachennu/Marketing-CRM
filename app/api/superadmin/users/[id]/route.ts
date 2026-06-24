import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const supabase = getSupabaseAdminClient()
    const { email, password, fullName, role, organizationId } = await request.json()

    // Get current email from the database to check if it has changed
    const { data: currentUser } = await supabase
      .from('users')
      .select('email')
      .eq('id', id)
      .single()

    // 1. Update Auth user if email or password is provided and email has changed
    const authUpdate: Record<string, any> = {}
    if (email && email !== currentUser?.email) authUpdate.email = email
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
    if (role !== undefined) dbUpdate.role = role
    if (organizationId !== undefined) dbUpdate.organization_id = organizationId
    if (email !== undefined) dbUpdate.email = email

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
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const supabase = getSupabaseAdminClient()

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
