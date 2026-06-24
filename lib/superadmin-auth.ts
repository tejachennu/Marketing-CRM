import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export function getSupabaseAdminClient() {
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

export function getSupabaseAnonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

export async function checkSuperAdmin(request: NextRequest) {
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
        console.warn('[checkSuperAdmin] Token validation failed:', tokenErr)
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
          console.warn('[checkSuperAdmin] Cookie validation failed:', cookieErr)
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

    if (!profile) {
      return null
    }

    // 4. Auto-upgrade developer email if role check fails
    if (profile.role !== 'superadmin' && (authEmail === 'tejachennu@gmail.com' || authEmail === 'tejachennu@blsindia-canada.ca')) {
      await adminClient
        .from('users')
        .update({ role: 'superadmin' })
        .eq('id', authUserId)
      profile.role = 'superadmin'
      console.log(`[checkSuperAdmin] Auto-upgraded developer email ${authEmail} to superadmin`)
    }

    if (profile.role === 'superadmin') {
      return profile
    }

    return null
  } catch (err) {
    console.error('[checkSuperAdmin] Error:', err)
    return null
  }
}
