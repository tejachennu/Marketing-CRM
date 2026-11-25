import { tooManyAttempts } from '@/lib/auth/attempts'
import { createClient } from '@supabase/supabase-js'
import { startPlan } from '@/lib/billing-service'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { isSuperAdminEmail } from '@/lib/api-auth-helper'
import { checkSignupCode, clearSignupCode, parseSignup, signupCodeOn } from '@/lib/auth/signup-otp'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  // Use service role to bypass RLS and rate limits
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function POST(request: NextRequest) {
  // Tracked so a failed signup does not leave a half-created tenant behind
  let createdOrgId: string | null = null
  let createdAuthUserId: string | null = null
  let supabase: ReturnType<typeof getSupabaseAdminClient> | null = null

  try {
    supabase = getSupabaseAdminClient()
    const body = await request.json()
    const parsed = parseSignup(body)
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { email, password, fullName, companyName } = parsed.value
    const limited = tooManyAttempts(request, 'signup', email)
    if (limited) return limited

    // These addresses are promoted to superadmin on
    // login. They must therefore never be registrable by whoever types them in first.
    if (isSuperAdminEmail(email)) {
      return NextResponse.json({ error: 'This email address cannot be used to sign up' }, { status: 403 })
    }

    // The 6-digit code emailed by /api/auth/signup/send-code proves the email is theirs (only when
    // SIGNUP_CODE=on; switched off by default)
    if (signupCodeOn()) {
      const code = await checkSignupCode(supabase, email, body.code)
      if ('error' in code) {
        return NextResponse.json({ error: code.error, field: 'code' }, { status: 400 })
      }
    }

    // Create organization first
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert([
        {
          name: companyName,
          slug: `${slug}-${randomBytes(4).toString('hex')}`,
          contact_email: email,
          ...(parsed.value.phone ? { contact_phone: parsed.value.phone } : {}),
        },
      ])
      .select()
      .single()

    if (orgError) throw orgError
    createdOrgId = orgData.id

    // Create auth user via Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // The email was confirmed with the sign-up code
    })

    if (authError) throw authError
    createdAuthUserId = authData.user.id

    // Create user profile
    const { error: userError } = await supabase.from('users').insert([
      {
        id: authData.user.id,
        organization_id: orgData.id,
        email,
        full_name: fullName,
        role: 'owner',
      },
    ])

    if (userError) throw userError

    // The account is complete from here on; demo data below is best-effort
    createdOrgId = null
    createdAuthUserId = null
    await clearSignupCode(supabase, email).catch(() => {})
    // The plan picked on the pricing page (?plan=…): the trial starts on it
    await startPlan(supabase, orgData.id, body.plan)

    // The usual deal stages; no made-up contacts, deals or chats (owner: "why all this test data is showing")
    await supabase.from('pipeline_stages').insert([
      { organization_id: orgData.id, name: 'New', position: 1, color: '#6366f1' },
      { organization_id: orgData.id, name: 'Contacted', position: 2, color: '#8b5cf6' },
      { organization_id: orgData.id, name: 'Qualified', position: 3, color: '#ec4899' },
      { organization_id: orgData.id, name: 'Negotiating', position: 4, color: '#f59e0b' },
      { organization_id: orgData.id, name: 'Closed Won', position: 5, color: '#10b981' },
    ]).then(() => undefined, () => undefined)

    return NextResponse.json(
      {
        success: true,
        message: 'Account created successfully',
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Signup error:', error)

    // Roll back partial work (e.g. the email was already registered) so retries start clean
    if (supabase) {
      try {
        if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId)
        if (createdOrgId) await supabase.from('organizations').delete().eq('id', createdOrgId)
      } catch (cleanupErr) {
        console.error('[Signup] Failed to clean up after error:', cleanupErr)
      }
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Signup failed',
      },
      { status: 400 }
    )
  }
}
