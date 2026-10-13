'use client'

import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { 
  Megaphone, 
  Plus, 
  Loader2, 
  BarChart3, 
  Users, 
  CheckCircle, 
  AlertCircle, 
  Upload, 
  X, 
  ChevronRight, 
  ChevronLeft, 
  ArrowLeft, 
  RefreshCw, 
  Eye, 
  Phone, 
  Database,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ExternalLink,
  Copy,
  FileText,
  Play,
  Send,
  TrendingUp,
  Target,
  Square,
  RotateCcw,
  Calendar,
  Clock,
  Tag,
  Search,
  User,
  Filter,
  Check,
  CheckSquare,
  History,
  ChevronDown,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { useAlert, useConfirm } from '@/lib/dialog-context'
import { authSessionManager } from '@/lib/auth-context'
import { AudiencePicker, type PastCampaign } from '@/components/campaigns/audience-picker'
import { buildRecipientList, summarizeSelection, type RecipientList } from '@/lib/campaigns/audience'

interface Campaign {
  id: string
  name: string
  template_name: string
  template_body: string
  status: string
  total_contacts: number
  sent_count: number
  failed_count: number
  delivered_count?: number
  read_count?: number
  active_chats_count?: number
  unread_chats_count?: number
  reply_rate?: number
  created_at: string
  scheduled_at?: string | null
  channel?: string
  sender?: string
  subject?: string
}

/** Totals for every campaign of the organization, whatever page or filter the list is on. */
interface CampaignSummary {
  total: number
  scheduled: number
  sending: number
  completed: number
  failed: number
  stopped: number
  recipients: number
  sent: number
  failedMessages: number
}

interface CampaignLog {
  id: string
  phone_number: string | null
  email_address: string | null
  status: string
  error_message: string | null
  variables_mapped: Record<string, any>
  message_sid: string | null
  created_at: string
}

interface Template {
  sid: string
  name: string
  raw_name?: string
  whatsapp_template_name?: string
  body: string
  variables: string[]
  sampleValues?: Record<string, string>
  category: string
  language?: string
  approval_status?: string
  rejection_reason?: string | null
  isDbTemplate?: boolean
  source?: string
  components?: any[]
}

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  company: string | null
  email: string | null
  tags?: string[]
}

export default function CampaignsPage() {
  const router = useRouter()
  const alert = useAlert()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateFetchError, setTemplateFetchError] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  // Escape closes the wizard, after asking when there is work to lose (see requestCloseWizard)
  const requestCloseWizardRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!isCreateOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestCloseWizardRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCreateOpen])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [selectedCampaignLogs, setSelectedCampaignLogs] = useState<CampaignLog[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  // Add-template inline panel state
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const [newTplCategory, setNewTplCategory] = useState('UTILITY')
  const [newTplLanguage, setNewTplLanguage] = useState('en')
  const [newTplBody, setNewTplBody] = useState('')
  const [newTplSaving, setNewTplSaving] = useState(false)
  const [newTplError, setNewTplError] = useState('')

  // Campaigns list pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCampaignsCount, setTotalCampaignsCount] = useState(0)

  const [wizardStep, setWizardStep] = useState(1)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  
  // Dashboard Search & Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'sms' | 'email'>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  
  const [audienceSource, setAudienceSource] = useState<'db' | 'excel'>('excel')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelData, setExcelData] = useState<any[]>([])
  const [excelHeaders, setExcelHeaders] = useState<string[]>([])
  // Nobody is selected until the user ticks contacts: a bulk message should never default to "everyone"
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  
  // Mapping state: maps template placeholders "1", "2" to column names / attributes
  const [phoneColumn, setPhoneColumn] = useState('')
  const [contactNameColumn, setContactNameColumn] = useState('')
  const [contactLastNameColumn, setContactLastNameColumn] = useState('')
  const [contactTagColumn, setContactTagColumn] = useState('')
  const [customCampaignTag, setCustomCampaignTag] = useState('')
  const [variableMappings, setVariableMappings] = useState<Record<string, string>>({})
  const [variableMappingTypes, setVariableMappingTypes] = useState<Record<string, 'dynamic' | 'static'>>({})
  const [staticVariableValues, setStaticVariableValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Schedule-based marketing state in Indian Standard Time (IST - UTC+05:30)
  const [dispatchTiming, setDispatchTiming] = useState<'immediate' | 'scheduled'>('immediate')
  const [scheduledDateIST, setScheduledDateIST] = useState<string>('')
  const [scheduledTimeIST, setScheduledTimeIST] = useState<string>('')

  // Step 2, CRM audience: the past campaigns offered as a filter and who each of them was sent to.
  // The filters themselves live in <AudiencePicker>.
  const [allCampaignsList, setAllCampaignsList] = useState<PastCampaign[]>([])
  const [isLoadingAllCampaigns, setIsLoadingAllCampaigns] = useState(false)
  const [campaignParticipantsMap, setCampaignParticipantsMap] = useState<Record<string, string[] | undefined>>({})
  const [participantsError, setParticipantsError] = useState<string | null>(null)
  const participantsInFlightRef = useRef<Set<string>>(new Set())
  const [contactsError, setContactsError] = useState<string | null>(null)

  // Campaign list: totals for the whole organization, and the search as last sent to the server
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [listError, setListError] = useState<string | null>(null)
  const listRequestRef = useRef(0)

  // A campaign that was created but whose sending could not be started. Pressing Launch again
  // starts that one instead of creating a second copy.
  const createdCampaignIdRef = useRef<string | null>(null)

  // New multi-channel states
  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
    enable_sms: true,
  })
  const [channel, setChannel] = useState<'whatsapp' | 'sms' | 'email'>('whatsapp')
  const [sender, setSender] = useState('')
  const [subject, setSubject] = useState('')
  const [customMessageBody, setCustomMessageBody] = useState('')
  const [customVariables, setCustomVariables] = useState<string[]>([])
  const [availableSenders, setAvailableSenders] = useState<{
    smsSenders: Array<{ value: string; label: string }>
    whatsappSenders: Array<{ value: string; label: string }>
    emailSenders: Array<{ value: string; label: string }>
  }>({ smsSenders: [], whatsappSenders: [], emailSenders: [] })
  const [isLoadingSenders, setIsLoadingSenders] = useState(false)
  const [editorMode, setEditorMode] = useState<'visual' | 'code'>('visual')
  const [detailsPreviewMode, setDetailsPreviewMode] = useState<'preview' | 'raw'>('preview')
  const visualEditorRef = useRef<HTMLDivElement>(null)

  // Remounting the picker clears its filters when a new campaign is started
  const [audiencePickerKey, setAudiencePickerKey] = useState(0)

  // How many messages the ticked CRM contacts turn into (missing and repeated numbers removed)
  const crmSelection = useMemo(
    () => summarizeSelection(contacts, new Set(selectedContactIds), new Set<string>(), channel),
    [contacts, selectedContactIds, channel]
  )

  // The first ticked contact, used to preview the message with real values
  const crmSampleContact = useMemo(() => {
    const ticked = new Set(selectedContactIds)
    return contacts.find((c) => ticked.has(c.id)) || null
  }, [contacts, selectedContactIds])

  // The uploaded sheet checked against the chosen phone / email column
  const sheetCheck = useMemo<RecipientList | null>(() => {
    if (excelData.length === 0 || !phoneColumn) return null
    return buildRecipientList(excelData.map((row) => ({ address: row[phoneColumn], variables: {} })), channel)
  }, [excelData, phoneColumn, channel])

  // Sync state to visual editor element
  useEffect(() => {
    if (visualEditorRef.current && editorMode === 'visual') {
      if (visualEditorRef.current.innerHTML !== customMessageBody) {
        visualEditorRef.current.innerHTML = customMessageBody || ''
      }
    }
  }, [customMessageBody, editorMode])

  const handleVisualEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML
    handleCustomMessageBodyChange(html)
  }

  const handleCustomMessageBodyChange = (text: string) => {
    setCustomMessageBody(text)
    const matches = text.match(/\{\{([^}]+)\}\}/g) || []
    const uniqueVars = Array.from(new Set(matches.map(m => m.replace(/<[^>]*>/g, '').replace(/[\{\}]/g, ''))))
    uniqueVars.sort((a, b) => {
      const numA = parseInt(a)
      const numB = parseInt(b)
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB
      return a.localeCompare(b)
    })
    setCustomVariables(uniqueVars)
  }

  // Pre-populate message body when template selection changes
  useEffect(() => {
    if (selectedTemplate) {
      handleCustomMessageBodyChange(selectedTemplate.body)
    } else {
      handleCustomMessageBodyChange('')
    }
  }, [selectedTemplate])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<any>(null)
  const isMasterOrg = user?.organization_id === '303b7a2d-281c-403c-b794-54d1e195ca69'

  useEffect(() => {
    const loadFeaturesAndData = async () => {
      try {
        await restoreSupabaseSession()
        let userId: string | null = null
        const { data: { user: authUser } } = await supabase.auth.getUser()
        if (authUser) userId = authUser.id
        else {
          const storedUser = authSessionManager.getUser()
          if (storedUser?.id) userId = storedUser.id
        }
        if (userId) {
          const email = authUser?.email || authSessionManager.getUser()?.email || ''
          const userData = await ensureUserProfile(userId, email)
          if (userData) {
            setUser(userData)
            const { data: orgData } = await supabase
              .from('organizations')
              .select('enable_ai, enable_email, enable_messages, enable_phone_calls, enable_sms')
              .eq('id', userData.organization_id)
              .maybeSingle()
            if (orgData) {
              const isMaster = userData.organization_id === '303b7a2d-281c-403c-b794-54d1e195ca69'
              const enabledFeatures = {
                enable_ai: orgData.enable_ai !== false,
                enable_email: isMaster && orgData.enable_email !== false,
                enable_messages: orgData.enable_messages !== false,
                enable_phone_calls: isMaster && orgData.enable_phone_calls !== false,
                enable_sms: isMaster && orgData.enable_sms !== false,
              }
              setFeatures(enabledFeatures)
              if (!isMaster) {
                setChannel('whatsapp')
              } else if (!enabledFeatures.enable_messages && enabledFeatures.enable_email) {
                setChannel('email')
              }
            }
            const orgId = userData.organization_id
            fetchCampaigns(1, true, orgId)
            fetchTemplates(orgId)
            fetchSenders(orgId)
          }
        }
      } catch (err) {
        console.error('Error loading organization features:', err)
      }
    }

    loadFeaturesAndData()
  }, [])

  const fetchSenders = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    setIsLoadingSenders(true)
    try {
      const res = await fetch(`/api/campaigns/senders?organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        setAvailableSenders({
          smsSenders: data.smsSenders || [],
          whatsappSenders: data.whatsappSenders || [],
          emailSenders: data.emailSenders || []
        })
      }
    } catch (err) {
      console.error('Error fetching senders:', err)
    } finally {
      setIsLoadingSenders(false)
    }
  }

  // Auto-set default sender when channel or availableSenders change
  useEffect(() => {
    const senders =
      channel === 'whatsapp' ? availableSenders.whatsappSenders :
      channel === 'sms' ? availableSenders.smsSenders :
      availableSenders.emailSenders;
    if (senders && senders.length > 0) {
      setSender(senders[0].value)
    } else {
      setSender('')
    }
  }, [channel, availableSenders])

  // Auto-select first configured channel when availableSenders or features change
  useEffect(() => {
    if (!isMasterOrg) {
      setChannel('whatsapp')
      return
    }
    const channels: Array<'whatsapp' | 'sms' | 'email'> = []
    if (features.enable_messages && availableSenders.whatsappSenders.length > 0) {
      channels.push('whatsapp')
    }
    if (features.enable_messages && features.enable_sms && availableSenders.smsSenders.length > 0) {
      channels.push('sms')
    }
    if (features.enable_email && availableSenders.emailSenders.length > 0) {
      channels.push('email')
    }
    if (channels.length > 0 && !channels.includes(channel)) {
      setChannel(channels[0])
    }
  }, [availableSenders, features, channel, isMasterOrg])

  // Reset filterChannel if non-master attempts to filter by sms or email
  useEffect(() => {
    if (!isMasterOrg && (filterChannel === 'sms' || filterChannel === 'email')) {
      setFilterChannel('all')
    }
  }, [isMasterOrg, filterChannel])

  // Auto-polling for active campaigns
  useEffect(() => {
    const hasProcessing = campaigns.some(c => c.status === 'PROCESSING' || c.status === 'PENDING')
    if (!hasProcessing) return

    const interval = setInterval(() => {
      fetchCampaigns(currentPage, false)
      if (selectedCampaign && (selectedCampaign.status === 'PROCESSING' || selectedCampaign.status === 'PENDING')) {
        fetchCampaignDetails(selectedCampaign.id, false)
      }
    }, 4000)

    return () => clearInterval(interval)
  }, [campaigns, selectedCampaign, currentPage])

  // The search and filters are applied by the server across every campaign, not to the ten on screen.
  // They are read from a ref so the poller and the action handlers always ask for the current view.
  const listQueryRef = useRef({ search: '', channel: 'all', status: 'all' })
  listQueryRef.current = { search: debouncedSearch, channel: filterChannel, status: filterStatus }

  const fetchCampaigns = async (pageVal: number = 1, showLoader = true, orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    if (showLoader) setIsLoading(true)

    const requestId = ++listRequestRef.current
    const { search, channel: channelFilter, status: statusFilter } = listQueryRef.current
    const params = new URLSearchParams({ page: String(pageVal), limit: '10', organizationId: orgId })
    if (search.trim()) params.set('search', search.trim())
    if (channelFilter !== 'all') params.set('channel', channelFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)

    try {
      const res = await fetch(`/api/campaigns?${params.toString()}`)
      const data = await res.json()
      // A newer request (a later keystroke, another page) has been sent: this answer is out of date
      if (requestId !== listRequestRef.current) return
      if (!res.ok || !data.success) throw new Error(data.error || 'Campaigns could not be loaded.')

      setCampaigns(data.campaigns)
      setCurrentPage(data.pagination.page)
      setTotalPages(data.pagination.pages)
      setTotalCampaignsCount(data.pagination.total)
      if (data.summary) setSummary(data.summary)
      setListError(null)

      // The last campaign of the last page was removed or no longer matches: step back a page
      if (data.campaigns.length === 0 && data.pagination.total > 0 && pageVal > 1) {
        fetchCampaigns(Math.min(pageVal - 1, data.pagination.pages), showLoader, orgId)
      }
    } catch (err: any) {
      if (requestId !== listRequestRef.current) return
      console.error('Error fetching campaigns:', err)
      // A background refresh that fails keeps the list on screen; only a visible load reports it
      if (showLoader) setListError(err.message || 'Campaigns could not be loaded.')
    } finally {
      if (requestId === listRequestRef.current) setIsLoading(false)
    }
  }

  // Search as you type, without a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // A changed search or filter starts again from the first page
  const listFiltersInitialised = useRef(false)
  useEffect(() => {
    if (!user?.organization_id) return
    // The first run is the initial load, which loadFeaturesAndData has already started
    if (!listFiltersInitialised.current) {
      listFiltersInitialised.current = true
      return
    }
    fetchCampaigns(1, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filterChannel, filterStatus, user?.organization_id])

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Format any ISO date/time into Indian Standard Time (IST - UTC+05:30)
  const formatISTDateTime = (dateInput?: string | Date | null) => {
    if (!dateInput) return ''
    try {
      const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
      if (isNaN(d.getTime())) return String(dateInput)
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(d) + ' IST'
    } catch {
      return String(dateInput)
    }
  }

  // Get default scheduled date and time in IST (default: +30 minutes)
  const getISTDefaults = () => {
    const now = new Date()
    const future = new Date(now.getTime() + 30 * 60 * 1000)
    
    const formatterDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const dateStr = formatterDate.format(future) // YYYY-MM-DD
    
    const formatterTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    const timeStr = formatterTime.format(future) // HH:mm

    return { dateStr, timeStr }
  }

  // Past campaigns offered as an audience filter (names only; their recipients load when one is chosen)
  const fetchAllCampaigns = async () => {
    const orgId = user?.organization_id
    if (!orgId) return
    setIsLoadingAllCampaigns(true)
    try {
      const res = await fetch(`/api/campaigns?all=true&organizationId=${orgId}`)
      const data = await res.json()
      if (data.success && data.campaigns) {
        setAllCampaignsList(data.campaigns)
      }
    } catch (err) {
      console.error('Error fetching all campaigns for filter:', err)
    } finally {
      setIsLoadingAllCampaigns(false)
    }
  }

  // Load who the given past campaigns were sent to. Each campaign is requested once.
  const organizationIdForAudience = user?.organization_id
  const requestParticipants = useCallback((campaignIds: string[]) => {
    if (!organizationIdForAudience) return
    const wanted = campaignIds.filter((id) => !participantsInFlightRef.current.has(id))
    if (wanted.length === 0) return
    wanted.forEach((id) => participantsInFlightRef.current.add(id))
    setParticipantsError(null)

    fetch(`/api/campaigns/participants?campaignIds=${wanted.join(',')}&organizationId=${organizationIdForAudience}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) throw new Error(data.error || 'The recipients of the chosen campaigns could not be loaded.')
        const loaded: Record<string, string[]> = data.participantsByCampaign || {}
        setCampaignParticipantsMap((prev) => {
          const next = { ...prev }
          // Every requested campaign is marked as loaded, including one with no recipients
          for (const id of wanted) next[id] = loaded[id] || []
          return next
        })
      })
      .catch((err) => {
        console.error('Error fetching campaign participants:', err)
        // Left unloaded on purpose: a filter must not quietly behave as if nobody received the campaign
        setParticipantsError(err.message || 'The recipients of the chosen campaigns could not be loaded.')
      })
      .finally(() => wanted.forEach((id) => participantsInFlightRef.current.delete(id)))
  }, [organizationIdForAudience])

  // Scheduled Campaign Actions
  const handleSendNowScheduled = async (campaignId: string) => {
    setActionLoadingId(campaignId)
    try {
      const res = await fetch('/api/campaigns/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, action: 'send_now' })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to trigger campaign.')
      }
      await fetchCampaigns(currentPage, false)
      if (selectedCampaign?.id === campaignId) {
        await fetchCampaignDetails(campaignId, false)
      }
    } catch (err: any) {
      alert({ title: 'Campaign not sent', message: err.message || 'Error triggering scheduled campaign' })
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleCancelScheduled = async (campaignId: string) => {
    if (!(await confirm({ title: 'Cancel this scheduled campaign?', message: 'It will not be sent at its scheduled time.', confirmLabel: 'Cancel campaign', cancelLabel: 'Keep scheduled', destructive: true }))) return
    setActionLoadingId(campaignId)
    try {
      const res = await fetch('/api/campaigns/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, action: 'cancel_schedule' })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to cancel schedule.')
      }
      await fetchCampaigns(currentPage, false)
      if (selectedCampaign?.id === campaignId) {
        await fetchCampaignDetails(campaignId, false)
      }
    } catch (err: any) {
      alert({ title: 'Schedule not cancelled', message: err.message || 'Error cancelling schedule' })
    } finally {
      setActionLoadingId(null)
    }
  }

  // Background auto-trigger for scheduled campaigns due in IST
  useEffect(() => {
    const checkScheduledCampaigns = async () => {
      try {
        const res = await fetch('/api/campaigns/scheduled')
        const data = await res.json()
        if (data && data.triggeredCount > 0) {
          fetchCampaigns(currentPage, false)
        }
      } catch (err) {
        // silent background check
      }
    }

    checkScheduledCampaigns()
    const interval = setInterval(checkScheduledCampaigns, 25000)
    return () => clearInterval(interval)
  }, [currentPage])

  const handleStopCampaign = async (campaignId: string) => {
    if (!(await confirm({
      title: 'Stop this campaign?',
      message: 'Messages already sent stay sent. The contacts not reached yet will not get it; you can send to them later with Rerun.',
      confirmLabel: 'Stop sending',
      cancelLabel: 'Keep sending',
      destructive: true,
    }))) return
    setActionLoadingId(campaignId)
    try {
      const res = await fetch('/api/campaigns/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId })
      })
      const data = await res.json()
      if (data.success) {
        await fetchCampaigns(currentPage)
        if (selectedCampaign?.id === campaignId) {
          await fetchCampaignDetails(campaignId)
        }
      } else {
        alert({ title: 'Campaign not stopped', message: data.error || 'Failed to stop campaign' })
      }
    } catch (err: any) {
      console.error('Error stopping campaign:', err)
      alert({ title: 'Campaign not stopped', message: err.message || 'The campaign could not be stopped. Check your connection and try again.' })
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRerunCampaign = async (campaignId: string, rerunType: 'failed_only' | 'all' = 'failed_only') => {
    const target = campaigns.find((c) => c.id === campaignId) || (selectedCampaign?.id === campaignId ? selectedCampaign : null)
    const pending = target ? Math.max(0, target.total_contacts - target.sent_count) : 0
    if (!(await confirm(rerunType === 'all'
      ? {
          title: 'Send this campaign to everyone again?',
          message: `All ${target?.total_contacts ?? ''} recipients get the message again, including those who already received it.`.replace('  ', ' '),
          confirmLabel: 'Send to everyone again',
          destructive: true,
        }
      : {
          title: 'Send to the contacts who did not get it?',
          message: pending > 0
            ? `${pending} ${pending === 1 ? 'contact' : 'contacts'} failed or were not reached. They will be sent the message now. Contacts who already received it are not messaged again.`
            : 'Contacts whose message failed or was not sent will be tried again. Contacts who already received it are not messaged again.',
          confirmLabel: 'Send now',
        }
    ))) return
    setActionLoadingId(campaignId)
    try {
      const res = await fetch('/api/campaigns/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, rerunType })
      })
      const data = await res.json()
      if (data.success) {
        await fetchCampaigns(currentPage)
        if (selectedCampaign?.id === campaignId) {
          await fetchCampaignDetails(campaignId)
        }
      } else {
        alert({ title: 'Campaign not restarted', message: data.error || 'Failed to rerun campaign' })
      }
    } catch (err: any) {
      console.error('Error rerunning campaign:', err)
      alert({ title: 'Campaign not restarted', message: err.message || 'The campaign could not be restarted. Check your connection and try again.' })
    } finally {
      setActionLoadingId(null)
    }
  }

  const fetchTemplates = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    setTemplateFetchError(null)
    try {
      const res = await fetch(`/api/templates?organizationId=${orgId}&_t=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.error) {
        setTemplateFetchError(data.error)
      }
      if (data.templates) {
        setTemplates(data.templates)
      }
    } catch (err: any) {
      console.error('Error fetching templates:', err)
      setTemplateFetchError(err.message || 'Failed to load templates')
    }
  }

  const handleSaveNewTemplate = async () => {
    setNewTplError('')
    if (!newTplName.trim()) { setNewTplError('Template name is required.'); return }
    if (!newTplBody.trim()) { setNewTplError('Template body is required.'); return }
    setNewTplSaving(true)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: user?.organization_id,
          name: newTplName.trim().toLowerCase().replace(/\s+/g, '_'),
          category: newTplCategory,
          language: newTplLanguage,
          body: newTplBody.trim()
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setNewTplError(data.error || 'Failed to save template.')
        return
      }
      // Reload templates then auto-select the new one
      await fetchTemplates()
      setShowAddTemplate(false)
      setNewTplName('')
      setNewTplBody('')
      setNewTplCategory('UTILITY')
      setNewTplLanguage('en')
    } catch (err: any) {
      setNewTplError(err.message || 'Network error')
    } finally {
      setNewTplSaving(false)
    }
  }

  // The CRM contacts for the audience step. Only the columns the picker shows are downloaded.
  const fetchContacts = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    setIsLoadingContacts(true)
    setContactsError(null)
    try {
      const res = await fetch(`/api/contacts?all=true&fields=basic&organizationId=${orgId}`)
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Contacts could not be loaded.')
      const loadedContacts: Contact[] = data.contacts || []
      setContacts(loadedContacts)
      // Keep whatever was ticked; only drop ids of contacts that no longer exist
      const known = new Set(loadedContacts.map((c) => c.id))
      setSelectedContactIds((prev) => prev.filter((id) => known.has(id)))
    } catch (err: any) {
      console.error('Error fetching contacts:', err)
      setContactsError(err.message || 'Contacts could not be loaded.')
    } finally {
      setIsLoadingContacts(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchCampaigns(currentPage, false)
    setIsRefreshing(false)
  }

  const fetchCampaignDetails = async (campaignId: string, showLoader = true) => {
    if (showLoader) setIsLoadingLogs(true)
    try {
      const res = await fetch(`/api/campaigns?id=${campaignId}`)
      const data = await res.json()
      if (data.success) {
        setSelectedCampaign(data.campaign)
        setSelectedCampaignLogs(data.logs)
        setDetailsPreviewMode('preview')
      }
    } catch (err) {
      console.error('Error fetching campaign details:', err)
    } finally {
      setIsLoadingLogs(false)
    }
  }

  const handleDownloadLogsReport = () => {
    if (!selectedCampaign || selectedCampaignLogs.length === 0) return

    // Format log records for the spreadsheet
    const reportData = selectedCampaignLogs.map((log) => {
      const variables = Object.entries(log.variables_mapped || {})
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')

      return {
        Recipient: selectedCampaign.channel === 'email' 
          ? (log.email_address || log.phone_number || '-') 
          : (log.phone_number || log.email_address || '-'),
        Status: log.status,
        'Message SID / ID': log.message_sid || '-',
        'Variables Mapped': variables,
        'Error / Details': log.error_message || '-',
        'Sent At': new Date(log.created_at).toLocaleString()
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(reportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Delivery Logs')

    // Save and download file
    const fileName = `${selectedCampaign.name.toLowerCase().replace(/\s+/g, '_')}_delivery_logs.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  // Helper to strictly identify phone number column (excluding any column with 'name')
  const isPhoneHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    if (/name/i.test(h)) return false // Exclude Contact Name, Customer Name, Full Name, etc.
    return (
      /phone|mobile|cell|tel|whatsapp/i.test(h) ||
      /contact.*(num|no|#)/i.test(h) ||
      /phone.*(num|no|#)/i.test(h) ||
      /mobile.*(num|no|#)/i.test(h) ||
      /^(phone|mobile|cell|tel|whatsapp|contact_no|phone_no|mobile_no)$/i.test(h)
    )
  }

  const isNameHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    return (
      /^(contact\s*name|first\s*name|customer\s*name|patient\s*name|full\s*name|client\s*name|name)$/i.test(h) ||
      /contact.*name|first.*name|customer.*name|patient.*name|full.*name|client.*name|^name$/i.test(h)
    )
  }

  const isLastNameHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    return /^(last\s*name|surname)$/i.test(h) || /last.*name|surname/i.test(h)
  }

  const isTagHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    return /^(tag|tags|category|group|segment|label)$/i.test(h) || /tag|category|segment/i.test(h)
  }

  // Helper to auto-map template placeholders to Excel columns or Contact attributes
  const autoDetectVariableMappings = (
    variables: string[],
    headers: string[],
    sampleVals?: Record<string, string>
  ) => {
    const mappings: Record<string, string> = {}
    const types: Record<string, 'dynamic' | 'static'> = {}
    const statics: Record<string, string> = {}

    variables.forEach((v) => {
      const isMedia = v.includes('image_url') || v.includes('video_url') || v.includes('document_url') || v.includes('filename')
      types[v] = isMedia ? 'static' : 'dynamic'
      statics[v] = sampleVals?.[v] || ''
      mappings[v] = ''

      if (!isMedia && headers.length > 0) {
        const vClean = v.toLowerCase().trim()

        // 1. Placeholder 1 or First Name / Contact Name / Name
        if (vClean === '1' || /^(first_name|name|contact_name|customer_name|patient_name|full_name)$/i.test(vClean)) {
          const matchedNameHeader = 
            headers.find(h => /^(contact\s*name|first\s*name|customer\s*name|patient\s*name|full\s*name|client\s*name|name)$/i.test(h.trim())) ||
            headers.find(h => /contact.*name|first.*name|customer.*name|patient.*name|full.*name|client.*name|^name$/i.test(h.trim())) ||
            (headers.includes('first_name') ? 'first_name' : '')
          
          if (matchedNameHeader) {
            mappings[v] = matchedNameHeader
            types[v] = 'dynamic'
          }
        }
        // 2. Placeholder 2 or Last Name / Company / Date
        else if (vClean === '2' || /^(last_name|surname|company|date|location)$/i.test(vClean)) {
          const matchedSecondHeader = 
            headers.find(h => /^(last\s*name|surname)$/i.test(h.trim())) ||
            headers.find(h => /last.*name|surname/i.test(h.trim())) ||
            headers.find(h => /^(company|organization|org)$/i.test(h.trim())) ||
            headers.find(h => /company|organization|date|appointment|city|location/i.test(h.trim())) ||
            (headers.includes('last_name') ? 'last_name' : '')

          if (matchedSecondHeader) {
            mappings[v] = matchedSecondHeader
            types[v] = 'dynamic'
          }
        }
        // 3. Placeholder 3+ or other named variables
        else {
          const exactMatch = headers.find(h => h.trim().toLowerCase() === vClean)
          if (exactMatch) {
            mappings[v] = exactMatch
            types[v] = 'dynamic'
          } else {
            const partialMatch = headers.find(h => h.trim().toLowerCase().includes(vClean) || vClean.includes(h.trim().toLowerCase()))
            if (partialMatch) {
              mappings[v] = partialMatch
              types[v] = 'dynamic'
            }
          }
        }
      }
    })

    return { mappings, types, statics }
  }

  // Handle Excel File Drop/Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setExcelFile(file)
    setErrorMsg('')

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(worksheet)
        
        if (json.length === 0) {
          setErrorMsg('The Excel sheet appears to be empty.')
          return
        }

        setExcelData(json)
        const headers = Object.keys(json[0] || {})
        setExcelHeaders(headers)
        
        // Auto-select phone or email column with strict keyword matching
        if (channel === 'email') {
          const emailKey = headers.find(h => /email|mail|e-mail/i.test(h.trim())) || ''
          setPhoneColumn(emailKey)
        } else {
          const phoneKey = headers.find(isPhoneHeader) || ''
          setPhoneColumn(phoneKey)
        }

        // Auto-detect Name, Last Name, and Tag columns
        const nameKey = headers.find(isNameHeader) || ''
        setContactNameColumn(nameKey)

        const lastNameKey = headers.find(isLastNameHeader) || ''
        setContactLastNameColumn(lastNameKey)

        const tagKey = headers.find(isTagHeader) || ''
        setContactTagColumn(tagKey)

        // Auto-detect variable mappings immediately for active template/variables
        const variablesToMap = channel === 'whatsapp' ? (selectedTemplate?.variables || []) : customVariables
        if (variablesToMap.length > 0) {
          const { mappings, types, statics } = autoDetectVariableMappings(
            variablesToMap,
            headers,
            selectedTemplate?.sampleValues
          )
          setVariableMappings(mappings)
          setVariableMappingTypes(types)
          setStaticVariableValues(statics)
        }
      } catch (err) {
        console.error(err)
        setErrorMsg('Failed to parse Excel file. Ensure it is a valid .xlsx or .xls sheet.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const resetWizard = () => {
    setWizardStep(1)
    setNewCampaignName('')
    setSelectedTemplate(null)
    setAudienceSource('excel')
    setExcelFile(null)
    setExcelData([])
    setExcelHeaders([])
    setPhoneColumn('')
    setContactNameColumn('')
    setContactLastNameColumn('')
    setContactTagColumn('')
    setCustomCampaignTag('')
    setSelectedContactIds([])
    setVariableMappings({})
    setVariableMappingTypes({})
    setStaticVariableValues({})
    setErrorMsg('')
    createdCampaignIdRef.current = null
    setChannel('whatsapp')
    setSender('')
    setSubject('')
    setCustomMessageBody('')
    setCustomVariables([])
    setEditorMode('visual')
    setDispatchTiming('immediate')
    setScheduledDateIST('')
    setScheduledTimeIST('')
    setAudiencePickerKey((key) => key + 1)
  }

  const startNewCampaign = () => {
    resetWizard()
    setIsCreateOpen(true)
    fetchAllCampaigns()
    fetchContacts()
  }

  /** Close the wizard. Asks first when the user has already put work into it. */
  const requestCloseWizard = async () => {
    if (isSubmitting) return
    const hasWork = Boolean(newCampaignName.trim() || selectedTemplate || customMessageBody.trim() || excelData.length > 0 || selectedContactIds.length > 0)
    if (hasWork && !(await confirm({
      title: 'Discard this campaign?',
      message: 'The name, message and audience you have set up will be lost.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    }))) return
    setIsCreateOpen(false)
  }
  requestCloseWizardRef.current = requestCloseWizard

  const handleNextStep = () => {
    if (wizardStep === 1) {
      if (!newCampaignName.trim()) {
        setErrorMsg('Please specify a campaign name.')
        return
      }
      if (!sender.trim()) {
        setErrorMsg('Please select or write a sender.')
        return
      }
      if (channel === 'email' && !subject.trim()) {
        setErrorMsg('Please specify an email subject line.')
        return
      }
      if (channel === 'whatsapp' && !selectedTemplate) {
        setErrorMsg('Please select an approved template.')
        return
      }
      if ((channel === 'sms' || channel === 'email') && !customMessageBody.trim()) {
        setErrorMsg('Please specify a message body.')
        return
      }
      setErrorMsg('')
      setWizardStep(2)
    } else if (wizardStep === 2) {
      if (audienceSource === 'excel') {
        if (excelData.length === 0) {
          setErrorMsg('Please upload a valid Excel or CSV sheet.')
          return
        }
        if (!phoneColumn) {
          setErrorMsg(channel === 'email' ? 'Please select the column mapping to the recipient email address.' : 'Please select the column mapping to the recipient phone number.')
          return
        }
        if (sheetCheck && sheetCheck.recipients.length === 0) {
          setErrorMsg(channel === 'email'
            ? `No valid email addresses were found in the "${phoneColumn}" column. Choose a different column.`
            : `No valid phone numbers were found in the "${phoneColumn}" column. Choose a different column.`)
          return
        }
      } else {
        if (isLoadingContacts) {
          setErrorMsg('Your contacts are still loading. Try again in a moment.')
          return
        }
        if (contacts.length === 0) {
          setErrorMsg('No contacts found in database. Create contacts first or upload Excel.')
          return
        }
        if (selectedContactIds.length === 0) {
          setErrorMsg('Tick at least one contact to send this campaign to.')
          return
        }
        if (crmSelection.recipients === 0) {
          setErrorMsg(channel === 'email'
            ? 'None of the ticked contacts has a valid email address.'
            : 'None of the ticked contacts has a valid phone number.')
          return
        }
      }
      setErrorMsg('')
      
      // Auto-detect mappings when proceeding to Step 3
      const variablesToMap = channel === 'whatsapp'
        ? (selectedTemplate?.variables || [])
        : customVariables;
      
      const headersToUse = audienceSource === 'excel' 
        ? excelHeaders 
        : ['first_name', 'last_name', 'company', 'email', 'phone_number']

      const { mappings, types, statics } = autoDetectVariableMappings(
        variablesToMap,
        headersToUse,
        selectedTemplate?.sampleValues
      )

      // Cleanly isolate mappings ONLY for variables in the active template
      const currentMappings: Record<string, string> = {}
      const currentTypes: Record<string, 'dynamic' | 'static'> = {}
      const currentStatics: Record<string, string> = {}

      variablesToMap.forEach(v => {
        currentMappings[v] = variableMappings[v] || mappings[v] || ''
        currentTypes[v] = variableMappingTypes[v] || types[v] || 'dynamic'
        currentStatics[v] = staticVariableValues[v] || statics[v] || ''
      })

      setVariableMappings(currentMappings)
      setVariableMappingTypes(currentTypes)
      setStaticVariableValues(currentStatics)
      setWizardStep(3)
    } else if (wizardStep === 3) {
      const variablesToMap = channel === 'whatsapp'
        ? (selectedTemplate?.variables || [])
        : customVariables;

      // Validate mapping completed ONLY for variables in the active template!
      const unmapped = variablesToMap.filter(tplVar => {
        const type = variableMappingTypes[tplVar] || 'dynamic'
        if (type === 'static') {
          return !staticVariableValues[tplVar]?.trim()
        } else {
          return !variableMappings[tplVar]
        }
      })
      if (unmapped.length > 0) {
        setErrorMsg('Please complete all variable mappings or static values before proceeding.')
        return
      }
      setErrorMsg('')
      setWizardStep(4)
    }
  }

  const handlePrevStep = () => {
    setErrorMsg('')
    setWizardStep(prev => prev - 1)
  }

  // The list that is sent: one entry per valid, distinct phone number or email.
  // `invalid` and `duplicates` say how many rows were left out and why.
  const compileAudience = (): RecipientList => {
    const variablesToMap = channel === 'whatsapp'
      ? (selectedTemplate?.variables || [])
      : customVariables;

    if (audienceSource === 'excel') {
      const rows = excelData.map(row => {
        const variables: Record<string, string> = {}
        variablesToMap.forEach(tplVar => {
          const type = variableMappingTypes[tplVar] || 'dynamic'
          if (type === 'static') {
            variables[tplVar] = staticVariableValues[tplVar] || ''
          } else {
            const colName = variableMappings[tplVar]
            variables[tplVar] = String(row[colName] ?? '')
          }
        })
        // Attach contact name, last name, and tags so CRM contacts save accurately
        if (contactNameColumn && row[contactNameColumn]) {
          variables['first_name'] = String(row[contactNameColumn] || '').trim()
          variables['contact_name'] = String(row[contactNameColumn] || '').trim()
          variables['name'] = String(row[contactNameColumn] || '').trim()
        }
        if (contactLastNameColumn && row[contactLastNameColumn]) {
          variables['last_name'] = String(row[contactLastNameColumn] || '').trim()
        }
        if (contactTagColumn && row[contactTagColumn]) {
          variables['tag'] = String(row[contactTagColumn] || '').trim()
          variables['tags'] = String(row[contactTagColumn] || '').trim()
        } else if (customCampaignTag) {
          variables['tag'] = customCampaignTag.trim()
          variables['tags'] = customCampaignTag.trim()
        }

        return { address: row[phoneColumn], variables }
      })
      return buildRecipientList(rows, channel)
    }

    // Database contacts mapping
    const selectedIdSet = new Set(selectedContactIds)
    const rows = contacts.filter(c => selectedIdSet.has(c.id)).map(c => {
      const variables: Record<string, string> = {}
      variablesToMap.forEach(tplVar => {
        const type = variableMappingTypes[tplVar] || 'dynamic'
        if (type === 'static') {
          variables[tplVar] = staticVariableValues[tplVar] || ''
        } else {
          const attr = variableMappings[tplVar]
          const key = attr as keyof Contact
          variables[tplVar] = String(c[key] || '')
        }
      })

      // Ensure default variables are always populated from contact fields if not explicitly mapped
      const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.first_name || 'Valued Customer'
      if (variablesToMap.includes('1') && !variables['1']) variables['1'] = c.first_name || fullName
      if (!variables['name']) variables['name'] = c.first_name || fullName
      if (!variables['first_name']) variables['first_name'] = c.first_name || fullName
      if (!variables['contact_name']) variables['contact_name'] = fullName
      if (!variables['2'] && c.last_name) variables['2'] = c.last_name
      if (!variables['last_name'] && c.last_name) variables['last_name'] = c.last_name
      if (c.company && !variables['company']) variables['company'] = c.company
      if (Array.isArray(c.tags) && c.tags.length > 0 && !variables['tag']) variables['tag'] = c.tags.join(', ')

      return { address: channel === 'email' ? c.email : c.phone_number, variables }
    })
    return buildRecipientList(rows, channel)
  }

  // What the review step shows: the real number of messages, not the number of rows or ticks
  const reviewAudience = wizardStep === 4 ? compileAudience() : null
  const reviewRecipientCount = reviewAudience ? reviewAudience.recipients.length : 0

  const handleLaunchCampaign = async () => {
    setIsSubmitting(true)
    setErrorMsg('')
    
    try {
      const audienceList = compileAudience().recipients

      if (audienceList.length === 0) {
        setErrorMsg(channel === 'email'
          ? 'There is nobody to send to: no selected recipient has a valid email address.'
          : 'There is nobody to send to: no selected recipient has a valid phone number.')
        setIsSubmitting(false)
        return
      }

      let scheduledIso: string | null = null
      if (dispatchTiming === 'scheduled') {
        if (!scheduledDateIST || !scheduledTimeIST) {
          setErrorMsg('Please specify both dispatch date and time in Indian Standard Time (IST).')
          setIsSubmitting(false)
          return
        }

        // IST is strictly UTC+05:30
        const parsedScheduledIST = new Date(`${scheduledDateIST}T${scheduledTimeIST}:00+05:30`)
        if (isNaN(parsedScheduledIST.getTime())) {
          setErrorMsg('Invalid scheduled date or time selected.')
          setIsSubmitting(false)
          return
        }

        const now = Date.now()
        if (parsedScheduledIST.getTime() <= now + 2 * 60 * 1000) {
          setErrorMsg('Scheduled time in IST must be in the future (at least 2 minutes from now).')
          setIsSubmitting(false)
          return
        }

        scheduledIso = parsedScheduledIST.toISOString()
      }

      // 1. Create the campaign, unless an earlier attempt already did and only failed to start it
      let campaignId = createdCampaignIdRef.current
      if (!campaignId) {
      const effectiveTemplateBody = customMessageBody || selectedTemplate?.body || (channel === 'whatsapp' ? (selectedTemplate?.whatsapp_template_name || selectedTemplate?.name || 'custom_message') : 'Campaign Message')
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCampaignName,
          templateName: selectedTemplate?.whatsapp_template_name || selectedTemplate?.raw_name || selectedTemplate?.name?.split('•')[0]?.trim() || 'custom_message',
          templateBody: effectiveTemplateBody,
          templateSid: selectedTemplate?.sid || null,
          templateLanguage: selectedTemplate?.language || 'en',
          audience: audienceList,
          channel,
          sender,
          subject: channel === 'email' ? subject : undefined,
          organizationId: user?.organization_id || undefined,
          createdBy: user?.id || undefined,
          scheduledAt: scheduledIso
        })
      })

      const createData = await createRes.json()
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create campaign record.')
      }

      campaignId = createData.campaign.id as string
      createdCampaignIdRef.current = campaignId
      }

      // 2. Trigger asynchronous background run API ONLY if immediate dispatch
      if (dispatchTiming === 'immediate') {
        const runRes = await fetch('/api/campaigns/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId })
        })

        const runData = await runRes.json()
        if (!runRes.ok || !runData.success) {
          console.error('Trigger running error, but campaign record was created:', runData)
          throw new Error(`${runData.error || 'The campaign was saved but sending could not be started.'} Press Launch again to start it; a second campaign will not be created.`)
        }
      }

      createdCampaignIdRef.current = null
      setIsCreateOpen(false)
      fetchCampaigns(1, true)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An unexpected error occurred during dispatch.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getPreviewMessage = () => {
    let preview = customMessageBody
    if (!preview) return ''
    
    const variablesToMap = channel === 'whatsapp' 
      ? (selectedTemplate?.variables || []) 
      : customVariables;

    // Preview with first row/contact
    if (audienceSource === 'excel' && excelData.length > 0) {
      Object.keys(variableMappingTypes).forEach(tplVar => {
        const type = variableMappingTypes[tplVar]
        let val = ''
        if (type === 'static') {
          val = staticVariableValues[tplVar] || ''
        } else {
          const colName = variableMappings[tplVar]
          val = excelData[0][colName] || `[${colName}]`
        }
        preview = preview.replace(new RegExp(`\\{\\{${tplVar}\\}\\}`, 'g'), String(val))
      })
    } else if (audienceSource === 'db' && crmSampleContact) {
      // The first ticked contact is the sample
      const sampleContact = crmSampleContact
      Object.keys(variableMappingTypes).forEach(tplVar => {
        const type = variableMappingTypes[tplVar]
        let val = ''
        if (type === 'static') {
          val = staticVariableValues[tplVar] || ''
        } else {
          const attr = variableMappings[tplVar]
          const rawVal = sampleContact[attr as keyof Contact]
          val = Array.isArray(rawVal) ? rawVal.join(', ') : (String(rawVal || '') || `[${attr}]`)
        }
        preview = preview.replace(new RegExp(`\\{\\{${tplVar}\\}\\}`, 'g'), String(val))
      })
    } else {
      // Default fallback placeholders
      variablesToMap.forEach(v => {
        const type = variableMappingTypes[v]
        const val = type === 'static' ? (staticVariableValues[v] || `[Static ${v}]`) : `[Value ${v}]`
        preview = preview.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), val)
      })
    }
    return preview
  }

  // Totals cover every campaign of the organization (from the server), not just the page on screen
  const totalSent = summary?.sent ?? 0
  const totalFailed = summary?.failedMessages ?? 0
  const totalRecipients = summary?.recipients ?? 0
  const successRate = totalSent + totalFailed > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 0
  const listIsFiltered = Boolean(debouncedSearch.trim()) || filterChannel !== 'all' || filterStatus !== 'all'
  const clearListFilters = () => {
    setSearchTerm('')
    setFilterChannel('all')
    setFilterStatus('all')
  }

  // Sub-renderers for clean structure and to avoid truncation errors
  const renderHeader = () => (
    <div className="bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#2a3942] px-4 py-4 md:px-6 flex-shrink-0">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-[#00a884]/10 text-[#008069] dark:text-emerald-400 flex items-center justify-center">
            <Megaphone size={19} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-[#111b21] dark:text-white tracking-tight">Campaigns</h1>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate">
              {summary
                ? `${summary.total} ${summary.total === 1 ? 'campaign' : 'campaigns'} · ${summary.sending} sending · ${summary.scheduled} scheduled · ${summary.completed} completed`
                : 'Send one message to many contacts on WhatsApp'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh the list"
            aria-label="Refresh the list"
            className="h-9 w-9 sm:w-auto sm:px-3 bg-white dark:bg-[#202d36] hover:bg-slate-50 dark:hover:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-lg text-[#54656f] dark:text-slate-300 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={startNewCampaign}
            className="h-9 px-3.5 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white flex items-center gap-1.5 text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>New campaign</span>
          </button>
        </div>
      </div>
    </div>
  )

  const renderStatsGrid = () => {
    // Without the totals query (no direct database connection) there is nothing honest to show
    if (!summary) return null
    const stats = [
      { label: 'Recipients', value: totalRecipients.toLocaleString(), note: 'Across all campaigns', icon: Target, tone: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
      { label: 'Messages sent', value: totalSent.toLocaleString(), note: 'Accepted by the provider', icon: Send, tone: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400' },
      { label: 'Failed', value: totalFailed.toLocaleString(), note: totalFailed > 0 ? 'Use Rerun on a campaign to retry' : 'Nothing to retry', icon: AlertCircle, tone: 'bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400' },
      { label: 'Success rate', value: totalSent + totalFailed > 0 ? `${successRate}%` : '—', note: 'Sent out of sent + failed', icon: TrendingUp, tone: 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400' },
    ]
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(({ label, value, note, icon: Icon, tone }) => (
          <div key={label} className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
              <Icon size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#667781] dark:text-[#8696a0] truncate">{label}</p>
              <p className="text-xl font-bold tabular-nums text-[#111b21] dark:text-white leading-tight">{value}</p>
              <p className="text-[11px] text-[#8696a0] truncate">{note}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderFiltersBar = () => (
    <div className="bg-white dark:bg-[#1f2c34] p-2.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] flex flex-col md:flex-row md:items-center justify-between gap-2.5">
      <div className="relative flex-1 md:max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0] pointer-events-none" />
        <input
          type="text"
          inputMode="search"
          aria-label="Search campaigns"
          placeholder="Search by campaign or template name"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full h-9 pl-9 pr-9 bg-slate-50 dark:bg-[#202d36]/40 border border-[#e9edef] dark:border-slate-700 rounded-lg text-[13px] focus:outline-none focus:border-[#00a884] focus:ring-2 focus:ring-[#00a884]/20 text-[#111b21] dark:text-white placeholder-[#8696a0]"
        />
        {searchTerm && (
          <button type="button" aria-label="Clear search" onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-[#8696a0] hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Channel only matters when more than WhatsApp is switched on */}
        {isMasterOrg && (features.enable_sms || features.enable_email) && (
          <div role="group" aria-label="Filter by channel" className="flex bg-slate-100 dark:bg-[#202d36] p-0.5 rounded-lg">
            {[
              { value: 'all', label: 'All channels' },
              { value: 'whatsapp', label: 'WhatsApp' },
              ...(features.enable_sms ? [{ value: 'sms', label: 'SMS' }] : []),
              ...(features.enable_email ? [{ value: 'email', label: 'Email' }] : [])
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={filterChannel === opt.value}
                onClick={() => setFilterChannel(opt.value as any)}
                className={`h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  filterChannel === opt.value
                    ? 'bg-white dark:bg-[#2a3942] text-[#008069] dark:text-emerald-400 shadow-sm'
                    : 'text-[#667781] dark:text-[#8696a0]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        <select
          aria-label="Filter by status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={`h-9 px-2.5 border rounded-lg text-xs font-semibold cursor-pointer focus:outline-none focus:border-[#00a884] ${
            filterStatus !== 'all'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-[#00a884] text-[#008069] dark:text-emerald-300'
              : 'bg-slate-50 dark:bg-[#202d36] border-[#e9edef] dark:border-slate-700 text-[#111b21] dark:text-white'
          }`}
        >
          <option value="all">All statuses</option>
          <option value="sending">Sending{summary ? ` (${summary.sending})` : ''}</option>
          <option value="scheduled">Scheduled{summary ? ` (${summary.scheduled})` : ''}</option>
          <option value="completed">Completed{summary ? ` (${summary.completed})` : ''}</option>
          <option value="failed">Failed{summary ? ` (${summary.failed})` : ''}</option>
          <option value="stopped">Stopped or cancelled{summary ? ` (${summary.stopped})` : ''}</option>
        </select>
        {listIsFiltered && (
          <button type="button" onClick={clearListFilters} className="h-9 px-2.5 text-xs font-semibold text-[#667781] dark:text-[#8696a0] hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer">
            Clear
          </button>
        )}
      </div>
    </div>
  )

  const renderCampaignList = () => (
    <div className="space-y-3.5">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl shadow-xs">
          <Loader2 className="animate-spin text-[#00a884] mb-2" size={24} />
          <span className="text-xs text-[#8696a0]">Loading campaign records...</span>
        </div>
      ) : listError ? (
        <div role="alert" className="flex flex-col items-center justify-center text-center p-10 bg-white dark:bg-[#1f2c34] border border-rose-200 dark:border-rose-900/50 rounded-xl">
          <AlertCircle className="text-rose-500 mb-2" size={24} />
          <p className="font-semibold text-sm text-[#111b21] dark:text-white">The campaign list could not be loaded</p>
          <p className="text-xs mt-1 text-[#667781] dark:text-[#8696a0] max-w-md break-words">{listError}</p>
          <button type="button" onClick={() => fetchCampaigns(currentPage, true)} className="mt-3 h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center p-12 py-16 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl">
          <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 text-[#8696a0] flex items-center justify-center mb-3">
            {listIsFiltered ? <Search size={22} /> : <Megaphone size={22} />}
          </div>
          {listIsFiltered ? (
            <>
              <p className="font-semibold text-sm text-[#111b21] dark:text-white">No campaigns match</p>
              <p className="text-xs mt-1 text-[#667781] dark:text-[#8696a0]">Nothing fits this search and these filters, across all {summary?.total ?? ''} campaigns.</p>
              <button type="button" onClick={clearListFilters} className="mt-3 text-xs font-bold text-[#008069] dark:text-emerald-400 hover:underline cursor-pointer">Clear search and filters</button>
            </>
          ) : (
            <>
              <p className="font-semibold text-sm text-[#111b21] dark:text-white">No campaigns yet</p>
              <p className="text-xs mt-1 text-[#667781] dark:text-[#8696a0] max-w-sm">Pick an approved template, choose who gets it, and send now or schedule it.</p>
              <button type="button" onClick={startNewCampaign} className="mt-4 h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                <Plus size={15} strokeWidth={2.5} /> Create your first campaign
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4.5 sm:gap-5">
          {campaigns.map((c) => {
            const isProcessing = c.status === 'PROCESSING' || c.status === 'PENDING'
            const progressPct = c.total_contacts > 0 ? Math.round(((c.sent_count + c.failed_count) / c.total_contacts) * 100) : 0
            
            const channelIcon = (() => {
              const chan = c.channel || 'whatsapp'
              if (chan === 'email') return <Mail size={13} className="text-blue-600" />
              if (chan === 'sms') return <MessageSquare size={13} className="text-amber-600" />
              return <Phone size={13} className="text-[#008069]" />
            })()

            const channelBadgeColor = (() => {
              const chan = c.channel || 'whatsapp'
              if (chan === 'email') return 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 border-blue-100 dark:border-blue-900/30'
              if (chan === 'sms') return 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 border-amber-100 dark:border-amber-900/30'
              return 'bg-[#e7f7f4] dark:bg-emerald-950/20 text-[#008069] border-[#00a884]/20'
            })()

            return (
              <div 
                key={c.id}
                onClick={() => router.push(`/dashboard/campaigns/${c.id}`)}
                className="group relative bg-white dark:bg-[#1c282f] p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between gap-4 overflow-hidden"
              >
                {/* Left Status Accent Indicator Strip */}
                <div 
                  className={`absolute left-0 top-0 bottom-0 w-1.5 transition-colors ${
                    c.status === 'COMPLETED' ? 'bg-emerald-500' :
                    c.status === 'PROCESSING' || c.status === 'PENDING' ? 'bg-amber-400' :
                    c.status === 'SCHEDULED' ? 'bg-indigo-500' :
                    c.status === 'STOPPED' || c.status === 'CANCELLED' ? 'bg-rose-500' :
                    c.status === 'FAILED' ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`} 
                />

                {/* ROW 1: Header (Channel Avatar + Identity + Status + Active Replies) */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3.5 pl-1.5">
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 border ${channelBadgeColor} shadow-2xs group-hover:scale-105 group-hover:shadow-sm transition-all duration-200 mt-0.5`}>
                      {channelIcon}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Campaign Title & Status Badge */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="font-bold text-base sm:text-lg text-[#111b21] dark:text-white truncate group-hover:text-[#008069] dark:group-hover:text-emerald-400 transition-colors">
                          {c.name}
                        </h3>

                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1.5 shrink-0 ${
                          c.status === 'COMPLETED' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/60' :
                          isProcessing ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60' :
                          c.status === 'SCHEDULED' ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60' :
                          c.status === 'STOPPED' || c.status === 'CANCELLED' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/60' :
                          c.status === 'FAILED' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 border-red-200' :
                          'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200'
                        }`}>
                          {c.status === 'SCHEDULED' && <Calendar size={11} />}
                          <span>{c.status === 'PROCESSING' || c.status === 'PENDING' ? 'Sending' : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</span>
                        </span>
                      </div>

                      {/* Template & Timestamp Row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8696a0]">
                        <span className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 px-2 py-0.5 rounded-lg text-slate-600 dark:text-slate-300 font-medium">
                          <Tag size={11} className="text-[#8696a0] shrink-0" />
                          <span className="text-[#8696a0]">Template:</span>
                          <strong className="font-semibold truncate max-w-[200px]">{c.template_name}</strong>
                        </span>

                        <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                          <Clock size={11} className="text-[#8696a0] shrink-0" />
                          <span>{new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </span>

                        {c.status === 'SCHEDULED' && c.scheduled_at && (
                          <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
                            <Clock size={11} />
                            <span>Scheduled: {formatISTDateTime(c.scheduled_at)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Active Replies Live Pill */}
                  <div className="shrink-0 flex items-center sm:self-start">
                    {(c.active_chats_count ?? 0) > 0 ? (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-[#008069] dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-800 shadow-2xs">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        <MessageSquare size={13} className="fill-current text-[#008069] dark:text-emerald-400 shrink-0" />
                        <span>{c.active_chats_count} Active {c.active_chats_count === 1 ? 'Reply' : 'Replies'}</span>
                        {(c.unread_chats_count ?? 0) > 0 && (
                          <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-0.5">
                            {c.unread_chats_count} new
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-[#8696a0]/70 font-medium bg-slate-50 dark:bg-slate-800/40 border border-slate-200/40 dark:border-slate-800">
                        <MessageSquare size={12} />
                        <span>0 replies</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* ROW 2: Delivery Metrics & Progress Block */}
                <div className="space-y-3 bg-slate-50/80 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200/70 dark:border-slate-800/70 pl-2 sm:pl-4">
                  {/* Progress Header */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold uppercase tracking-wider text-[10px] text-[#8696a0]">
                        {isProcessing ? 'Sending now' : c.status === 'SCHEDULED' ? 'Not started' : 'Progress'}
                      </span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                        progressPct === 100 
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' 
                          : isProcessing
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 animate-pulse'
                          : 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}>
                        {progressPct}%
                      </span>
                    </div>

                    <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {c.sent_count + c.failed_count} <span className="text-slate-400 font-normal">of {c.total_contacts} processed</span>
                    </span>
                  </div>

                  {/* Progress Track */}
                  <div className="h-2.5 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-300/40 dark:border-slate-700/40">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        c.status === 'FAILED' ? 'bg-red-500' :
                        c.status === 'SCHEDULED' ? 'bg-indigo-500' :
                        isProcessing ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400 animate-pulse' :
                        'bg-gradient-to-r from-[#008069] via-emerald-500 to-teal-400'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {/* 4 Metric Chips Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                    <div className="bg-white dark:bg-[#1f2c34] px-3.5 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 shadow-2xs flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-[#8696a0] tracking-wider">Recipients</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{c.total_contacts}</span>
                    </div>

                    <div className="bg-white dark:bg-[#1f2c34] px-3.5 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 shadow-2xs flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>Sent</span>
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                        {c.sent_count}
                        {(c.read_count ?? 0) + (c.delivered_count ?? 0) > 0 && (
                          <span className="text-[11px] font-normal text-[#8696a0] ml-1">
                            ({(c.delivered_count ?? 0) + (c.read_count ?? 0)} delivered{(c.read_count ?? 0) > 0 ? `, ${c.read_count} read` : ''})
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="bg-white dark:bg-[#1f2c34] px-3.5 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 shadow-2xs flex flex-col">
                      <span className={`text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 ${c.failed_count > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[#8696a0]'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.failed_count > 0 ? 'bg-rose-500' : 'bg-slate-400'}`}></span>
                        <span>Failed</span>
                      </span>
                      <span className={`text-sm font-bold mt-0.5 ${c.failed_count > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{c.failed_count}</span>
                    </div>

                    <div className="bg-white dark:bg-[#1f2c34] px-3.5 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 shadow-2xs flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-[#008069] dark:text-emerald-400 tracking-wider flex items-center gap-1.5">
                        <MessageSquare size={11} className="fill-current" />
                        <span>Replies</span>
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                        {c.active_chats_count || 0}
                        {c.reply_rate !== undefined && (
                          <span className="text-[11px] font-normal text-[#8696a0] ml-1">({c.reply_rate}%)</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ROW 3: Dedicated Action Footer */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pl-1.5" onClick={(e) => e.stopPropagation()}>
                  {/* Left: Channel indicator label */}
                  <div className="flex items-center gap-2 text-xs text-[#8696a0]">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span className={`w-2 h-2 rounded-full ${
                        (c.channel || 'whatsapp') === 'whatsapp' ? 'bg-[#008069]' :
                        c.channel === 'sms' ? 'bg-amber-500' : 'bg-blue-500'
                      }`}></span>
                      <span className="capitalize">{(c.channel || 'whatsapp') === 'whatsapp' ? 'WhatsApp' : c.channel}{c.sender ? ` · from ${c.sender}` : ''}</span>
                    </span>
                  </div>

                  {/* Right: Unified Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Excel Export */}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/campaigns?id=${c.id}`)
                          const data = await res.json()
                          if (data.success && data.logs) {
                            const reportData = data.logs.map((log: any) => {
                              const variables = Object.entries(log.variables_mapped || {})
                                .map(([k, v]) => `${k}:${v}`)
                                .join(', ')
                              return {
                                Recipient: c.channel === 'email' 
                                  ? (log.email_address || log.phone_number || '-') 
                                  : (log.phone_number || log.email_address || '-'),
                                Status: log.status,
                                'Message SID / ID': log.message_sid || '-',
                                'Variables Mapped': variables,
                                'Error / Details': log.error_message || '-',
                                'Sent At': new Date(log.created_at).toLocaleString()
                              }
                            })
                            const worksheet = XLSX.utils.json_to_sheet(reportData)
                            const workbook = XLSX.utils.book_new()
                            XLSX.utils.book_append_sheet(workbook, worksheet, 'Logs')
                            XLSX.writeFile(workbook, `${c.name.toLowerCase().replace(/\s+/g, '_')}_report.xlsx`)
                          }
                        } catch (err) {
                          console.error('Error downloading log report from card:', err)
                        }
                      }}
                      className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#202d36] hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:text-[#008069] dark:hover:text-emerald-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs"
                      title="Download Excel Report"
                    >
                      <FileSpreadsheet size={13} />
                      <span>Excel</span>
                    </button>

                    {/* Rerun Failed */}
                    {c.status !== 'PROCESSING' && c.status !== 'PENDING' && c.status !== 'SCHEDULED' && (
                      <button
                        type="button"
                        onClick={() => handleRerunCampaign(c.id, 'failed_only')}
                        disabled={actionLoadingId === c.id}
                        className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#202d36] hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs disabled:opacity-50"
                        title="Rerun failed & pending recipients only"
                      >
                        {actionLoadingId === c.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        <span>{c.failed_count > 0 ? `Retry ${c.failed_count} failed` : 'Retry unsent'}</span>
                      </button>
                    )}

                    {/* Scheduled Actions */}
                    {c.status === 'SCHEDULED' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSendNowScheduled(c.id)}
                          disabled={actionLoadingId === c.id}
                          className="h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs disabled:opacity-50"
                          title="Override schedule and send now immediately"
                        >
                          {actionLoadingId === c.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Play size={11} className="fill-current" />
                          )}
                          <span>Send Now</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelScheduled(c.id)}
                          disabled={actionLoadingId === c.id}
                          className="h-9 px-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                          title="Cancel this scheduled campaign"
                        >
                          <X size={12} />
                          <span>Cancel</span>
                        </button>
                      </div>
                    )}

                    {/* Stop Processing Campaign */}
                    {(c.status === 'PROCESSING' || c.status === 'PENDING') && (
                      <button
                        type="button"
                        onClick={() => handleStopCampaign(c.id)}
                        disabled={actionLoadingId === c.id}
                        className="h-9 px-3.5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                        title="Stop Campaign execution"
                      >
                        {actionLoadingId === c.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Square size={11} className="fill-current" />
                        )}
                        <span>Stop Campaign</span>
                      </button>
                    )}

                    {/* Open the campaign: delivery report and the replies it got */}
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/campaigns/${c.id}`)}
                      className="h-9 px-4 rounded-xl bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors"
                      title="Open the delivery report and reply to the people who answered"
                    >
                      <MessageSquare size={13} />
                      <span>{(c.active_chats_count ?? 0) > 0 ? 'View replies' : 'Open'}</span>
                      {(c.active_chats_count ?? 0) > 0 && (
                        <span className="bg-white/25 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center tabular-nums">
                          {c.active_chats_count}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderPagination = () => {
    if (totalPages <= 1) return null

    const pageNumbers = []
    const maxVisiblePages = 5
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2))
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1)

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1)
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(i)
    }

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 mt-2 border-t border-[#e9edef] dark:border-[#2a3942]">
        <div className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0]">
          Showing <span className="text-[#111b21] dark:text-white">{(currentPage - 1) * 10 + 1}</span> to{' '}
          <span className="text-[#111b21] dark:text-white">{(currentPage - 1) * 10 + campaigns.length}</span> of{' '}
          <span className="text-[#111b21] dark:text-white">{totalCampaignsCount}</span> {listIsFiltered ? 'matching campaigns' : 'campaigns'}
        </div>
        
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => fetchCampaigns(currentPage - 1)}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"
            title="Previous page"
          >
            <ChevronLeft size={14} />
          </button>

          {startPage > 1 && (
            <>
              <button
                type="button"
                onClick={() => fetchCampaigns(1)}
                className={`h-8 px-3 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                  currentPage === 1
                    ? 'bg-[#008069] text-white shadow-xs'
                    : 'border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0]'
                }`}
              >
                1
              </button>
              {startPage > 2 && (
                <span className="text-[11px] font-bold text-[#8696a0] px-1 select-none">...</span>
              )}
            </>
          )}

          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => fetchCampaigns(page)}
              className={`h-8 w-8 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                currentPage === page
                  ? 'bg-[#008069] text-white shadow-xs font-black'
                  : 'border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0]'
              }`}
            >
              {page}
            </button>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && (
                <span className="text-[11px] font-bold text-[#8696a0] px-1 select-none">...</span>
              )}
              <button
                type="button"
                onClick={() => fetchCampaigns(totalPages)}
                className={`h-8 px-3 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                  currentPage === totalPages
                    ? 'bg-[#008069] text-white shadow-xs'
                    : 'border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0]'
                }`}
              >
                {totalPages}
              </button>
            </>
          )}

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => fetchCampaigns(currentPage + 1)}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"
            title="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    )
  }

  const renderDetailsModal = () => {
    if (!selectedCampaign) return null

    return (
      <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center z-50 p-4 md:p-6 select-none animate-in fade-in duration-200">
        <div className="bg-white dark:bg-[#1c282f] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 border dark:border-[#2a3942]">
          
          {/* Modal Header */}
          <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-5 py-4 flex items-center justify-between flex-shrink-0 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#008069] via-[#00a884] to-[#00c49a]" />
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[#111b21] dark:text-white truncate leading-tight">{selectedCampaign.name}</h2>
              <div className="flex flex-wrap items-center gap-x-2 mt-1.5 text-[10px] font-bold text-[#8696a0]">
                <span>{new Date(selectedCampaign.created_at).toLocaleString()}</span>
                <span>•</span>
                <span className="uppercase text-[#008069]">{(selectedCampaign.channel || 'whatsapp')}</span>
                {selectedCampaign.sender && (
                  <>
                    <span>•</span>
                    <span className="font-mono truncate max-w-[150px]">sender: {selectedCampaign.sender}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {selectedCampaign.status === 'SCHEDULED' ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      handleSendNowScheduled(selectedCampaign.id)
                      setSelectedCampaign(prev => prev ? { ...prev, status: 'PROCESSING' } : null)
                    }}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                    title="Override schedule and send now immediately"
                  >
                    {actionLoadingId === selectedCampaign.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Play size={10} className="fill-current" />
                    )}
                    <span>Send Now</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleCancelScheduled(selectedCampaign.id)
                      setSelectedCampaign(prev => prev ? { ...prev, status: 'STOPPED' } : null)
                    }}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                    title="Cancel scheduled campaign"
                  >
                    <X size={12} />
                    <span>Cancel</span>
                  </button>
                </div>
              ) : (selectedCampaign.status === 'PROCESSING' || selectedCampaign.status === 'PENDING') ? (
                <button
                  type="button"
                  onClick={() => handleStopCampaign(selectedCampaign.id)}
                  disabled={actionLoadingId === selectedCampaign.id}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Stop Campaign execution"
                >
                  {actionLoadingId === selectedCampaign.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Square size={10} className="fill-current" />
                  )}
                  <span>Stop Campaign</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRerunCampaign(selectedCampaign.id, 'failed_only')}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Rerun failed and pending recipients only"
                  >
                    {actionLoadingId === selectedCampaign.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    <span>Rerun Failed & Pending</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRerunCampaign(selectedCampaign.id, 'all')}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Reset and rerun full campaign for all recipients"
                  >
                    <span>Rerun All</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => router.push(`/dashboard/campaigns/${selectedCampaign.id}`)}
                className="h-7 px-2.5 bg-gradient-to-r from-[#008069] to-[#00a884] hover:from-[#00705b] hover:to-[#009475] text-white rounded-lg text-[10px] md:text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Open Campaign in Full Tab with Interactive Chat"
              >
                <ExternalLink size={12} />
                <span>Full Tab</span>
                {(selectedCampaign.active_chats_count ?? 0) > 0 && (
                  <span className="bg-white/20 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {selectedCampaign.active_chats_count}
                  </span>
                )}
              </button>

              <button
                onClick={() => fetchCampaignDetails(selectedCampaign.id)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-[#8696a0] cursor-pointer transition-colors"
                title="Reload data"
              >
                <RefreshCw size={14} />
              </button>
              <button 
                onClick={() => setSelectedCampaign(null)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-[#54656f] dark:text-[#8696a0] cursor-pointer transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scrollable contents */}
          <div className="flex-1 overflow-y-auto space-y-4 p-5 pb-8 scrollbar-thin bg-slate-50/35 dark:bg-[#121b22]/20">
            {/* Scheduled Campaign Alert Banner */}
            {selectedCampaign.status === 'SCHEDULED' && (
              <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 p-3.5 rounded-xl flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                      Scheduled Delivery in Indian Standard Time (IST)
                    </div>
                    <div className="text-[11px] text-indigo-700 dark:text-indigo-400 font-mono font-bold mt-0.5">
                      {formatISTDateTime(selectedCampaign.scheduled_at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleSendNowScheduled(selectedCampaign.id)
                      setSelectedCampaign(prev => prev ? { ...prev, status: 'PROCESSING' } : null)
                    }}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    <Play size={11} className="fill-current" />
                    <span>Send Now</span>
                  </button>
                </div>
              </div>
            )}

            {/* Modal Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[10px] font-black uppercase text-[#8696a0]">Targets</div>
                <div className="text-base font-black text-[#111b21] dark:text-white mt-1">{selectedCampaign.total_contacts}</div>
              </div>
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Sent</div>
                <div className="text-base font-black text-[#008069] dark:text-emerald-400 mt-1">{selectedCampaign.sent_count}</div>
              </div>
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[10px] font-black uppercase text-red-500">Failed</div>
                <div className="text-base font-black text-red-500 mt-1">{selectedCampaign.failed_count}</div>
              </div>
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400">Success</div>
                <div className="text-base font-black text-blue-600 dark:text-blue-400 mt-1">
                  {selectedCampaign.total_contacts > 0 
                    ? Math.round((selectedCampaign.sent_count / selectedCampaign.total_contacts) * 100) 
                    : 0}%
                </div>
              </div>
            </div>

            {/* Message Content Preview */}
            <div className="p-4 bg-white dark:bg-[#1f2c34] rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#667781] dark:text-[#8696a0]">
                  <FileText size={14} className="text-[#00a884]" />
                  <span>MESSAGE CONTENT</span>
                </div>
                {selectedCampaign.channel === 'email' && /<[a-z][\s\S]*>/i.test(selectedCampaign.template_body || '') && (
                  <div className="flex bg-[#f0f2f5] dark:bg-[#202d36] p-0.5 rounded-lg border border-[#e9edef] dark:border-[#2a3942]">
                    <button
                      type="button"
                      onClick={() => setDetailsPreviewMode('preview')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                        detailsPreviewMode === 'preview'
                          ? 'bg-white dark:bg-slate-700 text-[#111b21] dark:text-white shadow-xs'
                          : 'text-[#667781] dark:text-[#8696a0]'
                      }`}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailsPreviewMode('raw')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                        detailsPreviewMode === 'raw'
                          ? 'bg-white dark:bg-slate-700 text-[#111b21] dark:text-white shadow-xs'
                          : 'text-[#667781] dark:text-[#8696a0]'
                      }`}
                    >
                      HTML
                    </button>
                  </div>
                )}
              </div>

              {selectedCampaign.channel === 'email' && /<[a-z][\s\S]*>/i.test(selectedCampaign.template_body || '') && detailsPreviewMode === 'preview' ? (
                <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-lg overflow-hidden bg-white dark:bg-slate-900 max-w-full shadow-inner">
                  <iframe
                    srcDoc={selectedCampaign.template_body}
                    title="Email Template Preview"
                    className="w-full h-60 border-0"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : selectedCampaign.channel === 'whatsapp' ? (
                <div className="flex justify-start">
                  <div className="bg-[#efeae2] dark:bg-[#0b141a]/60 p-4 rounded-xl border border-emerald-100 dark:border-emerald-950/20 max-w-lg w-full shadow-inner relative">
                    <div className="bg-white dark:bg-[#1f2c34] rounded-lg p-3 text-xs leading-relaxed text-[#111b21] dark:text-white shadow-sm relative rounded-tl-none font-sans max-w-[90%]">
                      <p className="whitespace-pre-wrap break-words">{selectedCampaign.template_body}</p>
                      <div className="text-[10px] text-[#8696a0] text-right mt-1 font-semibold">
                        {new Date(selectedCampaign.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#f8f9fa] dark:bg-[#1c282f] border border-[#e9edef] dark:border-[#2a3942] text-xs font-mono text-[#54656f] dark:text-[#8696a0] whitespace-pre-wrap max-h-40 overflow-y-auto shadow-inner">
                  {selectedCampaign.template_body}
                </div>
              )}
            </div>

            {/* Delivery Logs Table */}
            <div className="p-4 bg-white dark:bg-[#1f2c34] rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-3 text-xs font-bold text-[#667781] dark:text-[#8696a0]">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-[#00a884]" />
                  <span>DELIVERY LOGS</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCampaignLogs.length > 0 && (
                    <button
                      onClick={handleDownloadLogsReport}
                      className="h-7 px-2.5 rounded border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/25 hover:bg-[#e7f7f4] dark:hover:bg-[#008069]/10 text-[10px] md:text-[10px] font-bold text-[#008069] dark:text-emerald-400 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Export logs to Excel"
                    >
                      <FileSpreadsheet size={11} />
                      <span>Download Report</span>
                    </button>
                  )}
                  <span className="text-[10px] bg-slate-100 dark:bg-[#2a3942] px-2 py-0.5 rounded text-[#54656f] dark:text-[#8696a0]">
                    {selectedCampaignLogs.length} messages
                  </span>
                </div>
              </div>

              <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-lg overflow-hidden shadow-xs">
                {isLoadingLogs ? (
                  <div className="flex flex-col items-center justify-center h-40 bg-[#f8f9fa] dark:bg-[#202d36]/20">
                    <Loader2 className="animate-spin text-[#00a884] mb-2" size={20} />
                    <span className="text-xs text-[#8696a0]">Loading log entries...</span>
                  </div>
                ) : selectedCampaignLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 bg-[#f8f9fa] dark:bg-[#202d36]/20 text-[#8696a0] text-xs">
                    No logs found.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-60 overflow-y-auto scrollbar-thin">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#f8f9fa] dark:bg-[#202d36] border-b border-[#e9edef] dark:border-[#2a3942] text-[#667781] dark:text-[#8696a0] font-bold sticky top-0 z-10">
                          <th className="p-2.5 font-bold">Recipient</th>
                          <th className="p-2.5 font-bold">Status</th>
                          <th className="p-2.5 font-bold">Variables</th>
                          <th className="p-2.5 font-bold">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f5f6f6] dark:divide-[#2a3942]/65 bg-white dark:bg-[#1f2c34]">
                        {selectedCampaignLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-[#f8f9fa]/50 dark:hover:bg-[#2a3942]/20">
                            <td className="p-2.5 font-bold text-[#111b21] dark:text-white truncate max-w-[140px]">
                              {selectedCampaign.channel === 'email' 
                                ? (log.email_address || log.phone_number || '-') 
                                : (log.phone_number || log.email_address || '-')}
                            </td>
                            <td className="p-2.5">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-black text-[10px] border ${
                                log.status === 'READ' ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 border-blue-200/50' :
                                log.status === 'DELIVERED' ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border-emerald-200/50' :
                                log.status === 'SENT' ? 'bg-[#e7f7f4] dark:bg-emerald-950/20 text-[#008069] border-[#00a884]/20' :
                                log.status === 'PENDING' ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 border-amber-200/50' :
                                'bg-red-50 dark:bg-red-950/20 text-red-600 border-red-200/50'
                              }`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="p-2.5">
                              <div className="flex flex-wrap gap-1 max-w-[160px]">
                                {Object.entries(log.variables_mapped).map(([k, v]) => (
                                  <span key={k} className="bg-slate-50 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px] border border-slate-100 dark:border-slate-800 text-[#54656f] dark:text-[#8696a0] font-bold font-mono">
                                    {k}:{String(v)}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-2.5 text-red-500 max-w-[120px] truncate" title={log.error_message || ''}>
                              {log.error_message || log.message_sid || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Modal Footer */}
          <div className="px-5 py-4 bg-[#f0f2f5] dark:bg-[#1f2c34] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-end flex-shrink-0">
            <button
              onClick={() => setSelectedCampaign(null)}
              className="px-4 py-2 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#e9edef] rounded-xl text-xs font-bold transition-all cursor-pointer border border-[#e9edef] dark:border-[#2a3942]"
            >
              Close
            </button>
          </div>

        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#f0f2f5] dark:bg-[#0b141a] overflow-hidden relative">
      {renderHeader()}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0 bg-slate-50/50 dark:bg-[#0c1317]">
        <div className="max-w-6xl mx-auto space-y-6">
          {renderStatsGrid()}
          {renderFiltersBar()}
          {renderCampaignList()}
          {renderPagination()}
        </div>
      </div>

      {/* Creation Wizard - Full Screen Workspace */}
      {isCreateOpen && (
        <div role="dialog" aria-modal="true" aria-label="Create a campaign" className="fixed inset-0 z-50 w-full h-full bg-[#f8f9fa] dark:bg-[#0b141a] flex flex-col animate-in fade-in duration-200 overflow-hidden">
          {/* Full Screen Top App Bar */}
          <header className="bg-white dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-4 md:px-8 py-3 flex items-center justify-between shadow-2xs z-30 shrink-0">
            {/* Left: Back & Campaign Title */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={requestCloseWizard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#202d36] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer shadow-2xs"
                title="Exit wizard"
              >
                <ArrowLeft size={15} />
                <span className="hidden sm:inline">Exit</span>
              </button>

              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-[#008069] to-[#00a884] text-white flex items-center justify-center shadow-xs shrink-0">
                  <Megaphone size={18} className="fill-white/20" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-sm md:text-base text-[#111b21] dark:text-white tracking-tight">
                      New campaign
                    </h2>
                  </div>
                  <p className="text-[10.5px] text-[#667781] dark:text-[#8696a0] truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                    {newCampaignName.trim() ? newCampaignName : 'Message, audience, then send or schedule'}
                  </p>
                </div>
              </div>
            </div>

            {/* Center: Stepper Pills */}
            <div className="hidden lg:flex items-center gap-1 bg-[#f0f2f5] dark:bg-[#121b22] p-1 rounded-2xl border border-[#e9edef] dark:border-[#2a3942]">
              {[
                { step: 1, label: 'Message' },
                { step: 2, label: 'Audience' },
                { step: 3, label: 'Personalise' },
                { step: 4, label: 'Review & send' },
              ].map((s) => {
                const isCurrent = wizardStep === s.step
                const isCompleted = wizardStep > s.step
                return (
                  <button
                    key={s.step}
                    type="button"
                    onClick={() => {
                      if (isCompleted) setWizardStep(s.step as any)
                    }}
                    disabled={!isCompleted && !isCurrent}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isCurrent
                        ? 'bg-white dark:bg-[#1f2c34] text-[#008069] dark:text-emerald-400 shadow-2xs cursor-default'
                        : isCompleted
                        ? 'text-emerald-700 dark:text-emerald-400 hover:bg-white/60 dark:hover:bg-[#1f2c34]/60 cursor-pointer'
                        : 'text-[#8696a0] opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                        isCurrent
                          ? 'bg-[#008069] text-white'
                          : isCompleted
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                      }`}
                    >
                      {isCompleted ? '✓' : s.step}
                    </span>
                    <span>{s.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Right: Close Button */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 lg:hidden">
                Step {wizardStep}/4
              </span>
              <button
                type="button"
                onClick={requestCloseWizard}
                className="p-2 hover:bg-slate-100 dark:hover:bg-[#2a3942] rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                title="Exit (Esc)"
              >
                <X size={20} />
              </button>
            </div>
          </header>

          {/* Full Screen Body Workspace */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-[#f8f9fa] dark:bg-[#0b141a] scrollbar-thin">
            <div className={`mx-auto w-full space-y-5 pb-24 transition-all duration-300 ${wizardStep === 2 ? 'max-w-7xl' : 'max-w-4xl'}`}>
              {/* Mobile Stepper Banner */}
              <div className="lg:hidden p-3 rounded-xl bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] shadow-2xs flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-white">
                  Step {wizardStep} of 4:{' '}
                  {wizardStep === 1
                    ? 'Message'
                    : wizardStep === 2
                    ? 'Audience'
                    : wizardStep === 3
                    ? 'Personalise'
                    : 'Review & send'}
                </span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map((s) => (
                    <div
                      key={s}
                      className={`h-2 rounded-full transition-all ${
                        s === wizardStep
                          ? 'w-6 bg-[#00a884]'
                          : s < wizardStep
                          ? 'w-2 bg-emerald-300 dark:bg-emerald-800'
                          : 'w-2 bg-slate-200 dark:bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Error Alert */}
              {errorMsg && (
                <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-2xl flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300 shadow-2xs">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-rose-600 dark:text-rose-400" />
                  <span className="font-semibold">{errorMsg}</span>
                </div>
              )}

              {/* Step Contents Container */}
              <div className={`bg-white dark:bg-[#1c282f] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs transition-all duration-300 ${wizardStep === 2 ? 'p-4 sm:p-6 md:p-7' : 'p-5 md:p-8'}`}>

              {/* STEP 1: Details & Template Selection */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Campaign Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. June Promotional Discount"
                      value={newCampaignName}
                      onChange={(e) => setNewCampaignName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-[#111b21] dark:text-white"
                    />
                  </div>

                  {/* Channel Selection */}
                  {isMasterOrg && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Campaign Channel</label>
                      <div className="grid grid-cols-3 gap-2">
                        {features.enable_messages && availableSenders.whatsappSenders.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setChannel('whatsapp')}
                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              channel === 'whatsapp'
                                ? 'bg-[#e7f7f4] border-[#00a884] text-[#008069]'
                                : 'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                            }`}
                          >
                            WhatsApp
                          </button>
                        )}
                        {features.enable_messages && features.enable_sms && availableSenders.smsSenders.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setChannel('sms')}
                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              channel === 'sms'
                                ? 'bg-amber-50 border-amber-500 text-amber-700'
                                : 'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                            }`}
                          >
                            SMS
                          </button>
                        )}
                        {features.enable_email && availableSenders.emailSenders.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setChannel('email')}
                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              channel === 'email'
                                ? 'bg-blue-50 border-blue-500 text-blue-700'
                                : 'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                            }`}
                          >
                            Email
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Sender Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Sender (From)</label>
                    {isLoadingSenders ? (
                      <div className="text-xs text-[#8696a0] flex items-center gap-1.5 py-1">
                        <Loader2 size={12} className="animate-spin text-[#00a884]" />
                        <span>Fetching senders...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <select
                          value={sender}
                          onChange={(e) => setSender(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                        >
                          <option value="">-- Choose Sender ID / Number --</option>
                          {channel === 'whatsapp' && availableSenders.whatsappSenders.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                          {channel === 'sms' && availableSenders.smsSenders.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                          {channel === 'email' && availableSenders.emailSenders.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                          <option value="custom_write_in">-- Write Custom Sender --</option>
                        </select>
                        
                        {(sender === 'custom_write_in' || !availableSenders[channel === 'whatsapp' ? 'whatsappSenders' : channel === 'sms' ? 'smsSenders' : 'emailSenders']?.some(s => s.value === sender)) && (
                          <input
                            type="text"
                            placeholder={
                              channel === 'email' ? 'e.g. sales@yourdomain.com' :
                              channel === 'sms' ? 'e.g. +1234567890 or service SID' :
                              'e.g. whatsapp:+1234567890'
                            }
                            value={sender === 'custom_write_in' ? '' : sender}
                            onChange={(e) => setSender(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-semibold text-[#111b21] dark:text-white"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Email Subject Selection */}
                  {channel === 'email' && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Email Subject</label>
                      <input 
                        type="text" 
                        placeholder="Enter email subject line..."
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">
                        {channel === 'whatsapp' ? 'Approved Gateway Template' : 'Choose Base Template (Optional)'}
                      </label>
                      {channel === 'whatsapp' && (
                        <button
                          type="button"
                          onClick={() => fetchTemplates()}
                          className="text-[11px] text-[#00a884] hover:underline flex items-center gap-1 font-medium transition-colors"
                        >
                          <RefreshCw size={11} /> Refresh from Meta
                        </button>
                      )}
                    </div>
                    <select
                      value={selectedTemplate?.sid || ''}
                      onChange={(e) => {
                        const tpl = templates.find(t => t.sid === e.target.value) || null
                        setSelectedTemplate(tpl)
                        setCustomMessageBody(tpl ? tpl.body : '')
                        setVariableMappings({})
                        setVariableMappingTypes({})
                        setStaticVariableValues({})
                      }}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#111b21] dark:text-white border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                    >
                      <option value="">
                        {channel === 'whatsapp' ? '-- Choose approved template --' : '-- Write custom message or choose template --'}
                      </option>
                      {templates.map(t => {
                        const statusTag = t.approval_status === 'APPROVED' ? '✓ Approved' : t.approval_status === 'REJECTED' ? '✕ Rejected' : t.approval_status === 'PENDING' ? '⏳ Pending' : '✓'
                        const langTag = t.language ? `[${t.language}]` : '[en]'
                        const catTag = t.category ? `[${t.category}]` : ''
                        return (
                          <option key={t.sid} value={t.sid}>
                            {t.whatsapp_template_name || t.raw_name || t.name} • {statusTag} {langTag} {catTag}
                          </option>
                        )
                      })}
                    </select>

                    {/* Selected Template Details Card */}
                    {selectedTemplate && channel === 'whatsapp' && (
                      <div className="mt-2 p-3.5 bg-slate-50 dark:bg-[#1f2c34] rounded-xl border border-slate-200 dark:border-[#2a3942] space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-800 dark:text-white">
                              {selectedTemplate.whatsapp_template_name || selectedTemplate.raw_name || selectedTemplate.name}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              selectedTemplate.approval_status === 'APPROVED' || !selectedTemplate.approval_status
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                : selectedTemplate.approval_status === 'PENDING'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                            }`}>
                              {selectedTemplate.approval_status === 'APPROVED' || !selectedTemplate.approval_status ? '✓ WhatsApp Approved' : selectedTemplate.approval_status}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] font-mono">
                            <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-semibold border border-slate-300 dark:border-slate-700">
                              Language: {selectedTemplate.language || 'en'}
                            </span>
                            <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-semibold border border-blue-200 dark:border-blue-800">
                              {selectedTemplate.category || 'UTILITY'}
                            </span>
                            <span className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-semibold border border-purple-200 dark:border-purple-800">
                              {selectedTemplate.source === 'meta' ? 'Meta Cloud' : selectedTemplate.source === 'twilio' ? 'Twilio Content' : 'Custom'}
                            </span>
                          </div>
                        </div>

                        <div className="p-2.5 bg-white dark:bg-[#111b21] rounded-lg border border-slate-200 dark:border-[#3b4a54] text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed">
                          {selectedTemplate.body}
                        </div>

                        {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Placeholders:</span>
                            {selectedTemplate.variables.map(v => (
                              <span key={v} className="bg-[#00a884]/10 text-[#00a884] dark:bg-[#00a884]/20 border border-[#00a884]/30 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
                                {"{{"}{v}{"}}"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {channel === 'whatsapp' && templateFetchError && (
                      <div className="mt-1 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/30 text-xs flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                          <AlertCircle size={13} className="shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
                          <span>WhatsApp API Credentials Issue</span>
                        </div>
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-normal">
                          {templateFetchError}
                        </p>
                        <a 
                          href="/dashboard/settings" 
                          className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline mt-0.5"
                        >
                          Go to Settings → Credentials to update token & IDs
                        </a>
                      </div>
                    )}

                    {/* Add Template inline panel */}
                    {channel === 'whatsapp' && (
                      <div>
                        {!showAddTemplate ? (
                          <button
                            type="button"
                            onClick={() => setShowAddTemplate(true)}
                            className="text-[10px] font-semibold text-[#00a884] hover:text-[#00876d] flex items-center gap-1 mt-1 cursor-pointer"
                          >
                            <span className="text-base leading-none">+</span> Register Meta-approved template
                          </button>
                        ) : (
                          <div className="mt-2 p-3 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-xl border border-[#e9edef] dark:border-[#3b4a54] flex flex-col gap-2">
                            <p className="text-[10px] font-bold text-[#54656f] dark:text-[#8696a0] uppercase tracking-wide">Add Approved Template</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-[#54656f] dark:text-[#8696a0] font-semibold">Name</label>
                                <input
                                  type="text"
                                  placeholder="e.g. form_filling"
                                  value={newTplName}
                                  onChange={e => setNewTplName(e.target.value)}
                                  className="w-full mt-0.5 px-2.5 py-1.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#3b4a54] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-[#54656f] dark:text-[#8696a0] font-semibold">Category</label>
                                <select
                                  value={newTplCategory}
                                  onChange={e => setNewTplCategory(e.target.value)}
                                  className="w-full mt-0.5 px-2.5 py-1.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#3b4a54] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                                >
                                  <option value="UTILITY">Utility</option>
                                  <option value="MARKETING">Marketing</option>
                                  <option value="AUTHENTICATION">Authentication</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] text-[#54656f] dark:text-[#8696a0] font-semibold">Message Body</label>
                              <textarea
                                rows={3}
                                placeholder="Enter template body. Use {{1}}, {{2}} for variables."
                                value={newTplBody}
                                onChange={e => setNewTplBody(e.target.value)}
                                className="w-full mt-0.5 px-2.5 py-1.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#3b4a54] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono resize-none dark:text-white"
                              />
                            </div>
                            {newTplError && <p className="text-[10px] text-red-500">{newTplError}</p>}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={newTplSaving}
                                onClick={handleSaveNewTemplate}
                                className="flex-1 py-1.5 text-xs font-bold bg-[#00a884] hover:bg-[#00876d] text-white rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {newTplSaving ? 'Saving...' : 'Save Template'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setShowAddTemplate(false); setNewTplError('') }}
                                className="px-3 py-1.5 text-xs font-bold text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white border border-[#e9edef] dark:border-[#3b4a54] rounded-lg transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Message Body</label>
                      {channel === 'email' && (
                        <div className="flex bg-[#f0f2f5] p-0.5 rounded-lg border border-[#e9edef]">
                          <button
                            type="button"
                            onClick={() => setEditorMode('visual')}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              editorMode === 'visual'
                                ? 'bg-white text-[#111b21] dark:text-white shadow-sm'
                                : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white'
                            }`}
                          >
                            Visual Editor
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditorMode('code')}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              editorMode === 'code'
                                ? 'bg-white text-[#111b21] dark:text-white shadow-sm'
                                : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white'
                            }`}
                          >
                            HTML Code / Plain Text
                          </button>
                        </div>
                      )}
                    </div>
                    {channel === 'whatsapp' ? (
                      <textarea
                        readOnly
                        placeholder="Select a WhatsApp template above to populate message body..."
                        value={customMessageBody}
                        rows={4}
                        className="w-full px-3.5 py-2.5 bg-[#f8f9fa] border border-[#e9edef] rounded-xl text-xs focus:outline-none font-mono resize-none text-[#667781] dark:text-[#8696a0]"
                      />
                    ) : channel === 'email' && editorMode === 'visual' ? (
                      <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-xl overflow-hidden bg-white dark:bg-[#2a3942] focus-within:ring-1 focus-within:ring-[#00a884]">
                        {/* Formatting Toolbar */}
                        <div className="flex flex-wrap items-center gap-1 bg-[#f0f2f5] border-b border-[#e9edef] p-1.5 select-none">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('bold', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Bold"
                          >
                            <Bold size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('italic', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Italic"
                          >
                            <Italic size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('underline', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Underline"
                          >
                            <Underline size={14} />
                          </button>
                          <div className="w-px h-4 bg-[#e9edef] mx-1" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('insertUnorderedList', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Bullet List"
                          >
                            <List size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('insertOrderedList', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Numbered List"
                          >
                            <ListOrdered size={14} />
                          </button>
                          <div className="w-px h-4 bg-[#e9edef] mx-1" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('justifyLeft', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Align Left"
                          >
                            <AlignLeft size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('justifyCenter', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Align Center"
                          >
                            <AlignCenter size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('justifyRight', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Align Right"
                          >
                            <AlignRight size={14} />
                          </button>
                          <div className="w-px h-4 bg-[#e9edef] mx-1" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('removeFormat', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all text-xs font-bold px-2"
                            title="Clear Formatting"
                          >
                            Tx
                          </button>
                        </div>
                        {/* contentEditable editor */}
                        <div
                          ref={visualEditorRef}
                          contentEditable
                          onInput={handleVisualEditorInput}
                          className="min-h-[160px] max-h-[320px] p-3.5 text-xs focus:outline-none overflow-y-auto text-[#111b21] dark:text-white font-sans prose prose-sm max-w-none"
                          data-placeholder="Type or format your rich email template here..."
                        />
                        <style dangerouslySetInnerHTML={{ __html: `
                          [contenteditable]:empty:before {
                            content: attr(data-placeholder);
                            color: #8696a0;
                            cursor: text;
                          }
                        `}} />
                      </div>
                    ) : (
                      <textarea
                        placeholder="Compose your custom message here... Use {{name}} or {{1}} placeholders to map columns dynamically."
                        value={customMessageBody}
                        onChange={(e) => handleCustomMessageBodyChange(e.target.value)}
                        rows={5}
                        className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono resize-y text-[#111b21] dark:text-white"
                      />
                    )}
                    {customVariables.length > 0 && (
                      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0]">Detected Variables:</span>
                        {customVariables.map(v => (
                          <span key={v} className="bg-[#00a884]/10 border border-[#00a884]/20 text-[#008069] text-[10px] px-1.5 py-0.5 rounded-md font-bold font-mono">
                            {"{{"}{v}{"}}"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: Audience */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  {/* Where the audience comes from */}
                  <div role="radiogroup" aria-label="Where the audience comes from" className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {([
                      {
                        id: 'db' as const,
                        icon: Database,
                        title: 'Contacts from your CRM',
                        detail: 'Search, filter by tag or past campaign, and tick who gets it.',
                        badge: isLoadingContacts ? 'Loading…' : `${contacts.length.toLocaleString()} contacts`,
                      },
                      {
                        id: 'excel' as const,
                        icon: FileSpreadsheet,
                        title: 'Upload a spreadsheet',
                        detail: 'An .xlsx, .xls or .csv file with one recipient per row.',
                        badge: excelData.length > 0 ? `${excelData.length.toLocaleString()} rows` : '',
                      },
                    ]).map(({ id, icon: Icon, title, detail, badge }) => {
                      const active = audienceSource === id
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => {
                            setAudienceSource(id)
                            setErrorMsg('')
                          }}
                          className={`relative p-4 rounded-2xl border-2 text-left flex items-start gap-3 cursor-pointer transition-colors ${
                            active
                              ? 'border-[#00a884] bg-emerald-50/50 dark:bg-emerald-950/20'
                              : 'border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#152026] hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className={`h-10 w-10 rounded-xl shrink-0 flex items-center justify-center ${active ? 'bg-[#00a884] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                            <Icon size={19} />
                          </div>
                          <div className="flex-1 min-w-0 pr-6">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-slate-900 dark:text-white">{title}</span>
                              {badge && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 tabular-nums">{badge}</span>}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{detail}</p>
                          </div>
                          <span className={`absolute top-4 right-4 h-5 w-5 rounded-full border-2 flex items-center justify-center ${active ? 'border-[#00a884] bg-[#00a884] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                            {active && <Check size={12} strokeWidth={3} />}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {audienceSource === 'excel' ? (
                    <div className="space-y-3">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                      />
                      {excelData.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full border-2 border-dashed border-slate-300 dark:border-[#2a3942] hover:border-[#00a884] hover:bg-emerald-50/40 dark:hover:bg-emerald-950/10 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-white dark:bg-[#152026] flex flex-col items-center justify-center gap-2"
                        >
                          <Upload size={26} className="text-[#8696a0]" />
                          <span className="text-sm font-semibold text-[#111b21] dark:text-white">Choose a spreadsheet</span>
                          <span className="text-xs text-[#667781] dark:text-[#8696a0]">.xlsx, .xls or .csv · the first row must hold the column names</span>
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <div className="p-3 bg-white dark:bg-[#152026] border border-slate-200 dark:border-[#2a3942] rounded-xl flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="h-9 w-9 shrink-0 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-[#008069] dark:text-emerald-400 flex items-center justify-center">
                                <FileSpreadsheet size={17} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{excelFile?.name || 'Spreadsheet'}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{excelData.length.toLocaleString()} rows · {excelHeaders.length} columns</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button type="button" onClick={() => fileInputRef.current?.click()} className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                                Replace
                              </button>
                              <button
                                type="button"
                                aria-label="Remove the spreadsheet"
                                onClick={() => {
                                  setExcelFile(null)
                                  setExcelData([])
                                  setExcelHeaders([])
                                  setPhoneColumn('')
                                  if (fileInputRef.current) fileInputRef.current.value = ''
                                }}
                                className="h-8 w-8 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center cursor-pointer"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-50 dark:bg-[#111b21] p-3.5 rounded-xl border border-slate-200 dark:border-[#2a3942]">
                            {/* Phone / Email Column */}
                            <div className="flex flex-col gap-1 sm:col-span-2">
                              <label htmlFor="sheet-address-column" className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                {channel === 'email' ? 'Column with the email address' : 'Column with the phone number'} <span className="text-rose-500">*</span>
                              </label>
                              <select
                                id="sheet-address-column"
                                value={phoneColumn}
                                onChange={(e) => setPhoneColumn(e.target.value)}
                                className={`w-full h-10 px-3 bg-white dark:bg-[#1f2c34] border rounded-xl text-[13px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a884]/20 focus:border-[#00a884] ${phoneColumn ? 'border-slate-200 dark:border-[#3b4a54]' : 'border-amber-400'}`}
                              >
                                <option value="">Choose a column…</option>
                                {excelHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>

                              {/* What that column actually contains */}
                              {sheetCheck && (
                                <div
                                  role="status"
                                  className={`mt-1 px-3 py-2 rounded-lg text-xs flex items-start gap-2 ${
                                    sheetCheck.recipients.length === 0
                                      ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/60'
                                      : sheetCheck.invalid + sheetCheck.duplicates > 0
                                        ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900/60'
                                        : 'bg-emerald-50 dark:bg-emerald-950/30 text-[#008069] dark:text-emerald-300 border border-[#00a884]/30'
                                  }`}
                                >
                                  {sheetCheck.recipients.length > 0 && sheetCheck.invalid + sheetCheck.duplicates === 0
                                    ? <CheckCircle size={14} className="shrink-0 mt-px" />
                                    : <AlertCircle size={14} className="shrink-0 mt-px" />}
                                  <span className="tabular-nums">
                                    <strong className="font-semibold">{sheetCheck.recipients.length.toLocaleString()} {sheetCheck.recipients.length === 1 ? 'recipient' : 'recipients'}</strong> will be sent this campaign
                                    {sheetCheck.invalid > 0 && ` · ${sheetCheck.invalid.toLocaleString()} ${sheetCheck.invalid === 1 ? 'row has' : 'rows have'} no valid ${channel === 'email' ? 'email address' : 'phone number'} and will be skipped`}
                                    {sheetCheck.duplicates > 0 && ` · ${sheetCheck.duplicates.toLocaleString()} repeated ${channel === 'email' ? (sheetCheck.duplicates === 1 ? 'address is' : 'addresses are') : (sheetCheck.duplicates === 1 ? 'number is' : 'numbers are')} sent once`}
                                    {sheetCheck.recipients.length === 0 && '. Check that the right column is chosen.'}
                                  </span>
                                </div>
                              )}
                              {channel !== 'email' && phoneColumn && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Numbers should include the country code. A 10-digit Indian mobile number is sent with +91.
                                </p>
                              )}
                            </div>

                            {/* Contact Name / First Name Column */}
                            <div className="flex flex-col gap-1">
                              <label htmlFor="sheet-name-column" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Name column <span className="font-normal text-slate-400">(optional)</span>
                              </label>
                              <select
                                id="sheet-name-column"
                                value={contactNameColumn}
                                onChange={(e) => setContactNameColumn(e.target.value)}
                                className="w-full h-10 px-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-xl text-[13px] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a884]/20 focus:border-[#00a884]"
                              >
                                <option value="">Not in this sheet</option>
                                {excelHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </div>

                            {/* Last Name Column */}
                            <div className="flex flex-col gap-1">
                              <label htmlFor="sheet-lastname-column" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Last name column <span className="font-normal text-slate-400">(optional)</span>
                              </label>
                              <select
                                id="sheet-lastname-column"
                                value={contactLastNameColumn}
                                onChange={(e) => setContactLastNameColumn(e.target.value)}
                                className="w-full h-10 px-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-xl text-[13px] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a884]/20 focus:border-[#00a884]"
                              >
                                <option value="">Not in this sheet</option>
                                {excelHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </div>

                            {/* Tag Column & Custom Tag */}
                            <div className="flex flex-col gap-1 sm:col-span-2">
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Tag these contacts in the CRM <span className="font-normal text-slate-400">(optional)</span>
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <select
                                  aria-label="Column holding each contact's tag"
                                  value={contactTagColumn}
                                  onChange={(e) => setContactTagColumn(e.target.value)}
                                  className="w-full h-10 px-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-xl text-[13px] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a884]/20 focus:border-[#00a884]"
                                >
                                  <option value="">No tag column</option>
                                  {excelHeaders.map(h => (
                                    <option key={h} value={h}>Use column: {h}</option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  aria-label="One tag for every contact in this sheet"
                                  placeholder="Or one tag for everyone, e.g. Diwali 2026"
                                  value={customCampaignTag}
                                  disabled={Boolean(contactTagColumn)}
                                  onChange={(e) => setCustomCampaignTag(e.target.value)}
                                  className="w-full h-10 px-3 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-xl text-[13px] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00a884]/20 focus:border-[#00a884] disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">New recipients are saved as contacts with this tag, so you can find them again later.</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : contactsError ? (
                    <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-5 text-center">
                      <AlertCircle size={22} className="mx-auto text-rose-500" />
                      <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">Your contacts could not be loaded</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 break-words">{contactsError}</p>
                      <button type="button" onClick={() => fetchContacts()} className="mt-3 h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                        <RefreshCw size={13} /> Try again
                      </button>
                    </div>
                  ) : (
                    <>
                      <AudiencePicker
                        key={audiencePickerKey}
                        contacts={contacts}
                        loading={isLoadingContacts}
                        onReload={() => fetchContacts()}
                        channel={channel}
                        selectedIds={selectedContactIds}
                        onChange={setSelectedContactIds}
                        campaigns={allCampaignsList}
                        loadingCampaigns={isLoadingAllCampaigns}
                        participantsByCampaign={campaignParticipantsMap}
                        participantsError={participantsError}
                        onNeedParticipants={requestParticipants}
                      />
                    </>
                  )}
                </div>
              )}

              {/* STEP 3: Variable Mapping */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="p-3 bg-[#f0f2f5] dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">Template text structure</span>
                    <p className="text-xs font-medium text-[#111b21] dark:text-white mt-1 font-mono leading-relaxed whitespace-pre-wrap">{selectedTemplate?.body}</p>
                  </div>

                  <h4 className="text-xs font-bold text-[#111b21] dark:text-white">Map Excel Columns / Contact Attributes to Placeholders</h4>
                  
                  {(channel === 'whatsapp' ? (selectedTemplate?.variables || []) : customVariables).length === 0 ? (
                    <div className="p-4 text-center bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-xl space-y-1">
                      <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                        ✓ No Variable Mapping Required
                      </div>
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        This template has no dynamic placeholders. All recipients will receive the exact message shown above. Click &quot;Continue&quot; to proceed to review and launch.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(channel === 'whatsapp' ? (selectedTemplate?.variables || []) : customVariables).map(v => (
                        <div key={v} className="space-y-3 bg-[#f8f9fa] dark:bg-[#111b21] p-3.5 rounded-xl border border-[#e9edef] dark:border-[#202d36] transition-all hover:shadow-sm">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="bg-[#00a884] text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded shadow-sm">
                                {"{{"}{v}{"}}"}
                              </span>
                              <span className="text-xs font-bold text-[#111b21] dark:text-white">
                                {v.startsWith('header_image') ? 'Header Image' : v.startsWith('header_video') ? 'Header Video' : v.startsWith('header_document_filename') ? 'Document Name' : v.startsWith('header_document') ? 'Header Document' : v.startsWith('header_text') ? 'Header Text' : v.startsWith('button_url') ? 'Dynamic Button URL' : v.startsWith('button_copy_code') ? 'Button Coupon/OTP Code' : `Variable ${v}`}
                              </span>
                            </div>

                            {/* Toggle mapping type */}
                            <div className="flex items-center self-end sm:self-auto bg-[#eae6df]/50 dark:bg-[#202d36] p-0.5 rounded-lg border border-[#e9edef] dark:border-[#303d46]">
                              <button
                                type="button"
                                onClick={() => {
                                  setVariableMappingTypes(prev => ({ ...prev, [v]: 'dynamic' }))
                                }}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                                  variableMappingTypes[v] !== 'static'
                                    ? 'bg-[#00a884] text-white shadow-sm'
                                    : 'text-[#667781] hover:text-[#111b21] dark:text-[#8696a0]'
                                }`}
                              >
                                Map Column
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setVariableMappingTypes(prev => ({ ...prev, [v]: 'static' }))
                                }}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                                  variableMappingTypes[v] === 'static'
                                    ? 'bg-[#00a884] text-white shadow-sm'
                                    : 'text-[#667781] hover:text-[#111b21] dark:text-[#8696a0]'
                                }`}
                              >
                                Static Value
                              </button>
                            </div>
                          </div>

                          {/* Input or Dropdown selector */}
                          {variableMappingTypes[v] === 'static' ? (
                            <input
                              type="text"
                              placeholder={
                                v.includes('image_url') || v.includes('video_url') || v.includes('document_url')
                                  ? "Enter media public URL or Facebook Media ID (e.g. 1084170318116787)"
                                  : v.includes('filename')
                                  ? "Enter dynamic filename (e.g. report.pdf)"
                                  : `Enter constant value for {{${v}}}`
                              }
                              value={staticVariableValues[v] || ''}
                              onChange={(e) => {
                                setStaticVariableValues(prev => ({ ...prev, [v]: e.target.value }))
                              }}
                              className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                            />
                          ) : (
                            <select
                              value={variableMappings[v] || ''}
                              onChange={(e) => {
                                setVariableMappings(prev => ({ ...prev, [v]: e.target.value }))
                              }}
                              className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                            >
                              <option value="">-- Choose column for {"{{"}{v}{"}}"} --</option>
                              {(audienceSource === 'excel' ? excelHeaders : ['first_name', 'last_name', 'company', 'email', 'phone_number']).map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: Preview & Launch Confirmation */}
              {wizardStep === 4 && (
                <div className="space-y-5">
                  {reviewRecipientCount > 0 ? (
                    <div className="p-4 bg-[#e7f7f4] dark:bg-emerald-950/30 border border-[#00a884]/20 rounded-xl flex items-start gap-3">
                      <CheckCircle size={18} className="text-[#008069] dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="font-bold text-sm text-[#008069] dark:text-emerald-300 tabular-nums">
                          {reviewRecipientCount.toLocaleString()} {reviewRecipientCount === 1 ? 'person' : 'people'} will receive this {channel === 'email' ? 'email' : 'message'}
                        </h4>
                        <p className="text-xs text-[#008069] dark:text-emerald-300/90 mt-0.5 leading-relaxed">
                          {dispatchTiming === 'scheduled' ? 'It is sent at the time you set below.' : 'Sending starts as soon as you launch and continues in the background.'}
                          {reviewAudience && reviewAudience.invalid > 0 && ` ${reviewAudience.invalid.toLocaleString()} without a valid ${channel === 'email' ? 'email address' : 'phone number'} ${reviewAudience.invalid === 1 ? 'is' : 'are'} skipped.`}
                          {reviewAudience && reviewAudience.duplicates > 0 && ` ${reviewAudience.duplicates.toLocaleString()} repeated ${channel === 'email' ? 'addresses' : 'numbers'} are sent only once.`}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-start gap-3">
                      <AlertCircle size={18} className="text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="font-bold text-sm text-rose-800 dark:text-rose-200">Nobody to send to</h4>
                        <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                          None of the selected recipients has a valid {channel === 'email' ? 'email address' : 'phone number'}. Go back to the audience step.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">First Message Preview</span>
                    {channel === 'email' ? (
                      <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm space-y-3">
                        <div className="space-y-1.5 border-b border-[#f0f2f5] pb-3 text-xs">
                          <div>
                            <span className="font-bold text-[#54656f] dark:text-[#8696a0]">From: </span>
                            <span className="text-[#111b21] dark:text-white font-mono">{sender || '(Configured Email Sender)'}</span>
                          </div>
                          <div>
                            <span className="font-bold text-[#54656f] dark:text-[#8696a0]">Subject: </span>
                            <span className="text-[#111b21] dark:text-white font-bold">{subject || '(No Subject)'}</span>
                          </div>
                        </div>
                        <div className="text-xs leading-relaxed text-[#111b21] dark:text-white font-sans py-2 min-h-[80px] overflow-y-auto max-h-[400px] border border-dashed border-[#e9edef] p-3 rounded-lg bg-gray-50/50">
                          {(() => {
                            const previewText = getPreviewMessage()
                            const hasHtml = /<[a-z][\s\S]*>/i.test(previewText)
                            const formattedPreview = hasHtml ? previewText : previewText.replace(/\n/g, '<br/>')
                            return (
                              <div dangerouslySetInnerHTML={{ __html: formattedPreview }} />
                            )
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#efeae2] p-4 rounded-xl border border-[#e9edef] relative overflow-hidden flex flex-col justify-end min-h-[220px] w-full">
                        {/* WhatsApp-style Bubble Container */}
                        <div className="bg-white dark:bg-[#1f2c34] rounded-lg border border-[#e9edef] dark:border-[#2a3942] text-[11px] max-w-[90%] sm:max-w-[285px] relative self-start shadow-sm leading-relaxed text-[#111b21] dark:text-white rounded-tl-none font-sans overflow-hidden flex flex-col">
                          
                          {/* 1. Header Rendering */}
                          {(() => {
                            const headerComp = selectedTemplate?.components?.find((c: any) => c.type === 'HEADER')
                            if (!headerComp) return null

                            if (headerComp.format === 'IMAGE') {
                              const sampleUrl = selectedTemplate?.sampleValues?.header_image_url || ''
                              return (
                                <div className="p-1 pb-0">
                                  {sampleUrl && sampleUrl.startsWith('http') ? (
                                    <img 
                                      src={sampleUrl} 
                                      alt="Header Template Image" 
                                      className="rounded-t-md max-h-36 w-full object-cover"
                                    />
                                  ) : (
                                    <div className="bg-slate-100 dark:bg-slate-800 rounded-t-md h-28 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1.5 border border-dashed border-slate-200 dark:border-slate-700">
                                      <FileSpreadsheet size={20} />
                                      <span className="text-[10px] font-medium">📷 Image Header (Approved Asset)</span>
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            if (headerComp.format === 'VIDEO') {
                              const sampleUrl = selectedTemplate?.sampleValues?.header_video_url || ''
                              return (
                                <div className="p-1 pb-0">
                                  {sampleUrl && sampleUrl.startsWith('http') ? (
                                    <video 
                                      src={sampleUrl} 
                                      className="rounded-t-md max-h-36 w-full object-cover bg-black"
                                      controls
                                    />
                                  ) : (
                                    <div className="bg-slate-100 dark:bg-slate-800 rounded-t-md h-28 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1.5 border border-dashed border-slate-200 dark:border-slate-700">
                                      <Play size={20} />
                                      <span className="text-[10px] font-medium">🎥 Video Header (Approved Asset)</span>
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            if (headerComp.format === 'DOCUMENT') {
                              const docFilename = selectedTemplate?.sampleValues?.header_document_filename || 'document.pdf'
                              return (
                                <div className="p-1.5 pb-0">
                                  <div className="bg-slate-100 dark:bg-slate-800/80 rounded p-2 flex items-center justify-between border border-slate-200/50 dark:border-slate-700/60">
                                    <div className="flex items-center gap-2 truncate">
                                      <FileText size={16} className="text-red-500 flex-shrink-0" />
                                      <span className="truncate max-w-[150px] text-[10px] font-bold text-slate-800 dark:text-slate-300">
                                        {docFilename}
                                      </span>
                                    </div>
                                    <Upload size={10} className="text-slate-400 rotate-180 flex-shrink-0" />
                                  </div>
                                </div>
                              )
                            }

                            if (headerComp.format === 'TEXT' && headerComp.text) {
                              let headerText = headerComp.text
                              const headerVarMatches = headerText.match(/\{\{[^\}]+\}\}/g)
                              if (headerVarMatches) {
                                const type = variableMappingTypes['header_text_1']
                                let val = ''
                                if (type === 'static') {
                                  val = staticVariableValues['header_text_1'] || selectedTemplate?.sampleValues?.['header_text_1'] || '[Header Text]'
                                } else {
                                  const mapping = variableMappings['header_text_1']
                                  val = mapping ? `[${mapping}]` : '[Header Text]'
                                }
                                headerText = headerText.replace(/\{\{[^\}]+\}\}/g, val)
                              }
                              return (
                                <div className="px-3 pt-3 font-bold text-xs text-slate-900 dark:text-slate-100 leading-tight">
                                  {headerText}
                                </div>
                              )
                            }

                            return null
                          })()}

                          {/* 2. Body Text Rendering */}
                          <div className="px-3 pt-2 pb-1 text-[11px] leading-relaxed">
                            <p className="whitespace-pre-wrap break-words">{getPreviewMessage()}</p>
                            
                            <div className="text-[10px] text-[#667781] dark:text-[#8696a0] text-right mt-1 font-semibold select-none">
                              10:00 AM
                            </div>
                          </div>

                          {/* 3. Buttons Rendering */}
                          {(() => {
                            const buttonsComp = selectedTemplate?.components?.find((c: any) => c.type === 'BUTTONS')
                            if (!buttonsComp || !Array.isArray(buttonsComp.buttons)) return null

                            return (
                              <div className="flex flex-col border-t border-[#f0f2f5] dark:border-slate-700/30">
                                {buttonsComp.buttons.map((btn: any, idx: number) => {
                                  let icon = null
                                  if (btn.type === 'URL') {
                                    icon = <ExternalLink size={10} className="text-[#008069] dark:text-emerald-400" />
                                  } else if (btn.type === 'PHONE_NUMBER') {
                                    icon = <Phone size={10} className="text-[#008069] dark:text-emerald-400" />
                                  } else if (btn.type === 'COPY_CODE') {
                                    icon = <Copy size={10} className="text-[#008069] dark:text-emerald-400" />
                                  }
                                  
                                  return (
                                    <div 
                                      key={idx} 
                                      className="py-2 px-3 text-center font-bold text-[10px] text-[#008069] dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer flex items-center justify-center gap-1.5 border-b border-[#f0f2f5] dark:border-slate-700/30 last:border-b-0 transition-colors"
                                    >
                                      <span>{btn.text}</span>
                                      {icon}
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}

                        </div>
                      </div>
                    )}
                  </div>

                  {/* Dispatch Timing & Scheduling in Indian Standard Time (IST) */}
                  <div className="bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-4 space-y-3.5 shadow-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-[#008069]" />
                        <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                          Dispatch Timing & Schedule (IST)
                        </h4>
                      </div>
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                        🇮🇳 Indian Standard Time (UTC+05:30)
                      </span>
                    </div>

                    {/* Timing Selector Buttons */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setDispatchTiming('immediate')}
                        className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                          dispatchTiming === 'immediate'
                            ? 'border-[#00a884] bg-[#e7f7f4]/40 text-[#008069]'
                            : 'border-[#e9edef] dark:border-[#2a3942] bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg shrink-0 ${dispatchTiming === 'immediate' ? 'bg-[#00a884] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                          <Send size={14} />
                        </div>
                        <div>
                          <div className="font-bold text-xs">Send Immediately</div>
                          <div className="text-[10px] opacity-80 mt-0.5">Start sending messages as soon as campaign is created</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDispatchTiming('scheduled')
                          if (!scheduledDateIST || !scheduledTimeIST) {
                            const defaults = getISTDefaults()
                            setScheduledDateIST(defaults.dateStr)
                            setScheduledTimeIST(defaults.timeStr)
                          }
                        }}
                        className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                          dispatchTiming === 'scheduled'
                            ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                            : 'border-[#e9edef] dark:border-[#2a3942] bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg shrink-0 ${dispatchTiming === 'scheduled' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                          <Calendar size={14} />
                        </div>
                        <div>
                          <div className="font-bold text-xs">Schedule for Later (IST)</div>
                          <div className="text-[10px] opacity-80 mt-0.5">Automate delivery at an exact Indian Standard Time</div>
                        </div>
                      </button>
                    </div>

                    {/* Scheduled Inputs & Presets (Visible when Scheduled is active) */}
                    {dispatchTiming === 'scheduled' && (
                      <div className="p-3.5 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Dispatch Date (IST) *
                            </label>
                            <input
                              type="date"
                              min={getISTDefaults().dateStr}
                              value={scheduledDateIST}
                              onChange={(e) => setScheduledDateIST(e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Dispatch Time (IST - 24hr / AM-PM) *
                            </label>
                            <input
                              type="time"
                              value={scheduledTimeIST}
                              onChange={(e) => setScheduledTimeIST(e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        </div>

                        {/* Quick Presets */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[10px] font-bold text-slate-500">Quick Presets (IST):</span>
                          {[
                            { label: '+30 Mins', offsetMins: 30 },
                            { label: '+1 Hour', offsetMins: 60 },
                            { label: '+3 Hours', offsetMins: 180 },
                            { label: 'Tomorrow 10:00 AM IST', customTomorrowHour: 10 },
                            { label: 'Tomorrow 04:00 PM IST', customTomorrowHour: 16 }
                          ].map((preset, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                const now = new Date()
                                let targetDate: Date
                                if (preset.offsetMins) {
                                  targetDate = new Date(now.getTime() + preset.offsetMins * 60 * 1000)
                                } else if (preset.customTomorrowHour !== undefined) {
                                  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
                                  const yyyyMmDd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow)
                                  const hourStr = String(preset.customTomorrowHour).padStart(2, '0')
                                  targetDate = new Date(`${yyyyMmDd}T${hourStr}:00:00+05:30`)
                                } else {
                                  targetDate = now
                                }

                                const dStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(targetDate)
                                const tStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(targetDate)
                                setScheduledDateIST(dStr)
                                setScheduledTimeIST(tStr)
                              }}
                              className="text-[10px] font-bold px-2 py-1 rounded bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        {/* Live IST Scheduled Preview Badge */}
                        {scheduledDateIST && scheduledTimeIST && (() => {
                          const istDate = new Date(`${scheduledDateIST}T${scheduledTimeIST}:00+05:30`)
                          const isPast = isNaN(istDate.getTime()) || istDate.getTime() <= Date.now()
                          return (
                            <div className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                              isPast 
                                ? 'bg-amber-50 border-amber-200 text-amber-800' 
                                : 'bg-indigo-100/60 dark:bg-indigo-900/40 border-indigo-200 dark:border-indigo-700 text-indigo-900 dark:text-indigo-100'
                            }`}>
                              <div className="flex items-center gap-2">
                                <Calendar size={14} className={isPast ? 'text-amber-600' : 'text-indigo-600 dark:text-indigo-400'} />
                                <div>
                                  <span className="font-bold">Execution Time: </span>
                                  <span className="font-mono font-bold">{formatISTDateTime(istDate)}</span>
                                </div>
                              </div>
                              {isPast ? (
                                <span className="text-[10px] font-bold text-amber-700">⚠️ Selected time is in the past!</span>
                              ) : (
                                <span className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                                  {(() => {
                                    const diffMinutes = Math.round((istDate.getTime() - Date.now()) / (60 * 1000))
                                    if (diffMinutes < 60) return `starts in ~${diffMinutes}m`
                                    const hours = Math.floor(diffMinutes / 60)
                                    const mins = diffMinutes % 60
                                    return `starts in ~${hours}h ${mins}m`
                                  })()}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>

                  <div className="border border-[#e9edef] rounded-xl p-3.5 space-y-2.5 text-xs bg-[#f8f9fa]">
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Campaign Name:</span>
                      <span className="font-bold text-[#111b21] dark:text-white">{newCampaignName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Selected Template:</span>
                      <span className="font-bold text-[#111b21] dark:text-white">
                        {selectedTemplate ? selectedTemplate.name : 'Custom Message'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Recipients:</span>
                      <span className="font-bold text-[#008069] tabular-nums">
                        {reviewRecipientCount.toLocaleString()}
                        <span className="font-normal text-[#667781] dark:text-[#8696a0]"> · from {audienceSource === 'excel' ? (excelFile?.name || 'spreadsheet') : 'CRM contacts'}</span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Dispatch Schedule:</span>
                      <span className={`font-bold ${dispatchTiming === 'scheduled' ? 'text-indigo-600 dark:text-indigo-400' : 'text-[#111b21] dark:text-white'}`}>
                        {dispatchTiming === 'immediate'
                          ? 'Send Immediately'
                          : scheduledDateIST && scheduledTimeIST
                          ? `${formatISTDateTime(new Date(`${scheduledDateIST}T${scheduledTimeIST}:00+05:30`))} (Scheduled)`
                          : 'Schedule Pending'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

          {/* Full Screen Sticky Bottom Navigation Footer */}
          <footer className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#1f2c34]/95 backdrop-blur-md border-t border-[#e9edef] dark:border-[#2a3942] px-4 md:px-8 py-3.5 shadow-2xl shrink-0">
            <div className="max-w-4xl mx-auto w-full flex items-center justify-between gap-3">
              {wizardStep > 1 ? (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="h-10 px-4.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#202d36] text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                >
                  <ArrowLeft size={15} />
                  <span>Back</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={requestCloseWizard}
                  className="h-10 px-4.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#202d36] text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                >
                  <span>Cancel</span>
                </button>
              )}

              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                <span>
                  Step {wizardStep} of 4:{' '}
                  <strong className="text-slate-800 dark:text-white">
                    {wizardStep === 1
                      ? 'Message'
                      : wizardStep === 2
                      ? 'Audience'
                      : wizardStep === 3
                      ? 'Personalise'
                      : 'Review & send'}
                  </strong>
                </span>
                {/* On the audience step, keep the number that matters in view while scrolling the list */}
                {wizardStep === 2 && (() => {
                  const count = audienceSource === 'db' ? crmSelection.recipients : (sheetCheck?.recipients.length ?? 0)
                  return (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${count > 0 ? 'bg-emerald-100 dark:bg-emerald-950/60 text-[#008069] dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {count.toLocaleString()} {count === 1 ? 'recipient' : 'recipients'}
                    </span>
                  )
                })()}
              </div>

              {wizardStep < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="h-10 px-5 rounded-xl bg-[#00a884] hover:bg-[#008f72] text-xs font-bold text-white flex items-center gap-1.5 transition-all shadow-md cursor-pointer hover:shadow-lg active:scale-98"
                >
                  <span>Continue</span>
                  <ChevronRight size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLaunchCampaign}
                  disabled={isSubmitting || reviewRecipientCount === 0}
                  className={`h-10 px-6 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all shadow-md cursor-pointer disabled:opacity-50 hover:shadow-lg active:scale-98 ${
                    dispatchTiming === 'scheduled'
                      ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-none'
                      : 'bg-[#00a884] hover:bg-[#008f72]'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>{dispatchTiming === 'scheduled' ? 'Scheduling...' : 'Launching...'}</span>
                    </>
                  ) : dispatchTiming === 'scheduled' ? (
                    <>
                      <Calendar size={15} />
                      <span>Schedule for {reviewRecipientCount.toLocaleString()}</span>
                    </>
                  ) : (
                    <>
                      <Megaphone size={15} />
                      <span>Send to {reviewRecipientCount.toLocaleString()} now</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </footer>
        </div>
      )}
    </div>
  )
}
