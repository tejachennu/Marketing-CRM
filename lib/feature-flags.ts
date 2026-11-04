/**
 * Which dashboard modules an organization gets. Commerce and the Flow Builder are on for every
 * organization unless a super admin switches them off (enable_messages, enable_flows), and
 * NEXT_PUBLIC_DISABLED_MODULES hides a module on the whole platform in an emergency.
 * Shared by the layout, the module pages and their tests.
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
 * that as "on", since the layout and the API routes apply the rules as well.
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
