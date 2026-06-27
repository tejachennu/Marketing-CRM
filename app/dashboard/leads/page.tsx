'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { Lead, PipelineStage, Contact, User as SupabaseUser } from '@/lib/types'
import {
  Plus, DollarSign, X, Trash2, MessageCircle, Save, Search,
  Calendar, TrendingUp, Trophy, XCircle, Pause, Filter,
  ChevronDown, ChevronUp, ArrowUpDown, Flame, Sun, Snowflake,
  BarChart3, Target, Clock, Grip, CheckCircle2, Ban,
  ExternalLink, Phone, Mail, Building2, Package, Loader2,
  List, LayoutGrid, Eye, Sparkles, User
} from 'lucide-react'
import Link from 'next/link'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend
} from 'recharts'

// ─── Types ───
interface LeadWithContact extends Lead {
  contact?: Contact
  stage?: PipelineStage
}

type StatusFilter = 'all' | 'active' | 'won' | 'lost' | 'on_hold'
type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type ViewMode = 'list' | 'analytics' | 'performance'
type DrawerTab = 'overview' | 'discussions' | 'ai_summary'
type SortField = 'title' | 'value' | 'created_at' | 'last_activity_at' | 'expected_close_date'
type SortDir = 'asc' | 'desc'

const SOURCE_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'other', label: 'Other' },
]

const LOST_REASONS = [
  'Price too high',
  'Went with competitor',
  'No budget',
  'Bad timing',
  'No response',
  'Feature missing',
  'Other',
]

const PRIORITY_CONFIG = {
  high: { label: 'Hot', icon: Flame, color: 'text-rose-500', bg: 'bg-rose-50', border: 'border-rose-100' },
  medium: { label: 'Warm', icon: Sun, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100' },
  low: { label: 'Cold', icon: Snowflake, color: 'text-blue-400', bg: 'bg-blue-50', border: 'border-blue-100' },
}

const STATUS_CONFIG = {
  active: { label: 'Active', color: '#00a884', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  won: { label: 'Won', color: '#00a884', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  lost: { label: 'Lost', color: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  on_hold: { label: 'On Hold', color: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
}

export default function LeadsPage() {
  // ─── Core State ───
  const [leads, setLeads] = useState<LeadWithContact[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [users, setUsers] = useState<{ id: string; full_name: string | null; email: string; role?: string }[]>([])
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
  })
  const [currency, setCurrency] = useState('USD')

  // ─── Contact Search State ───
  const [contactSearchInput, setContactSearchInput] = useState('')
  const [showContactDropdown, setShowContactDropdown] = useState(false)
  const [searchingContacts, setSearchingContacts] = useState(false)

  // ─── Pagination State ───
  const [currentPage, setCurrentPage] = useState(1)
  const [totalLeadsCount, setTotalLeadsCount] = useState(0)
  const pageSize = 15

  // ─── Analytics State ───
  const [allLeadsForAnalytics, setAllLeadsForAnalytics] = useState<Lead[]>([])

  // ─── Filters & View ───
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [analyticsChartView, setAnalyticsChartView] = useState<'month' | 'week' | 'pipeline' | 'source'>('month')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminSeeAll, setAdminSeeAll] = useState(true)
  const [readOnlyMode, setReadOnlyMode] = useState(false)

  // ─── Date Range Filter ───
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [dateFilterApplied, setDateFilterApplied] = useState(false)

  // ─── Popover Overlay Filter ───
  const [showFilterPopover, setShowFilterPopover] = useState(false)
  const filterPopoverRef = useRef<HTMLDivElement>(null)

  // Handle click outside for filter popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(event.target as Node)) {
        setShowFilterPopover(false)
      }
    }
    if (showFilterPopover) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterPopover])

  // ─── Modals ───
  const [showAddModal, setShowAddModal] = useState(false)
  const [isOfflineLead, setIsOfflineLead] = useState(false)
  const [offlineContact, setOfflineContact] = useState({ first_name: '', last_name: '', phone_number: '', company: '' })
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('overview')
  const [showWonLostModal, setShowWonLostModal] = useState<{ leadId: string; action: 'won' | 'lost' } | null>(null)
  const [wonLostReason, setWonLostReason] = useState('')
  const [wonLostNote, setWonLostNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // ─── Drag & Drop ───
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const dragLeadId = useRef<string | null>(null)

  // ─── Edit States (Inspector) ───
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editValue, setEditValue] = useState('')
  const [editStageId, setEditStageId] = useState('')
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [editSource, setEditSource] = useState('')
  const [editExpectedClose, setEditExpectedClose] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editProductService, setEditProductService] = useState('')
  const [editAssignedTo, setEditAssignedTo] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiSuccess, setAiSuccess] = useState(false)
  const [activities, setActivities] = useState<any[]>([])
  const [activityNote, setActivityNote] = useState('')

  async function fetchActivities(leadId: string) {
    const { data } = await supabase.from('lead_activities').select('*, user:users(full_name)').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (data) setActivities(data)
  }

  async function handleAddNote() {
    if (!activityNote.trim() || !selectedLeadId || !user) return
    setIsSaving(true)
    try {
      await supabase.from('lead_activities').insert([{
        organization_id: user.organization_id,
        lead_id: selectedLeadId,
        user_id: user.id,
        activity_type: 'note',
        content: activityNote
      }])
      setActivityNote('')
      await fetchActivities(selectedLeadId)
    } finally {
      setIsSaving(false)
    }
  }

  // ─── New Lead Form ───
  const [newLead, setNewLead] = useState({
    title: '', description: '', value: '', contact_id: '',
    priority: 'medium' as const, source: 'other',
    expected_close_date: '', notes: '', product_service: '',
    assigned_to: '',
  })

  // ─── Load Data ───
  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (selectedLeadId) {
      const lead = leads.find(l => l.id === selectedLeadId)
      if (lead) {
        setEditTitle(lead.title || '')
        setEditDescription(lead.description || '')
        setEditValue(lead.value ? String(lead.value) : '')
        setEditStageId(lead.pipeline_stage_id || '')
        setEditPriority(lead.priority || 'medium')
        setEditSource(lead.source || 'other')
        setEditExpectedClose(lead.expected_close_date || '')
        setEditNotes(lead.notes || '')
        setEditProductService(lead.product_service || '')
        setEditAssignedTo(lead.assigned_to || '')
        // Reset AI states
        setAiError(null)
        setAiSuccess(false)
        fetchActivities(selectedLeadId)
      }
    }
  }, [selectedLeadId, leads])

  async function loadData() {
    try {
      await restoreSupabaseSession()
      let userId: string | null = null
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) userId = authUser.id
      else {
        const storedUser = authSessionManager.getUser()
        if (storedUser?.id) userId = storedUser.id
      }
      if (!userId) { window.location.href = '/login'; return }

      const email = authUser?.email || authSessionManager.getUser()?.email || ''
      const userData = await ensureUserProfile(userId, email)
      if (!userData) return
      setUser(userData)
      // ── Role-based access ──────────────────────────────────────────────────
      // Admin/Manager roles: full pipeline + analytics visibility
      // sales_employee: only sees assigned leads unless see_all is true
      const isAdminRole = ['super_admin', 'org_admin', 'org_manager', 'owner', 'admin', 'superadmin', 'OrgAdmin', 'Manager', 'saleslead'].includes(userData.role || '')
      setIsAdmin(isAdminRole)
      setAdminSeeAll(userData.see_all !== false)
      setReadOnlyMode(userData.read_only === true)

      // Fetch stages
      const { data: stagesData } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('organization_id', userData.organization_id)
        .order('position')
      setStages(stagesData || [])

      // Fetch initial recent contacts
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20)
      setContacts((contactsData || []) as Contact[])

      // Fetch team members
      const { data: usersData } = await supabase
        .from('users')
        .select('id, full_name, email, role')
        .eq('organization_id', userData.organization_id)
      setUsers((usersData || []) as any)

      // Fetch organization features
      const { data: orgData } = await supabase
        .from('organizations')
        .select('enable_ai, enable_email, enable_messages, enable_phone_calls, currency')
        .eq('id', userData.organization_id)
        .maybeSingle()
      if (orgData) {
        setFeatures({
          enable_ai: orgData.enable_ai !== false,
          enable_email: orgData.enable_email !== false,
          enable_messages: orgData.enable_messages !== false,
          enable_phone_calls: orgData.enable_phone_calls !== false,
        })
        if (orgData.currency) setCurrency(orgData.currency)
      }

      // Fetch dynamic lists
      await Promise.all([
        loadLeads(userData, 1, searchQuery, statusFilter, priorityFilter, fromDate, toDate, dateFilterApplied, sortField, sortDir),
        loadAnalyticsLeads(userData.organization_id, userData.id, userData.see_all !== false)
      ])

    } catch (error) {
      console.error('Error loading leads data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Fetch contacts matching a query, or default to 20 recent contacts
  const fetchContacts = useCallback(async (query: string) => {
    try {
      if (!query.trim()) {
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(20)
        setContacts((contactsData || []) as Contact[])
        return
      }
      setSearchingContacts(true)
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone_number.ilike.%${query}%,company.ilike.%${query}%`)
        .limit(20)
      setContacts((contactsData || []) as Contact[])
    } catch (error) {
      console.error('Error searching contacts:', error)
    } finally {
      setSearchingContacts(false)
    }
  }, [])

  async function loadAnalyticsLeads(orgId: string, userId: string, seeAll: boolean) {
    try {
      let aq = supabase
        .from('leads')
        .select('value, status, priority, source, created_at, last_activity_at, updated_at, won_at, lost_at, assigned_to')
        .eq('organization_id', orgId)

      if (!seeAll) {
        aq = aq.eq('assigned_to', userId)
      }

      const { data, error } = await aq
      if (error) throw error
      setAllLeadsForAnalytics((data || []) as Lead[])
    } catch (error) {
      console.error('Error fetching analytics leads:', error)
    }
  }

  async function loadLeads(
    currentUser: SupabaseUser,
    page: number,
    queryText: string,
    status: StatusFilter,
    priority: PriorityFilter,
    fromD: string,
    toD: string,
    dateApplied: boolean,
    sField: SortField,
    sDir: SortDir
  ) {
    try {
      let contactIds: string[] = []
      if (queryText.trim()) {
        const { data: matchedContacts } = await supabase
          .from('contacts')
          .select('id')
          .or(`first_name.ilike.%${queryText}%,last_name.ilike.%${queryText}%,company.ilike.%${queryText}%`)
        contactIds = matchedContacts?.map(c => c.id) || []
      }

      let q = supabase
        .from('leads')
        .select(`
          *,
          contact:contact_id (
            id, first_name, last_name, email, company, phone_number
          ),
          stage:pipeline_stage_id (
            id, name, color, position
          )
        `, { count: 'exact' })
        .eq('organization_id', currentUser.organization_id)

      const seeAll = currentUser.see_all !== false
      if (!seeAll) {
        q = q.eq('assigned_to', currentUser.id)
      }

      if (queryText.trim()) {
        const searchOrs = [
          `title.ilike.%${queryText}%`,
          `product_service.ilike.%${queryText}%`
        ]
        if (contactIds.length > 0) {
          searchOrs.push(`contact_id.in.(${contactIds.map(id => `"${id}"`).join(',')})`)
        }
        q = q.or(searchOrs.join(','))
      }

      if (status !== 'all') {
        q = q.eq('status', status)
      }
      if (priority !== 'all') {
        q = q.eq('priority', priority)
      }

      if (dateApplied) {
        const dateCol = status === 'won' ? 'won_at' : (status === 'lost' ? 'lost_at' : 'created_at')
        if (fromD) {
          q = q.gte(dateCol, new Date(fromD).toISOString())
        }
        if (toD) {
          const endOfDay = new Date(toD)
          endOfDay.setHours(23, 59, 59, 999)
          q = q.lte(dateCol, endOfDay.toISOString())
        }
      }

      q = q.order(sField, { ascending: sDir === 'asc' })

      if (viewMode === 'list') {
        const from = (page - 1) * pageSize
        const to = from + pageSize - 1
        q = q.range(from, to)
      } else {
        q = q.eq('status', 'active').limit(200)
      }

      const { data, count, error } = await q
      if (error) throw error

      const formatted = (data || []).map((lead: any) => ({
        ...lead,
        contact: Array.isArray(lead.contact) ? lead.contact[0] : lead.contact,
        stage: Array.isArray(lead.stage) ? lead.stage[0] : lead.stage,
      })) as LeadWithContact[]

      setLeads(formatted)
      setTotalLeadsCount(count || 0)

    } catch (error) {
      console.error('Error fetching leads:', error)
    }
  }

  useEffect(() => {
    if (!showAddModal) return
    const timer = setTimeout(() => {
      fetchContacts(contactSearchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [contactSearchInput, showAddModal, fetchContacts])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, priorityFilter, fromDate, toDate])

  useEffect(() => {
    if (user) {
      loadLeads(user, currentPage, searchQuery, statusFilter, priorityFilter, fromDate, toDate, dateFilterApplied, sortField, sortDir)
    }
  }, [user, currentPage, searchQuery, statusFilter, priorityFilter, fromDate, toDate, dateFilterApplied, sortField, sortDir, viewMode])

  function setDateRangePreset(preset: 'this_month' | 'last_month' | 'ytd' | 'clear') {
    if (preset === 'clear') {
      setFromDate('')
      setToDate('')
      setDateFilterApplied(false)
      return
    }

    const now = new Date()
    let start: Date
    let end: Date

    if (preset === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    } else if (preset === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end = new Date(now.getFullYear(), now.getMonth(), 0)
    } else { // ytd
      start = new Date(now.getFullYear(), 0, 1)
      end = now
    }

    const format = (d: Date) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    setFromDate(format(start))
    setToDate(format(end))
    setDateFilterApplied(true)
  }

  async function handleSeedDemoData() {
    if (!user) return
    setActionLoading(true)
    try {
      // 1. Ensure pipeline stages exist
      let currentStages = stages
      if (currentStages.length === 0) {
        const defaultStages = [
          { name: 'New Lead', color: '#3b82f6', position: 1 },
          { name: 'Contacted', color: '#f59e0b', position: 2 },
          { name: 'Interested', color: '#10b981', position: 3 },
          { name: 'Qualified', color: '#8b5cf6', position: 4 },
          { name: 'Proposal Sent', color: '#ec4899', position: 5 },
          { name: 'Negotiation', color: '#f43f5e', position: 6 },
          { name: 'Follow-up', color: '#6b7280', position: 7 },
          { name: 'Demo Scheduled', color: '#06b6d4', position: 8 }
        ].map(s => ({ ...s, organization_id: user.organization_id }))

        const { data: insertedStages, error: stagesErr } = await supabase
          .from('pipeline_stages')
          .insert(defaultStages)
          .select()

        if (stagesErr) throw stagesErr
        currentStages = insertedStages || []
        setStages(currentStages)
      }

      // 2. Insert demo contacts
      const demoContacts = [
        {
          first_name: 'John',
          last_name: 'Smith',
          company: 'Tech Corp',
          email: 'john@techcorp.io',
          phone_number: '+16475523753',
          whatsapp_number: 'whatsapp:+16475523753',
          organization_id: user.organization_id
        },
        {
          first_name: 'Sarah',
          last_name: 'Johnson',
          company: 'Innovation Labs',
          email: 'sarah@innovation.com',
          phone_number: '+14165551234',
          whatsapp_number: 'whatsapp:+14165551234',
          organization_id: user.organization_id
        },
        {
          first_name: 'Michael',
          last_name: 'Chen',
          company: 'Digital Solutions',
          email: 'mchen@digitalsol.com',
          phone_number: '+18005551234',
          whatsapp_number: 'whatsapp:+18005551234',
          organization_id: user.organization_id
        },
        {
          first_name: 'Emily',
          last_name: 'Davis',
          company: 'Acme Products',
          email: 'emily@acme.com',
          phone_number: '+15145559876',
          whatsapp_number: 'whatsapp:+15145559876',
          organization_id: user.organization_id
        }
      ]

      const { data: insertedContacts, error: contactsErr } = await supabase
        .from('contacts')
        .insert(demoContacts)
        .select()

      if (contactsErr) throw contactsErr
      const createdContacts = insertedContacts || []

      // 3. Insert demo leads linked to those contacts
      const cJohn = createdContacts.find(c => c.first_name === 'John')
      const cSarah = createdContacts.find(c => c.first_name === 'Sarah')
      const cMichael = createdContacts.find(c => c.first_name === 'Michael')
      const cEmily = createdContacts.find(c => c.first_name === 'Emily')

      const stage1 = currentStages[0]?.id
      const stage2 = currentStages[1]?.id
      const stage3 = currentStages[2]?.id || stage1
      const stage4 = currentStages[3]?.id || stage1

      const demoLeads = []

      if (cJohn) {
        demoLeads.push({
          organization_id: user.organization_id,
          contact_id: cJohn.id,
          title: 'Enterprise License',
          description: 'Interested in buying 500 enterprise seats.',
          value: 25000,
          priority: 'high',
          status: 'active',
          source: 'website',
          pipeline_stage_id: stage3,
          created_by: user.id,
          assigned_to: user.id,
          last_activity_at: new Date(Date.now() - 2 * 3600000).toISOString(),
          product_service: 'Enterprise SaaS'
        })
      }

      if (cSarah) {
        demoLeads.push({
          organization_id: user.organization_id,
          contact_id: cSarah.id,
          title: 'SaaS Subscription Offer',
          description: 'Trialing our premium dashboard tools.',
          value: 4800,
          priority: 'medium',
          status: 'active',
          source: 'whatsapp',
          pipeline_stage_id: stage2,
          created_by: user.id,
          assigned_to: user.id,
          last_activity_at: new Date(Date.now() - 12 * 3600000).toISOString(),
          product_service: 'Premium Plan'
        })
      }

      if (cMichael) {
        demoLeads.push({
          organization_id: user.organization_id,
          contact_id: cMichael.id,
          title: 'Integration Services Contract',
          description: 'Consulting for API custom integrations.',
          value: 12500,
          priority: 'low',
          status: 'won',
          won_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          won_lost_reason: 'Client loved the WhatsApp integration speed.',
          source: 'referral',
          pipeline_stage_id: stage4,
          created_by: user.id,
          assigned_to: user.id,
          last_activity_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          product_service: 'API Integration Consulting'
        })
      }

      if (cEmily) {
        demoLeads.push({
          organization_id: user.organization_id,
          contact_id: cEmily.id,
          title: 'Retail Store App Upgrade',
          description: 'Request for custom mobile checkout options.',
          value: 7500,
          priority: 'high',
          status: 'active',
          source: 'cold_call',
          pipeline_stage_id: stage1,
          created_by: user.id,
          assigned_to: null,
          last_activity_at: new Date(Date.now() - 1 * 3600000).toISOString(),
          product_service: 'Mobile Checkout Integration'
        })
      }

      if (demoLeads.length > 0) {
        const { error: leadsErr } = await supabase.from('leads').insert(demoLeads)
        if (leadsErr) throw leadsErr
      }

      await loadData()
    } catch (error) {
      console.error('Error seeding demo data:', error)
      alert('Failed to seed demo data. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── CRUD Operations ───
  async function handleAddLead() {
    if (!user || !newLead.title) return
    if (!isOfflineLead && !newLead.contact_id) return
    if (isOfflineLead && !offlineContact.first_name) return // require at least a name
    
    setActionLoading(true)
    try {
      let finalContactId = newLead.contact_id
      
      if (isOfflineLead) {
        // Create offline contact
        const { data: contactData, error: contactError } = await supabase.from('contacts').insert([{
          organization_id: user.organization_id,
          first_name: offlineContact.first_name,
          last_name: offlineContact.last_name || null,
          phone_number: offlineContact.phone_number || 'Offline',
          company: offlineContact.company || null,
          created_by: user.id
        }]).select().single()
        
        if (contactError) throw contactError
        finalContactId = contactData.id
      }

      const { data: newLeadData, error } = await supabase.from('leads').insert([{
        organization_id: user.organization_id,
        contact_id: finalContactId,
        title: newLead.title,
        description: newLead.description,
        value: newLead.value ? parseFloat(newLead.value) : null,
        priority: newLead.priority,
        status: 'active',
        source: newLead.source,
        expected_close_date: newLead.expected_close_date || null,
        notes: newLead.notes,
        product_service: newLead.product_service,
        assigned_to: newLead.assigned_to || null,
        pipeline_stage_id: stages[0]?.id,
        created_by: user.id,
        last_activity_at: new Date().toISOString(),
      }]).select().single()
      
      if (error) throw error
      
      // Log creation activity
      await supabase.from('lead_activities').insert([{
        organization_id: user.organization_id,
        lead_id: newLeadData.id,
        user_id: user.id,
        activity_type: 'creation',
        content: 'Lead created'
      }])

      setShowAddModal(false)
      setIsOfflineLead(false)
      setOfflineContact({ first_name: '', last_name: '', phone_number: '', company: '' })
      setNewLead({ title: '', description: '', value: '', contact_id: '', priority: 'medium', source: 'other', expected_close_date: '', notes: '', product_service: '', assigned_to: '' })
      await loadData()
    } catch (error) {
      console.error('Error adding lead:', error)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSaveChanges() {
    if (!selectedLeadId || !user) return
    setIsSaving(true)
    try {
      const currentLead = leads.find(l => l.id === selectedLeadId)
      const { error } = await supabase.from('leads').update({
        title: editTitle,
        description: editDescription,
        value: editValue ? parseFloat(editValue) : null,
        priority: editPriority,
        pipeline_stage_id: editStageId,
        source: editSource,
        expected_close_date: editExpectedClose || null,
        notes: editNotes,
        product_service: editProductService,
        assigned_to: editAssignedTo || null,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', selectedLeadId)
      if (error) throw error
      
      // Log stage change if applicable
      if (currentLead && currentLead.pipeline_stage_id !== editStageId) {
        const newStage = stages.find(s => s.id === editStageId)
        await supabase.from('lead_activities').insert([{
          organization_id: user.organization_id,
          lead_id: selectedLeadId,
          user_id: user.id,
          activity_type: 'stage_change',
          content: `Moved to ${newStage?.name || 'new stage'}`
        }])
      }

      await loadData()
      setSelectedLeadId(null)
    } catch (error) {
      console.error('Error saving lead:', error)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteLead() {
    if (!selectedLeadId || !confirm('Delete this lead permanently?')) return
    setIsSaving(true)
    try {
      await supabase.from('leads').delete().eq('id', selectedLeadId)
      await loadData()
      setSelectedLeadId(null)
    } catch (error) {
      console.error('Error deleting lead:', error)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAISummarize() {
    if (!selectedLeadData) return
    setAiLoading(true)
    setAiError(null)
    setAiSuccess(false)

    try {
      // 1. Try to find a conversation for this lead
      let conversationId = null

      const { data: convByLead, error: leadErr } = await supabase
        .from('conversations')
        .select('id')
        .eq('lead_id', selectedLeadData.id)
        .maybeSingle()

      if (leadErr) console.error('Error fetching conv by lead:', leadErr)

      if (convByLead?.id) {
        conversationId = convByLead.id
      } else {
        // Fallback to fetching by contact_id
        const { data: convByContact, error: contactErr } = await supabase
          .from('conversations')
          .select('id')
          .eq('contact_id', selectedLeadData.contact_id)
          .maybeSingle()

        if (contactErr) console.error('Error fetching conv by contact:', contactErr)
        if (convByContact?.id) {
          conversationId = convByContact.id
        }
      }

      if (!conversationId) {
        throw new Error('No WhatsApp conversation history found for this lead or contact. AI cannot extract profile data without message history.')
      }

      // 2. Call the summarize API
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversationId }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to analyze transcript.')
      }

      const profile = result.profile
      if (profile) {
        if (profile.title) setEditTitle(profile.title)
        if (profile.value !== undefined && profile.value !== null) {
          setEditValue(String(profile.value))
        }
        if (profile.priority && (profile.priority === 'high' || profile.priority === 'medium' || profile.priority === 'low')) {
          setEditPriority(profile.priority)
        }
        if (profile.product_service) setEditProductService(profile.product_service)
        if (profile.summary) setEditDescription(profile.summary)
        if (profile.notes) {
          if (Array.isArray(profile.notes)) {
            setEditNotes(profile.notes.join('\n'))
          } else {
            setEditNotes(profile.notes)
          }
        }
        setAiSuccess(true)
      } else {
        throw new Error('No profile data returned from AI.')
      }
    } catch (err: any) {
      console.error('AI Profile Error:', err)
      setAiError(err.message || 'An error occurred during AI profiling.')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleStatusChange(leadId: string, newStatus: 'won' | 'lost' | 'on_hold' | 'active') {
    if (newStatus === 'won' || newStatus === 'lost') {
      setShowWonLostModal({ leadId, action: newStatus })
      return
    }
    setActionLoading(true)
    try {
      await supabase.from('leads').update({
        status: newStatus,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', leadId)
      
      if (user) {
        await supabase.from('lead_activities').insert([{
          organization_id: user.organization_id,
          lead_id: leadId,
          user_id: user.id,
          activity_type: 'status_change',
          content: `Status changed to ${newStatus}`
        }])
      }

      await loadData()
    } catch (error) {
      console.error('Error updating status:', error)
    } finally {
      setActionLoading(false)
    }
  }

  async function confirmWonLost() {
    if (!showWonLostModal) return
    setActionLoading(true)
    const { leadId, action } = showWonLostModal
    try {
      const now = new Date().toISOString()
      await supabase.from('leads').update({
        status: action,
        won_lost_reason: wonLostReason || wonLostNote || '',
        ...(action === 'won' ? { won_at: now } : { lost_at: now }),
        last_activity_at: now,
        updated_at: now,
      }).eq('id', leadId)
      
      if (user) {
        await supabase.from('lead_activities').insert([{
          organization_id: user.organization_id,
          lead_id: leadId,
          user_id: user.id,
          activity_type: 'status_change',
          content: `Marked as ${action.toUpperCase()}${wonLostReason ? ` - ${wonLostReason}` : ''}${wonLostNote ? ` - ${wonLostNote}` : ''}`
        }])
      }

      await loadData()
      setShowWonLostModal(null)
      setWonLostReason('')
      setWonLostNote('')
    } catch (error) {
      console.error('Error updating status:', error)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleMoveStage(leadId: string, stageId: string) {
    try {
      await supabase.from('leads').update({
        pipeline_stage_id: stageId,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', leadId)
      await loadData()
    } catch (error) {
      console.error('Error moving lead:', error)
    }
  }

  // ─── Computed Values ───
  const filteredLeads = leads
  const sortedLeads = leads

  // Pagination
  const totalPages = Math.ceil(totalLeadsCount / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedLeads = leads

  // Analytics
  const now = new Date()
  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const thisMonthStartStr = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const thisMonthEndStr = formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const lastMonthStartStr = formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const lastMonthEndStr = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 0))

  const activeLeads = allLeadsForAnalytics.filter(l => l.status === 'active')
  const wonLeads = allLeadsForAnalytics.filter(l => l.status === 'won')
  const lostLeads = allLeadsForAnalytics.filter(l => l.status === 'lost')

  const totalPipelineValue = activeLeads.reduce((s, l) => s + (l.value || 0), 0)

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const wonThisMonth = wonLeads.filter(l => new Date(l.won_at || l.updated_at).getTime() >= startOfMonth)
  const wonRevenueThisMonth = wonThisMonth.reduce((s, l) => s + (l.value || 0), 0)

  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime()
  const wonLastMonth = wonLeads.filter(l => {
    const t = new Date(l.won_at || l.updated_at).getTime()
    return t >= startOfLastMonth && t <= endOfLastMonth
  })
  const wonRevenueLastMonth = wonLastMonth.reduce((s, l) => s + (l.value || 0), 0)

  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime()
  const wonYTD = wonLeads.filter(l => new Date(l.won_at || l.updated_at).getTime() >= startOfYear)
  const wonRevenueYTD = wonYTD.reduce((s, l) => s + (l.value || 0), 0)

  const conversionRate = (wonLeads.length + lostLeads.length) > 0
    ? Math.round((wonLeads.length / (wonLeads.length + lostLeads.length)) * 100) : 0

  const avgDealSize = wonLeads.length > 0
    ? Math.round(wonLeads.reduce((s, l) => s + (l.value || 0), 0) / wonLeads.length) : 0

  // Date range filter
  const dateFilteredWon = dateFilterApplied ? wonLeads.filter(l => {
    const t = new Date(l.won_at || l.updated_at).getTime()
    const start = fromDate ? new Date(fromDate).getTime() : 0
    const end = toDate ? new Date(toDate).getTime() + 86400000 - 1 : Infinity
    return t >= start && t <= end
  }) : []
  const dateFilteredRevenue = dateFilteredWon.reduce((s, l) => s + (l.value || 0), 0)

  // ── Week-wise analytics breakdown (last 8 weeks) ──
  const weeklyBreakdown = Array.from({ length: 8 }, (_, i) => {
    const weekOffset = 7 - i
    const wEnd = new Date(now)
    wEnd.setDate(now.getDate() - (7 - i) * 7 + 6)
    wEnd.setHours(23, 59, 59, 999)
    const wStart = new Date(wEnd)
    wStart.setDate(wEnd.getDate() - 6)
    wStart.setHours(0, 0, 0, 0)
    const wWon = wonLeads.filter(l => {
      const t = new Date(l.won_at || l.updated_at).getTime()
      return t >= wStart.getTime() && t <= wEnd.getTime()
    })
    const wCreated = allLeadsForAnalytics.filter(l => {
      const t = new Date(l.created_at).getTime()
      return t >= wStart.getTime() && t <= wEnd.getTime()
    })
    const weekLabel = `W${i + 1} (${wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    return {
      week: weekLabel,
      sales: wWon.length,
      revenue: wWon.reduce((s, l) => s + (l.value || 0), 0),
      newLeads: wCreated.length,
    }
  })

  // ── Current month: daily deals count + revenue ──
  const currentDay = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dailyRevenueData = Array.from({ length: currentDay }, (_, i) => {
    const day = i + 1
    const dateStart = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0).getTime()
    const dateEnd = new Date(now.getFullYear(), now.getMonth(), day, 23, 59, 59).getTime()
    const wonToday = wonThisMonth.filter(l => {
      const t = new Date(l.won_at || l.updated_at).getTime()
      return t >= dateStart && t <= dateEnd
    })
    return {
      day: day.toString(),
      revenue: wonToday.reduce((s, l) => s + (l.value || 0), 0),
      sales: wonToday.length,
    }
  })

  // ── Month-end prediction using linear trend ──
  const daysElapsed = currentDay
  const avgDailyRevenue = daysElapsed > 0 ? wonRevenueThisMonth / daysElapsed : 0
  const avgDailySales = daysElapsed > 0 ? wonThisMonth.length / daysElapsed : 0
  const predictedMonthRevenue = Math.round(avgDailyRevenue * daysInMonth)
  const predictedMonthSales = Math.round(avgDailySales * daysInMonth)
  const revenueGrowthVsLast = wonRevenueLastMonth > 0
    ? Math.round(((predictedMonthRevenue - wonRevenueLastMonth) / wonRevenueLastMonth) * 100) : 0
  const projectionConfidence = Math.min(Math.round((daysElapsed / daysInMonth) * 100), 95)

  // ── Daily chart incl. projected remaining days ──
  const fullMonthChart = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    if (day <= currentDay) {
      const actual = dailyRevenueData[i] || { revenue: 0, sales: 0 }
      return { day: day.toString(), revenue: actual.revenue, sales: actual.sales, projected: null as number | null }
    }
    return { day: day.toString(), revenue: 0, sales: 0, projected: Math.round(avgDailyRevenue) }
  })

  // Data for Sales Performance Graphs
  const teamPerformanceData = users.map((u: any) => {
    const userWon = wonLeads.filter(l => l.assigned_to === u.id)
    return {
      name: u.full_name || 'Unknown',
      revenue: userWon.reduce((s, l) => s + (l.value || 0), 0),
      deals: userWon.length
    }
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5) // Top 5

  // Data for Sales Analytics Graphs
  const pipelineByStageData = stages.map(s => {
    const stageLeads = activeLeads.filter(l => l.pipeline_stage_id === s.id)
    return {
      name: s.name,
      value: stageLeads.reduce((sum, l) => sum + (l.value || 0), 0),
      count: stageLeads.length,
      fill: s.color || '#8696a0'
    }
  })

  const sourceCounts = allLeadsForAnalytics.reduce((acc, l) => {
    const src = (l.source || 'other').replace('_', ' ')
    acc[src] = (acc[src] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const SOURCE_COLORS = ['#00a884', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']
  const leadsBySourceData = Object.entries(sourceCounts).map(([name, value], idx) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    color: SOURCE_COLORS[idx % SOURCE_COLORS.length]
  })).sort((a, b) => b.value - a.value)

  // Stale leads (no activity > 7 days)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).getTime()
  const staleLeads = activeLeads.filter(l => new Date(l.last_activity_at || l.created_at).getTime() < sevenDaysAgo)

  // Leads created this week
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const leadsThisWeek = allLeadsForAnalytics.filter(l => new Date(l.created_at).getTime() >= startOfWeek.getTime())

  // Status counts
  const statusCounts = {
    all: allLeadsForAnalytics.length,
    active: activeLeads.length,
    won: wonLeads.length,
    lost: lostLeads.length,
    on_hold: allLeadsForAnalytics.filter(l => l.status === 'on_hold').length,
  }

  const selectedLeadData = leads.find(l => l.id === selectedLeadId)

  // Sales Employees Performance Calculation
  const employeePerformance = users.map(u => {
    let employeeLeads = allLeadsForAnalytics.filter(l => l.assigned_to === u.id)
    
    if (dateFilterApplied) {
      const start = fromDate ? new Date(fromDate).getTime() : 0
      const end = toDate ? new Date(toDate).getTime() + 86400000 - 1 : Infinity
      employeeLeads = employeeLeads.filter(l => {
        const dateVal = l.status === 'won' ? (l.won_at || l.created_at) : (l.status === 'lost' ? (l.lost_at || l.created_at) : l.created_at)
        const t = new Date(dateVal).getTime()
        return t >= start && t <= end
      })
    }

    const empActive = employeeLeads.filter(l => l.status === 'active')
    const empWon = employeeLeads.filter(l => l.status === 'won')
    const empLost = employeeLeads.filter(l => l.status === 'lost')
    
    const totalWonRevenue = empWon.reduce((sum, l) => sum + (l.value || 0), 0)
    const convRate = (empWon.length + empLost.length) > 0
      ? Math.round((empWon.length / (empWon.length + empLost.length)) * 100) : 0
    const avgSize = empWon.length > 0 ? Math.round(totalWonRevenue / empWon.length) : 0
    
    const lastActivity = employeeLeads.reduce((latest, l) => {
      const t = new Date(l.last_activity_at || l.created_at).getTime()
      return t > latest ? t : latest
    }, 0)

    return {
      user: u,
      activeCount: empActive.length,
      wonCount: empWon.length,
      lostCount: empLost.length,
      totalRevenue: totalWonRevenue,
      conversionRate: convRate,
      avgDealSize: avgSize,
      lastActivityAt: lastActivity > 0 ? new Date(lastActivity).toISOString() : null
    }
  }).sort((a, b) => b.totalRevenue - a.totalRevenue)

  const activeTeamLeadsFiltered = allLeadsForAnalytics.filter(l => {
    if (l.status !== 'active') return false
    if (!dateFilterApplied) return true
    const start = fromDate ? new Date(fromDate).getTime() : 0
    const end = toDate ? new Date(toDate).getTime() + 86400000 - 1 : Infinity
    const t = new Date(l.created_at).getTime()
    return t >= start && t <= end
  })

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const contactName = (lead: LeadWithContact) =>
    `${lead.contact?.first_name || 'Unknown'} ${lead.contact?.last_name || ''}`.trim()

  const formatCurrency = (val: number) => {
    let symbol = '$'
    if (currency === 'INR') symbol = '₹'
    else if (currency === 'EUR') symbol = '€'
    else if (currency === 'GBP') symbol = '£'
    
    if (val >= 1000000) return `${symbol}${(val / 1000000).toFixed(1)}M`
    if (val >= 1000) return `${symbol}${(val / 1000).toFixed(1)}K`
    return `${symbol}${val.toLocaleString()}`
  }

  const daysSince = (date: string) => {
    const d = Math.floor((now.getTime() - new Date(date).getTime()) / 86400000)
    if (d === 0) return 'Today'
    if (d === 1) return '1 day ago'
    return `${d}d ago`
  }

  // ─── Loading State ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-[#00a884]" />
          <span className="text-xs font-semibold text-[#667781]">Loading pipeline...</span>
        </div>
      </div>
    )
  }

  // ─── Render ───
  return (
    <div className="h-full flex flex-col bg-[#eae6df]/30 overflow-hidden leads-page-container">
      {/* ━━━ TOP BAR ━━━ */}
      <div className="flex-shrink-0 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] px-4 md:px-6 pt-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#111b21] dark:text-slate-100 flex items-center gap-2">
              <TrendingUp size={20} className="text-[#00a884] dark:text-[#00e676]" />
              Sales Pipeline
            </h1>
            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium mt-0.5">
              {totalLeadsCount} total leads · {activeLeads.length} active · {formatCurrency(totalPipelineValue)} in pipeline
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setContactSearchInput('')
                setNewLead(prev => ({ ...prev, contact_id: '' }))
                setShowAddModal(true)
              }}
              className="bg-[#00a884] dark:bg-[#00a884] hover:bg-[#008069] dark:hover:bg-[#009270] text-white px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">New Lead</span>
            </button>
          </div>
        </div>

        {/* Radix-style Navigation Tabs */}
        <div className="flex items-center gap-6 overflow-x-auto hide-scrollbar">
          {(
            [
              { id: 'list', label: 'Pipeline List', icon: List },
              { id: 'analytics', label: 'Sales Analytics', icon: BarChart3 },
              { id: 'performance', label: 'Team Performance', icon: Target }
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id as ViewMode)}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === tab.id
                  ? 'border-[#00a884] dark:border-[#00e676] text-[#00a884] dark:text-[#00e676]'
                  : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-slate-300 hover:border-[#e9edef] dark:hover:border-slate-700'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── ACTION BAR (Search & Filters) ── */}
      {viewMode === 'list' && (
        <div className="bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-4 shadow-sm z-30 relative">
          <div className="flex items-center gap-2 w-full md:w-auto flex-1">
            {/* Search */}
            <div className="relative flex-1 md:flex-none min-w-[200px] md:w-[280px]">
              <Search size={14} className="absolute left-2.5 top-2.5 text-[#8696a0]" />
              <input
                type="text"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] dark:bg-slate-900 border border-[#e9edef] dark:border-slate-800 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] focus:bg-white dark:focus:bg-[#182229] font-medium text-[#111b21] dark:text-white transition-all"
              />
            </div>
            
            {/* Unified Filter Button */}
            <div className="relative" ref={filterPopoverRef}>
              <button
                onClick={() => setShowFilterPopover(!showFilterPopover)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                  statusFilter !== 'all' || priorityFilter !== 'all' || dateFilterApplied
                    ? 'bg-[#e7f7f4] dark:bg-emerald-950/30 border-[#00a884]/20 text-[#008069] dark:text-[#00e676]'
                    : 'bg-white dark:bg-[#111b21] border-[#e9edef] dark:border-slate-800 text-[#667781] dark:text-slate-300 hover:bg-[#f0f2f5] dark:hover:bg-slate-900'
                }`}
              >
                <Filter size={14} />
                <span>Filters</span>
                {(statusFilter !== 'all' || priorityFilter !== 'all' || dateFilterApplied) && (
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#00a884] text-white text-[9px]">
                    {(statusFilter !== 'all' ? 1 : 0) + (priorityFilter !== 'all' ? 1 : 0) + (dateFilterApplied ? 1 : 0)}
                  </span>
                )}
                {showFilterPopover ? <ChevronUp size={14} className="ml-1 opacity-50" /> : <ChevronDown size={14} className="ml-1 opacity-50" />}
              </button>

              {/* Popover Overlay */}
              {showFilterPopover && (
                <div className="absolute top-[calc(100%+8px)] left-0 md:left-auto md:right-0 w-[280px] md:w-[320px] bg-white dark:bg-slate-900 border border-[#e9edef] dark:border-slate-700 rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-2 duration-200 z-50">
                  <div className="p-3 border-b border-[#e9edef] dark:border-slate-800 flex items-center justify-between bg-[#f8f9fa] dark:bg-slate-950/50">
                    <h3 className="text-xs font-bold text-[#111b21] dark:text-slate-200">Filter Leads</h3>
                    <button
                      onClick={() => {
                        setStatusFilter('all')
                        setPriorityFilter('all')
                        setFromDate('')
                        setToDate('')
                        setDateFilterApplied(false)
                      }}
                      className="text-[10px] font-bold text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                    >
                      Reset All
                    </button>
                  </div>
                  
                  <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Status */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[#8696a0] tracking-wider">Status</label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['all', 'active', 'won', 'lost', 'on_hold'] as StatusFilter[]).map(s => (
                          <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer border ${
                              statusFilter === s
                                ? 'bg-[#111b21] dark:bg-white text-white dark:text-[#111b21] border-transparent'
                                : 'bg-transparent text-[#667781] dark:text-slate-300 border-[#e9edef] dark:border-slate-700 hover:border-[#111b21] dark:hover:border-slate-400'
                            }`}
                          >
                            {s === 'all' ? 'All' : s === 'on_hold' ? 'On Hold' : s.charAt(0).toUpperCase() + s.slice(1)}
                            <span className="ml-1 opacity-50 text-[9px]">{statusCounts[s]}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Temperature / Priority */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[#8696a0] tracking-wider">Temperature</label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['all', 'high', 'medium', 'low'] as PriorityFilter[]).map(p => {
                          const cfg = p !== 'all' ? PRIORITY_CONFIG[p] : null
                          return (
                            <button
                              key={p}
                              onClick={() => setPriorityFilter(p)}
                              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                                priorityFilter === p
                                  ? 'bg-[#111b21] dark:bg-white text-white dark:text-[#111b21] border-transparent'
                                  : 'bg-transparent text-[#667781] dark:text-slate-300 border-[#e9edef] dark:border-slate-700 hover:border-[#111b21] dark:hover:border-slate-400'
                              }`}
                            >
                              {cfg && <cfg.icon size={10} className={priorityFilter === p ? '' : cfg.color} />}
                              {p === 'all' ? 'All' : cfg?.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Date Range */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[#8696a0] tracking-wider">Date Range</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[9px] text-[#667781] font-bold">From</span>
                          <div className="flex items-center gap-1 bg-[#f0f2f5] dark:bg-slate-950 rounded-lg p-1.5 border border-[#e9edef] dark:border-slate-800">
                            <Calendar size={12} className="text-[#8696a0]" />
                            <input
                              type="date"
                              value={fromDate}
                              onChange={e => { setFromDate(e.target.value); setDateFilterApplied(true) }}
                              className="bg-transparent border-none text-[#111b21] dark:text-white outline-none font-bold text-[10px] w-full cursor-pointer"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] text-[#667781] font-bold">To</span>
                          <div className="flex items-center gap-1 bg-[#f0f2f5] dark:bg-slate-950 rounded-lg p-1.5 border border-[#e9edef] dark:border-slate-800">
                            <Calendar size={12} className="text-[#8696a0]" />
                            <input
                              type="date"
                              value={toDate}
                              onChange={e => { setToDate(e.target.value); setDateFilterApplied(true) }}
                              className="bg-transparent border-none text-[#111b21] dark:text-white outline-none font-bold text-[10px] w-full cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setDateRangePreset('this_month')} className="flex-1 py-1 bg-[#f0f2f5] dark:bg-slate-800 hover:bg-[#e9edef] dark:hover:bg-slate-700 text-[#111b21] dark:text-slate-200 text-[9px] font-bold rounded-md transition-colors border border-[#e9edef] dark:border-slate-700 cursor-pointer">
                          This Month
                        </button>
                        <button onClick={() => setDateRangePreset('last_month')} className="flex-1 py-1 bg-[#f0f2f5] dark:bg-slate-800 hover:bg-[#e9edef] dark:hover:bg-slate-700 text-[#111b21] dark:text-slate-200 text-[9px] font-bold rounded-md transition-colors border border-[#e9edef] dark:border-slate-700 cursor-pointer">
                          Last Month
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ━━━ ANALYTICS DASHBOARD ━━━ */}
      {viewMode === 'analytics' && (
        <div className="flex-1 bg-[#f0f2f5] dark:bg-[#111b21] overflow-y-auto animate-in fade-in duration-200">
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-5 space-y-6">

            {/* ── Header + Chart Switcher ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-[#111b21] dark:text-white">Sales Analytics</h2>
                <p className="text-[11px] text-[#667781] dark:text-slate-400 mt-0.5">
                  {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · {daysElapsed} of {daysInMonth} days elapsed
                </p>
              </div>
              <div className="flex items-center gap-1.5 p-1 bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 shadow-sm">
                {([
                  { id: 'month', label: 'Monthly' },
                  { id: 'week', label: 'Weekly' },
                  { id: 'pipeline', label: 'Pipeline' },
                  { id: 'source', label: 'Sources' },
                ] as const).map(v => (
                  <button
                    key={v.id}
                    onClick={() => setAnalyticsChartView(v.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      analyticsChartView === v.id
                        ? 'bg-[#00a884] text-white shadow-sm'
                        : 'text-[#54656f] dark:text-slate-400 hover:bg-[#f0f2f5] dark:hover:bg-slate-800'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── KPI Cards Row ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* This Month Sales */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#8696a0]">Sales This Month</span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                    <Trophy size={14} className="text-[#00a884]" />
                  </div>
                </div>
                <p className="text-2xl font-black text-[#111b21] dark:text-white">{wonThisMonth.length}</p>
                <p className="text-[10px] text-[#8696a0] mt-1">{formatCurrency(wonRevenueThisMonth)} won</p>
              </div>
              {/* This Week Sales */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#8696a0]">Sales This Week</span>
                  <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
                    <BarChart3 size={14} className="text-blue-500" />
                  </div>
                </div>
                <p className="text-2xl font-black text-[#111b21] dark:text-white">
                  {wonLeads.filter(l => new Date(l.won_at || l.updated_at).getTime() >= startOfWeek.getTime()).length}
                </p>
                <p className="text-[10px] text-[#8696a0] mt-1">{leadsThisWeek.length} new leads in</p>
              </div>
              {/* Prediction */}
              <div className="bg-gradient-to-br from-[#00a884] to-[#008069] rounded-xl p-4 shadow-sm text-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-white/70">Predicted Revenue</span>
                  <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                    <TrendingUp size={14} className="text-white" />
                  </div>
                </div>
                <p className="text-2xl font-black text-white">{formatCurrency(predictedMonthRevenue)}</p>
                <p className="text-[10px] text-white/70 mt-1">
                  {revenueGrowthVsLast >= 0 ? '↑' : '↓'} {Math.abs(revenueGrowthVsLast)}% vs last month · {projectionConfidence}% confidence
                </p>
              </div>
              {/* Predicted Deals */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#8696a0]">Predicted Deals</span>
                  <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center">
                    <Target size={14} className="text-violet-500" />
                  </div>
                </div>
                <p className="text-2xl font-black text-[#111b21] dark:text-white">{predictedMonthSales}</p>
                <p className="text-[10px] text-[#8696a0] mt-1">avg {formatCurrency(avgDealSize)} / deal</p>
              </div>
            </div>

            {/* ── Secondary KPIs ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-3 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0"><Calendar size={15} className="text-amber-500" /></div>
                <div><p className="text-[9px] font-black uppercase text-[#8696a0]">Last Month Won</p><p className="text-sm font-black text-[#111b21] dark:text-white">{wonLastMonth.length} <span className="text-[10px] font-semibold text-[#8696a0]">deals</span></p></div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-3 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center flex-shrink-0"><Target size={15} className="text-pink-500" /></div>
                <div><p className="text-[9px] font-black uppercase text-[#8696a0]">Conversion Rate</p><p className="text-sm font-black text-[#111b21] dark:text-white">{conversionRate}%</p></div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-3 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0"><TrendingUp size={15} className="text-blue-500" /></div>
                <div><p className="text-[9px] font-black uppercase text-[#8696a0]">Revenue YTD</p><p className="text-sm font-black text-[#111b21] dark:text-white">{formatCurrency(wonRevenueYTD)}</p></div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-3 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0"><Clock size={15} className="text-rose-500" /></div>
                <div><p className="text-[9px] font-black uppercase text-[#8696a0]">Stale Leads</p><p className="text-sm font-black text-[#111b21] dark:text-white">{staleLeads.length} <span className="text-[10px] font-semibold text-[#8696a0]">&gt;7d</span></p></div>
              </div>
            </div>

            {/* ── Main Chart Area ── */}
            {analyticsChartView === 'month' && (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2">
                      <TrendingUp size={15} className="text-[#00a884]" />
                      This Month — Revenue & Sales Count
                    </h3>
                    <p className="text-[10px] text-[#8696a0] mt-0.5">Solid = actual · Dashed = projected</p>
                  </div>
                  <div className="flex gap-3 text-[10px] font-bold">
                    <span className="flex items-center gap-1"><span className="w-3 h-1 bg-[#00a884] rounded-full inline-block" />Revenue</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-1 bg-blue-400 rounded-full inline-block" />Sales</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-1 border-t-2 border-dashed border-amber-400 inline-block" />Projected</span>
                  </div>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={fullMonthChart} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00a884" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#00a884" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.10} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f2f5" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0', fontWeight: 600 }} interval={2} />
                      <YAxis yAxisId="rev" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0' }} tickFormatter={(v: any) => `${formatCurrency(v)}`} width={60} />
                      <YAxis yAxisId="cnt" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0' }} width={25} />
                      <Tooltip
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '11px', fontWeight: 600 }}
                        formatter={(value: any, name: any) => {
                          if (name === 'revenue') return [formatCurrency(value), 'Revenue']
                          if (name === 'projected') return [formatCurrency(value), 'Projected/day']
                          return [value, 'Sales']
                        }}
                        labelFormatter={(label: any) => `Day ${label}`}
                      />
                      <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#00a884" strokeWidth={2.5} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, fill: '#00a884' }} />
                      <Area yAxisId="rev" type="monotone" dataKey="projected" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" fill="url(#projGrad)" dot={false} />
                      <Bar yAxisId="cnt" dataKey="sales" fill="#3b82f6" opacity={0.5} radius={[3, 3, 0, 0]} barSize={8} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {analyticsChartView === 'week' && (
              <div className="space-y-6">
                {/* Week-wise Revenue Bar */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-5">
                    <BarChart3 size={15} className="text-[#00a884]" />
                    Weekly Revenue — Last 8 Weeks
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeklyBreakdown} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f2f5" />
                        <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0', fontWeight: 600 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0' }} tickFormatter={(v: any) => formatCurrency(v)} width={60} />
                        <Tooltip
                          contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '11px', fontWeight: 600 }}
                          formatter={(value: any, name: any) => {
                            if (name === 'revenue') return [formatCurrency(value), 'Revenue']
                            return [value, name === 'sales' ? 'Deals Won' : 'New Leads']
                          }}
                        />
                        <Bar dataKey="revenue" fill="#00a884" radius={[5, 5, 0, 0]} barSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {/* Week-wise Deals Won vs New Leads */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-5">
                    <Target size={15} className="text-blue-500" />
                    Weekly — Deals Won vs New Leads
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeklyBreakdown} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f2f5" />
                        <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0', fontWeight: 600 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0' }} width={25} />
                        <Tooltip
                          contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '11px', fontWeight: 600 }}
                          formatter={(value: any, name: any) => [value, name === 'sales' ? 'Deals Won' : 'New Leads']}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 600 }} />
                        <Bar dataKey="sales" name="Deals Won" fill="#00a884" radius={[4, 4, 0, 0]} barSize={16} />
                        <Bar dataKey="newLeads" name="New Leads" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {/* Weekly Summary Table */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm overflow-x-auto">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white mb-4">Week-by-Week Summary</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#e9edef] dark:border-slate-800">
                        <th className="text-left pb-2 font-black text-[#8696a0] text-[10px] uppercase tracking-wider">Week</th>
                        <th className="text-right pb-2 font-black text-[#8696a0] text-[10px] uppercase tracking-wider">Deals Won</th>
                        <th className="text-right pb-2 font-black text-[#8696a0] text-[10px] uppercase tracking-wider">New Leads</th>
                        <th className="text-right pb-2 font-black text-[#8696a0] text-[10px] uppercase tracking-wider">Revenue</th>
                        <th className="text-right pb-2 font-black text-[#8696a0] text-[10px] uppercase tracking-wider">Avg Deal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyBreakdown.map((w, i) => (
                        <tr key={i} className="border-b border-[#f0f2f5] dark:border-slate-800/50 hover:bg-[#f8f9fa] dark:hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 font-semibold text-[#111b21] dark:text-white">{w.week}</td>
                          <td className="py-2.5 text-right font-bold text-[#00a884]">{w.sales}</td>
                          <td className="py-2.5 text-right font-semibold text-[#667781] dark:text-slate-400">{w.newLeads}</td>
                          <td className="py-2.5 text-right font-bold text-[#111b21] dark:text-white">{formatCurrency(w.revenue)}</td>
                          <td className="py-2.5 text-right text-[#667781] dark:text-slate-400">{w.sales > 0 ? formatCurrency(Math.round(w.revenue / w.sales)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {analyticsChartView === 'pipeline' && (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-5">
                  <BarChart3 size={15} className="text-[#00a884]" />
                  Pipeline Value by Stage (Active Deals)
                </h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pipelineByStageData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f2f5" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8696a0', fontWeight: 600 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8696a0' }} tickFormatter={(v: any) => formatCurrency(v)} width={65} />
                      <Tooltip
                        cursor={{ fill: 'rgba(0,168,132,0.05)' }}
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '11px', fontWeight: 600 }}
                        formatter={(value: any, name: any, props: any) => [`${formatCurrency(value)} (${props.payload.count} deals)`, 'Pipeline Value']}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={36}>
                        {pipelineByStageData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Stage detail rows */}
                <div className="mt-4 space-y-2">
                  {pipelineByStageData.map((s, i) => {
                    const pct = totalPipelineValue > 0 ? Math.round((s.value / totalPipelineValue) * 100) : 0
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.fill }} />
                        <span className="text-[11px] font-semibold text-[#667781] dark:text-slate-400 w-28 truncate">{s.name}</span>
                        <div className="flex-1 h-1.5 bg-[#f0f2f5] dark:bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.fill }} />
                        </div>
                        <span className="text-[11px] font-black text-[#111b21] dark:text-white w-16 text-right">{formatCurrency(s.value)}</span>
                        <span className="text-[10px] text-[#8696a0] w-14 text-right">{s.count} deals</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {analyticsChartView === 'source' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-4">
                    <LayoutGrid size={15} className="text-[#00a884]" />
                    Lead Sources — All Time
                  </h3>
                  <div className="h-64 relative">
                    {leadsBySourceData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={leadsBySourceData} innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                            {leadsBySourceData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '11px', fontWeight: 600 }} formatter={(value: any) => [value, 'Leads']} />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 600, color: '#667781' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-[#8696a0]">No source data</div>
                    )}
                  </div>
                </div>
                {/* Source breakdown table */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white mb-4">Source Breakdown</h3>
                  <div className="space-y-3">
                    {leadsBySourceData.map((s, i) => {
                      const pct = allLeadsForAnalytics.length > 0 ? Math.round((s.value / allLeadsForAnalytics.length) * 100) : 0
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                          <span className="text-[11px] font-semibold text-[#667781] dark:text-slate-400 w-24 capitalize">{s.name}</span>
                          <div className="flex-1 h-1.5 bg-[#f0f2f5] dark:bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                          </div>
                          <span className="text-[11px] font-black text-[#111b21] dark:text-white w-8 text-right">{s.value}</span>
                          <span className="text-[10px] text-[#8696a0] w-8 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                    {leadsBySourceData.length === 0 && <p className="text-xs text-[#8696a0] text-center py-4">No source data available</p>}
                  </div>
                </div>
              </div>
            )}

            {/* ── Prediction Insight Card ── */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-4">
                <Sparkles size={15} className="text-[#00a884]" />
                Month-End Forecast & Insights
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Forecast progress */}
                <div className="col-span-2 space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-[#667781] dark:text-slate-400">Revenue Progress</span>
                      <span className="text-[#111b21] dark:text-white">{formatCurrency(wonRevenueThisMonth)} <span className="font-normal text-[#8696a0]">/ {formatCurrency(predictedMonthRevenue)} predicted</span></span>
                    </div>
                    <div className="h-3 bg-[#f0f2f5] dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#00a884] to-[#00e5b0] transition-all duration-700"
                        style={{ width: `${predictedMonthRevenue > 0 ? Math.min(Math.round((wonRevenueThisMonth / predictedMonthRevenue) * 100), 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-[#667781] dark:text-slate-400">Sales Count Progress</span>
                      <span className="text-[#111b21] dark:text-white">{wonThisMonth.length} <span className="font-normal text-[#8696a0]">/ {predictedMonthSales} predicted</span></span>
                    </div>
                    <div className="h-3 bg-[#f0f2f5] dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-700"
                        style={{ width: `${predictedMonthSales > 0 ? Math.min(Math.round((wonThisMonth.length / predictedMonthSales) * 100), 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-[#667781] dark:text-slate-400">Month Elapsed</span>
                      <span className="text-[#111b21] dark:text-white">{daysElapsed} / {daysInMonth} days ({projectionConfidence}%)</span>
                    </div>
                    <div className="h-3 bg-[#f0f2f5] dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700"
                        style={{ width: `${projectionConfidence}%` }}
                      />
                    </div>
                  </div>
                </div>
                {/* Trend metrics */}
                <div className="space-y-3 border-t md:border-t-0 md:border-l border-[#e9edef] dark:border-slate-800 pt-3 md:pt-0 md:pl-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#8696a0]">Daily Revenue Avg</p>
                    <p className="text-sm font-black text-[#111b21] dark:text-white">{formatCurrency(Math.round(avgDailyRevenue))}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#8696a0]">Daily Deals Avg</p>
                    <p className="text-sm font-black text-[#111b21] dark:text-white">{avgDailySales.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#8696a0]">vs Last Month</p>
                    <p className={`text-sm font-black ${revenueGrowthVsLast >= 0 ? 'text-[#00a884]' : 'text-rose-500'}`}>
                      {revenueGrowthVsLast >= 0 ? '+' : ''}{revenueGrowthVsLast}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#8696a0]">Pipeline at Risk</p>
                    <p className="text-sm font-black text-amber-600">{staleLeads.length} leads</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Priority Distribution ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-4">
                  <BarChart3 size={15} className="text-[#00a884]" />
                  Priority Distribution (Active)
                </h3>
                <div className="space-y-4">
                  {(['high', 'medium', 'low'] as const).map(p => {
                    const count = activeLeads.filter(l => l.priority === p).length
                    const totalActive = activeLeads.length || 1
                    const percentage = Math.round((count / totalActive) * 100)
                    const cfg = PRIORITY_CONFIG[p]
                    return (
                      <div key={p} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-[#667781] dark:text-slate-400 flex items-center gap-1.5">
                            <cfg.icon size={12} className={cfg.color} />
                            {cfg.label}
                          </span>
                          <span className="font-black text-[#111b21] dark:text-white">{count} <span className="font-normal text-[10px] text-[#8696a0]">({percentage}%)</span></span>
                        </div>
                        <div className="w-full bg-[#f0f2f5] dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${p === 'high' ? 'bg-rose-500' : p === 'medium' ? 'bg-amber-500' : 'bg-blue-400'}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-[#e9edef] dark:border-slate-800 p-5 shadow-sm">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-4">
                  <TrendingUp size={15} className="text-[#00a884]" />
                  Pipeline Activity
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-[#f8f9fa] dark:bg-slate-800/50 rounded-lg border border-[#e9edef] dark:border-slate-700/50">
                    <span className="flex items-center gap-2 text-xs font-semibold text-[#111b21] dark:text-slate-200">
                      <Plus size={14} className="text-[#00a884]" />New Leads This Week
                    </span>
                    <span className="text-sm font-black text-[#111b21] dark:text-white">{leadsThisWeek.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-100 dark:border-amber-900/30">
                    <span className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-400">
                      <Clock size={14} className="text-amber-600" />Stale Leads (&gt;7 days)
                    </span>
                    <span className="text-sm font-black text-amber-800 dark:text-amber-400">{staleLeads.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <span className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-400">
                      <Target size={14} className="text-blue-500" />Total Active Pipeline
                    </span>
                    <span className="text-sm font-black text-blue-800 dark:text-blue-400">{activeLeads.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-[#f8f9fa] dark:bg-slate-800/50 rounded-lg border border-[#e9edef] dark:border-slate-700/50">
                    <span className="flex items-center gap-2 text-xs font-semibold text-[#667781] dark:text-slate-400">
                      <DollarSign size={14} className="text-[#8696a0]" />Total Pipeline Value
                    </span>
                    <span className="text-sm font-black text-[#111b21] dark:text-white">{formatCurrency(totalPipelineValue)}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ━━━ MAIN CONTENT ━━━ */}
      <div className={viewMode === 'analytics' ? 'hidden' : 'flex-1 overflow-auto'}>
        {totalLeadsCount === 0 && viewMode !== 'performance' ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
            <div className="max-w-md bg-white p-8 rounded-2xl border border-[#e9edef] shadow-sm flex flex-col items-center animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-[#e7f7f4] flex items-center justify-center mb-5 text-[#00a884]">
                <TrendingUp size={32} />
              </div>
              <h2 className="text-lg font-bold text-[#111b21] mb-2">Welcome to your Sales Pipeline!</h2>
              <p className="text-xs text-[#667781] leading-relaxed mb-6">
                Your pipeline is currently empty. Get started by creating your first sales lead to track opportunities and manage your pipeline.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
                <button
                  onClick={() => {
                    setContactSearchInput('')
                    setNewLead(prev => ({ ...prev, contact_id: '' }))
                    setShowAddModal(true)
                  }}
                  className="bg-[#00a884] hover:bg-[#008069] text-white px-5 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Plus size={14} />
                  <span>Create Lead</span>
                </button>
              </div>
            </div>
          </div>
        ) : viewMode === 'list' ? (
          /* ── LIST VIEW ── */
          <div className="px-4 md:px-6 py-4">
            {sortedLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#667781]">
                <Search size={40} className="text-[#e9edef] mb-3" />
                <p className="text-sm font-bold">No leads found</p>
                <p className="text-xs font-medium mt-1">Try adjusting your filters or add a new lead</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#111b21] rounded-xl border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden">
                {/* Table Header (Desktop only) */}
                <div className="hidden md:grid md:grid-cols-[2fr_1.2fr_100px_120px_80px_80px_110px_90px_100px] gap-0 border-b border-[#e9edef] dark:border-[#202d36] bg-[#f8f9fa] dark:bg-[#182229] px-4 py-2.5 text-[9px] font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
                  <button onClick={() => handleSort('title')} className="flex items-center gap-1 cursor-pointer hover:text-[#111b21] dark:hover:text-white transition-colors text-left border-0 bg-transparent p-0 font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0] text-[9px]">
                    Contact / Deal {sortField === 'title' && <ArrowUpDown size={9} />}
                  </button>
                  <span>Stage</span>
                  <button onClick={() => handleSort('value')} className="flex items-center gap-1 cursor-pointer hover:text-[#111b21] dark:hover:text-white transition-colors border-0 bg-transparent p-0 font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0] text-[9px]">
                    Value {sortField === 'value' && <ArrowUpDown size={9} />}
                  </button>
                  <span>Status</span>
                  <span>Priority</span>
                  <span>Source</span>
                  <span>Assigned To</span>
                  <button onClick={() => handleSort('last_activity_at')} className="flex items-center gap-1 cursor-pointer hover:text-[#111b21] dark:hover:text-white transition-colors border-0 bg-transparent p-0 font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0] text-[9px]">
                    Activity {sortField === 'last_activity_at' && <ArrowUpDown size={9} />}
                  </button>
                  <span>Actions</span>
                </div>

                {/* Table Body */}
                {paginatedLeads.map((lead, idx) => {
                  const name = contactName(lead)
                  const statusCfg = STATUS_CONFIG[lead.status || 'active']
                  const priorityCfg = PRIORITY_CONFIG[lead.priority || 'medium']
                  const PriorityIcon = priorityCfg.icon
                  const isSelected = selectedLeadId === lead.id
                  return (
                    <div
                      key={lead.id}
                      onClick={() => { setSelectedLeadId(lead.id); setActiveDrawerTab('overview') }}
                      className={`px-4 py-4 md:py-3 border-b border-[#f5f6f6] dark:border-[#202d36] last:border-b-0 cursor-pointer transition-all hover:bg-[#f8f9fa] dark:hover:bg-[#182229]/60 group relative ${
                        isSelected ? 'bg-[#e7f7f4]/30 dark:bg-emerald-950/20' : ''
                      } ${
                        lead.priority === 'high' ? 'border-l-4 border-l-rose-500' :
                        lead.priority === 'medium' ? 'border-l-4 border-l-amber-500' :
                        'border-l-4 border-l-blue-400'
                      }`}
                    >
                      {/* MOBILE CARD LAYOUT (visible on mobile only) */}
                      <div className="flex flex-col gap-2.5 md:hidden">
                        {/* Header Row: Contact info + Value */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-8 w-8 rounded-full bg-[#dfe5e7] dark:bg-slate-700 flex items-center justify-center font-bold text-[10px] text-[#54656f] dark:text-slate-300 flex-shrink-0 border border-[#e9edef] dark:border-slate-800">
                              {(lead.contact?.first_name || 'U').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#111b21] dark:text-slate-100 truncate">{lead.title}</p>
                              <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium truncate">
                                {name}{lead.contact?.company ? ` · ${lead.contact.company}` : ''}
                              </p>
                            </div>
                          </div>
                          
                          <div className="text-xs font-black text-[#008069] dark:text-[#00e676] font-mono whitespace-nowrap pt-1">
                            {lead.value ? formatCurrency(lead.value) : '—'}
                          </div>
                        </div>

                        {/* Badges Row */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[9px] mt-0.5">
                          <span className="px-2 py-0.5 rounded-full font-bold text-white truncate"
                            style={{ backgroundColor: lead.stage?.color || '#8696a0' }}>
                            {lead.stage?.name || 'Unknown'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full font-bold border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                            {statusCfg.label}
                          </span>
                          <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-bold ${priorityCfg.bg} ${priorityCfg.color} border ${priorityCfg.border}`}>
                            <PriorityIcon size={9} />
                            {priorityCfg.label}
                          </span>
                          <span className="text-[9px] text-[#667781] dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-700/50">
                            {(lead.source || 'other').replace('_', ' ')}
                          </span>
                          <span className="text-[9px] font-bold text-[#54656f] dark:text-slate-300 bg-[#f0f2f5] dark:bg-slate-800 px-1.5 py-0.5 rounded border border-[#e9edef] dark:border-slate-700/50 flex items-center gap-1">
                            <User size={9} />
                            {lead.assigned_to ? users.find((u: any) => u.id === lead.assigned_to)?.full_name || 'Unknown' : 'Unassigned'}
                          </span>
                        </div>

                        {/* Footer Row: Activity + Actions */}
                        <div className="flex items-center justify-between border-t border-[#f5f6f6] dark:border-[#202d36] pt-2 mt-1">
                          <div className="text-[9px] text-[#8696a0] dark:text-slate-500 font-medium">
                            Activity: {daysSince(lead.last_activity_at || lead.created_at)}
                          </div>
                          
                          {/* Quick Actions (always visible on mobile) */}
                          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            {lead.status === 'active' && (
                              <>
                                <button onClick={() => handleStatusChange(lead.id, 'won')}
                                  title="Mark Won"
                                  className="p-1 rounded-md bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 hover:bg-green-100 border border-green-100 dark:border-green-900/50 cursor-pointer transition-all">
                                  <CheckCircle2 size={12} />
                                </button>
                                <button onClick={() => handleStatusChange(lead.id, 'lost')}
                                  title="Mark Lost"
                                  className="p-1 rounded-md bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-450 hover:bg-red-100 border border-red-100 dark:border-red-900/50 cursor-pointer transition-all">
                                  <Ban size={12} />
                                </button>
                              </>
                            )}
                            {(lead.status === 'won' || lead.status === 'lost' || lead.status === 'on_hold') && (
                              <button onClick={() => handleStatusChange(lead.id, 'active')}
                                title="Reactivate"
                                className="p-1 px-2 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 border border-emerald-100 dark:border-emerald-900/50 cursor-pointer transition-all text-[9px] font-bold">
                                Reactivate
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* DESKTOP TABLE ROW LAYOUT (hidden on mobile) */}
                      <div className="hidden md:grid md:grid-cols-[2fr_1.2fr_100px_120px_80px_80px_110px_90px_100px] gap-0 items-center">
                        {/* Contact / Deal */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-[#dfe5e7] dark:bg-slate-700 flex items-center justify-center font-bold text-[10px] text-[#54656f] dark:text-slate-350 flex-shrink-0 border border-[#e9edef] dark:border-slate-800">
                            {(lead.contact?.first_name || 'U').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#111b21] dark:text-slate-100 truncate">{lead.title}</p>
                            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium truncate">{name}{lead.contact?.company ? ` · ${lead.contact.company}` : ''}</p>
                          </div>
                        </div>

                        {/* Stage */}
                        <div className="flex items-center">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white truncate"
                            style={{ backgroundColor: lead.stage?.color || '#8696a0' }}>
                            {lead.stage?.name || 'Unknown'}
                          </span>
                        </div>

                        {/* Value */}
                        <div className="flex items-center text-xs font-bold text-[#008069] dark:text-[#00e676] font-mono">
                          {lead.value ? formatCurrency(lead.value) : '—'}
                        </div>

                        {/* Status */}
                        <div className="flex items-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                            {statusCfg.label}
                          </span>
                        </div>

                        {/* Priority */}
                        <div className="flex items-center">
                          <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${priorityCfg.bg} ${priorityCfg.color} border ${priorityCfg.border}`}>
                            <PriorityIcon size={9} />
                            {priorityCfg.label}
                          </span>
                        </div>

                        {/* Source */}
                        <div className="flex items-center text-[10px] text-[#667781] dark:text-[#8696a0] font-medium capitalize">
                          {(lead.source || 'other').replace('_', ' ')}
                        </div>

                        {/* Assigned To */}
                        <div className="flex items-center text-[10px] text-[#667781] dark:text-[#8696a0] font-medium truncate pr-2">
                          {lead.assigned_to ? users.find((u: any) => u.id === lead.assigned_to)?.full_name || 'Unknown' : 'Unassigned'}
                        </div>

                        {/* Activity */}
                        <div className="flex items-center text-[10px] text-[#8696a0] dark:text-[#8696a0] font-medium">
                          {daysSince(lead.last_activity_at || lead.created_at)}
                        </div>

                        {/* Quick Actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200" onClick={e => e.stopPropagation()}>
                          {lead.status === 'active' && (
                            <>
                              <button onClick={() => handleStatusChange(lead.id, 'won')}
                                title="Mark Won"
                                className="p-1.5 rounded-md bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 hover:bg-green-100 border border-green-100 dark:border-green-900/50 cursor-pointer transition-all">
                                <CheckCircle2 size={12} />
                              </button>
                              <button onClick={() => handleStatusChange(lead.id, 'lost')}
                                title="Mark Lost"
                                className="p-1.5 rounded-md bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-400 hover:bg-red-100 border border-red-100 dark:border-red-900/50 cursor-pointer transition-all">
                                <Ban size={12} />
                              </button>
                            </>
                          )}
                          {(lead.status === 'won' || lead.status === 'lost' || lead.status === 'on_hold') && (
                            <button onClick={() => handleStatusChange(lead.id, 'active')}
                              title="Reactivate"
                              className="p-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 border border-emerald-100 dark:border-emerald-900/50 cursor-pointer transition-all text-[9px] font-bold">
                              Reactivate
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#f8f9fa] border-t border-[#e9edef] text-[10px]">
                    <div className="text-[#667781] font-semibold">
                      Showing <span className="text-[#111b21]">{startIndex + 1}</span> to{' '}
                      <span className="text-[#111b21]">
                        {Math.min(startIndex + pageSize, totalLeadsCount)}
                      </span>{' '}
                      of <span className="text-[#111b21]">{totalLeadsCount}</span> leads
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1 border border-[#e9edef] rounded-md text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-40 disabled:hover:bg-transparent font-bold cursor-pointer transition-all bg-white"
                      >
                        Previous
                      </button>
                      {Array.from({ length: totalPages }).map((_, i) => {
                        const page = i + 1
                        if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
                          return (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`w-6 h-6 rounded-md font-bold transition-all cursor-pointer text-[9px] ${
                                currentPage === page
                                  ? 'bg-[#00a884] text-white'
                                  : 'border border-[#e9edef] bg-white text-[#54656f] hover:bg-[#f0f2f5]'
                              }`}
                            >
                              {page}
                            </button>
                          )
                        }
                        if (page === 2 || page === totalPages - 1) {
                          return <span key={page} className="px-1 text-[#8696a0] font-bold">...</span>
                        }
                        return null
                      })}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1 border border-[#e9edef] rounded-md text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-40 disabled:hover:bg-transparent font-bold cursor-pointer transition-all bg-white"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : viewMode === 'performance' ? (
          /* ── PERFORMANCE VIEW ── */
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {/* Team Stats Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-[#e9edef] p-4 shadow-sm flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase tracking-wider text-[#667781] mb-1">Top Sales Performer</span>
                {employeePerformance.length > 0 && employeePerformance[0].totalRevenue > 0 ? (
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-[#111b21]">
                      {employeePerformance[0].user.full_name || employeePerformance[0].user.email}
                    </span>
                    <span className="text-xs font-black font-mono text-[#00a884] mt-1">
                      {formatCurrency(employeePerformance[0].totalRevenue)} won
                    </span>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-[#8696a0]">No revenue won yet</span>
                )}
              </div>
              <div className="bg-white rounded-xl border border-[#e9edef] p-4 shadow-sm flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase tracking-wider text-[#667781] mb-1">Total Team Revenue</span>
                <span className="text-base font-black font-mono text-[#008069]">
                  {formatCurrency(employeePerformance.reduce((sum, e) => sum + e.totalRevenue, 0))}
                </span>
                <span className="text-[10px] text-[#8696a0] font-medium mt-1">
                  Across {employeePerformance.reduce((sum, e) => sum + e.wonCount, 0)} won deals
                </span>
              </div>
              <div className="bg-white rounded-xl border border-[#e9edef] p-4 shadow-sm flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase tracking-wider text-[#667781] mb-1">Active Team Pipeline</span>
                <span className="text-base font-black font-mono text-blue-600">
                  {formatCurrency(activeTeamLeadsFiltered.reduce((sum, l) => sum + (l.value || 0), 0))}
                </span>
                <span className="text-[10px] text-[#8696a0] font-medium mt-1">
                  Across {activeTeamLeadsFiltered.length} active deals
                </span>
              </div>
            </div>

            {/* Sales Performance Graphs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Revenue Trend */}
              <div className="bg-white dark:bg-slate-900 border border-[#e9edef] dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-6">
                  <TrendingUp size={16} className="text-[#00a884]" />
                  This Month's Revenue Trend
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyRevenueData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00a884" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#00a884" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edef" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8696a0' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8696a0' }} tickFormatter={(val) => `$${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val}`} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: 'bold' }}
                        formatter={(value: any) => [formatCurrency(value), 'Revenue']}
                        labelFormatter={(label) => `Day ${label}`}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#00a884" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Team Performance */}
              <div className="bg-white dark:bg-slate-900 border border-[#e9edef] dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-6">
                  <Trophy size={16} className="text-[#00a884]" />
                  Top Performers (Revenue)
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={teamPerformanceData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e9edef" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8696a0' }} tickFormatter={(val) => `$${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val}`} />
                      <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#111b21', fontWeight: 600 }} width={80} />
                      <Tooltip 
                        cursor={{ fill: 'rgba(0, 168, 132, 0.05)' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: 'bold' }}
                        formatter={(value: any) => [formatCurrency(value), 'Revenue']}
                      />
                      <Bar dataKey="revenue" fill="#00a884" radius={[0, 4, 4, 0]} barSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Performance Table */}
            <div className="bg-white rounded-xl border border-[#e9edef] shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-[#e9edef] bg-[#f8f9fa] flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#111b21]">Sales Employees Leaderboard</h3>
                <span className="text-[10px] font-semibold text-[#667781] bg-white border border-[#e9edef] px-2.5 py-0.5 rounded-full">
                  {users.length} members
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#e9edef] bg-[#f8f9fa] text-[9px] font-black uppercase tracking-wider text-[#667781] select-none">
                      <th className="px-4 py-2.5 w-12 text-center">Rank</th>
                      <th className="px-4 py-2.5">Employee</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5 text-center">Active Deals</th>
                      <th className="px-4 py-2.5 text-center">Deals Won</th>
                      <th className="px-4 py-2.5 text-center">Deals Lost</th>
                      <th className="px-4 py-2.5">Revenue Won</th>
                      <th className="px-4 py-2.5">Conversion Rate</th>
                      <th className="px-4 py-2.5">Avg Deal Size</th>
                      <th className="px-4 py-2.5">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeePerformance.map((emp, index) => {
                      const isTop = index === 0 && emp.totalRevenue > 0
                      return (
                        <tr key={emp.user.id} className="border-b border-[#f5f6f6] last:border-b-0 hover:bg-[#f8f9fa] transition-colors">
                          <td className="px-4 py-3 text-center font-bold text-[#667781]">
                            {isTop ? (
                              <span className="inline-flex items-center justify-center text-amber-500 font-bold" title="Top Salesperson!">
                                🏆
                              </span>
                            ) : (
                              index + 1
                            )}
                          </td>
                          <td className="px-4 py-3 font-bold text-[#111b21]">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-[#dfe5e7] flex items-center justify-center font-bold text-[10px] text-[#54656f] border border-[#e9edef] shrink-0">
                                {(emp.user.full_name || 'U').substring(0, 2).toUpperCase()}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">{emp.user.full_name || 'No name'}</span>
                                <span className="text-[9px] text-[#8696a0] font-normal font-sans truncate">{emp.user.email}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 capitalize text-[#54656f] font-semibold text-[10px]">
                            {emp.user.role || 'Member'}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-[#111b21]">
                            {emp.activeCount}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-green-600">
                            {emp.wonCount}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-rose-500">
                            {emp.lostCount}
                          </td>
                          <td className="px-4 py-3 font-bold text-[#008069] font-mono">
                            {formatCurrency(emp.totalRevenue)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#111b21] w-8">{emp.conversionRate}%</span>
                              <div className="flex-grow max-w-[80px] bg-[#f0f2f5] h-1.5 rounded-full overflow-hidden border border-[#e9edef]">
                                <div className="bg-[#00a884] h-full" style={{ width: `${emp.conversionRate}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-violet-600 font-mono">
                            {formatCurrency(emp.avgDealSize)}
                          </td>
                          <td className="px-4 py-3 text-[#8696a0] font-medium">
                            {emp.lastActivityAt ? daysSince(emp.lastActivityAt) : 'No activity'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ━━━ ADD LEAD MODAL ━━━ */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#e9edef] flex-shrink-0">
              <h2 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
                <Plus size={16} className="text-[#00a884]" />
                New Lead
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-[#f0f2f5] rounded-full text-[#8696a0] cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Contact Search or Create */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-[#667781] uppercase tracking-wider">Contact</label>
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsOfflineLead(!isOfflineLead)
                      if (!isOfflineLead) setNewLead(prev => ({ ...prev, contact_id: '' }))
                    }}
                    className="text-[10px] font-bold text-[#00a884] hover:text-[#008f6f] cursor-pointer"
                  >
                    {isOfflineLead ? 'Search Existing Contacts' : '+ Create Offline Contact'}
                  </button>
                </div>

                {isOfflineLead ? (
                  <div className="grid grid-cols-2 gap-3 p-3 bg-[#f8f9fa] rounded-lg border border-[#e9edef]">
                    <div className="col-span-2 sm:col-span-1">
                      <input type="text" placeholder="First Name *" required={isOfflineLead} className="form-input" value={offlineContact.first_name} onChange={e => setOfflineContact({...offlineContact, first_name: e.target.value})} />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <input type="text" placeholder="Last Name" className="form-input" value={offlineContact.last_name} onChange={e => setOfflineContact({...offlineContact, last_name: e.target.value})} />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <input type="tel" placeholder="Phone Number" className="form-input" value={offlineContact.phone_number} onChange={e => setOfflineContact({...offlineContact, phone_number: e.target.value})} />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <input type="text" placeholder="Company" className="form-input" value={offlineContact.company} onChange={e => setOfflineContact({...offlineContact, company: e.target.value})} />
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    {newLead.contact_id ? (
                      // Selected state
                      <div className="flex items-center justify-between form-input bg-[#e7f7f4]/40 border-[#00a884]/30">
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-[#111b21]">
                            {(() => {
                              const sel = contacts.find(c => c.id === newLead.contact_id)
                              return sel ? `${sel.first_name} ${sel.last_name || ''}` : 'Selected Contact'
                            })()}
                          </span>
                          <span className="text-[10px] text-[#667781] truncate">
                            {(() => {
                              const sel = contacts.find(c => c.id === newLead.contact_id)
                              return sel ? `${sel.phone_number} ${sel.company ? `· ${sel.company}` : ''}` : ''
                            })()}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setNewLead(prev => ({ ...prev, contact_id: '' }))
                            setContactSearchInput('')
                            setShowContactDropdown(true)
                          }}
                          className="p-1 hover:bg-[#dfe5e7] rounded-full text-[#8696a0] transition-colors cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      // Search input state
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search by name, phone, or company..."
                          value={contactSearchInput}
                          onChange={e => {
                            setContactSearchInput(e.target.value)
                            setShowContactDropdown(true)
                          }}
                          onFocus={() => setShowContactDropdown(true)}
                          className="form-input pr-8"
                          required={!isOfflineLead}
                        />
                        {searchingContacts ? (
                          <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-[#00a884]" />
                        ) : (
                          <Search size={14} className="absolute right-3 top-3 text-[#8696a0]" />
                        )}
                      </div>
                    )}

                    {/* Dropdown list */}
                    {showContactDropdown && !newLead.contact_id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowContactDropdown(false)}
                        />
                        <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-[#e9edef] rounded-lg shadow-lg z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                          {contacts.length === 0 ? (
                            <div className="p-3 text-xs text-[#8696a0] text-center font-medium">
                              No contacts found
                            </div>
                          ) : (
                            contacts.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setNewLead(prev => ({ ...prev, contact_id: c.id }))
                                  setShowContactDropdown(false)
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-[#f0f2f5] transition-colors border-b border-[#f5f6f6] last:border-b-0 flex flex-col gap-0.5 cursor-pointer"
                              >
                                <span className="text-xs font-bold text-[#111b21]">
                                  {c.first_name} {c.last_name || ''}
                                </span>
                                <span className="text-[10px] text-[#667781] truncate">
                                  {c.phone_number} {c.company ? `· ${c.company}` : ''}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Deal Title */}
              <FormField label="Deal Title">
                <input type="text" value={newLead.title} onChange={e => setNewLead({ ...newLead, title: e.target.value })}
                  className="form-input" placeholder="e.g. Enterprise WhatsApp CRM Setup" required />
              </FormField>

              {/* Description */}
              <FormField label="Description">
                <textarea value={newLead.description} onChange={e => setNewLead({ ...newLead, description: e.target.value })}
                  className="form-input" placeholder="Details about this deal..." rows={2} />
              </FormField>

              {/* Value + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Deal Value ($)">
                  <input type="number" value={newLead.value} onChange={e => setNewLead({ ...newLead, value: e.target.value })}
                    className="form-input" placeholder="5000" />
                </FormField>
                <FormField label="Priority">
                  <select value={newLead.priority} onChange={e => setNewLead({ ...newLead, priority: e.target.value as any })}
                    className="form-input">
                    <option value="high">🔥 Hot</option>
                    <option value="medium">☀️ Warm</option>
                    <option value="low">❄️ Cold</option>
                  </select>
                </FormField>
              </div>

              {/* Source + Expected Close */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Source">
                  <select value={newLead.source} onChange={e => setNewLead({ ...newLead, source: e.target.value })}
                    className="form-input">
                    {SOURCE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Expected Close Date">
                  <input type="date" value={newLead.expected_close_date} onChange={e => setNewLead({ ...newLead, expected_close_date: e.target.value })}
                    className="form-input" />
                </FormField>
              </div>

              {/* Product/Service */}
              <FormField label="Product / Service Interested In">
                <input type="text" value={newLead.product_service} onChange={e => setNewLead({ ...newLead, product_service: e.target.value })}
                  className="form-input" placeholder="e.g. CRM Pro Plan, WhatsApp API Integration" />
              </FormField>

              {/* Assigned To */}
              <FormField label="Assigned To">
                <select value={newLead.assigned_to} onChange={e => setNewLead({ ...newLead, assigned_to: e.target.value })}
                  className="form-input">
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </select>
              </FormField>

              {/* Notes */}
              <FormField label="Notes">
                <textarea value={newLead.notes} onChange={e => setNewLead({ ...newLead, notes: e.target.value })}
                  className="form-input" placeholder="Any additional notes..." rows={2} />
              </FormField>
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-5 py-4 border-t border-[#e9edef] flex-shrink-0">
              <button onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2.5 border border-[#e9edef] rounded-lg text-[#54656f] hover:bg-[#f0f2f5] text-xs font-bold cursor-pointer transition-all">
                Cancel
              </button>
              <button onClick={handleAddLead} disabled={actionLoading || !newLead.title || !newLead.contact_id}
                className="flex-1 px-4 py-2.5 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg text-xs font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
                {actionLoading && <Loader2 size={12} className="animate-spin" />}
                Create Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ━━━ WON/LOST CONFIRMATION MODAL ━━━ */}
      {showWonLostModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-200">
            <div className="p-5">
              {showWonLostModal.action === 'won' ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-10 w-10 rounded-full bg-green-50 border border-green-100 flex items-center justify-center">
                      <Trophy size={20} className="text-green-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#111b21]">Mark as Won 🎉</h3>
                      <p className="text-[10px] text-[#667781] font-medium">Congratulations on closing this deal!</p>
                    </div>
                  </div>
                  <FormField label="Closing Note (optional)">
                    <textarea value={wonLostNote} onChange={e => setWonLostNote(e.target.value)}
                      className="form-input" placeholder="Any notes about this win..." rows={2} />
                  </FormField>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-10 w-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
                      <XCircle size={20} className="text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#111b21]">Mark as Lost</h3>
                      <p className="text-[10px] text-[#667781] font-medium">Help track why this deal was lost</p>
                    </div>
                  </div>
                  <FormField label="Reason for Loss">
                    <select value={wonLostReason} onChange={e => setWonLostReason(e.target.value)} className="form-input">
                      <option value="">Select a reason...</option>
                      {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </FormField>
                  <div className="mt-3">
                    <FormField label="Additional Notes (optional)">
                      <textarea value={wonLostNote} onChange={e => setWonLostNote(e.target.value)}
                        className="form-input" placeholder="More details..." rows={2} />
                    </FormField>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[#e9edef]">
              <button onClick={() => { setShowWonLostModal(null); setWonLostReason(''); setWonLostNote('') }}
                className="flex-1 px-4 py-2.5 border border-[#e9edef] rounded-lg text-[#54656f] hover:bg-[#f0f2f5] text-xs font-bold cursor-pointer transition-all">
                Cancel
              </button>
              <button onClick={confirmWonLost} disabled={actionLoading}
                className={`flex-1 px-4 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                  showWonLostModal.action === 'won'
                    ? 'bg-[#00a884] hover:bg-[#008069] text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}>
                {actionLoading && <Loader2 size={12} className="animate-spin" />}
                {showWonLostModal.action === 'won' ? 'Confirm Won' : 'Confirm Lost'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ━━━ SLIDE-OUT DETAIL PANEL ━━━ */}
      {selectedLeadId && selectedLeadData && (
        <>
          <div onClick={() => setSelectedLeadId(null)} className="fixed inset-0 bg-black/20 z-40 backdrop-blur-[1px]" />
          <div className="fixed top-0 right-0 h-screen w-full sm:w-[440px] bg-white border-l border-[#e9edef] shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="bg-[#008069] px-5 py-4 flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-white text-sm font-bold">{selectedLeadData.title}</h3>
                <p className="text-white/70 text-[10px] font-medium mt-0.5">{contactName(selectedLeadData)}</p>
              </div>
              <button onClick={() => setSelectedLeadId(null)} className="p-1 hover:bg-white/10 rounded-full text-white/70 cursor-pointer transition-all">
                <X size={18} />
              </button>
            </div>

            {/* Status Bar */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#e9edef] bg-[#f8f9fa] flex-shrink-0">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATUS_CONFIG[selectedLeadData.status || 'active'].bg} ${STATUS_CONFIG[selectedLeadData.status || 'active'].text} ${STATUS_CONFIG[selectedLeadData.status || 'active'].border}`}>
                {STATUS_CONFIG[selectedLeadData.status || 'active'].label}
              </span>
              {selectedLeadData.status === 'active' && (
                <div className="flex items-center gap-1 ml-auto">
                  <button onClick={() => handleStatusChange(selectedLeadData.id, 'won')}
                    className="px-2.5 py-1 rounded-md bg-green-50 text-green-600 hover:bg-green-100 border border-green-100 text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1">
                    <CheckCircle2 size={11} /> Won
                  </button>
                  <button onClick={() => handleStatusChange(selectedLeadData.id, 'lost')}
                    className="px-2.5 py-1 rounded-md bg-red-50 text-red-500 hover:bg-red-100 border border-red-100 text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1">
                    <Ban size={11} /> Lost
                  </button>
                  <button onClick={() => handleStatusChange(selectedLeadData.id, 'on_hold')}
                    className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-100 text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1">
                    <Pause size={11} /> Hold
                  </button>
                </div>
              )}
              {selectedLeadData.status !== 'active' && (
                <button onClick={() => handleStatusChange(selectedLeadData.id, 'active')}
                  className="ml-auto px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100 text-[10px] font-bold cursor-pointer transition-all">
                  Reactivate
                </button>
              )}
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-[#e9edef] px-5 gap-6 flex-shrink-0 bg-white">
              <button 
                onClick={() => setActiveDrawerTab('overview')}
                className={`py-3 text-[11px] font-bold border-b-2 transition-all cursor-pointer ${
                  activeDrawerTab === 'overview' ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Overview
              </button>
              <button 
                onClick={() => setActiveDrawerTab('discussions')}
                className={`py-3 text-[11px] font-bold border-b-2 transition-all cursor-pointer ${
                  activeDrawerTab === 'discussions' ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Discussions
              </button>
              <button 
                onClick={() => setActiveDrawerTab('ai_summary')}
                className={`py-3 text-[11px] font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeDrawerTab === 'ai_summary' ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                <Sparkles size={12} className={activeDrawerTab === 'ai_summary' ? 'text-[#00a884]' : 'text-[#8696a0]'} />
                AI Summary
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
              {activeDrawerTab === 'overview' && (
                <>
                  {aiError && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-rose-700 text-xs font-semibold">
                      ⚠️ {aiError}
                    </div>
                  )}
                  {aiSuccess && (
                    <div className="p-3 bg-green-50 border border-green-100 rounded-lg text-[#008069] text-xs font-semibold">
                      ✨ AI successfully profiled this lead! Suggested details are pre-filled below. Review and click Save to apply.
                    </div>
                  )}
                  {/* Deal Title */}
              <FormField label="Deal Title">
                <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="form-input" />
              </FormField>

              {/* Value + Stage */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Value ($)">
                  <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                    className="form-input font-mono text-[#008069]" />
                </FormField>
                <FormField label="Pipeline Stage">
                  <select value={editStageId} onChange={e => setEditStageId(e.target.value)} className="form-input">
                    {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </FormField>
              </div>

              {/* Priority */}
              <FormField label="Priority">
                <div className="grid grid-cols-3 gap-2 bg-[#f0f2f5] p-1 rounded-lg border border-[#e9edef]">
                  {(['high', 'medium', 'low'] as const).map(p => {
                    const cfg = PRIORITY_CONFIG[p]
                    const Icon = cfg.icon
                    return (
                      <button key={p} type="button" onClick={() => setEditPriority(p)}
                        className={`py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                          editPriority === p
                            ? `bg-white shadow-sm ${cfg.color}`
                            : 'text-[#8696a0] hover:bg-[#e9edef]'
                        }`}>
                        <Icon size={10} />
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </FormField>

              {/* Source + Expected Close */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Source">
                  <select value={editSource} onChange={e => setEditSource(e.target.value)} className="form-input">
                    {SOURCE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Expected Close">
                  <input type="date" value={editExpectedClose} onChange={e => setEditExpectedClose(e.target.value)} className="form-input" />
                </FormField>
              </div>

              {/* Product/Service */}
              <FormField label="Product / Service">
                <input type="text" value={editProductService} onChange={e => setEditProductService(e.target.value)}
                  className="form-input" placeholder="Product or service..." />
              </FormField>

              {/* Assigned To */}
              <FormField label="Assigned To">
                <select value={editAssignedTo} onChange={e => setEditAssignedTo(e.target.value)} className="form-input">
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </select>
              </FormField>

              {/* Description */}
              <FormField label="Description">
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
                  className="form-input" rows={2} placeholder="Deal description..." />
              </FormField>

              {/* Notes */}
              <FormField label="Notes">
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  className="form-input" rows={3} placeholder="Internal notes about this deal..." />
              </FormField>

              {/* Won/Lost Reason (if applicable) */}
              {(selectedLeadData.status === 'won' || selectedLeadData.status === 'lost') && selectedLeadData.won_lost_reason && (
                <div className={`p-3 rounded-lg border ${selectedLeadData.status === 'won' ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                  <span className="text-[9px] font-black uppercase tracking-wider text-[#667781]">
                    {selectedLeadData.status === 'won' ? 'Won Note' : 'Lost Reason'}
                  </span>
                  <p className="text-xs font-medium text-[#111b21] mt-1">{selectedLeadData.won_lost_reason}</p>
                  {selectedLeadData.won_at && (
                    <p className="text-[9px] text-[#8696a0] mt-1">Won on {new Date(selectedLeadData.won_at).toLocaleDateString()}</p>
                  )}
                  {selectedLeadData.lost_at && (
                    <p className="text-[9px] text-[#8696a0] mt-1">Lost on {new Date(selectedLeadData.lost_at).toLocaleDateString()}</p>
                  )}
                </div>
              )}

              {/* Contact Card */}
              {selectedLeadData.contact && (
                <div className="p-4 bg-[#f8f9fa] border border-[#e9edef] rounded-xl space-y-3">
                  <span className="text-[9px] font-black uppercase tracking-wider text-[#667781]">Linked Contact</span>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-[#dfe5e7] border border-[#e9edef] flex items-center justify-center font-bold text-xs text-[#54656f]">
                      {(selectedLeadData.contact.first_name || 'U').substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#111b21]">{selectedLeadData.contact.first_name} {selectedLeadData.contact.last_name || ''}</p>
                      <p className="text-[10px] text-[#8696a0] font-medium">{selectedLeadData.contact.company || 'No company'}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-[10px] border-t border-[#e9edef] pt-2">
                    <div className="flex items-center gap-2 text-[#54656f] font-medium">
                      <Phone size={10} className="text-[#8696a0]" />
                      {selectedLeadData.contact.phone_number}
                    </div>
                    {selectedLeadData.contact.email && (
                      <div className="flex items-center gap-2 text-[#54656f] font-medium">
                        <Mail size={10} className="text-[#8696a0]" />
                        {selectedLeadData.contact.email}
                      </div>
                    )}
                  </div>
                  <Link href={`/dashboard?contactId=${selectedLeadData.contact_id}`}
                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-[#e7f7f4] hover:bg-[#d4f0e8] text-[#008069] rounded-lg text-xs font-bold transition-all border border-[#00a884]/20">
                    <MessageCircle size={13} />
                    Chat on WhatsApp
                  </Link>
                </div>
              )}
                </>
              )}

              {activeDrawerTab === 'discussions' && (
                <>

              {/* Activity Timeline & Notes */}
              <div className="pt-4 mt-2 border-t border-[#e9edef]">
                <h4 className="text-xs font-bold text-[#111b21] mb-3 flex items-center gap-1.5">
                  <MessageCircle size={14} className="text-[#00a884]" />
                  Activity & Notes
                </h4>
                
                <div className="bg-[#f0f2f5] p-2 rounded-lg mb-3">
                  <textarea 
                    value={activityNote}
                    onChange={e => setActivityNote(e.target.value)}
                    placeholder="Add a note or update..." 
                    className="form-input text-xs w-full bg-white border-transparent focus:border-[#00a884]"
                    rows={2}
                  />
                  <div className="flex justify-end mt-2">
                    <button 
                      onClick={handleAddNote}
                      disabled={!activityNote.trim() || isSaving}
                      className="px-3 py-1.5 bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white rounded text-[10px] font-bold cursor-pointer transition-all shadow-sm"
                    >
                      Post Note
                    </button>
                  </div>
                </div>

                <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2 no-scrollbar">
                  {activities.map(act => (
                    <div key={act.id} className="flex gap-2">
                      <div className="w-5 h-5 rounded-full bg-[#e7f7f4] flex items-center justify-center flex-shrink-0 mt-0.5">
                        {act.activity_type === 'note' ? (
                          <MessageCircle size={10} className="text-[#00a884]" />
                        ) : (
                          <Sparkles size={10} className="text-[#00a884]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 bg-white p-2.5 rounded-lg border border-[#e9edef] shadow-sm">
                        <div className="flex justify-between items-start mb-0.5">
                          <span className="text-[10px] font-bold text-[#111b21]">{act.user?.full_name || 'System'}</span>
                          <span className="text-[8px] text-[#8696a0] whitespace-nowrap ml-2">
                            {new Date(act.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#54656f] leading-relaxed break-words whitespace-pre-wrap">
                          {act.content}
                        </p>
                      </div>
                    </div>
                  ))}
                  {activities.length === 0 && (
                    <div className="text-center py-4 text-[10px] text-[#8696a0] font-medium italic bg-[#f8f9fa] rounded-lg border border-dashed border-[#e9edef]">
                      No activity recorded yet.
                    </div>
                  )}
                </div>
              </div>
                </>
              )}

              {activeDrawerTab === 'ai_summary' && (
                <div className="flex flex-col items-center justify-center min-h-[300px] text-center space-y-4 px-4 py-8">
                  <div className="w-16 h-16 rounded-full bg-[#e7f7f4] flex items-center justify-center">
                    <Sparkles size={24} className="text-[#00a884]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#111b21] mb-1">AI Lead Intelligence</h4>
                    <p className="text-[11px] text-[#667781] max-w-xs mx-auto">
                      Automatically analyze all notes, activities, and contact data to generate a comprehensive profile and pre-fill the form fields.
                    </p>
                  </div>
                  {features.enable_ai ? (
                    <button 
                      onClick={handleAISummarize} 
                      disabled={isSaving || aiLoading}
                      className="px-6 py-2.5 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
                    >
                      {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {aiLoading ? 'Analyzing Data...' : 'Generate AI Summary'}
                    </button>
                  ) : (
                    <div className="text-xs text-[#8696a0] bg-[#f8f9fa] p-3 rounded-lg border border-[#e9edef]">
                      AI features are currently disabled in your organization settings.
                    </div>
                  )}
                  {aiError && <p className="text-xs text-rose-600 font-medium mt-2">⚠️ {aiError}</p>}
                  {aiSuccess && <p className="text-xs text-[#008069] font-medium mt-2">✨ Lead profiled successfully! Check the Overview tab.</p>}
                </div>
              )}

              {/* Timestamps */}
              <div className="text-[9px] text-[#8696a0] font-medium space-y-1 pt-2 border-t border-[#e9edef]">
                <p>Created: {new Date(selectedLeadData.created_at).toLocaleString()}</p>
                <p>Last Activity: {selectedLeadData.last_activity_at ? new Date(selectedLeadData.last_activity_at).toLocaleString() : 'N/A'}</p>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-[#f0f2f5] border-t border-[#e9edef] px-4 py-3 flex items-center justify-between flex-shrink-0">
              <div className="flex gap-2">
                <button type="button" onClick={handleDeleteLead} disabled={isSaving || aiLoading}
                  className="p-2 rounded-lg border border-red-100 bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer transition-all disabled:opacity-50" title="Delete">
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setSelectedLeadId(null)} disabled={aiLoading}
                  className="px-4 py-2 rounded-lg border border-[#e9edef] bg-white hover:bg-[#f0f2f5] text-xs font-bold text-[#54656f] cursor-pointer transition-all disabled:opacity-50">
                  Close
                </button>
                <button onClick={handleSaveChanges} disabled={isSaving || aiLoading}
                  className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008069] text-xs font-bold text-white cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-sm">
                  {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={13} />}
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ━━━ GLOBAL FORM STYLES ━━━ */}
      <style jsx global>{`
        .form-input {
          width: 100%;
          padding: 8px 12px;
          background: white;
          border: 1px solid #e9edef;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          color: #111b21;
          outline: none;
          transition: all 0.15s;
        }
        .form-input:focus {
          border-color: #00a884;
          box-shadow: 0 0 0 2px rgba(0, 168, 132, 0.1);
        }
        select.form-input {
          cursor: pointer;
        }
        textarea.form-input {
          resize: vertical;
          min-height: 40px;
        }
      `}</style>
    </div>
  )
}

// ─── Utility Components ───

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: string; icon: React.ReactNode; color: string; sub?: string
}) {
  return (
    <div className="bg-[#f8f9fa] rounded-lg border border-[#e9edef] px-2.5 py-1.5 flex flex-col justify-center min-w-0">
      <div className="flex items-center gap-1">
        <span className={`${color} opacity-80 shrink-0`}>{icon}</span>
        <span className="text-[8px] font-black uppercase tracking-wider text-[#667781] truncate">{label}</span>
      </div>
      <div className="flex items-baseline justify-between mt-0.5 gap-1.5">
        <span className={`text-xs md:text-sm font-black font-mono ${color} leading-none`}>{value}</span>
        {sub && <span className="text-[8px] text-[#8696a0] font-bold truncate">{sub}</span>}
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-black uppercase tracking-wider text-[#54656f]">{label}</label>
      {children}
    </div>
  )
}
