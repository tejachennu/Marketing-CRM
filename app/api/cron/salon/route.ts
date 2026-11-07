import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { salonChatReady } from '@/lib/salon/chat'
import { runSalonJobs } from '@/lib/salon/jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET with "Authorization: Bearer <CRON_SECRET>": send what is due for every salon, even when no
 * counter is open. Vercel Cron sends that header itself when CRON_SECRET is set; any other
 * scheduler can call it the same way. Off until CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET || '').trim()
  if (!secret) return NextResponse.json({ error: 'Set CRON_SECRET to use the scheduled salon messages.' }, { status: 404 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = getSupabaseAdminClient()
  const { data: organizations, error } = await db.from('organizations').select('*').contains('enabled_connectors', ['salon']).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const results: Record<string, unknown> = {}
  for (const organization of (organizations || []).filter(salonChatReady)) {
    try {
      results[organization.id] = await runSalonJobs(db, organization.id)
    } catch (err: any) {
      results[organization.id] = { error: err?.message || 'failed' }
    }
  }
  return NextResponse.json({ success: true, salons: Object.keys(results).length, results })
}
