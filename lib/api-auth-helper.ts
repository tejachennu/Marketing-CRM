import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { can, canAccessAssigned, describeDenied, isSuperAdmin, type Permission } from './rbac'

export function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export function getSupabaseAnonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

// Developer accounts that are promoted to superadmin on their first authenticated request.
// Set SUPERADMIN_EMAILS (comma-separated, may be empty) to override without a code change.
const DEFAULT_SUPERADMIN_EMAILS = ['tejachennu223@gmail.com', 'tejachennu@blsindia-canada.ca']

export function getSuperAdminEmails(): string[] {
  const configured = process.env.SUPERADMIN_EMAILS
  const list = configured !== undefined ? configured.split(',') : DEFAULT_SUPERADMIN_EMAILS
  return list.map((email) => email.trim().toLowerCase()).filter(Boolean)
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return getSuperAdminEmails().includes(email.trim().toLowerCase())
}

/**
 * Resolve the Supabase auth user behind a request from its Bearer token,
 * falling back to the legacy `supabase-auth-token` cookie.
 */
async function resolveAuthIdentity(request: NextRequest): Promise<{ id: string; email: string | null } | null> {
  const candidates: string[] = []

  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    candidates.push(authHeader.substring(7))
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const tokenMatch = cookieHeader.match(/supabase-auth-token=([^;]+)/)
  if (tokenMatch) {
    candidates.push(tokenMatch[1])
  }

  for (const token of candidates) {
    try {
      const anonClient = getSupabaseAnonClient()
      const { data: { user } } = await anonClient.auth.getUser(token)
      if (user) {
        return { id: user.id, email: user.email || null }
      }
    } catch (tokenErr) {
      console.warn('[api-auth] Token validation failed:', tokenErr)
    }
  }

  return null
}

export async function getAuthenticatedUser(request: NextRequest) {
  try {
    const identity = await resolveAuthIdentity(request)
    if (!identity) {
      return null
    }

    const adminClient = getSupabaseAdminClient()
    const { data: profile } = await adminClient
      .from('users')
      .select('*')
      .eq('id', identity.id)
      .maybeSingle()

    if (profile && !isSuperAdmin(profile) && isSuperAdminEmail(identity.email)) {
      await adminClient
        .from('users')
        .update({ role: 'superadmin' })
        .eq('id', identity.id)
      profile.role = 'superadmin'
      console.log(`[api-auth] Auto-upgraded developer email ${identity.email} to superadmin`)
    }

    return profile
  } catch (err) {
    console.error('[api-auth] getAuthenticatedUser error:', err)
    return null
  }
}

export interface AccessOptions {
  /** What the caller's role must allow, on top of belonging to the organization. */
  permission?: Permission
  /**
   * verifyRecordAccess only: the record's column holding the user it is assigned to
   * (`assigned_to` on conversations, leads and tickets). Someone who only sees their own
   * work is refused records assigned to anyone else.
   */
  assignedColumn?: string
}

type AccessResult =
  | { authorized: true; user: any; error?: undefined; status?: undefined }
  | { authorized: false; user: any; error: string; status: number }

/** A 403 when the role does not allow `permission`, otherwise null. Super admins are checked like everyone else. */
function denyByPermission(user: any, permission: Permission | undefined): AccessResult | null {
  if (!permission || can(user, permission)) return null
  return { authorized: false, error: describeDenied(permission), status: 403, user }
}

export async function verifyOrgAccess(request: NextRequest, targetOrgId: string | null, options: AccessOptions = {}): Promise<AccessResult> {
  if (!targetOrgId) {
    return { authorized: false, error: 'Missing organizationId', status: 400, user: null }
  }

  const user = await getAuthenticatedUser(request)
  if (!user) {
    return { authorized: false, error: 'Unauthorized: No active session found', status: 401, user: null }
  }

  // Super admins can reach any organization; everyone else only their own
  if (!isSuperAdmin(user) && user.organization_id !== targetOrgId) {
    return { authorized: false, error: 'Forbidden: You do not have access to this organization\'s data', status: 403, user }
  }

  return denyByPermission(user, options.permission) || { authorized: true, user }
}

export async function verifyRecordAccess(request: NextRequest, table: string, recordId: string | null, options: AccessOptions = {}): Promise<AccessResult> {
  if (!recordId) {
    return { authorized: false, error: 'Missing ID parameter', status: 400, user: null }
  }

  const user = await getAuthenticatedUser(request)
  if (!user) {
    return { authorized: false, error: 'Unauthorized: No active session found', status: 401, user: null }
  }

  const denied = denyByPermission(user, options.permission)
  if (denied) return denied

  // Super admins can reach any organization's records
  if (isSuperAdmin(user)) {
    return { authorized: true, user }
  }

  // Check database if record belongs to user's organization
  try {
    const adminClient = getSupabaseAdminClient()
    const columns = options.assignedColumn ? `organization_id, ${options.assignedColumn}` : 'organization_id'
    const { data, error } = await adminClient
      .from(table)
      .select(columns)
      .eq('id', recordId)
      .maybeSingle()
    const record = data as Record<string, any> | null

    if (error || !record) {
      return { authorized: false, error: 'Record not found or access denied', status: 404, user }
    }

    if (record.organization_id !== user.organization_id) {
      return { authorized: false, error: 'Forbidden: You do not have access to this record', status: 403, user }
    }

    if (options.assignedColumn && !canAccessAssigned(user, record[options.assignedColumn])) {
      return { authorized: false, error: describeDenied('records.view_all'), status: 403, user }
    }

    return { authorized: true, user }
  } catch (err) {
    console.error('[api-auth] verifyRecordAccess error:', err)
    return { authorized: false, error: 'Internal server error during record validation', status: 500, user }
  }
}

/**
 * Authenticate a request that is not tied to one organization or record, optionally
 * requiring a permission. Use verifyOrgAccess / verifyRecordAccess when an id is available.
 */
export async function requireUser(request: NextRequest, options: AccessOptions = {}): Promise<AccessResult> {
  const user = await getAuthenticatedUser(request)
  if (!user) {
    return { authorized: false, error: 'Unauthorized: No active session found', status: 401, user: null }
  }
  return denyByPermission(user, options.permission) || { authorized: true, user }
}
