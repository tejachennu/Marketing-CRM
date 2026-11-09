/**
 * Front Desk's tabs in the phone's bottom bar: the shared connector helpers (lib/connector-nav.ts)
 * with Front Desk's tab names. Browser-only helpers.
 */

import { announceConnectorBadges, announceConnectorTab, connectorTabFromSearch, isConnectorTab, onTabRequest, openConnectorTab } from './connector-nav'

export type FrontDeskTab = 'counter' | 'invoices' | 'reviews' | 'team' | 'setup'
export const FRONT_DESK_TABS: FrontDeskTab[] = ['counter', 'invoices', 'reviews', 'team', 'setup']
/** Tabs only managers and admins see */
export const MANAGER_TABS: FrontDeskTab[] = ['reviews', 'team', 'setup']

export interface FrontDeskBadges { counter?: number; reviews?: number }

export function isFrontDeskTab(value: unknown): value is FrontDeskTab {
  return isConnectorTab('front-desk', value)
}

/** The tab in an address's query (?tab=…), if it is one. */
export function tabFromSearch(search: string): FrontDeskTab | null {
  return connectorTabFromSearch('front-desk', search) as FrontDeskTab | null
}

export const openFrontDeskTab = (tab: FrontDeskTab) => openConnectorTab('front-desk', tab)
export const announceFrontDeskTab = (tab: FrontDeskTab) => announceConnectorTab('front-desk', tab)
export const announceFrontDeskBadges = (badges: FrontDeskBadges) => announceConnectorBadges('front-desk', badges as Record<string, number>)
/** Front Desk opens the tabs the bottom bar asks for; returns the function that stops listening. */
export const onFrontDeskTabRequest = (handler: (tab: FrontDeskTab) => void) => onTabRequest('front-desk', (tab) => handler(tab as FrontDeskTab))
