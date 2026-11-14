'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { WamaLogo } from '@/components/brand/wama-logo'
import { getSupabase } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'

const input = 'w-full h-12 px-4 rounded-xl border border-[#d5ddeb] bg-white text-[15px] text-[#0E1B3D] placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-4 focus:ring-[#1D5BEA]/10'

/**
 * Where Google (or Apple) sends people back. Signs them in; the first time, asks for the business name
 * and makes their workspace with a free trial; then opens the dashboard.
 */
export default function OAuthCallback() {
  const router = useRouter()
  const [stage, setStage] = useState<'working' | 'business' | 'error'>('working')
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href)
        const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
        const problem = url.searchParams.get('error_description') || hash.get('error_description')
        if (problem) throw new Error(problem.replace(/\+/g, ' '))
        const client = getSupabase()
        const code = url.searchParams.get('code')
        const result = code
          ? await client.auth.exchangeCodeForSession(code)
          : hash.get('access_token') && hash.get('refresh_token')
            ? await client.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! })
            : await client.auth.getSession()
        if (result.error) throw result.error
        const session = result.data.session
        if (!session) throw new Error('The sign-in did not finish. Please try again.')
        // The rest of the app reads the session from here
        authSessionManager.setSession({ access_token: session.access_token, token_type: session.token_type, expires_in: session.expires_in || 3600, expires_at: session.expires_at || Math.floor(Date.now() / 1000) + 3600, refresh_token: session.refresh_token })
        authSessionManager.setUser(session.user as any)
        window.history.replaceState(null, '', '/auth/callback')

        const res = await fetch('/api/auth/oauth-complete', { headers: { Authorization: `Bearer ${session.access_token}` } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'The sign-in did not finish. Please try again.')
        if (data.ready) {
          sessionStorage.removeItem('signup_plan')
          router.replace('/dashboard')
          return
        }
        setToken(session.access_token)
        setEmail(data.email || '')
        setFullName(data.name || '')
        setStage('business')
      } catch (err: any) {
        setError(err?.message || 'The sign-in did not finish. Please try again.')
        setStage('error')
      }
    })()
  }, [router])

  async function finish(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/auth/oauth-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyName, fullName, plan: sessionStorage.getItem('signup_plan') || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Your business could not be set up. Please try again.')
      sessionStorage.removeItem('signup_plan')
      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f6fa] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#e3e8f2] p-6 sm:p-8">
        <WamaLogo />
        {stage === 'working' && (
          <p className="mt-8 flex items-center gap-2.5 text-[15px] text-[#4a5672]" role="status"><Loader2 size={18} className="animate-spin text-[#1D5BEA]" /> Signing you in…</p>
        )}
        {stage === 'error' && (
          <>
            <h1 className="mt-6 text-[20px] font-extrabold text-[#0E1B3D]">That did not work</h1>
            <p className="mt-2 text-[14.5px] text-[#b91c1c]">{error}</p>
            <a href="/login" className="mt-6 inline-flex h-11 px-5 items-center rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold">Back to sign in</a>
          </>
        )}
        {stage === 'business' && (
          <form onSubmit={finish} className="mt-6 space-y-4">
            <div>
              <h1 className="text-[22px] font-extrabold text-[#0E1B3D]">Name your business</h1>
              <p className="mt-1 text-[14.5px] text-[#4a5672]">One last step. Your 14-day free trial starts now{email ? ` for ${email}` : ''}.</p>
            </div>
            <label className="block">
              <span className="block text-[13.5px] font-semibold text-[#4a5672] mb-1.5">Business name</span>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoFocus required minLength={2} maxLength={80} placeholder="Glow Salon" className={input} />
            </label>
            <label className="block">
              <span className="block text-[13.5px] font-semibold text-[#4a5672] mb-1.5">Your name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} autoComplete="name" className={input} />
            </label>
            {error && <p role="alert" className="text-[14px] font-semibold text-[#b91c1c]">{error}</p>}
            <button type="submit" disabled={saving || companyName.trim().length < 2} className="w-full h-12 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
              {saving && <Loader2 size={18} className="animate-spin" />} Start my free trial
            </button>
            <p className="text-[12.5px] text-[#8a94a8]">By continuing you agree to the <a href="/terms" className="underline">terms</a> and <a href="/privacy" className="underline">privacy policy</a>.</p>
          </form>
        )}
      </div>
    </main>
  )
}
