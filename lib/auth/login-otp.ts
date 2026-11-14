/**
 * Sign-in with an email code. After the password is right, a 6-digit code is emailed; the session is
 * given only when that code is entered. Codes last 10 minutes and allow 5 tries; a new code can be
 * sent once a minute, up to 5 an hour. Only a hash of the code is kept.
 *
 * A bypass code, for when email is down: set LOGIN_OTP_BYPASS in the environment (never in the repo).
 * It only works for the super admin addresses (SUPERADMIN_EMAILS), so it is not a way into any account.
 */

import { createHash, randomInt, timingSafeEqual } from 'crypto'
import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'


/** supabase/migrations/20261115_login_codes.sql word for word. */
export const LOGIN_CODES_SQL = `-- Sign-in email codes: after the password, a 6-digit code sent to the email must be entered.
-- Only a hash of the code is kept. Safe to run more than once. The app runs it on its own.
CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
`

const LOGIN_CODES_LOCK = 724519015
export const CODE_MINUTES = 10
export const MAX_TRIES = 5
export const RESEND_SECONDS = 60
export const MAX_SENDS_PER_HOUR = 5

export const loginCodesSetup = createAutoSetup('Sign-in codes', (connectionString) => runMigrationSql(connectionString, LOGIN_CODES_SQL, LOGIN_CODES_LOCK))

/** Run a step; if the codes table is missing, set it up and try again. */
export async function withLoginCodes(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = loginCodesSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /login_codes/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /login_codes/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
export const hashCode = (email: string, code: string) => createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex')

/** The super admin addresses from SUPERADMIN_EMAILS (comma-separated), same as api-auth-helper. */
function superAdminEmails(env: Record<string, string | undefined>): string[] {
  return String(env.SUPERADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The bypass code (LOGIN_OTP_BYPASS), honoured only for a super admin address. */
export function isBypassCode(email: string, code: string, env: Record<string, string | undefined> = process.env): boolean {
  const bypass = String(env.LOGIN_OTP_BYPASS || '').trim()
  if (bypass.length < 4 || !superAdminEmails(env).includes(String(email || '').trim().toLowerCase())) return false
  return sameSecret(bypass, String(code || '').trim())
}

type Issued = { code: string } | { error: string; retryAfter?: number }

/** Make a new code for this email (replacing any earlier one), within the sending limits. */
export async function issueLoginCode(db: any, email: string, now = Date.now()): Promise<Issued> {
  const { data: row, error } = await withLoginCodes(() => db.from('login_codes').select('*').eq('email', email).maybeSingle())
  if (error) throw new Error(error.message)
  const code = newCode()
  const fields = { code_hash: hashCode(email, code), expires_at: new Date(now + CODE_MINUTES * 60_000).toISOString(), attempts: 0, last_sent_at: new Date(now).toISOString() }
  if (!row) {
    const { error: insertError } = await db.from('login_codes').insert({ email, ...fields, sends: 1, window_started_at: new Date(now).toISOString() })
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
  const { error: updateError } = await db.from('login_codes').update({ ...fields, sends: windowFresh ? Number(row.sends) + 1 : 1, window_started_at: windowFresh ? row.window_started_at : new Date(now).toISOString() }).eq('email', email)
  if (updateError) throw new Error(updateError.message)
  return { code }
}

/** Check the code typed in. The bypass code is accepted for a super admin without a stored code. A wrong one counts as a try. */
export async function checkLoginCode(db: any, email: string, code: unknown, now = Date.now()): Promise<{ ok: true } | { error: string }> {
  const typed = String(code ?? '').replace(/\D/g, '')
  if (isBypassCode(email, typed)) return { ok: true }
  if (typed.length !== 6) return { error: 'Enter the 6-digit code we emailed you.' }
  const { data: row, error } = await withLoginCodes(() => db.from('login_codes').select('*').eq('email', email).maybeSingle())
  if (error) throw new Error(error.message)
  if (!row) return { error: 'Ask for a code first.' }
  if (Date.parse(row.expires_at) <= now) return { error: 'That code has expired. Send a new one.' }
  if (Number(row.attempts) >= MAX_TRIES) return { error: 'Too many wrong tries. Send a new code.' }
  if (row.code_hash !== hashCode(email, typed)) {
    await db.from('login_codes').update({ attempts: Number(row.attempts) + 1 }).eq('email', email)
    const left = MAX_TRIES - Number(row.attempts) - 1
    return { error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Send a new code.' }
  }
  return { ok: true }
}

/** After a good sign-in: the code cannot be used again. */
export async function clearLoginCode(db: any, email: string) {
  await db.from('login_codes').delete().eq('email', email)
}

/** The email with the code, in plain words. */
export function loginCodeEmail(code: string, name: string) {
  const first = (name || '').split(' ')[0] || 'there'
  const safe = first.replace(/[<>&']/g, '')
  return {
    subject: `${code} is your WAMA CRM sign-in code`,
    text: `Hi ${safe},\n\nYour WAMA CRM sign-in code is ${code}. It works for ${CODE_MINUTES} minutes.\n\nIf you did not try to sign in, you can ignore this email.`,
    html: `<div style='font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0E1B3D'>
  <p style='font-size:15px'>Hi ${safe},</p>
  <p style='font-size:15px'>Enter this code to sign in to <strong>WAMA CRM</strong>:</p>
  <p style='font-size:32px;font-weight:800;letter-spacing:8px;color:#1D5BEA;font-family:monospace;margin:20px 0'>${code}</p>
  <p style='font-size:13px;color:#6B7894'>It works for ${CODE_MINUTES} minutes. If you did not try to sign in, you can ignore this email.</p>
</div>`,
  }
}
