'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Lock, Check, Loader2, Sparkles, ShieldCheck } from 'lucide-react'

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  // Password strength state
  const [strength, setStrength] = useState<'weak' | 'medium' | 'strong'>('weak')

  useEffect(() => {
    if (!token) {
      setError('Missing or invalid invitation token.')
    }
  }, [token])

  useEffect(() => {
    if (password.length === 0) {
      setStrength('weak')
      return
    }
    const hasLetters = /[a-zA-Z]/.test(password)
    const hasNumbers = /[0-9]/.test(password)
    const hasSpecial = /[^A-Za-z0-9]/.test(password)
    const length = password.length

    if (length >= 8 && hasLetters && hasNumbers && hasSpecial) {
      setStrength('strong')
    } else if (length >= 6 && hasLetters && hasNumbers) {
      setStrength('medium')
    } else {
      setStrength('weak')
    }
  }, [password])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Invalid or expired setup token.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to set password')
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/login')
      }, 3000)
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

      {/* Main Container */}
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
          
          {success ? (
            <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-[#e7f7f4] dark:bg-[#0d2318]/50 text-[#00a884] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#00a884]/10">
                <ShieldCheck size={36} />
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Password Secured</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold leading-relaxed">
                Your password has been successfully configured. We are redirecting you to the login screen...
              </p>
              <Loader2 className="animate-spin text-[#00a884] mx-auto mt-4" size={20} />
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Set Workspace Password</h2>
                <p className="text-xs text-slate-500 dark:text-[#8696a0] mt-2 font-medium leading-relaxed">
                  Establish a secure login credential to access your organization dashboard.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/50 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 mb-5">
                  {error}
                </div>
              )}

              {token && (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 dark:text-[#8696a0] uppercase tracking-widest mb-2">
                      New Password
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                        <Lock size={15} />
                      </div>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-white transition-all"
                        placeholder="••••••••"
                        required
                        minLength={6}
                      />
                    </div>

                    {/* Password Strength Indicator */}
                    {password.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-[9px] font-bold">
                          <span className="text-[#8696a0]">Strength:</span>
                          <span className={
                            strength === 'strong' ? 'text-[#00a884]' :
                            strength === 'medium' ? 'text-amber-500' : 'text-rose-500'
                          }>
                            {strength.toUpperCase()}
                          </span>
                        </div>
                        <div className="h-1 w-full bg-slate-200 dark:bg-[#2a3942] rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-300 ${
                            strength === 'strong' ? 'w-full bg-[#00a884]' :
                            strength === 'medium' ? 'w-2/3 bg-amber-500' : 'w-1/3 bg-rose-500'
                          }`} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 dark:text-[#8696a0] uppercase tracking-widest mb-2">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                        <Lock size={15} />
                      </div>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-white transition-all"
                        placeholder="••••••••"
                        required
                        minLength={6}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-[#00a884] to-[#008069] text-white py-3 rounded-xl font-bold transition-all disabled:opacity-50 text-xs flex items-center justify-center gap-1.5 cursor-pointer border-none shadow-sm"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Configuring...</span>
                      </>
                    ) : (
                      <span>Configure Password</span>
                    )}
                  </Button>
                </form>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b141a] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#00a884]" size={24} />
      </div>
    }>
      <SetPasswordContent />
    </Suspense>
  )
}
