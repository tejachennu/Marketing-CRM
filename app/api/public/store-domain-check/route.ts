import { NextRequest } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { cleanDomain } from '@/lib/commerce/store-domain'

export const runtime = 'nodejs'

/**
 * GET ?domain=shop.theirname.com — asked by the store domain gateway (Caddy "on demand TLS") before it makes
 * a certificate: 200 only for a domain a business has connected on WAMA, so the gateway cannot be used to
 * get certificates for anything else. Answers nothing about the business.
 */
export async function GET(request: NextRequest) {
  const cleaned = cleanDomain(new URL(request.url).searchParams.get('domain'))
  if ('error' in cleaned) return new Response('no', { status: 404 })
  const db = getSupabaseAdminClient()
  const { data, error } = await db.from('organizations').select('id').eq('store_domain', cleaned.domain).maybeSingle()
  if (error || !data) return new Response('no', { status: 404 })
  return new Response('ok', { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
