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
  if (roleKey(role) === 'viewer') return 'viewer'
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

/** A Viewer sees everything in the workspace and cannot change anything. */
export function isViewer(user: RoleSubject): boolean {
  return roleKey(user?.role) === 'viewer'
}

// ── Access control checks ───────────────────────────────────────────────────

/**
 * Returns true if this user should see ALL conversations/leads/tickets for the org.
 * Admin/manager always see all. Employees only if see_all is explicitly granted.
 */
export function canSeeAll(user: RoleSubject): boolean {
  if (!user) return false
  if (isManager(user) || isViewer(user)) return true
  return user.see_all === true
}

/**
 * Returns true if this user is in read-only mode (view only, cannot send/edit).
 * Admins and managers are never read-only regardless of the flag.
 */
export function isReadOnly(user: RoleSubject): boolean {
  if (!user) return false
  if (isManager(user)) return false
  return user.read_only === true || isViewer(user)
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
  /** The plan, payments and AI credits. */
  | 'billing.manage'
  /** The Super Admin console: every organization and user. */
  | 'platform.manage'

export function can(user: RoleSubject, permission: Permission): boolean {
  if (!user) return false
  switch (permission) {
    case 'platform.manage':
      return isSuperAdmin(user)
    case 'settings.manage':
    case 'team.manage':
    case 'billing.manage':
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
  'billing.manage': 'Only organization admins can change the plan or add AI credits.',
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

  // Managers open Settings for the Knowledge tab; the page hides the rest from them
  if (under('/dashboard/settings')) return isManager(user)
  // The team page: admins manage everyone, managers set what agents can see and do
  if (under('/dashboard/team')) return can(user, 'team.grant_access')
  if (under('/dashboard/billing')) return can(user, 'billing.manage')
  // Admins switch connectors on; managers can see what is available
  if (under('/dashboard/connectors')) return isManager(user)
  if (under('/dashboard/flows')) return can(user, 'automation.manage')
  if (under('/dashboard/campaigns') || under('/dashboard/contacts') || under('/dashboard/templates')) return canSeeAll(user)
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
    if (isManager(target)) return 'Admins and managers always have full access; these switches only apply to agents.'
    if (isViewer(target)) return 'Viewers always see everything and cannot make changes; these switches only apply to agents.'
  }

  if (change.remove || change.role !== undefined) {
    if (!can(actor, 'team.manage')) return describeDenied('team.manage')
    if (isSelf) return change.remove ? 'You cannot remove your own account.' : 'You cannot change your own role.'
    if (isSuperAdmin(target) && !actorIsPlatform) return 'Only a super admin can change a super admin account.'
    if (isOwner(target) && !actorIsPlatform) return 'The organization owner cannot be removed or given a different role.'
    if (change.role !== undefined && roleKey(change.role) === 'owner') return 'There is only one owner: the person who created the workspace.'
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
  super_admin:    { label: 'Super Admin', description: 'WAMA CRM staff: every workspace', color: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-50 dark:bg-violet-950/30', border: 'border-violet-200 dark:border-violet-900' },
  org_admin:      { label: 'Admin',       description: 'Everything, including team, settings and billing', color: 'text-[#1D5BEA] dark:text-blue-300', bg: 'bg-[#eef3fe] dark:bg-blue-950/30', border: 'border-[#cddbfb] dark:border-blue-900' },
  org_manager:    { label: 'Manager',     description: 'All chats, leads and campaigns; assigns work', color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-50 dark:bg-teal-950/30', border: 'border-teal-200 dark:border-teal-900' },
  sales_employee: { label: 'Agent',       description: 'Chats, leads and tickets assigned to them', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900' },
}

const OWNER_DISPLAY: RoleDisplay = { label: 'Owner', description: 'Created the workspace: everything, and cannot be removed', color: 'text-[#0E1B3D] dark:text-white', bg: 'bg-[#e8ecf5] dark:bg-slate-800', border: 'border-[#cfd7e6] dark:border-slate-700' }
const VIEWER_DISPLAY: RoleDisplay = { label: 'Viewer', description: 'Sees everything, changes nothing', color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800', border: 'border-slate-200 dark:border-slate-700' }

/** Label and colours for a role badge. Legacy role names show under the role they map to. */
export function getRoleDisplay(role: string | null | undefined): RoleDisplay {
  if (roleKey(role) === 'owner') return OWNER_DISPLAY
  if (roleKey(role) === 'viewer') return VIEWER_DISPLAY
  return ROLE_DISPLAY[normalizeRole(role)]
}

/** A role an admin can give a teammate. */
export type AssignableRole = 'org_admin' | 'org_manager' | 'sales_employee' | 'viewer'

/** The roles admins give teammates, most access first. Owner and Super Admin are never handed out. */
export const ASSIGNABLE_ROLES: { value: AssignableRole; label: string; description: string }[] = [
  { value: 'org_admin',      label: 'Admin',   description: 'Everything, including the team, settings and billing.' },
  { value: 'org_manager',    label: 'Manager', description: 'Every chat, lead, ticket and campaign. Assigns work and sets what agents can see. No settings or billing.' },
  { value: 'sales_employee', label: 'Agent',   description: 'Replies to the chats and works the leads and tickets assigned to them.' },
  { value: 'viewer',         label: 'Viewer',  description: 'Sees every chat, lead and report, but cannot reply or change anything.' },
]

/** The assignable role a teammate holds now (the owner shows as Admin, the highest role that can be given). */
export function assignableRoleOf(user: RoleSubject): AssignableRole {
  if (isViewer(user)) return 'viewer'
  const role = normalizeRole(user?.role)
  return role === 'super_admin' ? 'org_admin' : role
}

/** The value stored for a role chosen in the team page. */
export function storedTeammateRole(role: unknown): AssignableRole | null {
  if (!isKnownRole(role)) return null
  if (roleKey(role) === 'viewer') return 'viewer'
  const canonical = normalizeRole(role)
  return canonical === 'super_admin' ? null : canonical
}

/** What each role can do, for the permissions table on the team page. Worked out from `can`, so it never drifts. */
export const ROLE_CAPABILITIES: { label: string; permission: Permission }[] = [
  { label: 'See every chat, lead and ticket', permission: 'records.view_all' },
  { label: 'Reply to customers and update records', permission: 'records.write' },
  { label: 'Assign chats and leads to teammates', permission: 'records.assign' },
  { label: 'Contacts, campaigns and templates', permission: 'campaigns.manage' },
  { label: 'Flows, AI knowledge and store setup', permission: 'automation.manage' },
  { label: 'Set what agents can see and do', permission: 'team.grant_access' },
  { label: 'Invite, remove and change teammates', permission: 'team.manage' },
  { label: 'WhatsApp, email and workspace settings', permission: 'settings.manage' },
  { label: 'Plan, payments and AI credits', permission: 'billing.manage' },
]

/** The roles in the permissions table, with a stand-in account for each. */
export const ROLE_TABLE: { label: string; subject: { role: string } }[] = [
  { label: 'Owner', subject: { role: 'owner' } },
  { label: 'Admin', subject: { role: 'org_admin' } },
  { label: 'Manager', subject: { role: 'org_manager' } },
  { label: 'Agent', subject: { role: 'sales_employee' } },
  { label: 'Viewer', subject: { role: 'viewer' } },
]

/** Role the "add teammate" forms start on: the least access, so an admin has to choose to give more. */
export const DEFAULT_TEAMMATE_ROLE: AssignableRole = 'sales_employee'
