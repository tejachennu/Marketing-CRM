/**
 * Server-side helpers for the Sales Pipeline screens' API: who may do what. Every route goes
 * through pipelineAccess, so a workspace that switched the connector off gets a clear refusal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '../api-auth-helper'
import { isConnectorOn } from '../connectors'
import { can, canAssign, canSeeAll, isReadOnly, type Permission } from '../rbac'
import { withPipelineSchema } from './schema'
import type { PipelineActor } from './store'

export interface PipelineContext {
  db: any
  user: any
  organizationId: string
  organization: Record<string, any>
  actor: PipelineActor
  currency: string
}

export type PipelineAccess = { ok: true; ctx: PipelineContext } | { ok: false; response: NextResponse }

export const PIPELINE_OFF_MESSAGE = 'Sales Pipeline is switched off for this workspace. An admin can switch it on in Connectors.'

export async function pipelineAccess(request: NextRequest, organizationId: string | null | undefined, permission?: Permission): Promise<PipelineAccess> {
  const access = await verifyOrgAccess(request, organizationId || null, permission ? { permission } : {})
  if (!access.authorized) return { ok: false, response: NextResponse.json({ error: access.error }, { status: access.status }) }
  const db = getSupabaseAdminClient()
  // Every column, so the switch reads as on before its migration has run
  const { data: organization, error } = await withPipelineSchema(() => db.from('organizations').select('*').eq('id', organizationId).maybeSingle())
  if (error || !organization) return { ok: false, response: NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: error ? 500 : 404 }) }
  // Consular Helpdesk has no Connectors page, so its switch stays on and it keeps the pipeline
  if (!isConnectorOn(organization, 'pipeline')) {
    return { ok: false, response: NextResponse.json({ error: PIPELINE_OFF_MESSAGE }, { status: 403 }) }
  }
  const user = access.user
  const actor: PipelineActor = { db, organizationId: String(organizationId), userId: user?.id || null, seeAll: canSeeAll(user), canAssign: canAssign(user) }
  return { ok: true, ctx: { db, user, organizationId: String(organizationId), organization, actor, currency: String(organization.currency || 'INR').toUpperCase() } }
}

/** What this person may do, for the screens to show only the buttons that work. */
export function permissionsOf(user: any) {
  return {
    id: user?.id || null,
    seeAll: canSeeAll(user),
    canAssign: canAssign(user),
    readOnly: isReadOnly(user),
    canManage: can(user, 'automation.manage'),
  }
}

/** The workspace's teammates, for owners and the reports. */
export async function teamOf(db: any, organizationId: string) {
  const { data, error } = await db.from('users').select('id, full_name, email, role').eq('organization_id', organizationId).order('full_name')
  if (error) throw new Error(error.message)
  return (data || []).map((u: any) => ({ id: u.id, full_name: u.full_name || null, email: u.email || null, role: u.role || null }))
}

export function serverError(where: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[Pipeline ${where}]`, message)
  return NextResponse.json({ error: message || 'Something went wrong. Please try again.' }, { status: 500 })
}
