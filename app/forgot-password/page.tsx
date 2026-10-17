'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Mail, Loader2, Sparkles, ArrowLeft, MailCheck } from 'lucide-react'

function ForgotPasswordContent() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send a reset link')
      setSent(true)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b141a] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Ambient background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[#00a884]/5 dark:bg-[#00a884]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[440px] relative z-10">
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-3 mb-8 select-none">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-[#00a884] to-[#008069] flex items-center justify-center shadow-lg shadow-[#00a884]/10 dark:shadow-[#00a884]/20">
            <Sparkles size={20} className="text-white" />
          </div>
          <span className="text-slate-900 dark:text-white text-2xl font-black tracking-wider">
            OMNI<span className="text-[#00a884] font-extrabold">CRM</span>
          </span>
        </div>

        {/* Card */}
        <div className="backdrop-blur-xl bg-white/80 dark:bg-[#111b21] rounded-3xl border border-slate-200/80 dark:border-[#202d36] p-8 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.03)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:text-[#8696a0] dark:hover:text-white mb-6 uppercase tracking-wider transition-colors"
          >
            <ArrowLeft size={12} />
            Back to login
          </Link>

          {sent ? (
            <div className="text-center py-4 space-y-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-[#e7f7f4] dark:bg-[#0d2318]/50 text-[#00a884] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#00a884]/10">
                <MailCheck size={32} />
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Check your email</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold leading-relaxed">
                If an account exists for <strong className="text-slate-800 dark:text-white">{email.trim().toLowerCase()}</strong>, we sent a link to reset its password. It expires in 1 hour. Check your spam folder if you don&apos;t see it.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Forgot password?</h2>
                <p className="text-xs text-slate-500 dark:text-[#8696a0] mt-2 font-medium leading-relaxed">
                  Enter the email you sign in with and we&apos;ll send you a link to choose a new password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
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
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00a884]/15 text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-white transition-all"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#00a884] to-[#008069] text-white py-3 rounded-xl font-bold transition-all disabled:opacity-50 text-xs flex items-center justify-center gap-1.5 cursor-pointer border-none shadow-sm"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <span>Send reset link</span>
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b141a] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#00a884]" size={24} />
      </div>
    }>
      <ForgotPasswordContent />
    </Suspense>
  )
}
