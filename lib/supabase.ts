import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { User } from './types'
import { authSessionManager } from './auth-context'

let supabaseClient: SupabaseClient | null = null
let sessionRestored = false
let isRestoringSession = false // Guard: suppress onAuthStateChange during restore

export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })

  // Listen for auth state changes (like token refreshes) to keep our localStorage session updated
  supabaseClient.auth.onAuthStateChange((event, session) => {
    // Skip updates during session restoration to prevent re-renders and race conditions
    if (isRestoringSession) return

    if (event === 'TOKEN_REFRESHED') {
      // Token was refreshed in the background — silently update stored session
      if (session) {
        authSessionManager.setSession({
          access_token: session.access_token,
          token_type: session.token_type,
          expires_in: session.expires_in || 3600,
          expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
          refresh_token: session.refresh_token,
          user: session.user,
        })
        if (session.user) {
          authSessionManager.setUser({
            id: session.user.id,
            email: session.user.email || '',
            phone: session.user.phone || '',
          })
        }
      }
    } else if (event === 'SIGNED_OUT') {
      authSessionManager.clearSession()
      // Auto-redirect to login on sign out (only if on a dashboard page)
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
        window.location.href = '/login'
      }
    }
    // Intentionally do NOT handle 'SIGNED_IN' — we handle login/restore ourselves
    // This prevents the onAuthStateChange from writing to localStorage during setSession(),
    // which was causing re-renders and the "chat loads twice" bug.
  })

  return supabaseClient
}

/**
 * Restore the Supabase auth session from localStorage.
 * This MUST be called before any supabase.auth.getUser() or RLS-protected queries.
 * It bridges the gap between our API-based login (which stores tokens in localStorage)
 * and the client-side Supabase SDK (which doesn't know about those tokens).
 */
export async function restoreSupabaseSession(): Promise<boolean> {
  if (sessionRestored) return true

  // Prevent concurrent restore calls
  if (isRestoringSession) {
    // Wait for the in-progress restore to finish
    let retries = 0
    while (isRestoringSession && retries < 50) {
      await new Promise(resolve => setTimeout(resolve, 50))
      retries++
    }
    return sessionRestored
  }

  isRestoringSession = true

  try {
    const client = getSupabase()

    // First check if Supabase already has a session (e.g. from its own persistence)
    const { data: { session: existingSession } } = await client.auth.getSession()
    if (existingSession) {
      sessionRestored = true
      return true
    }

    // If not, try restoring from our localStorage auth_session
    if (typeof window === 'undefined') return false

    const storedSession = sessionStorage.getItem('auth_session') || localStorage.getItem('auth_session')
    if (!storedSession) return false

    const session = JSON.parse(storedSession)
    if (!session?.access_token || !session?.refresh_token) return false

    // Set the session on the Supabase client (this triggers onAuthStateChange, but our guard suppresses it)
    const { error } = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })

    if (error) {
      console.error('[Auth] Failed to restore session:', error.message)
      // Clear invalid session data
      localStorage.removeItem('auth_session')
      localStorage.removeItem('auth_user')
      sessionStorage.removeItem('auth_session')
      authSessionManager.clearSession()
      return false
    }

    sessionRestored = true
    return true
  } catch (error) {
    console.error('[Auth] Error restoring session:', error)
    return false
  } finally {
    isRestoringSession = false
  }
}

/**
 * Helper to ensure a user profile exists in the database.
 * If not found, auto-generates a default organization and profile.
 */
export async function ensureUserProfile(userId: string, email: string): Promise<User | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const authHeader = authSessionManager.getAuthHeader()
    if (authHeader) {
      headers['Authorization'] = authHeader
    }

    // Send userId + email in body as fallback auth method
    const res = await fetch('/api/auth/profile', {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, email }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      console.error('[ensureUserProfile] Failed:', errData.error || res.statusText)
      return null
    }

    const data = await res.json()
    if (data.success && data.user) {
      return data.user as User
    }

    return null
  } catch (error) {
    console.error('[ensureUserProfile] Error:', error)
    return null
  }
}

/**
 * Reset the session restored flag (e.g. on logout)
 */
export function resetSessionState() {
  sessionRestored = false
}

// For backwards compatibility — use getSupabase() for explicit calls
export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabase()
    const value = (client as any)[prop]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})

export type Database = any
