import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

function getSupabaseAnonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

export async function getAuthenticatedUser(request: NextRequest) {
  try {
    let authUserId: string | null = null
    let authEmail: string | null = null

    // 1. Try Authorization header (Bearer token)
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      try {
        const anonClient = getSupabaseAnonClient()
        const { data: { user } } = await anonClient.auth.getUser(token)
        if (user) {
          authUserId = user.id
          authEmail = user.email || null
        }
      } catch (tokenErr) {
        console.warn('[api-auth] Token validation failed:', tokenErr)
      }
    }

    // 2. Try cookie
    if (!authUserId) {
      const cookieHeader = request.headers.get('cookie') || ''
      const tokenMatch = cookieHeader.match(/supabase-auth-token=([^;]+)/)
      if (tokenMatch) {
        try {
          const anonClient = getSupabaseAnonClient()
          const { data: { user } } = await anonClient.auth.getUser(tokenMatch[1])
          if (user) {
            authUserId = user.id
            authEmail = user.email || null
          }
        } catch (cookieErr) {
          console.warn('[api-auth] Cookie validation failed:', cookieErr)
        }
      }
    }

    if (!authUserId) {
      return null
    }

    // 3. Query user profile
    const adminClient = getSupabaseAdminClient()
    const { data: profile } = await adminClient
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .maybeSingle()

    // Auto-upgrade developer email if role check fails (matching superadmin-auth.ts behaviour)
    if (profile && profile.role !== 'superadmin' && (authEmail === 'tejachennu223@gmail.com' || authEmail === 'tejachennu@blsindia-canada.ca')) {
      await adminClient
        .from('users')
        .update({ role: 'superadmin' })
        .eq('id', authUserId)
      profile.role = 'superadmin'
    }

    return profile
  } catch (err) {
    console.error('[api-auth] getAuthenticatedUser error:', err)
    return null
  }
}

export async function verifyOrgAccess(request: NextRequest, targetOrgId: string | null) {
  if (!targetOrgId) {
    return { authorized: false, error: 'Missing organizationId', status: 400, user: null }
  }

  const user = await getAuthenticatedUser(request)
  if (!user) {
    return { authorized: false, error: 'Unauthorized: No active session found', status: 401, user: null }
  }

  // Superadmin can access anything
  if (user.role === 'superadmin') {
    return { authorized: true, user }
  }

  // Normal users must match organization id
  if (user.organization_id !== targetOrgId) {
    return { authorized: false, error: 'Forbidden: You do not have access to this organization\'s data', status: 403, user }
  }

  return { authorized: true, user }
}

export async function verifyRecordAccess(request: NextRequest, table: string, recordId: string | null) {
  if (!recordId) {
    return { authorized: false, error: 'Missing ID parameter', status: 400, user: null }
  }

  const user = await getAuthenticatedUser(request)
  if (!user) {
    return { authorized: false, error: 'Unauthorized: No active session found', status: 401, user: null }
  }

  // Superadmin can access anything
  if (user.role === 'superadmin') {
    return { authorized: true, user }
  }

  // Check database if record belongs to user's organization
  try {
    const adminClient = getSupabaseAdminClient()
    const { data: record, error } = await adminClient
      .from(table)
      .select('organization_id')
      .eq('id', recordId)
      .maybeSingle()

    if (error || !record) {
      return { authorized: false, error: 'Record not found or access denied', status: 404, user }
    }

    if (record.organization_id !== user.organization_id) {
      return { authorized: false, error: 'Forbidden: You do not have access to this record', status: 403, user }
    }

    return { authorized: true, user }
  } catch (err) {
    console.error('[api-auth] verifyRecordAccess error:', err)
    return { authorized: false, error: 'Internal server error during record validation', status: 500, user }
  }
}
