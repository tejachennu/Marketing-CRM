/**
 * Audience rules for the campaign wizard: who matches the filters, who can actually be
 * reached on the chosen channel, and what the final recipient list is.
 * Pure functions, shared by the wizard and its tests.
 */

export type CampaignChannel = 'whatsapp' | 'sms' | 'email'

export interface AudienceContact {
  id: string
  first_name?: string | null
  last_name?: string | null
  phone_number?: string | null
  email?: string | null
  company?: string | null
  tags?: string[] | null
}

/** Shown in the tag list for contacts that have no tags at all. */
export const UNTAGGED = '__untagged__'

export interface AudienceFilters {
  /** Matches name, company, phone number or email. */
  search: string
  tags: string[]
  /** any: has at least one of the tags · all: has every tag · none: has none of them. */
  tagMode: 'any' | 'all' | 'none'
  campaigns: string[]
  /** received: was sent one of the campaigns · not_received: was sent none of them. */
  campaignMode: 'received' | 'not_received'
  /** Hide contacts that have no usable phone number (or email, for an email campaign). */
  reachableOnly: boolean
}

export const EMPTY_AUDIENCE_FILTERS: AudienceFilters = {
  search: '',
  tags: [],
  tagMode: 'any',
  campaigns: [],
  campaignMode: 'received',
  reachableOnly: false,
}

export function hasActiveFilters(filters: AudienceFilters): boolean {
  return Boolean(filters.search.trim()) || filters.tags.length > 0 || filters.campaigns.length > 0 || filters.reachableOnly
}

// ── Phone numbers and emails ────────────────────────────────────────────────

/**
 * The digits of a phone number in international form, or '' when it cannot be one.
 * A bare 10-digit Indian mobile number (starting 6-9) gets the 91 country code, so
 * "98765 43210" and "+91 98765 43210" are the same recipient.
 */
export function normalizePhoneDigits(raw: unknown): string {
  let digits = String(raw ?? '').replace(/\D/g, '')
  // 00 is the international call prefix in many countries
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`
  return digits.length >= 8 && digits.length <= 15 ? digits : ''
}

/** "+919876543210", or null when the value is not a usable phone number. */
export function toDialablePhone(raw: unknown): string | null {
  const digits = normalizePhoneDigits(raw)
  return digits ? `+${digits}` : null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase()
  return EMAIL_PATTERN.test(email) ? email : ''
}

/** The address a contact would be messaged on for a channel, or '' when there is none. */
export function getRecipientKey(contact: Pick<AudienceContact, 'phone_number' | 'email'>, channel: CampaignChannel): string {
  return channel === 'email' ? normalizeEmail(contact.email) : normalizePhoneDigits(contact.phone_number)
}

export function isReachable(contact: Pick<AudienceContact, 'phone_number' | 'email'>, channel: CampaignChannel): boolean {
  return getRecipientKey(contact, channel) !== ''
}

// ── Tags ────────────────────────────────────────────────────────────────────

/** A contact's tags, trimmed, without blanks or repeats. */
export function getContactTags(contact: Pick<AudienceContact, 'tags'>): string[] {
  if (!Array.isArray(contact.tags)) return []
  const seen = new Set<string>()
  for (const tag of contact.tags) {
    const clean = typeof tag === 'string' ? tag.trim() : ''
    if (clean) seen.add(clean)
  }
  return [...seen]
}

/** Every tag in use with how many contacts carry it, most used first. */
export function countTags(contacts: AudienceContact[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const contact of contacts) {
    for (const tag of getContactTags(contact)) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

function matchesTags(contact: AudienceContact, tags: string[], mode: AudienceFilters['tagMode']): boolean {
  if (tags.length === 0) return true
  const own = getContactTags(contact)
  const has = (tag: string) => (tag === UNTAGGED ? own.length === 0 : own.includes(tag))
  if (mode === 'all') return tags.every(has)
  if (mode === 'none') return !tags.some(has)
  return tags.some(has)
}

// ── Past campaigns ──────────────────────────────────────────────────────────

/**
 * Everyone who was sent any of the given campaigns, as normalized phone digits and emails.
 * `participantsByCampaign` holds the raw phone numbers / emails from the delivery logs.
 */
export function buildParticipantSet(campaignIds: string[], participantsByCampaign: Record<string, string[] | undefined>): Set<string> {
  const set = new Set<string>()
  for (const id of campaignIds) {
    for (const value of participantsByCampaign[id] || []) {
      const email = normalizeEmail(value)
      if (email) {
        set.add(email)
        continue
      }
      const digits = normalizePhoneDigits(value)
      if (digits) set.add(digits)
    }
  }
  return set
}

/** True when the delivery logs of every selected campaign have been loaded. */
export function participantsLoaded(campaignIds: string[], participantsByCampaign: Record<string, string[] | undefined>): boolean {
  return campaignIds.every((id) => Array.isArray(participantsByCampaign[id]))
}

export function wasInCampaigns(contact: AudienceContact, participants: Set<string>): boolean {
  const phone = normalizePhoneDigits(contact.phone_number)
  if (phone && participants.has(phone)) return true
  const email = normalizeEmail(contact.email)
  return Boolean(email) && participants.has(email)
}

// ── Filtering ───────────────────────────────────────────────────────────────

function matchesSearch(contact: AudienceContact, search: string): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true

  const text = `${contact.first_name || ''} ${contact.last_name || ''} ${contact.company || ''} ${contact.email || ''}`.toLowerCase()
  if (text.includes(query)) return true

  // "98765 432", "+91-98765" and "9876543" all find the same number
  const queryDigits = query.replace(/\D/g, '')
  if (queryDigits && !/[a-z@]/.test(query)) {
    const phoneDigits = String(contact.phone_number || '').replace(/\D/g, '')
    // Also try the number with its country code, so "+91 98765" finds a contact saved as "98765 43210"
    return phoneDigits.includes(queryDigits) || normalizePhoneDigits(contact.phone_number).includes(queryDigits)
  }
  return String(contact.phone_number || '').toLowerCase().includes(query)
}

export interface FilterContext {
  channel: CampaignChannel
  /** From buildParticipantSet for filters.campaigns. */
  participants: Set<string>
}

export function contactMatchesFilters(contact: AudienceContact, filters: AudienceFilters, context: FilterContext): boolean {
  if (filters.reachableOnly && !isReachable(contact, context.channel)) return false
  if (!matchesSearch(contact, filters.search)) return false
  if (!matchesTags(contact, filters.tags, filters.tagMode)) return false
  if (filters.campaigns.length > 0) {
    const received = wasInCampaigns(contact, context.participants)
    if (filters.campaignMode === 'received' ? !received : received) return false
  }
  return true
}

export function filterContacts<T extends AudienceContact>(contacts: T[], filters: AudienceFilters, context: FilterContext): T[] {
  if (!hasActiveFilters(filters)) return contacts
  return contacts.filter((contact) => contactMatchesFilters(contact, filters, context))
}

// ── Selection summary ───────────────────────────────────────────────────────

export interface SelectionSummary {
  /** Contacts ticked. */
  selected: number
  /** Ticked and shown by the current filters. */
  selectedVisible: number
  /** Ticked but hidden by the current filters. They are still part of the audience. */
  selectedHidden: number
  /** Ticked, but with no usable phone number / email for the channel. They will be skipped. */
  unreachable: number
  /** Ticked contacts that share a number / email with another ticked contact. Sent once. */
  duplicates: number
  /** How many messages will actually go out. */
  recipients: number
}

export function summarizeSelection(
  contacts: AudienceContact[],
  selectedIds: ReadonlySet<string>,
  visibleIds: ReadonlySet<string>,
  channel: CampaignChannel
): SelectionSummary {
  let selected = 0
  let selectedVisible = 0
  let unreachable = 0
  let duplicates = 0
  const seen = new Set<string>()

  for (const contact of contacts) {
    if (!selectedIds.has(contact.id)) continue
    selected += 1
    if (visibleIds.has(contact.id)) selectedVisible += 1

    const key = getRecipientKey(contact, channel)
    if (!key) unreachable += 1
    else if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }

  return { selected, selectedVisible, selectedHidden: selected - selectedVisible, unreachable, duplicates, recipients: seen.size }
}

// ── Final recipient list ────────────────────────────────────────────────────

export interface Recipient {
  phone?: string
  email?: string
  variables: Record<string, string>
}

export interface RecipientList {
  recipients: Recipient[]
  /** Rows dropped because the phone number / email was missing or not valid. */
  invalid: number
  /** Rows dropped because the same number / email appeared earlier in the list. */
  duplicates: number
}

/**
 * Turn rows into the list that is sent: one message per valid, distinct phone number or
 * email. The first row for an address wins.
 */
export function buildRecipientList(
  rows: { address: unknown; variables: Record<string, string> }[],
  channel: CampaignChannel
): RecipientList {
  const recipients: Recipient[] = []
  const seen = new Set<string>()
  let invalid = 0
  let duplicates = 0

  for (const row of rows) {
    const key = channel === 'email' ? normalizeEmail(row.address) : normalizePhoneDigits(row.address)
    if (!key) {
      invalid += 1
      continue
    }
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    recipients.push(channel === 'email' ? { email: key, variables: row.variables } : { phone: `+${key}`, variables: row.variables })
  }

  return { recipients, invalid, duplicates }
}
