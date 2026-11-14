/**
 * "Continue with Google" through Firebase: Firebase only proves who the person is (their Google
 * account). Every WAMA CRM account, session and record stays in Supabase:
 *
 * 1. The website or app signs in with Google through Firebase and sends the Firebase ID token here.
 * 2. The token is checked against Google's public keys for this Firebase project (no Firebase SDK).
 * 3. The Supabase account with that email is used; when there is none, it is made (email confirmed:
 *    Google has checked it).
 * 4. A normal Supabase session is made for that account and handed back, so the rest of WAMA CRM
 *    works exactly as after an email sign-in. A first-timer then names their business
 *    (/api/auth/oauth-complete).
 */

import { createPublicKey, createVerify, X509Certificate } from 'node:crypto'

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

let certCache: { at: number; maxAge: number; certs: Record<string, string> } | null = null

/** Google's signing certificates for Firebase ID tokens, kept as long as Google says. */
export async function firebaseCerts(fetcher: typeof fetch = fetch, now = Date.now()): Promise<Record<string, string>> {
  if (certCache && now - certCache.at < certCache.maxAge) return certCache.certs
  const response = await fetcher(CERTS_URL)
  if (!response.ok) throw new Error(`Google's keys could not be read (HTTP ${response.status})`)
  const certs = (await response.json()) as Record<string, string>
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 3600) * 1000
  certCache = { at: now, maxAge, certs }
  return certs
}

/** Test seam. */
export function resetFirebaseCerts() {
  certCache = null
}

export interface FirebasePerson { uid: string; email: string; name: string | null; provider: string }

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

/**
 * Check a Firebase ID token: signed by Google for this project, not expired, for a verified email.
 * Returns the person, or the reason in words. `certs` is injectable for tests.
 */
export async function verifyFirebaseToken(token: unknown, projectId: string, certs: Record<string, string> | (() => Promise<Record<string, string>>), now = Date.now()): Promise<FirebasePerson | { error: string }> {
  const bad = { error: 'Google sign-in could not be checked. Please try again.' }
  if (typeof token !== 'string' || token.split('.').length !== 3 || !projectId) return bad
  const [head, body, signature] = token.split('.')
  let header: any, claims: any
  try {
    header = decode(head)
    claims = decode(body)
  } catch {
    return bad
  }
  if (header.alg !== 'RS256' || !header.kid) return bad
  const keys = typeof certs === 'function' ? await certs() : certs
  const pem = keys[header.kid]
  if (!pem) return bad
  try {
    // Google sends certificates; a bare public key works too (tests)
    const key = pem.includes('BEGIN CERTIFICATE') ? new X509Certificate(pem).publicKey : createPublicKey(pem)
    if (!createVerify('RSA-SHA256').update(`${head}.${body}`).verify(key, Buffer.from(signature, 'base64url'))) return bad
  } catch {
    return bad
  }
  const seconds = Math.floor(now / 1000)
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return bad
  // A few minutes' slack for a phone whose clock is off
  if (!(Number(claims.exp) > seconds - 300) || !(Number(claims.iat) <= seconds + 300) || !claims.sub) return { error: 'The Google sign-in has expired. Please try again.' }
  const email = String(claims.email || '').trim().toLowerCase()
  if (!email || claims.email_verified !== true) return { error: 'Your Google account has no confirmed email address.' }
  return { uid: String(claims.sub), email, name: String(claims.name || '').trim() || null, provider: String(claims.firebase?.sign_in_provider || 'google.com') }
}

export interface SupabaseSession { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: string; user: any }

/**
 * The Supabase session for this person: their existing account (by email), or a new one when there is
 * none. Uses the admin client to make (or find) the account and a one-time sign-in link, which the
 * public client turns into a session straight away (no email is sent).
 */
export async function supabaseSessionFor(admin: any, anon: any, person: FirebasePerson): Promise<{ session: SupabaseSession; created: boolean }> {
  let created = false
  const made = await admin.auth.admin.createUser({
    email: person.email,
    email_confirm: true,
    user_metadata: { full_name: person.name || undefined, signed_up_with: 'google' },
  })
  if (!made.error) created = true
  else if (!/already|registered|exists/i.test(made.error.message || '')) throw new Error(made.error.message)

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: person.email })
  const tokenHash = link.data?.properties?.hashed_token
  if (link.error || !tokenHash) throw new Error(link.error?.message || 'The sign-in could not be made')
  const verified = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  const session = verified.data?.session
  if (verified.error || !session) throw new Error(verified.error?.message || 'The sign-in could not be made')
  return {
    created,
    session: {
      access_token: session.access_token, refresh_token: session.refresh_token, token_type: session.token_type || 'bearer',
      expires_in: session.expires_in || 3600, expires_at: session.expires_at || Math.floor(Date.now() / 1000) + 3600, user: session.user,
    },
  }
}
