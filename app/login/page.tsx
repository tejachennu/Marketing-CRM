'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, BadgeCheck, Bot, Eye, EyeOff, Loader2, Megaphone, MessageCircle, Moon, RefreshCw, ShieldCheck, ShoppingBag, Sun } from 'lucide-react'
import { WamaLogo } from '@/components/brand/wama-logo'
import { OAuthButtons } from '@/components/auth/oauth-buttons'

const HIGHLIGHTS = [
  { icon: MessageCircle, title: 'One WhatsApp inbox for the whole team', text: 'Every chat, assigned to the right person.' },
  { icon: Bot, title: 'AI that replies in your customer\'s language', text: 'English, Telugu, Hindi, or a mix of them.' },
  { icon: ShoppingBag, title: 'Sell right inside WhatsApp', text: 'Catalog, cart, UPI payments and orders.' },
  { icon: Megaphone, title: 'Campaigns that reach every customer', text: 'Approved templates, sent in minutes.' },
]

const inputClass = 'w-full h-12 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[15px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-4 focus:ring-[#1D5BEA]/10 transition'

function storeSession(data: any) {
  if (!data.session) return
  localStorage.setItem('auth_session', JSON.stringify(data.session))
  sessionStorage.setItem('auth_session', JSON.stringify(data.session))
  localStorage.setItem('auth_user', JSON.stringify(data.user))
  // Lets the middleware open the dashboard straight away
  document.cookie = `user-logged-in=true; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
}

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Second step: the code emailed to the user
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpSentEmail, setOtpSentEmail] = useState('')
  const [resendTimer, setResendTimer] = useState(0)
  const [resending, setResending] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  useEffect(() => {
    if (resendTimer <= 0) return
    const interval = setInterval(() => setResendTimer((t) => t - 1), 1000)
    return () => clearInterval(interval)
  }, [resendTimer])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    window.dispatchEvent(new Event('theme-changed'))
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Sign in failed. Please try again.')

      if (data.session) {
        storeSession(data)
        router.replace('/dashboard')
      } else if (data.otpRequired) {
        setOtpSentEmail(data.email || email)
        setOtpRequired(true)
        setOtpCode('')
        setResendTimer(data.resendAfterSeconds || 60)
        setNotice(`We sent a 6-digit code to ${data.email || email}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpSentEmail, password, otpCode: otpCode.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'That code did not work. Please try again.')
      storeSession(data)
      document.cookie = `user-logged-in=true; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
      router.replace('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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
      if (!response.ok) throw new Error(data.error || 'The code could not be sent again.')
      setResendTimer(60)
      setNotice(`A new code is on its way to ${otpSentEmail}.`)
    } catch (err: any) {
      setError(err.message || 'The code could not be sent again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex bg-[#f6f8fc] dark:bg-[#0b141a] font-sans text-[#0E1B3D] dark:text-slate-100">
      {/* Brand side (large screens) */}
      <aside className="hidden lg:flex relative w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-[#0E1B3D] px-12 py-10 text-white">
        <div className="absolute -top-40 -right-40 h-[420px] w-[420px] rounded-full bg-[#1D5BEA]/30 blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-40 -left-32 h-[380px] w-[380px] rounded-full bg-[#00A884]/25 blur-[120px] pointer-events-none" />

        <Link href="/" className="relative w-fit"><WamaLogo size={40} tone="light" /></Link>

        <div className="relative max-w-md">
          <h1 className="text-[40px] leading-[1.1] font-extrabold tracking-tight">
            Turn WhatsApp chats into <span className="text-[#7CF0A8]">customers</span>.
          </h1>
          <ul className="mt-9 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 h-10 w-10 shrink-0 rounded-xl bg-white/10 flex items-center justify-center"><Icon size={19} className="text-[#7CF0A8]" /></span>
                <span>
                  <span className="block text-[16px] font-semibold">{title}</span>
                  <span className="block text-[14.5px] text-white/65 mt-0.5">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[13.5px] font-semibold">
          <BadgeCheck size={17} className="text-[#7CF0A8]" /> Official Meta Tech Provider
        </div>
      </aside>

      {/* Form side */}
      <main className="relative flex-1 flex flex-col">
        <div className="flex items-center justify-between px-5 sm:px-8 py-5">
          <Link href="/" className="lg:invisible"><WamaLogo size={32} /></Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="h-10 w-10 rounded-xl border border-[#e3e8f2] dark:border-slate-800 bg-white dark:bg-[#111b21] text-[#4a5672] dark:text-slate-300 hover:bg-[#f1f4f9] dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-5 pb-10">
          <div className="w-full max-w-[420px]">
            {!otpRequired ? (
              <div>
                <h2 className="text-[30px] font-extrabold tracking-tight">Welcome back</h2>
                <p className="text-[15.5px] text-[#4a5672] dark:text-slate-400 mt-1.5">Sign in to your WAMA CRM workspace.</p>

                <div className="mt-8"><OAuthButtons onError={setError} /></div>

                <form onSubmit={handleLogin} className="mt-4 space-y-5">
                  <div>
                    <label htmlFor="email" className="block text-[14px] font-semibold mb-1.5">Email</label>
                    <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@yourbusiness.in" required autoFocus />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="password" className="block text-[14px] font-semibold">Password</label>
                      <Link href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'} className="text-[14px] font-semibold text-[#1D5BEA] hover:underline">
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-12`} placeholder="Your password" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg flex items-center justify-center text-[#6B7894] hover:text-[#0E1B3D] dark:hover:text-white cursor-pointer" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 px-4 py-3 text-[14px] font-medium text-[#b91c1c] dark:text-red-300">{error}</div>}

                  <button type="submit" disabled={loading} className="w-full h-12 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[16px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer">
                    {loading ? <><Loader2 size={18} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={18} /></>}
                  </button>
                </form>

                <p className="mt-8 text-center text-[15px] text-[#4a5672] dark:text-slate-400">
                  New to WAMA CRM? <Link href="/signup" className="font-semibold text-[#1D5BEA] hover:underline">Start your free trial</Link>
                </p>
              </div>
            ) : (
              <div>
                <button type="button" onClick={() => { setOtpRequired(false); setError(null); setNotice(null) }} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#4a5672] dark:text-slate-400 hover:text-[#0E1B3D] dark:hover:text-white mb-6 cursor-pointer">
                  <ArrowLeft size={16} /> Back
                </button>
                <div className="h-12 w-12 rounded-2xl bg-[#e8f7f1] dark:bg-emerald-950/40 flex items-center justify-center mb-4"><ShieldCheck size={24} className="text-[#00A884]" /></div>
                <h2 className="text-[28px] font-extrabold tracking-tight">Check your email</h2>
                <p className="text-[15.5px] text-[#4a5672] dark:text-slate-400 mt-1.5">
                  We sent a 6-digit code to <strong className="text-[#0E1B3D] dark:text-white">{otpSentEmail}</strong>.
                </p>

                <form onSubmit={handleVerifyOtp} className="mt-7 space-y-5">
                  <div>
                    <label htmlFor="otp" className="block text-[14px] font-semibold mb-1.5">Code</label>
                    <input
                      id="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                      className={`${inputClass} h-14 text-center text-[24px] font-bold tracking-[0.5em]`}
                      placeholder="••••••"
                      required
                      autoFocus
                    />
                  </div>

                  {notice && !error && <div role="status" className="rounded-xl bg-[#e8f7f1] dark:bg-emerald-950/30 px-4 py-3 text-[14px] font-medium text-[#047857] dark:text-emerald-300">{notice}</div>}
                  {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 px-4 py-3 text-[14px] font-medium text-[#b91c1c] dark:text-red-300">{error}</div>}

                  <button type="submit" disabled={loading || otpCode.length !== 6} className="w-full h-12 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[16px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer">
                    {loading ? <><Loader2 size={18} className="animate-spin" /> Checking…</> : 'Verify and sign in'}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button type="button" onClick={handleResendOtp} disabled={resendTimer > 0 || resending} className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-[#1D5BEA] disabled:text-[#8a94a8] disabled:cursor-not-allowed cursor-pointer">
                    <RefreshCw size={15} className={resending ? 'animate-spin' : ''} />
                    {resendTimer > 0 ? `Send a new code in ${resendTimer}s` : 'Send a new code'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="pb-6 text-center text-[13px] text-[#8a94a8]">
          © {new Date().getFullYear()} Magnetora AI Solutions · <Link href="/privacy" className="hover:underline">Privacy</Link> · <Link href="/terms" className="hover:underline">Terms</Link>
        </p>
      </main>
    </div>
  )
}
