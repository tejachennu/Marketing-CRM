import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { checkLoginCode, clearLoginCode } from '@/lib/auth/login-otp'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables')
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * POST { email, password, otpCode }: finish signing in. The password is checked again, then the
 * 6-digit code emailed at the login step (or the super admin bypass code). Returns a Supabase session.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password, otpCode } = await request.json()
    if (!email || !password || !otpCode) {
      return NextResponse.json({ error: 'Email, password, and verification code are required' }, { status: 400 })
    }
    const normalisedEmail = String(email).trim().toLowerCase()
    const admin = getSupabaseAdminClient()

    // 1. The code (or the bypass) must be right
    const code = await checkLoginCode(admin, normalisedEmail, otpCode)
    if ('error' in code) return NextResponse.json({ error: code.error }, { status: 400 })

    // 2. The password must still be right, so a leaked code alone is not enough
    const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data: authData, error: authError } = await userClient.auth.signInWithPassword({ email: normalisedEmail, password })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 401 })
    if (!authData.session) return NextResponse.json({ error: 'Failed to create session' }, { status: 401 })

    // 3. One code, one sign-in
    await clearLoginCode(admin, normalisedEmail).catch(() => {})

    const response = NextResponse.json({ success: true, user: authData.user, session: authData.session }, { status: 200 })
    response.cookies.set('user-logged-in', 'true', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/' })
    return response
  } catch (error: any) {
    console.error('[Verify OTP] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 500 })
  }
}
