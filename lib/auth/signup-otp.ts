/**
 * Sign-up with an email code. The person fills the form, gets a 6-digit code by email, and the
 * account is made only when the code is right. Codes last 10 minutes and allow 5 tries; a new
 * code can be sent once a minute, up to 5 an hour. Only a hash of the code is stored.
 */

import { createHash, randomInt } from 'crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261114_signup_otps.sql word for word. */
export const SIGNUP_OTP_SQL = `-- Sign-up email codes: a new account is made only after the code sent to the email is entered.
-- Only a hash of the code is kept. Safe to run more than once. The app runs it on its own.
CREATE TABLE IF NOT EXISTS signup_otps (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE signup_otps ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

const AUTH_SCHEMA_LOCK = 724519012
export const CODE_MINUTES = 10
export const MAX_TRIES = 5
export const RESEND_SECONDS = 60
export const MAX_SENDS_PER_HOUR = 5

export const authSchemaSetup = createAutoSetup('Sign-up codes', (connectionString) => runMigrationSql(connectionString, SIGNUP_OTP_SQL, AUTH_SCHEMA_LOCK))

/** Run a step; if the codes table is missing, set it up and try again. */
export async function withAuthSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = authSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /signup_otps/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /signup_otps/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export interface SignupInput { email: string; password: string; fullName: string; companyName: string }

/** The sign-up form, checked. */
export function parseSignup(body: any): { value: SignupInput } | { error: string } {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim().slice(0, 80) : ''
  const companyName = typeof body?.companyName === 'string' ? body.companyName.trim().slice(0, 80) : ''
  if (!fullName) return { error: 'Enter your name.' }
  if (!companyName) return { error: 'Enter your business name.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Please enter a valid email address' }
  if (password.length < 6) return { error: 'Password must be at least 6 characters long' }
  return { value: { email, password, fullName, companyName } }
}

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
export const hashCode = (email: string, code: string) => createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex')

type Issued = { code: string } | { error: string; retryAfter?: number }

/** Make a new code for this email (replacing any earlier one), within the sending limits. */
export async function issueSignupCode(db: any, email: string, now = Date.now()): Promise<Issued> {
  const { data: row, error } = await withAuthSchema(() => db.from('signup_otps').select('*').eq('email', email).maybeSingle())
  if (error) throw new Error(error.message)
  const code = newCode()
  const fields = { code_hash: hashCode(email, code), expires_at: new Date(now + CODE_MINUTES * 60_000).toISOString(), attempts: 0, last_sent_at: new Date(now).toISOString() }
  if (!row) {
    const { error: insertError } = await db.from('signup_otps').insert({ email, ...fields, sends: 1, window_started_at: new Date(now).toISOString() })
    if (insertError) throw new Error(insertError.message)
    return { code }
  }
  const sinceLast = (now - Date.parse(row.last_sent_at)) / 1000
  if (sinceLast < RESEND_SECONDS) {
    const wait = Math.ceil(RESEND_SECONDS - sinceLast)
    return { error: `Please wait ${wait} seconds before asking for another code.`, retryAfter: wait }
  }
  const windowFresh = now - Date.parse(row.window_started_at) < 60 * 60_000
  if (windowFresh && Number(row.sends) >= MAX_SENDS_PER_HOUR) return { error: 'Too many codes asked for this email. Try again in an hour.' }
  const { error: updateError } = await db.from('signup_otps').update({ ...fields, sends: windowFresh ? Number(row.sends) + 1 : 1, window_started_at: windowFresh ? row.window_started_at : new Date(now).toISOString() }).eq('email', email)
  if (updateError) throw new Error(updateError.message)
  return { code }
}

/** Check the code typed in. A wrong one counts as a try. */
export async function checkSignupCode(db: any, email: string, code: unknown, now = Date.now()): Promise<{ ok: true } | { error: string }> {
  const typed = String(code ?? '').replace(/\D/g, '')
  if (typed.length !== 6) return { error: 'Enter the 6-digit code we emailed you.' }
  const { data: row, error } = await withAuthSchema(() => db.from('signup_otps').select('*').eq('email', email).maybeSingle())
  if (error) throw new Error(error.message)
  if (!row) return { error: 'Ask for a code first.' }
  if (Date.parse(row.expires_at) <= now) return { error: 'That code has expired. Send a new one.' }
  if (Number(row.attempts) >= MAX_TRIES) return { error: 'Too many wrong tries. Send a new code.' }
  if (row.code_hash !== hashCode(email, typed)) {
    await db.from('signup_otps').update({ attempts: Number(row.attempts) + 1 }).eq('email', email)
    const left = MAX_TRIES - Number(row.attempts) - 1
    return { error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Send a new code.' }
  }
  return { ok: true }
}

/** The account was made: the code cannot be used again. */
export async function clearSignupCode(db: any, email: string) {
  await db.from('signup_otps').delete().eq('email', email)
}

/** The email with the code, in plain words. */
export function signupCodeEmail(code: string, name: string) {
  const first = name.split(' ')[0] || 'there'
  return {
    subject: `${code} is your WAMA CRM sign-up code`,
    text: `Hi ${first},\n\nYour WAMA CRM sign-up code is ${code}. It works for ${CODE_MINUTES} minutes.\n\nIf you did not try to sign up, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0E1B3D">
  <p style="font-size:15px">Hi ${first.replace(/[<>&"]/g, '')},</p>
  <p style="font-size:15px">Enter this code to finish signing up for <strong>WAMA CRM</strong>:</p>
  <p style="font-size:32px;font-weight:800;letter-spacing:8px;color:#1D5BEA;font-family:monospace;margin:20px 0">${code}</p>
  <p style="font-size:13px;color:#6B7894">It works for ${CODE_MINUTES} minutes. If you did not try to sign up, you can ignore this email.</p>
</div>`,
  }
}
