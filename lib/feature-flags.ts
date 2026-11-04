/**
 * Which dashboard modules an organization gets. Commerce and the Flow Builder are on for every
 * organization unless a super admin switches them off (enable_messages, enable_flows), and
 * NEXT_PUBLIC_DISABLED_MODULES hides a module on the whole platform in an emergency.
 * Shared by the layout, the module pages and their tests. Server code (webhooks, jobs, API routes)
 * uses isModuleEnabledOnServer / isModuleDisabledOnServer, which also read DISABLED_MODULES at runtime.
 */

export type DashboardModule = 'commerce' | 'flows'

/** The organization columns the switches read. Undefined (column not migrated yet) means on. */
export interface ModuleSwitches {
  enable_messages?: boolean | null
  enable_flows?: boolean | null
}

/**
 * Modules hidden from everyone by NEXT_PUBLIC_DISABLED_MODULES ("commerce,flows"): the platform's
 * kill switch for emergencies. Read on each call, so a test can change it.
 */
export function isModuleDisabledByPlatform(module: DashboardModule): boolean {
  // Named literally so Next.js inlines the value into the browser bundle
  const disabled = process.env.NEXT_PUBLIC_DISABLED_MODULES || ''
  return disabled.split(',').some((name) => name.trim().toLowerCase() === module)
}

/** Whether the organization has the module: its switches are on and the platform has not hidden it. */
export function isModuleEnabled(org: ModuleSwitches | null | undefined, module: DashboardModule): boolean {
  if (isModuleDisabledByPlatform(module)) return false
  const messaging = org?.enable_messages !== false
  return module === 'commerce' ? messaging : messaging && org?.enable_flows !== false
}

/**
 * The platform's kill switch as the server sees it: DISABLED_MODULES, read at runtime so an
 * emergency change takes effect on the next request without a rebuild, plus the build-time
 * NEXT_PUBLIC_DISABLED_MODULES the dashboard hides modules by. Server-side only.
 */
export function isModuleDisabledOnServer(module: DashboardModule): boolean {
  // Looked up by a computed name so no bundler inlines it at build time
  const runtimeName = 'DISABLED_MODULES'
  const disabled = String(process.env[runtimeName] || '')
  return disabled.split(',').some((name) => name.trim().toLowerCase() === module) || isModuleDisabledByPlatform(module)
}

/**
 * isModuleEnabled for server code: the organization's switches, and the platform's kill switch
 * including the runtime DISABLED_MODULES. An organization row read before the enable_flows
 * migration has no such column, which counts as on.
 */
export function isModuleEnabledOnServer(org: ModuleSwitches | null | undefined, module: DashboardModule): boolean {
  return !isModuleDisabledOnServer(module) && isModuleEnabled(org, module)
}

/** The module a dashboard path belongs to, or null for pages that have no module switch. */
export function moduleForPath(pathname: string): DashboardModule | null {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`)
  if (under('/dashboard/commerce')) return 'commerce'
  if (under('/dashboard/flows')) return 'flows'
  return null
}

/**
 * The organization's switches from /api/organization, which answers without the credentials and
 * without the enable_flows column before its migration. Null when the request fails; callers treat
 * that as "on". This only decides what the dashboard shows: the server enforces the switches with
 * isModuleEnabledOnServer where it acts on them (the Meta webhook runs no flows for an organization
 * without the Flow Builder, and takes no new cart orders while commerce is switched off platform-wide).
 */
export async function fetchModuleSwitches(organizationId: string, accessToken?: string | null): Promise<ModuleSwitches | null> {
  try {
    const res = await fetch(`/api/organization?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    })
    if (!res.ok) return null
    const body = await res.json()
    return body?.organization && typeof body.organization === 'object' ? body.organization : null
  } catch {
    return null
  }
}
