import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/utils'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LINK_LIFETIME_MS = 60 * 60 * 1000
/** A new link is not sent while the last one is younger than this, so the form cannot flood an inbox. */
const RESEND_AFTER_MS = 60 * 1000

// The same answer whether or not the address has an account, so the form cannot be used to find out who does
const GENERIC_REPLY = { success: true, message: 'If an account exists for that email, a reset link is on its way.' }

/**
 * Where the link in the email points. Only the configured address or the host this request really
 * reached: never the Origin header, which a caller can set to send the reset token to their own site.
 */
function appOrigin(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  return configured || new URL(request.url).origin
}

/** Escapes the characters ilike treats as wildcards, so the address is matched exactly but case-insensitively. */
const exactIlike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function POST(request: NextRequest) {
  let email = ''
  try {
    const body = await request.json()
    email = String(body?.email || '').trim().toLowerCase()
  } catch {
    // Treated as a missing address below
  }
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const { data: user } = await supabase
      .from('users')
      .select('id, email, full_name')
      .ilike('email', exactIlike(email))
      .limit(1)
      .maybeSingle()
    if (!user) return NextResponse.json(GENERIC_REPLY)

    const { data: recent } = await supabase
      .from('password_setup_tokens')
      .select('created_at')
      .eq('user_id', user.id)
      .gt('created_at', new Date(Date.now() - RESEND_AFTER_MS).toISOString())
      .limit(1)
    if (recent && recent.length > 0) return NextResponse.json(GENERIC_REPLY)

    // One live link per person: an older reset or invite link stops working when a new one is sent
    await supabase.from('password_setup_tokens').delete().eq('user_id', user.id)
    const token = randomBytes(32).toString('hex')
    const { error: tokenError } = await supabase
      .from('password_setup_tokens')
      .insert([{ user_id: user.id, token, expires_at: new Date(Date.now() + LINK_LIFETIME_MS).toISOString() }])
    if (tokenError) {
      console.error('[Forgot Password] Failed to store reset token:', tokenError)
      return NextResponse.json({ error: 'Could not send a reset link right now. Please try again.' }, { status: 500 })
    }

    const resetLink = `${appOrigin(request)}/set-password?token=${token}&reset=1`
    const name = escapeHtml(user.full_name || '')
    const html = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e9edef; border-radius: 16px; background-color: #ffffff;">
        <h2 style="color: #111b21; font-weight: 800; font-size: 20px; margin: 0 0 8px;">Reset your password</h2>
        <p style="color: #54656f; font-size: 13px; line-height: 1.6; margin: 0 0 24px;">
          Hi${name ? ` ${name}` : ''},<br/>
          We received a request to reset the password for this account. Click the button below to choose a new one. This link expires in 1 hour and works once.
        </p>
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${resetLink}" style="background-color: #00a884; color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 800; font-size: 13px; text-decoration: none; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color: #8696a0; font-size: 11px; line-height: 1.4; margin: 0 0 12px;">
          If you didn't ask for this, you can ignore this email. Your password stays the same.
        </p>
        <p style="color: #8696a0; font-size: 10px; line-height: 1.4; border-top: 1px solid #e9edef; padding-top: 16px; margin: 0;">
          If the button doesn't work, copy and paste this link in your browser:<br/>
          <a href="${resetLink}" style="color: #3b82f6; text-decoration: underline;">${resetLink}</a>
        </p>
      </div>
    `

    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        html,
        text: `Reset your password with this link (expires in 1 hour): ${resetLink}\n\nIf you didn't ask for this, ignore this email.`,
      })
    } catch (sendError) {
      // Drop the token so the next attempt is not held back by the resend wait
      await supabase.from('password_setup_tokens').delete().eq('token', token)
      console.error('[Forgot Password] Reset email could not be sent:', sendError)
      return NextResponse.json({ error: 'Could not send a reset link right now. Please try again.' }, { status: 500 })
    }

    return NextResponse.json(GENERIC_REPLY)
  } catch (error) {
    console.error('[Forgot Password] Error:', error)
    return NextResponse.json({ error: 'Could not send a reset link right now. Please try again.' }, { status: 500 })
  }
}
