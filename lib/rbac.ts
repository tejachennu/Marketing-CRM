/**
 * lib/rbac.ts
 * Centralised Role-Based Access Control.
 *
 * Every role check in the app — the dashboard pages and the API routes — goes through this
 * file, so the rules live in one place. It has no server-only imports and no side effects.
 *
 * Four roles exist. Older accounts still carry legacy role names (`owner`, `OrgAdmin`,
 * `Manager`, `agent`, ...); `normalizeRole` maps every one of them onto the four below.
 */

// ── Roles ───────────────────────────────────────────────────────────────────

export type CanonicalRole = 'super_admin' | 'org_admin' | 'org_manager' | 'sales_employee'

/** Anything that carries a role: a `users` row, or just the fields a page has loaded. */
export type RoleSubject =
  | { id?: string | null; role?: string | null; see_all?: boolean | null; read_only?: boolean | null }
  | null
  | undefined

// Keys are lower-cased with punctuation removed, so "OrgAdmin", "org_admin" and "org-admin" all match
const ROLE_ALIASES: Record<string, CanonicalRole> = {
  superadmin: 'super_admin',
  orgadmin: 'org_admin',
  owner: 'org_admin',
  admin: 'org_admin',
  orgmanager: 'org_manager',
  manager: 'org_manager',
  saleslead: 'org_manager',
  salesemployee: 'sales_employee',
  salesemployees: 'sales_employee',
  member: 'sales_employee',
  agent: 'sales_employee',
  viewer: 'sales_employee',
}

function roleKey(role: unknown): string {
  return String(role ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

/** True when the value is a role name this app knows, current or legacy. */
export function isKnownRole(role: unknown): boolean {
  return roleKey(role) in ROLE_ALIASES
}

/**
 * Map any stored role onto one of the four roles.
 * An empty or unrecognised role gets the least access rather than the most.
 */
export function normalizeRole(role: unknown): CanonicalRole {
  return ROLE_ALIASES[roleKey(role)] ?? 'sales_employee'
}

const ROLE_RANK: Record<CanonicalRole, number> = {
  sales_employee: 1,
  org_manager: 2,
  org_admin: 3,
  super_admin: 4,
}

function rankOf(user: RoleSubject): number {
  return user ? ROLE_RANK[normalizeRole(user.role)] : 0
}

/**
 * The value written to `users.role`. Platform admins are stored as `superadmin`, the name
 * existing rows already use, and `owner` is kept because it marks who created the
 * organization; every other role is stored under its canonical name.
 */
export function toStoredRole(role: unknown): string {
  if (roleKey(role) === 'owner') return 'owner'
  const canonical = normalizeRole(role)
  return canonical === 'super_admin' ? 'superadmin' : canonical
}

// ── Role check functions ────────────────────────────────────────────────────

export function isSuperAdmin(user: RoleSubject): boolean {
  return rankOf(user) >= ROLE_RANK.super_admin
}

/** Org admins and above: full control of the organization. */
export function isAdmin(user: RoleSubject): boolean {
  return rankOf(user) >= ROLE_RANK.org_admin
}

/** Org managers and above. */
export function isManager(user: RoleSubject): boolean {
  return rankOf(user) >= ROLE_RANK.org_manager
}

export function isSalesEmployee(user: RoleSubject): boolean {
  return rankOf(user) === ROLE_RANK.sales_employee
}

/** The account that created the organization. Other admins cannot remove or demote it. */
export function isOwner(user: RoleSubject): boolean {
  return roleKey(user?.role) === 'owner'
}

// ── Access control checks ───────────────────────────────────────────────────

/**
 * Returns true if this user should see ALL conversations/leads/tickets for the org.
 * Admin/manager always see all. Employees only if see_all is explicitly granted.
 */
export function canSeeAll(user: RoleSubject): boolean {
  if (!user) return false
  if (isManager(user)) return true
  return user.see_all === true
}

/**
 * Returns true if this user is in read-only mode (view only, cannot send/edit).
 * Admins and managers are never read-only regardless of the flag.
 */
export function isReadOnly(user: RoleSubject): boolean {
  if (!user) return false
  if (isManager(user)) return false
  return user.read_only === true || roleKey(user.role) === 'viewer'
}

export type Permission =
  /** See every conversation, lead and ticket, not only the assigned ones. */
  | 'records.view_all'
  /** Send messages and edit conversations, leads, tickets and contacts. */
  | 'records.write'
  /** Assign conversations, leads and tickets to teammates. */
  | 'records.assign'
  /** The Contacts page: import, bulk edit and delete. */
  | 'contacts.manage'
  /** Create, schedule, run and stop campaigns; create and delete templates. */
  | 'campaigns.manage'
  /** Chatbot flows, forms, the AI knowledge base, voice workflows and store setup. */
  | 'automation.manage'
  /** Grant or revoke "see all" and "read only" for sales employees. */
  | 'team.grant_access'
  /** Invite and remove teammates, change their role. */
  | 'team.manage'
  /** Organization settings: channels, API credentials, integrations, feature switches. */
  | 'settings.manage'
  /** The Super Admin console: every organization and user. */
  | 'platform.manage'

export function can(user: RoleSubject, permission: Permission): boolean {
  if (!user) return false
  switch (permission) {
    case 'platform.manage':
      return isSuperAdmin(user)
    case 'settings.manage':
    case 'team.manage':
      return isAdmin(user)
    case 'team.grant_access':
    case 'records.assign':
    case 'automation.manage':
      return isManager(user)
    case 'records.view_all':
      return canSeeAll(user)
    case 'records.write':
      return !isReadOnly(user)
    case 'contacts.manage':
    case 'campaigns.manage':
      return canSeeAll(user) && !isReadOnly(user)
    default:
      return false
  }
}

const PERMISSION_DENIED: Record<Permission, string> = {
  'records.view_all': 'You can only open conversations, leads and tickets assigned to you.',
  'records.write': 'Your account is read-only. Ask an admin or manager to enable editing.',
  'records.assign': 'Only admins and managers can assign work to teammates.',
  'contacts.manage': 'You do not have access to manage contacts.',
  'campaigns.manage': 'You do not have access to manage campaigns and templates.',
  'automation.manage': 'Only admins and managers can change flows, the knowledge base and store setup.',
  'team.grant_access': 'Only admins and managers can change teammate access.',
  'team.manage': 'Only organization admins can add, remove or change teammates.',
  'settings.manage': 'Only organization admins can change organization settings.',
  'platform.manage': 'Super admin access is required.',
}

/** A sentence explaining a refusal, suitable to show to the user. */
export function describeDenied(permission: Permission): string {
  return PERMISSION_DENIED[permission]
}

/** Returns true if this user can manage teammates (add/remove/change roles). */
export function canManageTeam(user: RoleSubject): boolean {
  return can(user, 'team.manage')
}

/** Returns true if this user can grant see_all / read_only to employees. */
export function canGrantPermissions(user: RoleSubject): boolean {
  return can(user, 'team.grant_access')
}

/** Returns true if this user can assign leads/conversations to other team members. */
export function canAssign(user: RoleSubject): boolean {
  return can(user, 'records.assign')
}

/**
 * True when the user may open a record that can be assigned (conversation, lead, ticket):
 * they see everything, or it is assigned to them.
 */
export function canAccessAssigned(user: RoleSubject, assignedTo: string | null | undefined): boolean {
  if (!user) return false
  if (canSeeAll(user)) return true
  return Boolean(user.id) && assignedTo === user.id
}

// ── Page access ─────────────────────────────────────────────────────────────

/**
 * Whether a role may open a dashboard page. Feature switches (messages, email, flows beta)
 * are checked separately by the layout; this only answers the role question.
 */
export function canAccessPage(user: RoleSubject, pathname: string): boolean {
  if (!user) return false
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`)

  // Platform admins work in the Super Admin console and have no organization workspace of their own
  if (isSuperAdmin(user)) return under('/dashboard/superadmin') || under('/dashboard/profile')
  if (under('/dashboard/superadmin')) return false

  // Managers open Settings for the Team and Knowledge tabs; the page hides the rest from them
  if (under('/dashboard/settings')) return isManager(user)
  if (under('/dashboard/flows')) return can(user, 'automation.manage')
  if (under('/dashboard/campaigns') || under('/dashboard/contacts')) return canSeeAll(user)
  return true
}

// ── Team management rules ───────────────────────────────────────────────────

/** The roles this user may give to someone else. Nobody can hand out a role above their own. */
export function getGrantableRoles(actor: RoleSubject): CanonicalRole[] {
  if (isSuperAdmin(actor)) return ['super_admin', 'org_admin', 'org_manager', 'sales_employee']
  if (isAdmin(actor)) return ['org_admin', 'org_manager', 'sales_employee']
  return []
}

export interface TeamChange {
  /** Remove the teammate from the organization. */
  remove?: boolean
  /** Give the teammate a different role. */
  role?: unknown
  /** Change the "see all" or "read only" override. */
  access?: boolean
}

export interface TeamChangeContext {
  /** How many admins the target's organization has right now, including the target. */
  adminCount: number
}

/**
 * Decide whether `actor` may apply `change` to `target`.
 * Returns null when it is allowed, otherwise the reason to show the user.
 */
export function getTeamChangeError(
  actor: RoleSubject,
  target: RoleSubject,
  change: TeamChange,
  context: TeamChangeContext
): string | null {
  if (!actor || !target) return 'Teammate not found.'

  const isSelf = Boolean(actor.id) && actor.id === target.id
  const actorIsPlatform = isSuperAdmin(actor)

  if (change.access) {
    if (!can(actor, 'team.grant_access')) return describeDenied('team.grant_access')
    if (isSelf) return 'You cannot change your own access.'
    if (isManager(target)) return 'Admins and managers always have full access; these switches only apply to sales employees.'
  }

  if (change.remove || change.role !== undefined) {
    if (!can(actor, 'team.manage')) return describeDenied('team.manage')
    if (isSelf) return change.remove ? 'You cannot remove your own account.' : 'You cannot change your own role.'
    if (isSuperAdmin(target) && !actorIsPlatform) return 'Only a super admin can change a super admin account.'
    if (isOwner(target) && !actorIsPlatform) return 'The organization owner cannot be removed or given a different role.'
  }

  if (change.role !== undefined) {
    if (!isKnownRole(change.role)) return 'Choose a valid role.'
    const nextRole = normalizeRole(change.role)
    if (!getGrantableRoles(actor).includes(nextRole)) return 'You cannot assign a role above your own.'
    if (isAdmin(target) && !isSuperAdmin(target) && ROLE_RANK[nextRole] < ROLE_RANK.org_admin && context.adminCount <= 1) {
      return 'An organization needs at least one admin. Make someone else an admin first.'
    }
  }

  if (change.remove && isAdmin(target) && !isSuperAdmin(target) && context.adminCount <= 1) {
    return 'An organization needs at least one admin. Make someone else an admin first.'
  }

  return null
}

// ── Display helpers ─────────────────────────────────────────────────────────

export type RoleDisplay = {
  label: string
  description: string
  color: string
  bg: string
  border: string
}

const ROLE_DISPLAY: Record<CanonicalRole, RoleDisplay> = {
  super_admin:    { label: 'Super Admin',    description: 'Platform-level access across all organizations', color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/20', border: 'border-violet-200 dark:border-violet-900' },
  org_admin:      { label: 'Org Admin',      description: 'Full org access — all chats, leads, settings and team', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-200 dark:border-purple-900' },
  org_manager:    { label: 'Org Manager',    description: 'Sees everything, assigns work, grants employee access', color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-200 dark:border-blue-900' },
  sales_employee: { label: 'Sales Employee', description: 'Assigned leads & chats only by default', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-200 dark:border-emerald-900' },
}

/** Label and colours for a role badge. Legacy role names show under the role they map to. */
export function getRoleDisplay(role: string | null | undefined): RoleDisplay {
  const display = ROLE_DISPLAY[normalizeRole(role)]
  if (roleKey(role) === 'owner') return { ...display, label: 'Owner', description: 'Created this organization — full access' }
  return display
}

/** The 3 roles that org admins can assign to teammates (super_admin is internal only) */
export const ASSIGNABLE_ROLES: { value: CanonicalRole; label: string; description: string }[] = [
  { value: 'org_admin',      label: 'Org Admin',      description: 'Full access — all chats, leads, settings & team management' },
  { value: 'org_manager',    label: 'Org Manager',    description: 'Sees everything, assigns work & can grant employees wider access' },
  { value: 'sales_employee', label: 'Sales Employee', description: 'Sees only assigned leads & chats (can be expanded per-user)' },
]

/** Role the "add teammate" forms start on: the least access, so an admin has to choose to give more. */
export const DEFAULT_TEAMMATE_ROLE: CanonicalRole = 'sales_employee'
