/** The Super Admin page fires this when its section changes, so the side menu marks the right one. */
export const SUPERADMIN_TAB_EVENT = 'superadmin-tab'

export const SUPERADMIN_TABS = ['overview', 'workspaces', 'people', 'setup', 'email'] as const
export type SuperAdminTab = (typeof SUPERADMIN_TABS)[number]

/** The section in an address's ?tab=, or Overview */
export function superAdminTab(search: string): SuperAdminTab {
  const tab = new URLSearchParams(search).get('tab') || ''
  return (SUPERADMIN_TABS as readonly string[]).includes(tab) ? (tab as SuperAdminTab) : 'overview'
}
