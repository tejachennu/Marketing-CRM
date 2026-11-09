/**
 * On phones, a connector's own tabs (Front Desk, Sales Pipeline, E-commerce) live in the app's
 * bottom bar, which belongs to the dashboard layout, while the tabs are the connector page's own
 * state. The two talk through window events. Each page keeps its tab in the address (?tab=…), so
 * the bar knows the tab on arrival, Back steps through tabs and a link can open one directly.
 */

export type ConnectorApp = 'front-desk' | 'pipeline' | 'commerce'

/** Where each connector lives, its tabs (in order) and the one it opens on. */
export const CONNECTOR_APPS: Record<ConnectorApp, { paths: string[]; tabs: string[]; first: string }> = {
  'front-desk': { paths: ['/dashboard/front-desk', '/dashboard/salon'], tabs: ['counter', 'invoices', 'reviews', 'team', 'setup'], first: 'counter' },
  pipeline: { paths: ['/dashboard/leads'], tabs: ['board', 'list', 'follow-ups', 'reports', 'setup'], first: 'board' },
  commerce: { paths: ['/dashboard/commerce'], tabs: ['orders', 'products', 'flow', 'settings'], first: 'orders' },
}

/** The bottom bar asks a connector page to open a tab: { app, tab } */
export const OPEN_TAB_EVENT = 'connector:open-tab'
/** A connector page says which tab is showing: { app, tab } */
export const TAB_SHOWN_EVENT = 'connector:tab-shown'
/** A connector page says what needs attention, per tab: { app, badges: { tab: count } } */
export const BADGES_EVENT = 'connector:badges'

/** The connector whose page this is, if any. */
export function connectorAppAt(pathname: string): ConnectorApp | null {
  for (const [app, { paths }] of Object.entries(CONNECTOR_APPS) as [ConnectorApp, { paths: string[] }][]) {
    if (paths.some((base) => pathname === base || pathname.startsWith(`${base}/`))) return app
  }
  return null
}

export function isConnectorTab(app: ConnectorApp, value: unknown): value is string {
  return CONNECTOR_APPS[app].tabs.includes(String(value))
}

/** The connector's tab in an address's query (?tab=…), if it is one of its tabs. */
export function connectorTabFromSearch(app: ConnectorApp, search: string): string | null {
  const tab = new URLSearchParams(search).get('tab')
  return isConnectorTab(app, tab) ? tab : null
}

function emit(name: string, detail: unknown) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }))
}

export const openConnectorTab = (app: ConnectorApp, tab: string) => emit(OPEN_TAB_EVENT, { app, tab })
export const announceConnectorTab = (app: ConnectorApp, tab: string) => emit(TAB_SHOWN_EVENT, { app, tab })
export const announceConnectorBadges = (app: ConnectorApp, badges: Record<string, number>) => emit(BADGES_EVENT, { app, badges })

/** Listen for one connector's events; returns the function that stops listening. */
export function onConnectorEvent<T = string>(name: typeof OPEN_TAB_EVENT | typeof TAB_SHOWN_EVENT | typeof BADGES_EVENT, app: ConnectorApp, handler: (value: T) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (!detail || detail.app !== app) return
    handler((name === BADGES_EVENT ? detail.badges : detail.tab) as T)
  }
  window.addEventListener(name, listener)
  return () => window.removeEventListener(name, listener)
}

/** A connector page: open tabs the bottom bar asks for (only those this person may see). */
export function onTabRequest(app: ConnectorApp, handler: (tab: string) => void): () => void {
  return onConnectorEvent(OPEN_TAB_EVENT, app, (tab: string) => { if (isConnectorTab(app, tab)) handler(tab) })
}
