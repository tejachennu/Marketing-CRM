import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin } from '@/lib/superadmin-auth'
import { lockDownDatabase, openTables, tableSecurity } from '@/lib/security/lockdown'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET: which database tables anyone holding the public key could read (row level security off, or a catch-all rule)
export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const tables = await tableSecurity()
    if (!tables) return NextResponse.json({ connected: false, message: 'The database connection (POSTGRES_URL) is not set in Vercel, so this cannot be checked here. Run supabase/migrations/20261211_lock_down_tables.sql in the Supabase SQL editor instead.' })
    const open = openTables(tables)
    return NextResponse.json({ connected: true, total: tables.length, open, safe: open.length === 0 })
  } catch (error: any) {
    return NextResponse.json({ connected: false, message: `The database could not be checked: ${error?.message || 'unknown error'}` })
  }
}

// POST: lock every table down (row level security; members read only their own business's rows; nothing for the public key)
export async function POST(request: NextRequest) {
  const actor = await checkSuperAdmin(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await lockDownDatabase()
    const tables = await tableSecurity()
    const open = tables ? openTables(tables) : []
    console.warn(`[Security] Database locked down by ${actor.email || actor.id}; still open: ${open.join(', ') || 'none'}`)
    return NextResponse.json({ success: true, open, safe: open.length === 0 })
  } catch (error: any) {
    return NextResponse.json({ error: `The lock-down did not run: ${error?.message || 'unknown error'}` }, { status: 500 })
  }
}
