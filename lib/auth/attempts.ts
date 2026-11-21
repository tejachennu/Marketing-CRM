/**
 * Limits on sign-in, sign-up and password attempts, so nobody can keep guessing passwords or codes, or flood
 * people's inboxes. Per address (x-forwarded-for) and, where there is one, per email. In memory per server, like
 * the other rate limits; Supabase adds its own limits behind these.
 */

import { NextResponse } from 'next/server'
import { checkRateLimit } from '../rate-limiter'

const LIMITS = {
  login: { ip: [20, 10], email: [8, 10] },
  otp: { ip: [20, 10], email: [10, 10] },
  forgot: { ip: [30, 60], email: [10, 60] },
  signup: { ip: [10, 60], email: [5, 60] },
  setPassword: { ip: [15, 60], email: [0, 0] },
} as const

export type AttemptKind = keyof typeof LIMITS

/** A 429 answer when this address or email has tried too often; null when the attempt may go on. */
export function tooManyAttempts(request: { headers: { get(name: string): string | null } }, kind: AttemptKind, email?: unknown): NextResponse | null {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const [ipMax, ipMinutes] = LIMITS[kind].ip
  if (!checkRateLimit(`auth-${kind}-ip:${ip}`, ipMax, ipMinutes * 60_000).allowed) {
    return NextResponse.json({ error: 'Too many tries. Please wait a few minutes and try again.' }, { status: 429 })
  }
  const [emailMax, emailMinutes] = LIMITS[kind].email
  const key = String(email || '').trim().toLowerCase()
  if (emailMax && key && !checkRateLimit(`auth-${kind}-email:${key}`, emailMax, emailMinutes * 60_000).allowed) {
    return NextResponse.json({ error: 'Too many tries for this email. Please wait a few minutes and try again.' }, { status: 429 })
  }
  return null
}
