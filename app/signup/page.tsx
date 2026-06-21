'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { authSessionManager } from '@/lib/auth-context'
import { MessageCircle } from 'lucide-react'


export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
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
    <div className="min-h-screen bg-[#eae6df] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Green Header Band */}
      <div className="h-[222px] bg-[#00a884] w-full absolute top-0 left-0 z-0 shadow-sm flex items-center justify-center" />

      {/* Main Card */}
      <div className="w-full max-w-[440px] relative z-10 my-8">
        {/* Upper Brand Icon for presentation */}
        <div className="flex items-center justify-center gap-3 mb-6 relative select-none">
          <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center shadow-md">
            <MessageCircle size={22} className="text-[#00a884]" />
          </div>
          <span className="text-white text-lg font-bold tracking-tight">WHATSAPP CRM</span>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-[#e9edef] p-10">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-[#111b21]">Create Account</h2>
            <p className="text-xs text-[#667781] mt-1.5 font-medium">To set up your WhatsApp CRM.</p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] focus:border-[#00a884] text-xs font-semibold placeholder-[#8696a0] transition-all"
                placeholder="John Doe"
                required
              />
            </div>

            <div>
              <label htmlFor="companyName" className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                Company Name
              </label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] focus:border-[#00a884] text-xs font-semibold placeholder-[#8696a0] transition-all"
                placeholder="Acme Inc"
                required
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] focus:border-[#00a884] text-xs font-semibold placeholder-[#8696a0] transition-all"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] focus:border-[#00a884] text-xs font-semibold placeholder-[#8696a0] transition-all"
                placeholder="Choose a password"
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-xs font-medium text-rose-600">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00a884] hover:bg-[#008069] text-white py-2.5 rounded-lg font-bold transition-all shadow-sm disabled:opacity-50 text-xs"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-[#e9edef]">
            <p className="text-xs text-[#667781] font-semibold">
              Already have an account?{' '}
              <Link href="/login" className="text-[#00a884] hover:text-[#008069] font-bold">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
