import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const { email, password, otpCode } = await request.json()

    if (!email || !password || !otpCode) {
      return NextResponse.json(
        { error: 'Email, password, and verification code are required' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdminClient()

    // 1. Verify the OTP code from the database
    const now = new Date().toISOString()
    const { data: otpRecords, error: otpError } = await supabase
      .from('login_otps')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .eq('otp_code', otpCode.trim())
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)

    if (otpError) {
      console.error('[Verify OTP] Database query error:', otpError)
      return NextResponse.json({ error: 'Failed to verify code' }, { status: 500 })
    }

    if (!otpRecords || otpRecords.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    // 2. The OTP is valid! Now sign in with Supabase
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: authData, error: authError } = await userClient.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 401 }
      )
    }

    if (!authData.session) {
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 401 }
      )
    }

    // 3. Delete used OTP
    await supabase
      .from('login_otps')
      .delete()
      .eq('email', email.trim().toLowerCase())

    // 4. Create response with success session data
    const response = NextResponse.json(
      {
        success: true,
        user: authData.user,
        session: authData.session,
      },
      { status: 200 }
    )

    // Set secure HTTP-only cookie with the session
    const maxAge = 60 * 60 * 24 * 5 // 5 days
    response.cookies.set('supabase-auth-token', authData.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    })

    // Also set a flag cookie to indicate user is logged in
    response.cookies.set('user-logged-in', 'true', {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    })

    return response
  } catch (error: any) {
    console.error('[Verify OTP] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed' },
      { status: 500 }
    )
  }
}
