import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { demoRequestsOrgId, parseDemoRequest, saveDemoRequest } from '@/lib/demo-requests'

// Best-effort limit per server instance: a few requests a minute from one address is plenty for a person
const recent = new Map<string, number[]>()
function tooMany(key: string): boolean {
  const now = Date.now()
  const hits = (recent.get(key) || []).filter((time) => now - time < 60_000)
  hits.push(now)
  recent.set(key, hits)
  if (recent.size > 5000) recent.clear()
  return hits.length > 5
}

// POST: a "Book a demo" request from the website becomes a lead in the sales workspace
export async function POST(request: NextRequest) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (tooMany(address)) return NextResponse.json({ error: 'Too many requests. Please try again in a minute.' }, { status: 429 })

  const parsed = parseDemoRequest(await request.json().catch(() => null))
  // Bots get the same answer as people, so they learn nothing from it
  if ('spam' in parsed && parsed.spam) return NextResponse.json({ success: true })
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    await saveDemoRequest(getSupabaseAdminClient(), demoRequestsOrgId(), parsed.request)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Demo request] Could not save:', error?.message)
    return NextResponse.json({ error: 'We could not save your request. Please message us on WhatsApp instead.' }, { status: 500 })
  }
}
