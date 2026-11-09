import { withSalonSchema } from './schema'

/**
 * The Front Desk change history: every change to the setup (services, categories, catalog imports,
 * billing on/off, team, business details, WhatsApp settings, templates, booking flow) is written here
 * with who made it and what changed. Writing the history never stops the change itself.
 */

export type ChangeArea = 'service' | 'category' | 'catalog' | 'team' | 'business' | 'whatsapp' | 'booking_flow' | 'templates' | 'settings'

export interface ChangeEntry {
  area: ChangeArea
  /** added, changed, removed, imported, refreshed, … */
  action: string
  /** What it is about: a service's name, a person's name, … */
  target?: string | null
  /** What changed: { field: { from, to } }, or a short list (names imported). */
  details?: Record<string, unknown>
}

interface Ctx { db: any; organizationId: string; user?: any }

export const userName = (user: any) => String(user?.full_name || user?.name || user?.email || 'Someone').trim().slice(0, 80)

export async function logChange(ctx: Ctx, entry: ChangeEntry): Promise<void> {
  try {
    await withSalonSchema(() =>
      ctx.db.from('salon_change_log').insert({
        organization_id: ctx.organizationId,
        user_id: typeof ctx.user?.id === 'string' ? ctx.user.id : null,
        user_name: userName(ctx.user),
        area: entry.area,
        action: entry.action,
        target: entry.target ? String(entry.target).slice(0, 120) : null,
        details: entry.details || {},
      })
    )
  } catch (error) {
    console.error('[front desk] change history not written:', error)
  }
}

/** The fields that differ between two versions: { field: { from, to } }. */
export function changedFields(before: Record<string, any> | null | undefined, after: Record<string, any>, fields: string[]): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of fields) {
    if (!(field in after)) continue
    const from = before?.[field] ?? null
    const to = after[field] ?? null
    if (JSON.stringify(normalise(from)) !== JSON.stringify(normalise(to))) out[field] = { from, to }
  }
  return out
}

// "600" and 600, or 18 and "18.00", are the same value
const normalise = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) ? Number(v) : v)

/** The newest entries first, optionally for one area. */
export async function listChanges(db: any, organizationId: string, options: { limit?: number; area?: string | null; before?: string | null } = {}) {
  const limit = Math.min(200, Math.max(1, options.limit || 50))
  let query = db.from('salon_change_log').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(limit)
  if (options.area) query = query.eq('area', options.area)
  if (options.before) query = query.lt('created_at', options.before)
  const { data, error } = await withSalonSchema(() => query)
  if (error) throw new Error(error.message)
  return data || []
}
