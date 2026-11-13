import { NextResponse } from 'next/server'
import { firebaseAppConfig } from '@/lib/push'

export const dynamic = 'force-dynamic'

// GET: what the mobile app needs to sign in: the Supabase project address and its public key.
// Both are public already (the website sends them to every browser), so the app is built with no
// keys in it and works with whichever project this server uses.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ error: 'Sign-in is not set up on this server.' }, { status: 503 })
  // firebase: what the app needs for pop-up notifications (null until set up in Vercel)
  return NextResponse.json({ supabaseUrl, supabaseAnonKey, minAppVersion: '1.0.0', firebase: firebaseAppConfig() }, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
