import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, getSupabaseAnonClient } from '@/lib/api-auth-helper'
import { checkRateLimit } from '@/lib/rate-limiter'
import { firebaseCerts, supabaseSessionFor, verifyFirebaseToken } from '@/lib/auth/firebase-signin'

export const runtime = 'nodejs'

/**
 * GET: the Firebase settings the website needs for its Google sign-in pop-up (public values, like the
 * ones in every web page that uses Firebase), or null when Google sign-in is not set up.
 */
export async function GET() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim()
  const apiKey = String(process.env.FIREBASE_WEB_API_KEY || '').trim()
  if (!projectId || !apiKey) return NextResponse.json({ firebase: null })
  return NextResponse.json({
    firebase: { apiKey, projectId, authDomain: String(process.env.FIREBASE_AUTH_DOMAIN || '').trim() || `${projectId}.firebaseapp.com`, appId: String(process.env.FIREBASE_WEB_APP_ID || '').trim() || undefined },
  }, { headers: { 'Cache-Control': 'public, max-age=300' } })
}

/**
 * POST { idToken }: "Continue with Google" (website and app). Firebase proved who the person is; this
 * finds their WAMA CRM account in Supabase by email (or makes it) and returns a Supabase session.
 * `needsBusiness` = a first-timer, who names their business next (/api/auth/oauth-complete).
 */
export async function POST(request: NextRequest) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`firebase-signin:${ip}`, 20, 10 * 60_000).allowed) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429 })
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim()
  if (!projectId) return NextResponse.json({ error: 'Signing in with Google is not switched on yet. Please use your email for now.' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const person = await verifyFirebaseToken(body?.idToken, projectId, () => firebaseCerts())
  if ('error' in person) return NextResponse.json({ error: person.error }, { status: 401 })

  try {
    const admin = getSupabaseAdminClient()
    const { session, created } = await supabaseSessionFor(admin, getSupabaseAnonClient(), person)
    const { data: profile } = await admin.from('users').select('id, organization_id').eq('id', session.user.id).maybeSingle()
    const response = NextResponse.json({ session, user: session.user, created, needsBusiness: !profile?.organization_id, name: person.name, email: person.email })
    // Lets the website's middleware open the dashboard straight away, as after an email sign-in
    response.cookies.set('user-logged-in', 'true', { path: '/', maxAge: 60 * 60 * 24 * 7, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    return response
  } catch (error: any) {
    console.error('[Google sign-in]', error?.message)
    return NextResponse.json({ error: 'Your account could not be opened. Please try again, or use your email.' }, { status: 500 })
  }
}
