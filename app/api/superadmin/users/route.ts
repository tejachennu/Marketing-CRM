import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { isKnownRole, toStoredRole } from '@/lib/rbac'
import { isUuid } from '@/lib/record-visibility'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAGE_SIZE = 1000
const MAX_PAGES = 20

export async function GET(request: NextRequest) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdminClient()

    // A single request returns at most 1,000 rows, so read the table page by page
    const users: any[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('users')
        .select('*, organization:organizations(name, slug)')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (error) throw error
      users.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
    }

    return NextResponse.json({ success: true, users })
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
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '')
    const fullName = String(body?.fullName || '').trim()
    const role = body?.role
    const organizationId = body?.organizationId

    if (!email || !password || !fullName || !role || !organizationId) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!isKnownRole(role)) {
      return NextResponse.json({ error: 'Choose a valid role' }, { status: 400 })
    }
    if (!isUuid(organizationId)) {
      return NextResponse.json({ error: 'Choose an organization' }, { status: 400 })
    }

    const { data: organization } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .maybeSingle()
    if (!organization) {
      return NextResponse.json({ error: 'That organization does not exist' }, { status: 400 })
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
          role: toStoredRole(role),
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
