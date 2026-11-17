import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { cleanDomain } from '@/lib/commerce/store-domain'
import { hasServerKey } from '@/lib/commerce/server-key'

export const runtime = 'nodejs'

/**
 * GET (header X-Gateway-Key): every business domain connected in WAMA, for the shop server's automatic
 * job (deploy/nginx/sync-store-domains.sh), which sets up new ones and removes old ones. Domains only:
 * nothing about the businesses.
 */
export async function GET(request: NextRequest) {
  if (!hasServerKey(request.headers.get('x-gateway-key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 401 })
  const db = getSupabaseAdminClient()
  const { data, error } = await db.from('organizations').select('store_domain').not('store_domain', 'is', null).limit(5000)
  if (error) return NextResponse.json({ error: 'Could not read the domains.' }, { status: 500 })
  const domains = [...new Set((data || []).map((row: any) => cleanDomain(row.store_domain)).filter((d: any) => 'domain' in d).map((d: any) => d.domain))].sort()
  return NextResponse.json({ domains }, { headers: { 'Cache-Control': 'no-store' } })
}
