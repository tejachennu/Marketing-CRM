/**
 * Sign-in with Google (and later Apple): the person's account is made by Supabase; their WAMA CRM
 * workspace is made here, once, with the business name they type on the "Name your business" step.
 * A Google account with the same email as an existing WAMA CRM account signs in to that account
 * (Supabase links the two), so no second workspace is ever made.
 */

import { randomBytes } from 'node:crypto'
import { startPlan } from '../billing-service'
import { isPlanId } from '../plans'

export interface OAuthPerson { id: string; email: string; name: string | null; provider: string }

/** The signed-in person from a Supabase access token, or null when the token is not valid. */
export async function personFromToken(anon: any, token: string | null | undefined): Promise<OAuthPerson | null> {
  if (!token) return null
  const { data, error } = await anon.auth.getUser(token)
  const user = data?.user
  if (error || !user?.id || !user.email) return null
  const meta = user.user_metadata || {}
  return { id: user.id, email: String(user.email).toLowerCase(), name: String(meta.full_name || meta.name || '').trim() || null, provider: String(user.app_metadata?.provider || 'email') }
}

/** Check the "Name your business" step. */
export function parseBusinessStep(body: any): { companyName: string; fullName: string | null; plan: string | null } | { error: string } {
  const companyName = String(body?.companyName || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (companyName.length < 2) return { error: 'Please type your business name.' }
  const fullName = String(body?.fullName || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null
  const plan = isPlanId(body?.plan) ? String(body.plan) : null
  return { companyName, fullName, plan }
}

export function slugFor(companyName: string): string {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace'
  return `${base}-${randomBytes(4).toString('hex')}`
}

/**
 * Make the workspace for a person who signed in with Google and has none yet: the business, the
 * person as its owner, the usual deal stages, and the trial on the plan they picked. Returns the
 * profile. When a profile already exists (a second tap, or two tabs), it is returned as it is.
 */
export async function createWorkspaceFor(db: any, person: OAuthPerson, step: { companyName: string; fullName: string | null; plan: string | null }) {
  const { data: existing } = await db.from('users').select('*').eq('id', person.id).maybeSingle()
  if (existing) return { user: existing, created: false }

  const { data: org, error: orgError } = await db.from('organizations').insert([{ name: step.companyName, slug: slugFor(step.companyName), contact_email: person.email }]).select().single()
  if (orgError) throw new Error(orgError.message)

  const fullName = step.fullName || person.name || person.email.split('@')[0]
  const { data: user, error: userError } = await db.from('users').insert([{ id: person.id, organization_id: org.id, email: person.email, full_name: fullName, role: 'owner' }]).select().single()
  if (userError) {
    // Two taps at once: the other one made the profile; drop this business
    await db.from('organizations').delete().eq('id', org.id)
    const { data: again } = await db.from('users').select('*').eq('id', person.id).maybeSingle()
    if (again) return { user: again, created: false }
    throw new Error(userError.message)
  }

  await db.from('pipeline_stages').insert(
    [['New', '#6366f1'], ['Contacted', '#8b5cf6'], ['Qualified', '#ec4899'], ['Negotiating', '#f59e0b'], ['Closed Won', '#10b981']]
      .map(([name, color], index) => ({ organization_id: org.id, name, color, position: index + 1 })),
  ).then(() => undefined, () => undefined)
  if (step.plan) await startPlan(db, org.id, step.plan)
  return { user, created: true }
}
