import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

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
    const supabase = getSupabaseClient()
    const adminSupabase = getSupabaseAdminClient()
    
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      )
    }

    // 1. Authenticate with Supabase first to verify the credentials
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }

    // OTP logic disabled for testing
    /*
    // 2. Generate a secure 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes expiration

    // 3. Store OTP in database
    const { error: otpDbError } = await adminSupabase
      .from('login_otps')
      .insert([
        {
          email: email.trim().toLowerCase(),
          otp_code: otpCode,
          expires_at: expiresAt,
        }
      ])

    if (otpDbError) {
      console.error('[Login API] Failed to store OTP in DB:', otpDbError)
      return NextResponse.json(
        { error: 'Internal server error during verification' },
        { status: 500 }
      )
    }

    // 4. Send email to user with the OTP code
    const userFullName = data.user?.user_metadata?.full_name || email
    
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e9edef; rounded: 12px; background-color: #ffffff;">
        <h2 style="color: #111b21; font-weight: 800; font-size: 20px; margin-bottom: 8px;">Verification Code</h2>
        <p style="color: #54656f; font-size: 13px; line-height: 1.5; margin-bottom: 24px;">
          Hi there, <br/>
          Use the following verification code to complete your login to <strong>OmniCRM</strong>. This code is valid for 5 minutes.
        </p>
        <div style="background-color: #f0f2f5; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #00a884; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="color: #8696a0; font-size: 11px; line-height: 1.4; margin-top: 24px;">
          If you didn't attempt to sign in, you can safely ignore this email. Someone else might have typed your email by mistake.
        </p>
      </div>
    `
    
    await sendEmail({
      to: email.trim().toLowerCase(),
      subject: `🔑 ${otpCode} is your OmniCRM verification code`,
      html: emailHtml,
      text: `Your OmniCRM verification code is: ${otpCode}. It expires in 5 minutes.`
    })
    */

    // Return session directly (bypassing OTP)
    return NextResponse.json({
      success: true,
      otpRequired: false,
      session: data.session,
      user: data.user
    })
  } catch (error) {
    console.error('[v0] Login error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Login failed',
      },
      { status: 400 }
    )
  }
}
