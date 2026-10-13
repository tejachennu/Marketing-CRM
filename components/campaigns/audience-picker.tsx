'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, History, Loader2, RefreshCw, Search, Tag, Users, X } from 'lucide-react'
import {
  EMPTY_AUDIENCE_FILTERS,
  UNTAGGED,
  buildParticipantSet,
  countTags,
  filterContacts,
  getContactTags,
  hasActiveFilters,
  isReachable,
  participantsLoaded,
  summarizeSelection,
  type AudienceContact,
  type AudienceFilters,
  type CampaignChannel,
} from '@/lib/campaigns/audience'

export interface PastCampaign {
  id: string
  name: string
  channel?: string | null
  total_contacts?: number | null
  sent_count?: number | null
  created_at?: string | null
}

interface AudiencePickerProps {
  contacts: AudienceContact[]
  loading: boolean
  onReload: () => void
  channel: CampaignChannel
  /** Ids of the contacts that will receive the campaign. */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  campaigns: PastCampaign[]
  loadingCampaigns: boolean
  /** Raw phone numbers / emails each past campaign was sent to; undefined while not loaded. */
  participantsByCampaign: Record<string, string[] | undefined>
  /** Set when loading delivery logs failed; the past-campaign filter waits until a retry succeeds. */
  participantsError?: string | null
  /** Ask the parent to load the delivery logs of these campaigns. */
  onNeedParticipants: (campaignIds: string[]) => void
}

type View = 'all' | 'selected' | 'unselected'
type Menu = 'tags' | 'campaigns' | null

const PAGE_SIZE = 100
const number = (value: number) => value.toLocaleString()

const TAG_MODES: { id: AudienceFilters['tagMode']; label: string; hint: string }[] = [
  { id: 'any', label: 'Any of', hint: 'Has at least one of the chosen tags' },
  { id: 'all', label: 'All of', hint: 'Has every chosen tag' },
  { id: 'none', label: 'None of', hint: 'Has none of the chosen tags' },
]

const controlClass =
  'h-10 px-3 rounded-xl border text-[13px] font-medium inline-flex items-center justify-between gap-2 transition-colors cursor-pointer bg-white dark:bg-[#1a252c]'
const idleControl = 'border-slate-200 dark:border-[#2a3942] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
const activeControl = 'border-[#00a884] text-[#008069] dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30'
const menuClass =
  'absolute top-full mt-1.5 z-40 w-[min(22rem,calc(100vw-2rem))] bg-white dark:bg-[#1c282f] border border-slate-200 dark:border-[#2a3942] rounded-2xl shadow-xl p-3 space-y-2.5'
const chipClass = 'inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-full text-xs font-medium border'

/**
 * Step 2 of the campaign wizard when the audience comes from the CRM.
 *
 * Filters decide which contacts are listed; ticks decide who receives the campaign. The two are
 * kept visibly apart: the summary always counts the ticked contacts, and says so when some of
 * them are hidden by the filters.
 */
export function AudiencePicker({
  contacts,
  loading,
  onReload,
  channel,
  selectedIds,
  onChange,
  campaigns,
  loadingCampaigns,
  participantsByCampaign,
  participantsError,
  onNeedParticipants,
}: AudiencePickerProps) {
  const [filters, setFilters] = useState<AudienceFilters>(EMPTY_AUDIENCE_FILTERS)
  const [view, setView] = useState<View>('all')
  const [openMenu, setOpenMenu] = useState<Menu>(null)
  const [tagQuery, setTagQuery] = useState('')
  const [campaignQuery, setCampaignQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const campaignMenuRef = useRef<HTMLDivElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  // Typing stays responsive on a large contact list: the list catches up a moment later
  const deferredSearch = useDeferredValue(filters.search)
  const appliedFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const tagCounts = useMemo(() => countTags(contacts), [contacts])
  const untaggedCount = useMemo(() => contacts.filter((contact) => getContactTags(contact).length === 0).length, [contacts])

  const participants = useMemo(() => buildParticipantSet(filters.campaigns, participantsByCampaign), [filters.campaigns, participantsByCampaign])
  const participantsReady = participantsLoaded(filters.campaigns, participantsByCampaign)

  // Load delivery logs for campaigns that were just chosen
  useEffect(() => {
    const missing = filters.campaigns.filter((id) => participantsByCampaign[id] === undefined)
    if (missing.length > 0) onNeedParticipants(missing)
  }, [filters.campaigns, participantsByCampaign, onNeedParticipants])

  const matching = useMemo(
    () => filterContacts(contacts, appliedFilters, { channel, participants }),
    [contacts, appliedFilters, channel, participants]
  )
  const matchingIds = useMemo(() => new Set(matching.map((contact) => contact.id)), [matching])
  const summary = useMemo(() => summarizeSelection(contacts, selectedSet, matchingIds, channel), [contacts, selectedSet, matchingIds, channel])

  const rows = useMemo(() => {
    if (view === 'selected') return matching.filter((contact) => selectedSet.has(contact.id))
    if (view === 'unselected') return matching.filter((contact) => !selectedSet.has(contact.id))
    return matching
  }, [matching, view, selectedSet])

  const filtersActive = hasActiveFilters(filters)
  const allMatchingSelected = matching.length > 0 && summary.selectedVisible === matching.length
  const someMatchingSelected = summary.selectedVisible > 0 && !allMatchingSelected

  // Back to the first page of rows whenever what is listed changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [appliedFilters, view, channel])

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someMatchingSelected
  }, [someMatchingSelected])

  // Close a menu on an outside click or Escape. Escape is caught first so it closes the menu, not the wizard.
  useEffect(() => {
    if (!openMenu) return
    const onMouseDown = (event: MouseEvent) => {
      const menu = openMenu === 'tags' ? tagMenuRef.current : campaignMenuRef.current
      if (menu && !menu.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setOpenMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [openMenu])

  // ── Selection actions ──
  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id])
  }
  const addMatching = () => {
    const next = new Set(selectedIds)
    for (const contact of matching) next.add(contact.id)
    onChange([...next])
  }
  const removeMatching = () => onChange(selectedIds.filter((id) => !matchingIds.has(id)))
  const keepOnlyMatching = () => onChange(selectedIds.filter((id) => matchingIds.has(id)))

  // ── Filter actions ──
  const patch = (changes: Partial<AudienceFilters>) => setFilters((current) => ({ ...current, ...changes }))
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const clearFilters = () => {
    setFilters(EMPTY_AUDIENCE_FILTERS)
    setTagQuery('')
    setCampaignQuery('')
  }

  const tagLabel = (tag: string) => (tag === UNTAGGED ? 'No tags' : tag)
  const tagModeLabel = TAG_MODES.find((mode) => mode.id === filters.tagMode)?.label || 'Any of'
  const addressNoun = channel === 'email' ? 'email address' : 'phone number'

  const visibleTags = tagCounts.filter(({ tag }) => !tagQuery.trim() || tag.toLowerCase().includes(tagQuery.trim().toLowerCase()))
  const visibleCampaigns = campaigns.filter((campaign) => !campaignQuery.trim() || campaign.name.toLowerCase().includes(campaignQuery.trim().toLowerCase()))
  const campaignName = (id: string) => campaigns.find((campaign) => campaign.id === id)?.name || 'Campaign'

  const waitingForLogs = filters.campaigns.length > 0 && !participantsReady

  return (
    <div className="space-y-3">
      {/* ── Who will receive the campaign ── */}
      <div className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
        summary.recipients > 0
          ? 'border-[#00a884]/40 bg-emerald-50/60 dark:bg-emerald-950/20'
          : 'border-slate-200 dark:border-[#2a3942] bg-white dark:bg-[#152026]'
      }`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-11 w-11 shrink-0 rounded-xl flex items-center justify-center ${summary.recipients > 0 ? 'bg-[#00a884] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
            <Users size={20} />
          </div>
          <div className="min-w-0" aria-live="polite">
            <p className="text-[15px] font-bold text-slate-900 dark:text-white tabular-nums">
              {summary.recipients === 0
                ? 'No recipients selected'
                : `${number(summary.recipients)} ${summary.recipients === 1 ? 'recipient' : 'recipients'} selected`}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {summary.selected === 0
                ? `Tick contacts below, or filter and select everyone who matches. ${number(contacts.length)} contacts in your CRM.`
                : [
                    `${number(summary.selected)} of ${number(contacts.length)} contacts ticked`,
                    summary.unreachable > 0 ? `${number(summary.unreachable)} without a valid ${addressNoun} will be skipped` : '',
                    summary.duplicates > 0 ? `${number(summary.duplicates)} sharing a ${addressNoun} are sent once` : '',
                  ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {summary.selected > 0 && (
          <button type="button" onClick={() => onChange([])} className="h-9 px-3 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer self-start sm:self-auto">
            Clear selection
          </button>
        )}
      </div>

      {/* ── Filters: they narrow the list, not the selection ── */}
      <div className="rounded-2xl border border-slate-200 dark:border-[#2a3942] bg-slate-50/70 dark:bg-[#121c22] p-3 space-y-2.5">
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              inputMode="search"
              aria-label="Search contacts"
              placeholder="Search name, company, phone or email"
              value={filters.search}
              onChange={(event) => patch({ search: event.target.value })}
              className="w-full h-10 pl-9 pr-9 bg-white dark:bg-[#1a252c] border border-slate-200 dark:border-[#2a3942] rounded-xl text-[13px] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#00a884] focus:ring-2 focus:ring-[#00a884]/20"
            />
            {filters.search && (
              <button type="button" aria-label="Clear search" onClick={() => patch({ search: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Tags */}
            <div className="relative" ref={tagMenuRef}>
              <button
                type="button"
                aria-haspopup="true"
                aria-expanded={openMenu === 'tags'}
                onClick={() => setOpenMenu(openMenu === 'tags' ? null : 'tags')}
                className={`${controlClass} ${filters.tags.length > 0 ? activeControl : idleControl}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Tag size={14} />
                  Tags
                  {filters.tags.length > 0 && <span className="h-5 min-w-5 px-1 rounded-full bg-[#00a884] text-white text-[11px] font-bold tabular-nums inline-flex items-center justify-center">{filters.tags.length}</span>}
                </span>
                <ChevronDown size={14} className={`transition-transform ${openMenu === 'tags' ? 'rotate-180' : ''}`} />
              </button>

              {openMenu === 'tags' && (
                <div className={`${menuClass} left-0`}>
                  <div role="group" aria-label="How tags are matched" className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                    {TAG_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        title={mode.hint}
                        aria-pressed={filters.tagMode === mode.id}
                        onClick={() => patch({ tagMode: mode.id })}
                        className={`h-7 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                          filters.tagMode === mode.id ? 'bg-white dark:bg-[#2a3942] text-[#008069] dark:text-emerald-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 px-0.5">{TAG_MODES.find((mode) => mode.id === filters.tagMode)?.hint}</p>

                  {tagCounts.length > 8 && (
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" aria-label="Search tags" placeholder="Search tags" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} className="w-full h-8 pl-8 pr-3 text-xs bg-slate-50 dark:bg-[#121b22] border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-[#00a884] text-slate-900 dark:text-white" />
                    </div>
                  )}

                  <div className="max-h-60 overflow-y-auto -mx-1 px-1 space-y-0.5">
                    {tagCounts.length === 0 && untaggedCount === contacts.length ? (
                      <p className="py-5 text-center text-xs text-slate-500">None of your contacts have tags yet.</p>
                    ) : (
                      <>
                        {visibleTags.map(({ tag, count }) => (
                          <MenuOption key={tag} checked={filters.tags.includes(tag)} onToggle={() => patch({ tags: toggleIn(filters.tags, tag) })} label={tag} count={count} />
                        ))}
                        {untaggedCount > 0 && !tagQuery.trim() && (
                          <MenuOption checked={filters.tags.includes(UNTAGGED)} onToggle={() => patch({ tags: toggleIn(filters.tags, UNTAGGED) })} label="No tags" count={untaggedCount} muted />
                        )}
                        {visibleTags.length === 0 && tagQuery.trim() && <p className="py-4 text-center text-xs text-slate-500">No tag matches “{tagQuery}”.</p>}
                      </>
                    )}
                  </div>

                  {filters.tags.length > 0 && (
                    <button type="button" onClick={() => patch({ tags: [] })} className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer">
                      Clear tags
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Past campaigns */}
            <div className="relative" ref={campaignMenuRef}>
              <button
                type="button"
                aria-haspopup="true"
                aria-expanded={openMenu === 'campaigns'}
                onClick={() => setOpenMenu(openMenu === 'campaigns' ? null : 'campaigns')}
                className={`${controlClass} ${filters.campaigns.length > 0 ? activeControl : idleControl}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <History size={14} />
                  Past campaigns
                  {filters.campaigns.length > 0 && <span className="h-5 min-w-5 px-1 rounded-full bg-[#00a884] text-white text-[11px] font-bold tabular-nums inline-flex items-center justify-center">{filters.campaigns.length}</span>}
                </span>
                <ChevronDown size={14} className={`transition-transform ${openMenu === 'campaigns' ? 'rotate-180' : ''}`} />
              </button>

              {openMenu === 'campaigns' && (
                <div className={`${menuClass} right-0 sm:left-0 sm:right-auto lg:left-auto lg:right-0`}>
                  <div role="group" aria-label="How past campaigns are matched" className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                    {([
                      { id: 'received', label: 'Received' },
                      { id: 'not_received', label: 'Did not receive' },
                    ] as const).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={filters.campaignMode === mode.id}
                        onClick={() => patch({ campaignMode: mode.id })}
                        className={`h-7 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                          filters.campaignMode === mode.id ? 'bg-white dark:bg-[#2a3942] text-[#008069] dark:text-emerald-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 px-0.5">
                    {filters.campaignMode === 'received'
                      ? 'Contacts who were sent at least one of the chosen campaigns.'
                      : 'Contacts who were sent none of the chosen campaigns. Useful to avoid messaging the same people twice.'}
                  </p>

                  {campaigns.length > 8 && (
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" aria-label="Search campaigns" placeholder="Search campaigns" value={campaignQuery} onChange={(event) => setCampaignQuery(event.target.value)} className="w-full h-8 pl-8 pr-3 text-xs bg-slate-50 dark:bg-[#121b22] border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-[#00a884] text-slate-900 dark:text-white" />
                    </div>
                  )}

                  <div className="max-h-60 overflow-y-auto -mx-1 px-1 space-y-0.5">
                    {loadingCampaigns ? (
                      <p className="py-5 flex items-center justify-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin text-[#00a884]" /> Loading campaigns…</p>
                    ) : campaigns.length === 0 ? (
                      <p className="py-5 text-center text-xs text-slate-500">You have not sent any campaigns yet.</p>
                    ) : visibleCampaigns.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-500">No campaign matches “{campaignQuery}”.</p>
                    ) : (
                      visibleCampaigns.map((campaign) => (
                        <MenuOption
                          key={campaign.id}
                          checked={filters.campaigns.includes(campaign.id)}
                          onToggle={() => patch({ campaigns: toggleIn(filters.campaigns, campaign.id) })}
                          label={campaign.name}
                          detail={[
                            campaign.channel || 'whatsapp',
                            `${number(campaign.total_contacts || campaign.sent_count || 0)} recipients`,
                            campaign.created_at ? new Date(campaign.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
                          ].filter(Boolean).join(' · ')}
                        />
                      ))
                    )}
                  </div>

                  {filters.campaigns.length > 0 && (
                    <button type="button" onClick={() => patch({ campaigns: [] })} className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer">
                      Clear campaigns
                    </button>
                  )}
                </div>
              )}
            </div>

            <label className={`${controlClass} ${filters.reachableOnly ? activeControl : idleControl} select-none`} title={`Hide contacts that have no valid ${addressNoun}`}>
              <input type="checkbox" checked={filters.reachableOnly} onChange={(event) => patch({ reachableOnly: event.target.checked })} className="h-4 w-4 rounded accent-[#00a884] cursor-pointer" />
              Reachable only
            </label>
          </div>
        </div>

        {/* What is applied right now */}
        {filtersActive && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {filters.search.trim() && (
              <Chip tone="slate" onRemove={() => patch({ search: '' })}>“{filters.search.trim()}”</Chip>
            )}
            {filters.tags.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{tagModeLabel.toLowerCase()}</span>}
            {filters.tags.map((tag) => (
              <Chip key={tag} tone="emerald" onRemove={() => patch({ tags: filters.tags.filter((item) => item !== tag) })}>{tagLabel(tag)}</Chip>
            ))}
            {filters.campaigns.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{filters.campaignMode === 'received' ? 'received' : 'did not receive'}</span>}
            {filters.campaigns.map((id) => (
              <Chip key={id} tone="amber" onRemove={() => patch({ campaigns: filters.campaigns.filter((item) => item !== id) })}>{campaignName(id)}</Chip>
            ))}
            {filters.reachableOnly && <Chip tone="slate" onRemove={() => patch({ reachableOnly: false })}>Reachable only</Chip>}
            <button type="button" onClick={clearFilters} className="ml-auto text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:underline cursor-pointer">
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Ticked contacts the filters are hiding still receive the campaign: say so */}
      {filtersActive && summary.selectedHidden > 0 && !waitingForLogs && (
        <div role="alert" className="rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <p className="flex items-start gap-2 text-[13px] text-amber-900 dark:text-amber-200">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="font-semibold">{number(summary.selectedHidden)} ticked {summary.selectedHidden === 1 ? 'contact is' : 'contacts are'} not shown by these filters</strong> and will still receive the campaign.
            </span>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => { clearFilters(); setView('selected') }} className="h-8 px-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-transparent text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 cursor-pointer">
              Show everyone ticked
            </button>
            <button type="button" onClick={keepOnlyMatching} className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer">
              Keep only the {number(summary.selectedVisible)} shown
            </button>
          </div>
        </div>
      )}

      {/* ── Contacts ── */}
      <div className="border border-slate-200 dark:border-[#2a3942] rounded-2xl overflow-hidden bg-white dark:bg-[#111b21]">
        <div className="px-3 sm:px-4 py-2.5 bg-slate-50 dark:bg-[#152026] border-b border-slate-200 dark:border-[#2a3942] flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          <label className="flex items-center gap-3 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer select-none min-w-0">
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              aria-label={allMatchingSelected ? 'Untick everyone listed' : 'Tick everyone listed'}
              disabled={matching.length === 0 || waitingForLogs}
              checked={allMatchingSelected}
              onChange={() => (allMatchingSelected ? removeMatching() : addMatching())}
              className="h-4 w-4 rounded accent-[#00a884] cursor-pointer disabled:cursor-not-allowed"
            />
            <span className="tabular-nums">
              <strong className="font-semibold text-slate-900 dark:text-white">{number(matching.length)}</strong> {filtersActive ? 'matching' : matching.length === 1 ? 'contact' : 'contacts'}
              <span className="text-slate-400"> · </span>
              <strong className="font-semibold text-[#008069] dark:text-emerald-400">{number(summary.selectedVisible)}</strong> ticked
            </span>
          </label>

          <div className="flex items-center gap-2 flex-wrap">
            <div role="group" aria-label="Which contacts to list" className="inline-flex p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
              {([
                { id: 'all', label: 'All' },
                { id: 'selected', label: 'Ticked' },
                { id: 'unselected', label: 'Not ticked' },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                  className={`h-7 px-2.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    view === option.id ? 'bg-white dark:bg-[#2a3942] text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {allMatchingSelected ? (
              <button type="button" onClick={removeMatching} className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                Untick {filtersActive ? `these ${number(matching.length)}` : 'all'}
              </button>
            ) : (
              <button type="button" onClick={addMatching} disabled={matching.length === 0 || waitingForLogs} className="h-8 px-3 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <Check size={13} />
                {filtersActive ? `Tick all ${number(matching.length)} matching` : `Tick all ${number(matching.length)}`}
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500">
              <Loader2 className="animate-spin text-[#00a884]" size={22} />
              <span className="text-[13px]">Loading your contacts…</span>
            </div>
          ) : contacts.length === 0 ? (
            <EmptyRows title="No contacts in your CRM yet" detail="Add contacts first, or go back and upload a spreadsheet instead.">
              <button type="button" onClick={onReload} className="mt-3 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer">
                <RefreshCw size={12} /> Reload contacts
              </button>
            </EmptyRows>
          ) : waitingForLogs && participantsError ? (
            // Showing a list here would be a guess: without the logs nobody "received" anything
            <EmptyRows title="Could not check who received those campaigns" detail={participantsError}>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNeedParticipants(filters.campaigns.filter((id) => participantsByCampaign[id] === undefined))}
                  className="h-8 px-3 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw size={12} /> Try again
                </button>
                <button type="button" onClick={() => patch({ campaigns: [] })} className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                  Remove this filter
                </button>
              </div>
            </EmptyRows>
          ) : waitingForLogs ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500">
              <Loader2 className="animate-spin text-[#00a884]" size={22} />
              <span className="text-[13px]">Checking who received the chosen campaigns…</span>
            </div>
          ) : rows.length === 0 ? (
            <EmptyRows
              title={view === 'selected' ? 'No ticked contacts here' : view === 'unselected' ? 'Everyone listed is ticked' : 'No contacts match these filters'}
              detail={view !== 'all' ? 'Switch the list back to All to see everyone.' : 'Remove a filter or change the search to see more contacts.'}
            >
              <button type="button" onClick={() => (view !== 'all' ? setView('all') : clearFilters())} className="mt-3 h-8 px-3 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-semibold cursor-pointer">
                {view !== 'all' ? 'Show all' : 'Clear all filters'}
              </button>
            </EmptyRows>
          ) : (
            rows.slice(0, visibleCount).map((contact) => {
              const checked = selectedSet.has(contact.id)
              const reachable = isReachable(contact, channel)
              const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.phone_number || contact.email || 'Unnamed contact'
              const address = channel === 'email' ? contact.email : contact.phone_number
              const tags = getContactTags(contact)

              return (
                <label
                  key={contact.id}
                  className={`grid grid-cols-12 gap-x-3 gap-y-1 px-3 sm:px-4 py-2.5 items-center cursor-pointer select-none text-[13px] transition-colors ${
                    checked ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="col-span-12 sm:col-span-5 flex items-center gap-3 min-w-0">
                    <input type="checkbox" checked={checked} onChange={() => toggle(contact.id)} className="h-4 w-4 shrink-0 rounded accent-[#00a884] cursor-pointer" />
                    <div className="h-8 w-8 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#008069] dark:text-emerald-300 flex items-center justify-center font-semibold text-xs">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white truncate">{name}</p>
                      {contact.company && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{contact.company}</p>}
                    </div>
                  </div>

                  <div className="col-span-6 sm:col-span-3 pl-7 sm:pl-0 min-w-0">
                    {reachable ? (
                      <span className="font-mono text-xs text-slate-700 dark:text-slate-300 truncate block">{address}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400" title="This contact will be skipped">
                        <AlertTriangle size={12} />
                        {address ? `Invalid ${addressNoun}` : `No ${addressNoun}`}
                      </span>
                    )}
                  </div>

                  <div className="col-span-6 sm:col-span-4 flex items-center gap-1 flex-wrap justify-end sm:justify-start min-w-0">
                    {tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className={`text-[11px] px-1.5 py-0.5 rounded border max-w-[9rem] truncate ${
                          filters.tags.includes(tag) && filters.tagMode !== 'none'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-[#008069] dark:text-emerald-300 border-[#00a884]/30 font-semibold'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                    {tags.length > 3 && <span className="text-[11px] text-slate-400" title={tags.slice(3).join(', ')}>+{tags.length - 3}</span>}
                  </div>
                </label>
              )
            })
          )}
        </div>

        {!loading && !waitingForLogs && rows.length > 0 && (
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-[#152026] border-t border-slate-200 dark:border-[#2a3942] flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">
              Showing {number(Math.min(visibleCount, rows.length))} of {number(rows.length)}
            </span>
            {rows.length > visibleCount && (
              <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="h-7 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                Show {number(Math.min(PAGE_SIZE, rows.length - visibleCount))} more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MenuOption({ checked, onToggle, label, count, detail, muted }: { checked: boolean; onToggle: () => void; label: string; count?: number; detail?: string; muted?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 px-2 py-1.5 rounded-lg text-[13px] cursor-pointer select-none transition-colors ${checked ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#00a884] cursor-pointer" />
      <span className="flex-1 min-w-0">
        <span className={`block truncate ${muted ? 'italic text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'} ${checked ? 'font-semibold' : ''}`}>{label}</span>
        {detail && <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400 capitalize">{detail}</span>}
      </span>
      {count !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{count.toLocaleString()}</span>}
    </label>
  )
}

function Chip({ tone, onRemove, children }: { tone: 'slate' | 'emerald' | 'amber'; onRemove: () => void; children: React.ReactNode }) {
  const tones = {
    slate: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-[#008069] dark:text-emerald-300 border-[#00a884]/30',
    amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300/70 dark:border-amber-800',
  }
  return (
    <span className={`${chipClass} ${tones[tone]}`}>
      <span className="max-w-[12rem] truncate">{children}</span>
      <button type="button" aria-label="Remove this filter" onClick={onRemove} className="p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer">
        <X size={12} />
      </button>
    </span>
  )
}

function EmptyRows({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      <div className="h-11 w-11 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
        <Search size={20} />
      </div>
      <p className="text-sm font-semibold text-slate-800 dark:text-white">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{detail}</p>
      {children}
    </div>
  )
}
