'use client'

import { resetSessionState } from './supabase'

export interface AuthSession {
  access_token: string
  token_type: string
  expires_in: number
  expires_at: number
  refresh_token?: string
  user?: any
}

export interface AuthUser {
  id: string
  email: string
  aud?: string
  role?: string
  email_confirmed_at?: string
  phone?: string
  confirmed_at?: string
  last_sign_in_at?: string
  app_metadata?: any
  user_metadata?: any
  identities?: any[]
  created_at?: string
  updated_at?: string
}

// Session management utility
export const authSessionManager = {
  // Get the current session from storage
  getSession: (): AuthSession | null => {
    try {
      if (typeof window === 'undefined') return null
      // Try sessionStorage first (in-memory, cleared on tab close)
      const sessionData = sessionStorage.getItem('auth_session')
      if (sessionData) {
        return JSON.parse(sessionData)
      }
      // Fall back to localStorage
      const storageData = localStorage.getItem('auth_session')
      if (storageData) {
        return JSON.parse(storageData)
      }
      return null
    } catch {
      return null
    }
  },

  // Get the current user
  getUser: (): AuthUser | null => {
    try {
      if (typeof window === 'undefined') return null
      const userData = localStorage.getItem('auth_user')
      if (userData) {
        return JSON.parse(userData)
      }
      return null
    } catch {
      return null
    }
  },

  // Save session to storage
  setSession: (session: AuthSession) => {
    try {
      if (typeof window === 'undefined') return
      const sessionStr = JSON.stringify(session)
      localStorage.setItem('auth_session', sessionStr)
      sessionStorage.setItem('auth_session', sessionStr)
      
      // Sync the user-logged-in flag cookie for middleware compatibility
      // Do NOT set the access_token as a client-side cookie — the login API sets it httpOnly
      const maxAge = 60 * 60 * 24 * 7 // 7 days
      const secure = window.location.protocol === 'https:' ? '; secure' : ''
      document.cookie = `user-logged-in=true; path=/; max-age=${maxAge}; samesite=lax${secure}`
    } catch (error) {
      console.error('[Auth] Failed to save session:', error)
    }
  },

  // Save user to storage
  setUser: (user: AuthUser) => {
    try {
      if (typeof window === 'undefined') return
      localStorage.setItem('auth_user', JSON.stringify(user))
    } catch (error) {
      console.error('[Auth] Failed to save user:', error)
    }
  },

  // Clear session on logout
  clearSession: () => {
    try {
      if (typeof window === 'undefined') return
      localStorage.removeItem('auth_session')
      localStorage.removeItem('auth_user')
      sessionStorage.removeItem('auth_session')
      // Reset supabase session state so it re-restores on next login
      resetSessionState()
      // Clear all cookies
      document.cookie = 'supabase-auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
      document.cookie = 'user-logged-in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    } catch (error) {
      console.error('[Auth] Failed to clear session:', error)
    }
  },

  // Check if user is logged in (pure read — no side effects)
  isLoggedIn: (): boolean => {
    const session = authSessionManager.getSession()
    if (!session?.access_token) return false
    
    // If we have a refresh token, Supabase autoRefreshToken will handle renewal
    // So we consider the session valid as long as tokens exist
    if (session.refresh_token) return true

    // No refresh token — check if access token has expired
    if (session.expires_at) {
      const now = Math.floor(Date.now() / 1000)
      if (now > session.expires_at) {
        return false
      }
    }
    
    return true
  },

  // Get auth header for API calls
  getAuthHeader: () => {
    const session = authSessionManager.getSession()
    if (!session?.access_token) {
      return null
    }
    return `Bearer ${session.access_token}`
  },
}

/**
 * Start a periodic session health watcher.
 * Checks every 30 seconds if the session is still valid.
 * If the session has expired and cannot be refreshed, redirects to login.
 * Returns a cleanup function to stop the watcher.
 */
let sessionWatcherInterval: ReturnType<typeof setInterval> | null = null

export function startSessionWatcher(): () => void {
  // Don't start multiple watchers
  if (sessionWatcherInterval) return () => {}

  sessionWatcherInterval = setInterval(() => {
    const session = authSessionManager.getSession()

    if (!session) {
      // No session at all — redirect to login
      stopSessionWatcher()
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
        authSessionManager.clearSession()
        window.location.href = '/login'
      }
      return
    }

    // If no refresh token and access token expired, force logout
    if (!session.refresh_token && session.expires_at) {
      const now = Math.floor(Date.now() / 1000)
      if (now > session.expires_at) {
        stopSessionWatcher()
        authSessionManager.clearSession()
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
      }
    }
  }, 30000) // Check every 30 seconds

  return () => stopSessionWatcher()
}

function stopSessionWatcher() {
  if (sessionWatcherInterval) {
    clearInterval(sessionWatcherInterval)
    sessionWatcherInterval = null
  }
}

// Custom hook for auth state (use in client components)
export function useAuth() {
  const session = authSessionManager.getSession()
  const user = authSessionManager.getUser()
  const isLoggedIn = authSessionManager.isLoggedIn()

  return {
    session,
    user,
    isLoggedIn,
    logout: () => {
      authSessionManager.clearSession()
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    },
  }
}
