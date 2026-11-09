/**
 * Front Desk's tabs on phones live in the app's bottom bar (the dashboard layout), while the tabs
 * themselves are Front Desk's own state. The two talk through window events, and the tab is kept
 * in the address (?tab=invoices) so the phone's Back button steps back through tabs and a link can
 * open one directly. Browser-only helpers.
 */

export type FrontDeskTab = 'counter' | 'invoices' | 'reviews' | 'team' | 'setup'
export const FRONT_DESK_TABS: FrontDeskTab[] = ['counter', 'invoices', 'reviews', 'team', 'setup']
/** Tabs only managers and admins see */
export const MANAGER_TABS: FrontDeskTab[] = ['reviews', 'team', 'setup']

/** The bottom bar asks Front Desk to open a tab */
export const OPEN_TAB_EVENT = 'front-desk:open-tab'
/** Front Desk says which tab is showing */
export const TAB_SHOWN_EVENT = 'front-desk:tab-shown'
/** Front Desk says what needs attention (booking requests waiting, unhappy customers to call) */
export const BADGES_EVENT = 'front-desk:badges'

export interface FrontDeskBadges { counter?: number; reviews?: number }

export function isFrontDeskTab(value: unknown): value is FrontDeskTab {
  return FRONT_DESK_TABS.includes(value as FrontDeskTab)
}

/** The tab in an address's query (?tab=…), if it is one. */
export function tabFromSearch(search: string): FrontDeskTab | null {
  const tab = new URLSearchParams(search).get('tab')
  return isFrontDeskTab(tab) ? tab : null
}

function emit(name: string, detail: unknown) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }))
}

export const openFrontDeskTab = (tab: FrontDeskTab) => emit(OPEN_TAB_EVENT, tab)
export const announceFrontDeskTab = (tab: FrontDeskTab) => emit(TAB_SHOWN_EVENT, tab)
export const announceFrontDeskBadges = (badges: FrontDeskBadges) => emit(BADGES_EVENT, badges)
