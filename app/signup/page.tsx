'use client'

import { WamaLogo } from '@/components/brand/wama-logo'
import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { authSessionManager } from '@/lib/auth-context'
import { Sparkles, Mail, Lock, User, Building, ArrowRight, Sun, Moon } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Step 2: the 6-digit code emailed to them
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  async function sendCode() {
    setError(null)
    setLoading(true)
    try {
      const response = await fetch('/api/auth/signup/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, companyName }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.retryAfter) setResendIn(Number(data.retryAfter))
        throw new Error(data.error || 'The code could not be sent')
      }
      setCodeSent(true)
      setCode('')
      setResendIn(Number(data.resendAfterSeconds) || 60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useState(() => {
    // Run this once during render (or client-side mount) to match the HTML class
    if (typeof window !== 'undefined') {
      const isDark = document.documentElement.classList.contains('dark')
      setTheme(isDark ? 'dark' : 'light')
    }
  })

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    localStorage.setItem('theme', nextTheme)
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    window.dispatchEvent(new Event('theme-changed'))
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!codeSent) {
      await sendCode()
      return
    }
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          fullName,
          companyName,
          code,
          // Picked on the pricing page
          plan: new URLSearchParams(window.location.search).get('plan') || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed')
      }

      // Login after signup
      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const loginData = await loginResponse.json()

      if (loginResponse.ok && loginData.session) {
        // Store session data in storage for persistence
        authSessionManager.setSession(loginData.session)
        authSessionManager.setUser(loginData.user)
        
        // Wait for cookies to be set
        await new Promise(resolve => setTimeout(resolve, 100))
        router.push('/dashboard')
        
        // Refresh to ensure auth is properly initialized
        await new Promise(resolve => setTimeout(resolve, 200))
        router.refresh()
      } else {
        throw new Error('Failed to create session after signup')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('[v0] Signup error:', message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Theme Toggle Button */}
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all shadow-sm cursor-pointer z-20 flex items-center justify-center"
        aria-label="Toggle Theme"
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>

      {/* Main Signup Card Container */}
      <div className="w-full max-w-[440px] relative z-10 my-8">
        
        {/* Brand Header */}
        <div className="flex justify-center mb-8">
          <Link href="/" aria-label="WAMA CRM home"><WamaLogo size={38} /></Link>
        </div>

        {/* Glassmorphism Card */}
        <div className="backdrop-blur-xl bg-white/80 dark:bg-slate-900/60 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-8 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Create Account</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium leading-relaxed">
              Start your 14-day free trial. No card needed.
            </p>
          </div>

          <div className="mb-5"><OAuthButtons plan={typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('plan') : null} onError={setError} /></div>

          <form onSubmit={handleSignup} className="space-y-5">
            <div>
              <label htmlFor="fullName" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <User size={16} />
                </div>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  readOnly={codeSent}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D5BEA]/20 focus:border-[#1D5BEA] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-200 transition-all"
                  placeholder="John Doe"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="companyName" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Company Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <Building size={16} />
                </div>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  readOnly={codeSent}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D5BEA]/20 focus:border-[#1D5BEA] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-200 transition-all"
                  placeholder="Acme Inc"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <Mail size={16} />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={codeSent}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D5BEA]/20 focus:border-[#1D5BEA] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-200 transition-all"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <Lock size={16} />
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  readOnly={codeSent}
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D5BEA]/20 focus:border-[#1D5BEA] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-200 transition-all"
                  placeholder="Choose a strong password"
                  required
                />
              </div>
            </div>

            {codeSent && (
              <div className="rounded-xl border border-[#d5ddeb] dark:border-slate-800 p-4 space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  We emailed a 6-digit code to <strong className="text-slate-900 dark:text-white">{email}</strong>. It works for 10 minutes. Check spam if you do not see it.
                </p>
                <label htmlFor="code" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Code</label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D5BEA]/20 focus:border-[#1D5BEA] text-xl font-bold tracking-[0.5em] text-center text-slate-900 dark:text-white"
                  placeholder="······"
                  required
                />
                <div className="flex items-center justify-between text-xs">
                  <button type="button" onClick={() => { setCodeSent(false); setCode(''); setError(null) }} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">Change details</button>
                  <button type="button" onClick={sendCode} disabled={loading || resendIn > 0} className="font-bold text-[#1D5BEA] disabled:text-slate-400 cursor-pointer disabled:cursor-default">
                    {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send a new code'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || (codeSent && code.length !== 6)}
              className="w-full bg-[#1D5BEA] hover:bg-[#174bc4] text-white py-3 rounded-xl font-bold transition-colors disabled:opacity-50 text-xs flex items-center justify-center gap-2 cursor-pointer border-0"
            >
              {loading ? (
                <span>{codeSent ? 'Creating account...' : 'Sending code...'}</span>
              ) : (
                <>
                  <span>{codeSent ? 'Create Account' : 'Email me a code'}</span>
                  <ArrowRight size={14} />
                </>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-200/80 dark:border-slate-800/80 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              Already have an account?{' '}
              <Link href="/login" className="text-[#1D5BEA] dark:text-blue-300 hover:text-[#174bc4] dark:hover:text-blue-200 font-bold transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
