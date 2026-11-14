import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import { issueLoginCode, loginCodeEmail } from '@/lib/auth/login-otp'

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

    const normalisedEmail = String(email).trim().toLowerCase()

    // Signs the person in straight away. Used when OTP is switched off, and when the code email could
    // not go out — a mail outage must never lock people out, so the password alone is enough then.
    const signInNow = () => {
      const response = NextResponse.json({ success: true, otpRequired: false, session: data.session, user: data.user })
      if (data.session) {
        response.cookies.set('user-logged-in', 'true', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/' })
      }
      return response
    }

    // After the password, a 6-digit code emailed to the person proves the email is theirs.
    // Set OTP_LOGIN=off to skip the code step entirely.
    const otpOff = String(process.env.OTP_LOGIN || '').trim().toLowerCase() === 'off'
    if (otpOff) return signInNow()

    const issued = await issueLoginCode(adminSupabase, normalisedEmail).catch((e) => { console.error('[Login API] Could not make a code:', e?.message); return { error: 'make-failed' } as const })
    if ('error' in issued) {
      // A recent code is still good; ask for it rather than sending another
      if ('retryAfter' in issued && issued.retryAfter) return NextResponse.json({ otpRequired: true, email: normalisedEmail, resendAfterSeconds: issued.retryAfter })
      // The code could not even be made (a database problem). Don't lock the person out.
      return signInNow()
    }

    const name = data.user?.user_metadata?.full_name || normalisedEmail
    const mail = loginCodeEmail(issued.code, name)
    const sent = await sendEmail({ to: normalisedEmail, subject: mail.subject, html: mail.html, text: mail.text }).then(() => true).catch((e) => { console.error('[Login API] Code email failed:', e?.message); return false })

    // The email went out: ask for the code. It could not be sent: sign in on the password alone
    // rather than lock the person out of their account.
    if (sent) return NextResponse.json({ otpRequired: true, email: normalisedEmail, resendAfterSeconds: 60 })
    console.warn('[Login API] Code email could not be sent; signing in on the password alone for', normalisedEmail)
    return signInNow()
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
