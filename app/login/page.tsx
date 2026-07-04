'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Sparkles, Mail, Lock, ArrowRight, Sun, Moon, ShieldCheck, KeyRound, Loader2, ArrowLeft, RefreshCw } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  
  // Login Form States
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  
  // OTP Flow States
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpSentEmail, setOtpSentEmail] = useState('')
  const [resendTimer, setResendTimer] = useState(0)
  const [resending, setResending] = useState(false)
  
  // General UI States
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    // Sync theme on load
    if (typeof window !== 'undefined') {
      const isDark = document.documentElement.classList.contains('dark')
      setTheme(isDark ? 'dark' : 'light')
    }
  }, [])

  // Resend OTP countdown
  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer((t) => t - 1)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [resendTimer])

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

  // Phase 1: Handle login credentials submission
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }

      if (data.session) {
        localStorage.setItem('auth_session', JSON.stringify(data.session))
        sessionStorage.setItem('auth_session', JSON.stringify(data.session))
        localStorage.setItem('auth_user', JSON.stringify(data.user))

        // Set cookie so middleware allows dashboard access immediately
        document.cookie = `user-logged-in=true; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`

        router.replace('/dashboard')
      } else if (data.otpRequired) {
        setOtpSentEmail(data.email || email)
        setOtpRequired(true)
        setResendTimer(60) // Start 60s cooldown
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('[Login] Credential verification error:', message)
    } finally {
      setLoading(false)
    }
  }

  // Phase 2: Handle OTP verification submission
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: otpSentEmail,
          password,
          otpCode: otpCode.trim()
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed')
      }

      // Store session data in localStorage/sessionStorage for client context
      if (data.session) {
        localStorage.setItem('auth_session', JSON.stringify(data.session))
        sessionStorage.setItem('auth_session', JSON.stringify(data.session))
        localStorage.setItem('auth_user', JSON.stringify(data.user))
      }

      // Redirect to dashboard
      document.cookie = `user-logged-in=true; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
      router.replace('/dashboard')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed'
      setError(message)
      console.error('[Login] OTP verification error:', message)
    } finally {
      setLoading(false)
    }
  }

  // Resend OTP Code
  async function handleResendOtp() {
    if (resendTimer > 0 || resending) return
    setResending(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpSentEmail, password }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend code')
      }
      setResendTimer(60)
    } catch (err: any) {
      setError(err.message || 'Failed to resend code')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b141a] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Theme Toggle Button */}
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-3 rounded-xl bg-white/80 dark:bg-[#111b21] border border-slate-200/85 dark:border-[#202d36] text-slate-700 dark:text-[#8696a0] hover:bg-slate-100 dark:hover:bg-[#1f2c34] transition-all shadow-xs cursor-pointer z-20 flex items-center justify-center"
        aria-label="Toggle Theme"
      >
        {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
      </button>

      {/* Ambient background glows */}
      <div className="absolute top-[-25%] left-[-15%] w-[60%] h-[60%] bg-[#00a884]/5 dark:bg-[#00a884]/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-25%] right-[-15%] w-[60%] h-[60%] bg-blue-500/5 dark:bg-blue-500/8 rounded-full blur-[140px] pointer-events-none" />

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e9edef_1px,transparent_1px),linear-gradient(to_bottom,#e9edef_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1f2c34_1px,transparent_1px),linear-gradient(to_bottom,#1f2c34_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-35 dark:opacity-20 pointer-events-none" />

      {/* Main Login Card Container */}
      <div className="w-full max-w-[430px] relative z-10">
        
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-3 mb-8 select-none">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-[#00a884] to-[#008069] flex items-center justify-center shadow-lg shadow-[#00a884]/10 dark:shadow-[#00a884]/20">
            <Sparkles size={18} className="text-white animate-pulse" />
          </div>
          <span className="text-slate-900 dark:text-white text-2xl font-black tracking-wider">
            OMNI<span className="text-[#00a884] font-extrabold">CRM</span>
          </span>
        </div>

        {/* Premium CRM Glassmorphism Card */}
        <div className="backdrop-blur-xl bg-white/85 dark:bg-[#111b21] rounded-3xl border border-slate-200/80 dark:border-[#202d36] p-8 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.03)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.35)] overflow-hidden transition-all duration-300">
          
          {/* Phase 1: Email + Password Form */}
          {!otpRequired ? (
            <div className="animate-in fade-in slide-in-from-left duration-300">
              <div className="mb-8">
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Security Portal</h2>
                <p className="text-xs text-slate-500 dark:text-[#8696a0] mt-2 font-medium leading-relaxed">
                  Sign in to manage your unified marketing, voice, and message campaigns. Requires 2-factor email validation.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-[10px] font-bold text-slate-500 dark:text-[#8696a0] uppercase tracking-widest mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                      <Mail size={15} />
                    </div>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00a884]/15 focus:border-[#00a884] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-white transition-all"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-[10px] font-bold text-slate-500 dark:text-[#8696a0] uppercase tracking-widest mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                      <Lock size={15} />
                    </div>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00a884]/15 focus:border-[#00a884] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-white transition-all"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#00a884] to-[#008069] hover:from-[#00b991] hover:to-[#008069] text-white py-3.5 rounded-xl font-bold transition-all duration-300 shadow-md shadow-[#00a884]/10 dark:shadow-[#00a884]/25 disabled:opacity-50 text-xs flex items-center justify-center gap-1.5 cursor-pointer border-none"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Verifying Credentials...</span>
                    </>
                  ) : (
                    <>
                      <span>Submit Login</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </Button>
              </form>
            </div>
          ) : (
            /* Phase 2: OTP Entry Form */
            <div className="animate-in fade-in slide-in-from-right duration-300">
              <button
                type="button"
                onClick={() => { setOtpRequired(false); setError(null); }}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:text-[#8696a0] dark:hover:text-white mb-6 uppercase tracking-wider transition-colors cursor-pointer"
              >
                <ArrowLeft size={12} />
                Back to credentials
              </button>

              <div className="mb-6">
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <ShieldCheck className="text-[#00a884]" size={20} />
                  Two-Factor Check
                </h2>
                <p className="text-xs text-slate-500 dark:text-[#8696a0] mt-2 font-medium leading-relaxed">
                  We sent a 6-digit verification code to <strong className="text-slate-800 dark:text-white">{otpSentEmail}</strong>. Enter it below to proceed.
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-5">
                <div>
                  <label htmlFor="otp" className="block text-[10px] font-bold text-slate-500 dark:text-[#8696a0] uppercase tracking-widest mb-2">
                    6-Digit Verification Code
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                      <KeyRound size={15} />
                    </div>
                    <input
                      id="otp"
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full pl-10 pr-4 py-3 text-center tracking-[8px] bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00a884]/15 focus:border-[#00a884] text-sm font-bold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-white transition-all"
                      placeholder="000000"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#00a884] to-[#008069] text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-50 text-xs flex items-center justify-center gap-1.5 cursor-pointer border-none"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Verifying Code...</span>
                    </>
                  ) : (
                    <span>Confirm Login</span>
                  )}
                </Button>
              </form>

              {/* Resend Code Option */}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendTimer > 0 || resending}
                  className={`inline-flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer ${
                    resendTimer > 0
                      ? 'text-slate-400 dark:text-[#8696a0] cursor-not-allowed'
                      : 'text-[#00a884] hover:text-[#008069]'
                  }`}
                >
                  <RefreshCw size={11} className={resending ? 'animate-spin' : ''} />
                  <span>
                    {resendTimer > 0
                      ? `Resend code in ${resendTimer}s`
                      : 'Resend Verification Code'}
                  </span>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
