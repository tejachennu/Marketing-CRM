import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

function getSupabaseAnonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

export async function GET(request: NextRequest) {
  return POST(request)
}

export async function POST(request: NextRequest) {
  try {
    const adminClient = getSupabaseAdminClient()
    let authUserId: string | null = null
    let authEmail: string | null = null

    // Method 1: Try Authorization header (Bearer token)
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      try {
        const anonClient = getSupabaseAnonClient()
        const { data: { user: authUser } } = await anonClient.auth.getUser(token)
        if (authUser) {
          authUserId = authUser.id
          authEmail = authUser.email || null
        }
      } catch (tokenErr) {
        console.warn('[Profile] Token validation failed, trying other methods:', tokenErr)
      }
    }

    // Method 2: Try cookie
    if (!authUserId) {
      const cookieHeader = request.headers.get('cookie') || ''
      const tokenMatch = cookieHeader.match(/supabase-auth-token=([^;]+)/)
      if (tokenMatch) {
        try {
          const anonClient = getSupabaseAnonClient()
          const { data: { user: authUser } } = await anonClient.auth.getUser(tokenMatch[1])
          if (authUser) {
            authUserId = authUser.id
            authEmail = authUser.email || null
          }
        } catch (cookieErr) {
          console.warn('[Profile] Cookie token validation failed:', cookieErr)
        }
      }
    }

    // Method 3: Try request body (userId + email sent directly)
    if (!authUserId) {
      try {
        const body = await request.json().catch(() => null)
        if (body?.userId) {
          authUserId = body.userId
          authEmail = body.email || null
        }
      } catch {
        // No body or invalid JSON
      }
    }

    if (!authUserId) {
      return NextResponse.json(
        { error: 'Unauthorized: no valid auth method found' },
        { status: 401 }
      )
    }

    // 1. Try to fetch existing user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .maybeSingle()

    if (profile) {
      return NextResponse.json({ success: true, user: profile })
    }

    // 2. Auto-create organization + profile
    console.log('[Profile] Creating new user profile for:', authUserId)
    const email = authEmail || 'user'
    const orgName = `${email.split('@')[0]}'s Company`
    const orgSlug = `${email.split('@')[0]}-org-${Date.now()}`

    const { data: newOrg, error: newOrgError } = await adminClient
      .from('organizations')
      .insert([{ name: orgName, slug: orgSlug }])
      .select()
      .single()

    if (newOrgError) {
      console.error('[Profile] Failed to create organization:', newOrgError)
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
    }

    // Create default pipeline stages
    await adminClient.from('pipeline_stages').insert(
      [
        { name: 'New', color: '#6366f1', position: 1 },
        { name: 'Contacted', color: '#8b5cf6', position: 2 },
        { name: 'Qualified', color: '#ec4899', position: 3 },
        { name: 'Negotiating', color: '#f59e0b', position: 4 },
        { name: 'Closed Won', color: '#10b981', position: 5 },
      ].map((s) => ({
        organization_id: newOrg.id,
        name: s.name,
        color: s.color,
        position: s.position,
      }))
    )

    // Create user profile
    const fullName = email
      .split('@')[0]
      .split('.')
      .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')

    const { data: newProfile, error: profileError } = await adminClient
      .from('users')
      .insert([
        {
          id: authUserId,
          organization_id: newOrg.id,
          email: email,
          full_name: fullName,
          role: 'owner',
        },
      ])
      .select()
      .single()

    if (profileError) {
      console.error('[Profile] Failed to create user profile:', profileError)
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 })
    }

    console.log('[Profile] Auto-created user + org successfully')
    return NextResponse.json({ success: true, user: newProfile })
  } catch (error) {
    console.error('[Profile] API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
