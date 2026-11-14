'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'

/** Which sign-in providers are switched on in Supabase (NEXT_PUBLIC_OAUTH_PROVIDERS, default "google"). */
export function oauthProviders(): ('google' | 'apple')[] {
  const raw = String(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? 'google').toLowerCase()
  return (['google', 'apple'] as const).filter((p) => raw.split(/[\s,]+/).includes(p))
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.7c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.29-.88-2.3-3.51zM14.2 6.23c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23z" />
    </svg>
  )
}

/**
 * "Continue with Google" (and Apple when switched on). Opens the provider's page; it comes back to
 * /auth/callback, which signs the person in, or asks their business name the first time. `plan` (from
 * the pricing page) is remembered for that first time.
 */
export function OAuthButtons({ plan, onError }: { plan?: string | null; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const providers = oauthProviders()
  if (!providers.length) return null

  async function start(provider: 'google' | 'apple') {
    setBusy(provider)
    try {
      if (plan) sessionStorage.setItem('signup_plan', plan)
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback`, ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}) },
      })
      if (error) throw error
    } catch (error: any) {
      setBusy(null)
      onError?.(/provider is not enabled|Unsupported provider/i.test(error?.message || '') ? `Signing in with ${provider === 'google' ? 'Google' : 'Apple'} is not switched on yet. Please use your email for now.` : error?.message || 'That did not work. Please try again.')
    }
  }

  const button = 'w-full h-12 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[15px] font-semibold text-[#0E1B3D] dark:text-white inline-flex items-center justify-center gap-2.5 hover:border-[#1D5BEA] transition-colors cursor-pointer disabled:opacity-60'
  return (
    <div className="space-y-2.5">
      {providers.includes('google') && (
        <button type="button" onClick={() => start('google')} disabled={busy !== null} className={button}>
          {busy === 'google' ? <Loader2 size={18} className="animate-spin" /> : <GoogleMark />} Continue with Google
        </button>
      )}
      {providers.includes('apple') && (
        <button type="button" onClick={() => start('apple')} disabled={busy !== null} className={button}>
          {busy === 'apple' ? <Loader2 size={18} className="animate-spin" /> : <AppleMark />} Continue with Apple
        </button>
      )}
      <div className="flex items-center gap-3 py-1 text-[12.5px] text-[#8a94a8]" aria-hidden="true">
        <span className="h-px flex-1 bg-[#e3e8f2] dark:bg-slate-800" /> or with your email <span className="h-px flex-1 bg-[#e3e8f2] dark:bg-slate-800" />
      </div>
    </div>
  )
}
