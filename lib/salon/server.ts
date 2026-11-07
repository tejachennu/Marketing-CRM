/**
 * Server-side helpers for the Spa & Salon API routes: who may do what, and loading the salon's
 * setup. Every route goes through salonAccess, so a workspace without the connector switched on
 * (or Consular Helpdesk) gets a clear refusal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '../api-auth-helper'
import type { Permission } from '../rbac'
import { isConsularHelpdesk } from '../workspace-modules'
import { withSalonSchema } from './schema'

export interface SalonContext {
  db: any
  user: any
  organizationId: string
  organization: Record<string, any>
}

export type SalonAccess = { ok: true; ctx: SalonContext } | { ok: false; response: NextResponse }

export const SALON_OFF_MESSAGE = 'Spa & Salon is switched off for this workspace. An admin can switch it on in Connectors.'

export async function salonAccess(request: NextRequest, organizationId: string | null | undefined, permission?: Permission): Promise<SalonAccess> {
  const access = await verifyOrgAccess(request, organizationId || null, permission ? { permission } : {})
  if (!access.authorized) return { ok: false, response: NextResponse.json({ error: access.error }, { status: access.status }) }
  const db = getSupabaseAdminClient()
  const { data: organization, error } = await withSalonSchema(() =>
    db.from('organizations').select('id, name, slug, whatsapp_provider, twilio_account_sid, twilio_auth_token, enabled_connectors').eq('id', organizationId).maybeSingle()
  )
  if (error || !organization) return { ok: false, response: NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: error ? 500 : 404 }) }
  if (isConsularHelpdesk(organization) || !(organization.enabled_connectors || []).includes('salon')) {
    return { ok: false, response: NextResponse.json({ error: SALON_OFF_MESSAGE }, { status: 403 }) }
  }
  return { ok: true, ctx: { db, user: access.user, organizationId: String(organizationId), organization } }
}

export const DEFAULT_SALON_SETTINGS = {
  business_name: null as string | null,
  address: null as string | null,
  phone: null as string | null,
  email: null as string | null,
  gstin: null as string | null,
  invoice_prefix: 'INV',
  prices_include_tax: false,
  invoice_note: null as string | null,
  voice_replies: true,
  logo_url: null as string | null,
  opens_at: '10:00',
  closes_at: '21:00',
  closed_weekdays: [] as number[],
  chat_assistant: true,
  auto_approve_bookings: false,
  reminders_enabled: true,
  feedback_enabled: true,
  feedback_delay_minutes: 120,
  review_link: null as string | null,
}

export async function loadSalonSettings(db: any, organizationId: string) {
  const { data } = await withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle())
  return { ...DEFAULT_SALON_SETTINGS, ...(data || {}) }
}

export async function loadSalonSetup(db: any, organizationId: string) {
  const [settings, services, staff] = await Promise.all([
    loadSalonSettings(db, organizationId),
    withSalonSchema(() => db.from('salon_services').select('*').eq('organization_id', organizationId).order('position').order('name')),
    withSalonSchema(() => db.from('salon_staff').select('*').eq('organization_id', organizationId).order('name')),
  ])
  if (services.error) throw new Error(services.error.message)
  if (staff.error) throw new Error(staff.error.message)
  return { settings, services: services.data || [], staff: staff.data || [] }
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function serverError(scope: string, error: any) {
  console.error(`[Salon ${scope}]`, error?.message || error)
  return NextResponse.json({ error: error?.message || 'Something went wrong. Please try again.' }, { status: 500 })
}
