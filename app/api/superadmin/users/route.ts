import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'

export async function GET(request: NextRequest) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const { data: users, error } = await supabase
      .from('users')
      .select('*, organization:organizations(name, slug)')
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ success: true, users: users || [] })
  } catch (error: any) {
    console.error('[SuperAdmin Users GET API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const { email, password, fullName, role, organizationId } = await request.json()

    if (!email || !password || !fullName || !role || !organizationId) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    // 1. Create auth user in Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    // 2. Create user profile in public.users
    const { data: newProfile, error: profileError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          organization_id: organizationId,
          email,
          full_name: fullName,
          role,
        },
      ])
      .select('*, organization:organizations(name, slug)')
      .single()

    if (profileError) {
      // Rollback auth user creation if profile creation fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw profileError
    }

    return NextResponse.json({ success: true, user: newProfile })
  } catch (error: any) {
    console.error('[SuperAdmin Users POST API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}
