import { NextRequest } from 'next/server'
import { getAuthenticatedUser, getSupabaseAdminClient, getSupabaseAnonClient } from './api-auth-helper'

export { getSupabaseAdminClient, getSupabaseAnonClient }

/** Returns the caller's profile when they are a superadmin, otherwise null. */
export async function checkSuperAdmin(request: NextRequest) {
  const profile = await getAuthenticatedUser(request)
  return profile?.role === 'superadmin' ? profile : null
}
