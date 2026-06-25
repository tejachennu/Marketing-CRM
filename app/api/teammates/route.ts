import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

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
      .select('*')
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, fullName, role, organizationId } = body

    if (!email || !password || !fullName || !role || !organizationId) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    // 1. Fetch organization limit
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('max_teammates')
      .eq('id', organizationId)
      .single()

    if (orgError) throw orgError

    const limit = orgData?.max_teammates && orgData.max_teammates > 0 ? orgData.max_teammates : 4

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

    // 3. Create auth user in Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
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
          role,
        },
      ])
      .select()
      .single()

    if (profileError) {
      // Rollback auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw profileError
    }

    return NextResponse.json({ success: true, teammate: newProfile })
  } catch (error: any) {
    console.error('[API] Add teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to add teammate' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const orgId = searchParams.get('organizationId')

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    // Enforce that we don't delete the last owner/admin of the organization
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)

    if (countError) throw countError

    if (count !== null && count <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last user in the organization.' }, { status: 400 })
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
