/**
 * lib/rbac.ts
 * Centralised Role-Based Access Control helpers.
 * Supports both the new 4-tier roles and the legacy role slugs.
 */

import type { User } from './types'

// ── Canonical role helpers ──────────────────────────────────────────────────

/** Roles that have full platform/org admin privileges */
const ADMIN_ROLES = new Set([
  'super_admin', 'org_admin',
  // Legacy mappings
  'owner', 'admin', 'superadmin', 'OrgAdmin',
])

/** Roles that have manager-level privileges (can assign, grant access) */
const MANAGER_ROLES = new Set([
  'super_admin', 'org_admin', 'org_manager',
  // Legacy mappings
  'owner', 'admin', 'superadmin', 'OrgAdmin', 'Manager', 'saleslead',
])

/** Roles that are restricted employees (see only assigned by default) */
const EMPLOYEE_ROLES = new Set([
  'sales_employee',
  // Legacy mappings
  'member', 'agent', 'viewer', 'salesemployees',
])

// ── Role check functions ────────────────────────────────────────────────────

export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return ADMIN_ROLES.has(user.role)
}

export function isManager(user: User | null | undefined): boolean {
  if (!user) return false
  return MANAGER_ROLES.has(user.role)
}

export function isSalesEmployee(user: User | null | undefined): boolean {
  if (!user) return false
  return EMPLOYEE_ROLES.has(user.role)
}

export function isSuperAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return user.role === 'super_admin' || user.role === 'superadmin'
}

// ── Access control checks ───────────────────────────────────────────────────

/**
 * Returns true if this user should see ALL conversations/leads for the org.
 * Admin/manager always see all. Employees only if see_all is explicitly granted.
 */
export function canSeeAll(user: User | null | undefined): boolean {
  if (!user) return false
  if (isManager(user)) return true
  return user.see_all === true
}

/**
 * Returns true if this user is in read-only mode (view only, cannot send/edit).
 * Admins and managers are never read-only regardless of the flag.
 */
export function isReadOnly(user: User | null | undefined): boolean {
  if (!user) return false
  if (isManager(user)) return false // admins/managers are never read-only
  return user.read_only === true
}

/**
 * Returns true if this user can manage teammates (add/remove/change roles).
 */
export function canManageTeam(user: User | null | undefined): boolean {
  return isAdmin(user)
}

/**
 * Returns true if this user can grant see_all / read_only to employees.
 */
export function canGrantPermissions(user: User | null | undefined): boolean {
  return isManager(user)
}

/**
 * Returns true if this user can assign leads/conversations to other team members.
 */
export function canAssign(user: User | null | undefined): boolean {
  return isManager(user)
}

// ── Display helpers ─────────────────────────────────────────────────────────

export type RoleDisplay = {
  label: string
  description: string
  color: string
  bg: string
  border: string
}

const ROLE_DISPLAY_MAP: Record<string, RoleDisplay> = {
  super_admin:    { label: 'Super Admin',     description: 'Platform-level access across all orgs', color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/20', border: 'border-violet-200 dark:border-violet-900' },
  org_admin:      { label: 'Org Admin',       description: 'Full org access — all chats, leads, settings', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-200 dark:border-purple-900' },
  org_manager:    { label: 'Org Manager',     description: 'Manages team, assign leads, grant access', color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-200 dark:border-blue-900' },
  sales_employee: { label: 'Sales Employee',  description: 'Assigned leads & chats only by default', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900' },
  // Legacy fallbacks
  owner:          { label: 'Org Admin',       description: 'Full org access', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-200 dark:border-purple-900' },
  admin:          { label: 'Org Admin',       description: 'Full org access', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-200 dark:border-purple-900' },
  OrgAdmin:       { label: 'Org Admin',       description: 'Full org access', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-200 dark:border-purple-900' },
  superadmin:     { label: 'Super Admin',     description: 'Platform-level access', color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/20', border: 'border-violet-200 dark:border-violet-900' },
  Manager:        { label: 'Org Manager',     description: 'Manages team assignments', color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-200 dark:border-blue-900' },
  saleslead:      { label: 'Org Manager',     description: 'Manages team assignments', color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-200 dark:border-blue-900' },
  member:         { label: 'Sales Employee',  description: 'Assigned items only', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900' },
  agent:          { label: 'Sales Employee',  description: 'Assigned items only', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900' },
  salesemployees: { label: 'Sales Employee',  description: 'Assigned items only', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900' },
  viewer:         { label: 'Sales Employee',  description: 'Read-only access', color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-900/40', border: 'border-slate-200 dark:border-slate-800' },
}

export function getRoleDisplay(role: string): RoleDisplay {
  return ROLE_DISPLAY_MAP[role] ?? { label: role, description: '', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' }
}

/** The 3 roles that org admins can assign to new teammates (super_admin is internal only) */
export const ASSIGNABLE_ROLES: { value: string; label: string; description: string }[] = [
  { value: 'org_admin',      label: 'Org Admin',      description: 'Full access — all chats, leads, settings & team management' },
  { value: 'org_manager',    label: 'Org Manager',    description: 'Manages assignments & can grant employees wider access' },
  { value: 'sales_employee', label: 'Sales Employee', description: 'Sees only assigned leads & chats (can be expanded per-user)' },
]
