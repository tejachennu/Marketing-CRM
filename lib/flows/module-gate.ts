import { NextResponse } from 'next/server'
import { isModuleDisabledOnServer, isModuleEnabledOnServer } from '@/lib/feature-flags'

export const FLOWS_SWITCHED_OFF_MESSAGE = 'The Flow Builder is switched off for this organization, so flows and forms cannot be changed. Ask your administrator to turn it back on.'
export const FLOWS_UNAVAILABLE_MESSAGE = 'The Flow Builder is temporarily unavailable, so flows and forms cannot be changed right now.'

/**
 * Why this organization may not change or activate its flows and forms now, or null when it may:
 * the dashboard hides the Flow Builder in the same cases (lib/feature-flags.ts), and the API must
 * not let a hidden module be edited or switched on behind it.
 */
export async function getFlowsBlockedReason(supabase: any, organizationId: string): Promise<string | null> {
  // The kill switch as the server reads it, runtime DISABLED_MODULES included (no rebuild needed)
  if (isModuleDisabledOnServer('flows')) return FLOWS_UNAVAILABLE_MESSAGE
  // Every column, so this works before the enable_flows migration: a missing switch reads as on
  const { data, error } = await supabase.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  if (error) throw new Error(error.message)
  return isModuleEnabledOnServer(data, 'flows') ? null : FLOWS_SWITCHED_OFF_MESSAGE
}

/** The 403 a flows route answers while the Flow Builder is off for the organization, or null to go on. */
export async function refuseWhileFlowsOff(supabase: any, organizationId: string): Promise<NextResponse | null> {
  const reason = await getFlowsBlockedReason(supabase, organizationId)
  return reason ? NextResponse.json({ error: reason, moduleDisabled: 'flows' }, { status: 403 }) : null
}
