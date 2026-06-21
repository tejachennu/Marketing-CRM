import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { User } from './types'
import { authSessionManager } from './auth-context'

let supabaseClient: SupabaseClient | null = null
let sessionRestored = false

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
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
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
    }
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

    // Check if token has expired and we cannot refresh
    if (session.expires_at) {
      const now = Math.floor(Date.now() / 1000)
      if (now > session.expires_at && !session.refresh_token) {
        // Session expired and no refresh token, clear it
        localStorage.removeItem('auth_session')
        localStorage.removeItem('auth_user')
        sessionStorage.removeItem('auth_session')
        return false
      }
    }

    // Set the session on the Supabase client
    const { error } = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })

    if (error) {
      console.error('[v0] Failed to restore Supabase session:', error.message)
      // Clear invalid session
      localStorage.removeItem('auth_session')
      localStorage.removeItem('auth_user')
      sessionStorage.removeItem('auth_session')
      return false
    }

    sessionRestored = true
    return true
  } catch (error) {
    console.error('[v0] Error restoring session:', error)
    return false
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
