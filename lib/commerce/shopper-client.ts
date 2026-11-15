'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * Sign-in for shoppers on a store page. Kept apart from the WAMA dashboard's own sign-in (its own
 * storage key), so a shopper never becomes a dashboard user's session and the other way round.
 */
export function shopperAuth(): SupabaseClient | null {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, {
    auth: { storageKey: 'wama-shopper', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
  })
  return client
}

/** Where a sign-in may send the shopper back to: this app, or the store's own domain (nowhere else). */
export function safeReturn(raw: string | null, appOrigin: string, storeDomain: string | null): string {
  try {
    const url = new URL(String(raw || ''))
    if (url.origin === appOrigin) return url.origin
    if (storeDomain && url.protocol === 'https:' && url.hostname === storeDomain && !url.port) return url.origin
  } catch {}
  return appOrigin
}

/** The session handed to the store's own domain in the address's # part (never sent to any server). */
export function packSession(accessToken: string, refreshToken: string): string {
  return btoa(JSON.stringify({ a: accessToken, r: refreshToken })).replace(/=+$/, '')
}

export function unpackSession(packed: string): { access_token: string; refresh_token: string } | null {
  try {
    const data = JSON.parse(atob(packed))
    if (typeof data?.a === 'string' && typeof data?.r === 'string' && data.a.length < 4000 && data.r.length < 500) return { access_token: data.a, refresh_token: data.r }
  } catch {}
  return null
}
