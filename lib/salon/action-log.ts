/**
 * Counter actions sent with a client reference are done once. The mobile app queues actions
 * while offline and sends each with its own reference; if the reply is lost and it sends the
 * same action again, the first result comes back instead of a second bill or booking.
 */

import { withSalonSchema } from './schema'

/** A reference the app made up: letters, digits, _ and -, 8 to 64 long. */
export function isClientRef(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)
}

export type Claim = { fresh: true } | { fresh: false; result: any | null }

/** Take the reference for this action. Not fresh: it was done (result) or is being done (null). */
export async function claimClientRef(db: any, organizationId: string, ref: string): Promise<Claim> {
  const existing = await withSalonSchema(() => db.from('salon_action_log').select('result').eq('organization_id', organizationId).eq('client_ref', ref).maybeSingle())
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) return { fresh: false, result: existing.data.result ?? null }
  const { error } = await db.from('salon_action_log').insert({ organization_id: organizationId, client_ref: ref, result: null })
  if (!error) return { fresh: true }
  if (error.code === '23505') {
    const again = await db.from('salon_action_log').select('result').eq('organization_id', organizationId).eq('client_ref', ref).maybeSingle()
    return { fresh: false, result: again.data?.result ?? null }
  }
  throw new Error(error.message)
}

/** Remember what the action returned, for a repeat. */
export async function saveClientResult(db: any, organizationId: string, ref: string, result: unknown) {
  const { error } = await db.from('salon_action_log').update({ result }).eq('organization_id', organizationId).eq('client_ref', ref)
  if (error) console.warn('[Front Desk] Could not remember an action result:', error.message)
}

/** The action failed: let the same reference be tried again. */
export async function releaseClientRef(db: any, organizationId: string, ref: string) {
  await db.from('salon_action_log').delete().eq('organization_id', organizationId).eq('client_ref', ref).is('result', null)
}
