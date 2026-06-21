'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { seedDemoData } from '@/lib/seed-demo'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function DemoSetupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('demo@example.com')
  const [password, setPassword] = useState('Demo123456')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [step, setStep] = useState<'signup' | 'seed'>('signup')

  async function handleDemoSignup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      // Check if email already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select()
        .eq('email', email)
        .single()

      if (existingUser) {
        // Sign in with existing account
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) {
          if (signInError.message.includes('Invalid login credentials')) {
            throw new Error('Account exists but password is incorrect.')
          }
          throw signInError
        }

        setSuccess('Signed in! Now seeding demo data...')
        setStep('seed')
        return
      }

      // Create new account
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) throw signUpError

      if (!authData.user) throw new Error('Signup failed')

      setSuccess('Account created! Now seeding demo data...')

      // Create organization
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert([
          {
            name: 'Demo Company',
            slug: `demo-${Date.now()}`,
          },
        ])
        .select()
        .single()

      if (orgError) throw orgError

      // Create user profile
      const { error: userError } = await supabase.from('users').insert([
        {
          id: authData.user.id,
          organization_id: org.id,
          email,
          full_name: 'Demo User',
          role: 'owner',
        },
      ])

      if (userError) throw userError

      // Create default pipeline stages
      const stages = [
        { name: 'New', color: '#3b82f6', position: 0 },
        { name: 'Contacted', color: '#8b5cf6', position: 1 },
        { name: 'Qualified', color: '#ec4899', position: 2 },
        { name: 'Negotiating', color: '#f59e0b', position: 3 },
        { name: 'Closed', color: '#10b981', position: 4 },
      ]

      for (const stage of stages) {
        await supabase.from('pipeline_stages').insert([
          {
            organization_id: org.id,
            ...stage,
          },
        ])
      }

      setStep('seed')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('[v0] Demo signup error:', message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSeedDemo(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await seedDemoData()

      if (!result.success) {
        throw result.error || new Error('Failed to seed demo data')
      }

      setSuccess('Demo data created successfully! Redirecting to dashboard...')
      setTimeout(() => {
        router.push('/dashboard')
      }, 2000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to seed demo data'
      setError(message)
      console.error('[v0] Seed error:', message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Demo Setup</h1>
            <p className="text-gray-600">Quick start with sample data</p>
          </div>

          {step === 'signup' ? (
            <form onSubmit={handleDemoSignup} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  required
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  {success}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-medium transition-colors"
              >
                {loading ? 'Setting up...' : 'Create Demo Account'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSeedDemo} className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  Account created! Now we&apos;ll populate it with demo contacts, leads, and conversations.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  {success}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-medium transition-colors"
              >
                {loading ? 'Creating demo data...' : 'Populate with Demo Data'}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="space-y-2 text-sm text-gray-600">
              <p>
                Want to try regular signup?{' '}
                <Link href="/signup" className="text-green-600 hover:text-green-700 font-medium">
                  Sign up normally
                </Link>
              </p>
              <p>
                Already have an account?{' '}
                <Link href="/login" className="text-green-600 hover:text-green-700 font-medium">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
