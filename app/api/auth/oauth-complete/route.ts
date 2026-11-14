import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, getSupabaseAnonClient, isSuperAdminEmail } from '@/lib/api-auth-helper'
import { createWorkspaceFor, parseBusinessStep, personFromToken } from '@/lib/auth/oauth-workspace'

export const runtime = 'nodejs'

const bearer = (request: NextRequest) => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null

/**
 * After "Continue with Google" (website and app).
 * GET: does this person have a WAMA CRM workspace? { ready: true } or { ready: false, name, email }.
 * POST { companyName, fullName?, plan? }: make their workspace (once) and start the free trial.
 */
export async function GET(request: NextRequest) {
  const person = await personFromToken(getSupabaseAnonClient(), bearer(request))
  if (!person) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const { data: profile } = await getSupabaseAdminClient().from('users').select('id, organization_id').eq('id', person.id).maybeSingle()
  if (profile?.organization_id) return NextResponse.json({ ready: true })
  return NextResponse.json({ ready: false, email: person.email, name: person.name })
}

export async function POST(request: NextRequest) {
  const person = await personFromToken(getSupabaseAnonClient(), bearer(request))
  if (!person) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  // Super admin addresses are made super admins on sign-in: never a new client workspace for them
  if (isSuperAdminEmail(person.email)) return NextResponse.json({ ready: true })
  const step = parseBusinessStep(await request.json().catch(() => null))
  if ('error' in step) return NextResponse.json({ error: step.error }, { status: 400 })
  try {
    const result = await createWorkspaceFor(getSupabaseAdminClient(), person, step)
    return NextResponse.json({ ready: true, created: result.created })
  } catch (error: any) {
    console.error('[OAuth workspace]', error?.message)
    return NextResponse.json({ error: 'Your business could not be set up. Please try again.' }, { status: 500 })
  }
}
