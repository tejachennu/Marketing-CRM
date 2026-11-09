import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdminEmail } from '@/lib/api-auth-helper'
import { issueSignupCode, parseSignup, signupCodeEmail } from '@/lib/auth/signup-otp'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// POST { email, password, fullName, companyName }: check the form and email a 6-digit code.
// The account itself is made by POST /api/auth/signup with that code.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const parsed = parseSignup(body)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { email, fullName } = parsed.value
    if (isSuperAdminEmail(email)) return NextResponse.json({ error: 'This email address cannot be used to sign up' }, { status: 403 })

    const db = admin()
    const { data: existing } = await db.from('users').select('id').ilike('email', email).limit(1)
    if (existing?.length) return NextResponse.json({ error: 'An account with this email already exists. Sign in instead.', field: 'email' }, { status: 409 })

    const issued = await issueSignupCode(db, email)
    if ('error' in issued) return NextResponse.json({ error: issued.error, retryAfter: issued.retryAfter }, { status: 429 })

    const mail = signupCodeEmail(issued.code, fullName)
    const sent = await sendEmail({ to: email, ...mail }).catch((error: any) => ({ success: false, error: error?.message }))
    if (!(sent as any)?.success) {
      console.error('[Signup code] Email not sent:', (sent as any)?.error)
      return NextResponse.json({ error: 'The code could not be emailed right now. Please try again in a minute.' }, { status: 502 })
    }
    return NextResponse.json({ success: true, sentTo: email, expiresInMinutes: 10, resendAfterSeconds: 60 })
  } catch (error: any) {
    console.error('[Signup code] Error:', error?.message)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
