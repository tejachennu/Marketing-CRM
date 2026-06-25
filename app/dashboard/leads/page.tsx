'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { Lead, PipelineStage, Contact, User } from '@/lib/types'
import {
  Plus, DollarSign, X, Trash2, MessageCircle, Save, Search,
  Calendar, TrendingUp, Trophy, XCircle, Pause, Filter,
  ChevronDown, ChevronUp, ArrowUpDown, Flame, Sun, Snowflake,
  BarChart3, Target, Clock, Grip, CheckCircle2, Ban,
  ExternalLink, Phone, Mail, Building2, Package, Loader2,
  List, LayoutGrid, Eye, Sparkles
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ───
interface LeadWithContact extends Lead {
  contact?: Contact
  stage?: PipelineStage
}

type StatusFilter = 'all' | 'active' | 'won' | 'lost' | 'on_hold'
type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type ViewMode = 'list' | 'board' | 'performance'
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
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
  })

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showAnalytics, setShowAnalytics] = useState(false)

  // ─── Date Range Filter ───
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [dateFilterApplied, setDateFilterApplied] = useState(false)

  // ─── Modals ───
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
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
        .select('enable_ai, enable_email, enable_messages, enable_phone_calls')
        .eq('id', userData.organization_id)
        .maybeSingle()
      if (orgData) {
        setFeatures({
          enable_ai: orgData.enable_ai !== false,
          enable_email: orgData.enable_email !== false,
          enable_messages: orgData.enable_messages !== false,
          enable_phone_calls: orgData.enable_phone_calls !== false,
        })
      }

      // Fetch dynamic lists
      await Promise.all([
        loadLeads(userData, 1, searchQuery, statusFilter, priorityFilter, fromDate, toDate, dateFilterApplied, sortField, sortDir),
        loadAnalyticsLeads(userData.organization_id, userData.id, userData.role)
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

  async function loadAnalyticsLeads(orgId: string, userId: string, role: string) {
    try {
      let aq = supabase
        .from('leads')
        .select('value, status, priority, source, created_at, last_activity_at, updated_at, won_at, lost_at, assigned_to')
        .eq('organization_id', orgId)

      if (role === 'salesemployees' || role === 'saleslead') {
        aq = aq.or(`assigned_to.eq.${userId},assigned_to.is.null`)
      }

      const { data, error } = await aq
      if (error) throw error
      setAllLeadsForAnalytics((data || []) as Lead[])
    } catch (error) {
      console.error('Error fetching analytics leads:', error)
    }
  }

  async function loadLeads(
    currentUser: User,
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

      if (currentUser.role === 'salesemployees' || currentUser.role === 'saleslead') {
        q = q.or(`assigned_to.eq.${currentUser.id},assigned_to.is.null`)
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
    if (!user || !newLead.title || !newLead.contact_id) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from('leads').insert([{
        organization_id: user.organization_id,
        contact_id: newLead.contact_id,
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
      }])
      if (error) throw error
      setShowAddModal(false)
      setNewLead({ title: '', description: '', value: '', contact_id: '', priority: 'medium', source: 'other', expected_close_date: '', notes: '', product_service: '', assigned_to: '' })
      await loadData()
    } catch (error) {
      console.error('Error adding lead:', error)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSaveChanges() {
    if (!selectedLeadId) return
    setIsSaving(true)
    try {
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
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`
    return `$${val.toLocaleString()}`
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
      <div className="flex-shrink-0 bg-white border-b border-[#e9edef] px-4 md:px-6 py-2.5">
        <div className="flex flex-col gap-3">
          {/* Row 1: Title + Actions */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#111b21] flex items-center gap-2">
                <TrendingUp size={20} className="text-[#00a884]" />
                Sales Pipeline
              </h1>
              <p className="text-[10px] text-[#667781] font-medium mt-0.5">
                {totalLeadsCount} total leads · {activeLeads.length} active · {formatCurrency(totalPipelineValue)} in pipeline
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="bg-[#f0f2f5] p-0.5 rounded-lg flex items-center border border-[#e9edef]">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'list' ? 'bg-white text-[#008069] shadow-sm' : 'text-[#8696a0] hover:text-[#54656f]'}`}
                  title="List View"
                >
                  <List size={15} />
                </button>
                <button
                  onClick={() => setViewMode('board')}
                  className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'board' ? 'bg-white text-[#008069] shadow-sm' : 'text-[#8696a0] hover:text-[#54656f]'}`}
                  title="Board View"
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  onClick={() => setViewMode('performance')}
                  className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'performance' ? 'bg-white text-[#008069] shadow-sm' : 'text-[#8696a0] hover:text-[#54656f]'}`}
                  title="Team Performance"
                >
                  <BarChart3 size={15} />
                </button>
              </div>
              <button
                onClick={() => {
                  setContactSearchInput('')
                  setNewLead(prev => ({ ...prev, contact_id: '' }))
                  setShowAddModal(true)
                }}
                className="bg-[#00a884] hover:bg-[#008069] text-white px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-bold shadow-sm transition-all cursor-pointer"
              >
                <Plus size={15} />
                <span className="hidden sm:inline">New Lead</span>
              </button>
            </div>
          </div>

          {/* Row 2: Search + Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {viewMode !== 'performance' ? (
              <>
                {/* Search */}
                <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-[#8696a0]" />
                  <input
                    type="text"
                    placeholder="Search leads..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] border border-[#e9edef] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] focus:bg-white font-medium text-[#111b21] transition-all"
                  />
                </div>

                {/* Status Tabs */}
                <div className="flex items-center bg-[#f0f2f5] rounded-lg p-0.5 border border-[#e9edef]">
                  {(['all', 'active', 'won', 'lost', 'on_hold'] as StatusFilter[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                        statusFilter === s
                          ? 'bg-white shadow-sm text-[#111b21]'
                          : 'text-[#8696a0] hover:text-[#54656f]'
                      }`}
                    >
                      {s === 'all' ? 'All' : s === 'on_hold' ? 'On Hold' : s.charAt(0).toUpperCase() + s.slice(1)}
                      <span className="ml-1 text-[9px] opacity-60">{statusCounts[s]}</span>
                    </button>
                  ))}
                </div>

                {/* Priority Filter */}
                <div className="flex items-center bg-[#f0f2f5] rounded-lg p-0.5 border border-[#e9edef]">
                  {(['all', 'high', 'medium', 'low'] as PriorityFilter[]).map(p => {
                    const cfg = p !== 'all' ? PRIORITY_CONFIG[p] : null
                    return (
                      <button
                        key={p}
                        onClick={() => setPriorityFilter(p)}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          priorityFilter === p
                            ? 'bg-white shadow-sm text-[#111b21]'
                            : 'text-[#8696a0] hover:text-[#54656f]'
                        }`}
                      >
                        {cfg && <cfg.icon size={10} className={cfg.color} />}
                        {p === 'all' ? 'All' : cfg?.label}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {/* Date Range Filter */}
            <div className="flex items-center gap-1 bg-[#f0f2f5] rounded-lg p-0.5 border border-[#e9edef] text-[10px]">
              <Calendar size={11} className="text-[#8696a0] ml-1 shrink-0" />
              <input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value)
                  setDateFilterApplied(true)
                }}
                className="bg-transparent border-none text-[#111b21] outline-none font-bold text-[9px] cursor-pointer py-0.5 w-[90px] shrink-0"
                placeholder="From"
              />
              <span className="text-[#8696a0] font-bold shrink-0">-</span>
              <input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value)
                  setDateFilterApplied(true)
                }}
                className="bg-transparent border-none text-[#111b21] outline-none font-bold text-[9px] cursor-pointer py-0.5 w-[90px] shrink-0"
                placeholder="To"
              />
              {dateFilterApplied && (
                <button
                  onClick={() => {
                    setDateFilterApplied(false)
                    setFromDate('')
                    setToDate('')
                  }}
                  className="text-rose-500 hover:text-[#ef4444] font-bold text-[9px] cursor-pointer px-1 shrink-0"
                >
                  <X size={10} />
                </button>
              )}
            </div>

            {/* Quick Date Presets */}
            <div className="flex items-center bg-[#f0f2f5] rounded-lg p-0.5 border border-[#e9edef] text-[10px]">
              <button
                onClick={() => setDateRangePreset('this_month')}
                className={`px-2 py-1 rounded-md text-[9px] font-bold cursor-pointer transition-all ${
                  fromDate && toDate && dateFilterApplied &&
                  fromDate === thisMonthStartStr &&
                  toDate === thisMonthEndStr
                    ? 'bg-white shadow-sm text-[#111b21]'
                    : 'text-[#8696a0] hover:text-[#54656f]'
                }`}
              >
                This Month
              </button>
              <button
                onClick={() => setDateRangePreset('last_month')}
                className={`px-2 py-1 rounded-md text-[9px] font-bold cursor-pointer transition-all ${
                  fromDate && toDate && dateFilterApplied &&
                  fromDate === lastMonthStartStr &&
                  toDate === lastMonthEndStr
                    ? 'bg-white shadow-sm text-[#111b21]'
                    : 'text-[#8696a0] hover:text-[#54656f]'
                }`}
              >
                Last Month
              </button>
            </div>

            {viewMode !== 'performance' ? (
              /* Toggle Analytics */
              <button
                onClick={() => setShowAnalytics(!showAnalytics)}
                className={`p-2 rounded-lg border transition-all cursor-pointer ${showAnalytics ? 'bg-[#e7f7f4] border-[#00a884]/20 text-[#008069]' : 'bg-[#f0f2f5] border-[#e9edef] text-[#8696a0]'}`}
                title="Toggle Analytics"
              >
                <BarChart3 size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ━━━ ANALYTICS DASHBOARD ━━━ */}
      {showAnalytics && viewMode !== 'performance' && (
        <div className="flex-shrink-0 bg-white border-b border-[#e9edef] px-4 md:px-6 py-2.5 animate-in slide-in-from-top-2 duration-200">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
            <StatCard label="Pipeline Value" value={formatCurrency(totalPipelineValue)} icon={<DollarSign size={13} />} color="text-[#111b21]" />
            <StatCard label="Won This Month" value={formatCurrency(wonRevenueThisMonth)} icon={<Trophy size={13} />} color="text-[#00a884]" sub={`${wonThisMonth.length} deals`} />
            <StatCard label="Won Last Month" value={formatCurrency(wonRevenueLastMonth)} icon={<Calendar size={13} />} color="text-amber-600" sub={`${wonLastMonth.length} deals`} />
            <StatCard label="Won YTD" value={formatCurrency(wonRevenueYTD)} icon={<TrendingUp size={13} />} color="text-blue-600" sub={`${wonYTD.length} deals`} />
            <StatCard label="Conversion Rate" value={`${conversionRate}%`} icon={<Target size={13} />} color="text-violet-600" sub={`${wonLeads.length}W / ${lostLeads.length}L`} />
            <StatCard label="Avg Deal Size" value={formatCurrency(avgDealSize)} icon={<BarChart3 size={13} />} color="text-pink-600" sub={`${wonLeads.length} won`} />
          </div>

          {/* Date Range + Activity Stats */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-[#f5f6f6] text-[10px]">
            <div className="flex items-center gap-1.5 bg-[#f8f9fa] px-2 py-1 rounded-md border border-[#e9edef]">
              <span className="text-[8px] font-black text-[#667781] uppercase">From</span>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="bg-transparent border-none text-[#111b21] outline-none font-bold text-[9px] cursor-pointer" />
              <span className="text-[8px] font-black text-[#667781] uppercase ml-1">To</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="bg-transparent border-none text-[#111b21] outline-none font-bold text-[9px] cursor-pointer" />
              <button onClick={() => setDateFilterApplied(true)}
                className="bg-[#00a884] hover:bg-[#008069] text-white px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer text-[8px] ml-1">
                Apply
              </button>
              {dateFilterApplied && (
                <button onClick={() => { setDateFilterApplied(false); setFromDate(''); setToDate('') }}
                  className="text-rose-500 hover:text-rose-600 font-bold text-[8px] cursor-pointer ml-1">
                  Clear
                </button>
              )}
            </div>
            {dateFilterApplied && (
              <div className="bg-[#e7f7f4] border border-[#00a884]/20 px-2 py-0.5 rounded-md text-[#008069] font-bold text-[9px] animate-in fade-in duration-200">
                Won in range: <span className="font-black font-mono">{formatCurrency(dateFilteredRevenue)}</span> ({dateFilteredWon.length} deals)
              </div>
            )}
            <div className="flex items-center gap-3 font-semibold text-[#667781] text-[9px]">
              <span className="flex items-center gap-1">
                <Plus size={9} className="text-[#00a884]" />
                {leadsThisWeek.length} new this week
              </span>
              <span className="flex items-center gap-1">
                <Clock size={9} className={staleLeads.length > 0 ? 'text-amber-500' : 'text-[#8696a0]'} />
                {staleLeads.length} stale (&gt;7d)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ━━━ MAIN CONTENT ━━━ */}
      <div className="flex-1 overflow-auto">
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
              <div className="bg-white rounded-xl border border-[#e9edef] shadow-sm overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-[2fr_1.2fr_100px_120px_80px_80px_90px_100px] gap-0 border-b border-[#e9edef] bg-[#f8f9fa] px-4 py-2.5 text-[9px] font-black uppercase tracking-wider text-[#667781]">
                  <button onClick={() => handleSort('title')} className="flex items-center gap-1 cursor-pointer hover:text-[#111b21] transition-colors text-left">
                    Contact / Deal {sortField === 'title' && <ArrowUpDown size={9} />}
                  </button>
                  <span>Stage</span>
                  <button onClick={() => handleSort('value')} className="flex items-center gap-1 cursor-pointer hover:text-[#111b21] transition-colors">
                    Value {sortField === 'value' && <ArrowUpDown size={9} />}
                  </button>
                  <span>Status</span>
                  <span>Priority</span>
                  <span>Source</span>
                  <button onClick={() => handleSort('last_activity_at')} className="flex items-center gap-1 cursor-pointer hover:text-[#111b21] transition-colors">
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
                  return (
                    <div
                      key={lead.id}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`grid grid-cols-[2fr_1.2fr_100px_120px_80px_80px_90px_100px] gap-0 px-4 py-3 border-b border-[#f5f6f6] last:border-b-0 cursor-pointer transition-all hover:bg-[#f8f9fa] group ${
                        selectedLeadId === lead.id ? 'bg-[#e7f7f4]/30' : ''
                      }`}
                    >
                      {/* Contact / Deal */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-[#dfe5e7] flex items-center justify-center font-bold text-[10px] text-[#54656f] flex-shrink-0 border border-[#e9edef]">
                          {(lead.contact?.first_name || 'U').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111b21] truncate">{lead.title}</p>
                          <p className="text-[10px] text-[#667781] font-medium truncate">{name}{lead.contact?.company ? ` · ${lead.contact.company}` : ''}</p>
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
                      <div className="flex items-center text-xs font-bold text-[#008069] font-mono">
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
                      <div className="flex items-center text-[10px] text-[#667781] font-medium capitalize">
                        {(lead.source || 'other').replace('_', ' ')}
                      </div>

                      {/* Activity */}
                      <div className="flex items-center text-[10px] text-[#8696a0] font-medium">
                        {daysSince(lead.last_activity_at || lead.created_at)}
                      </div>

                      {/* Quick Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        {lead.status === 'active' && (
                          <>
                            <button onClick={() => handleStatusChange(lead.id, 'won')}
                              title="Mark Won"
                              className="p-1.5 rounded-md bg-green-50 text-green-600 hover:bg-green-100 border border-green-100 cursor-pointer transition-all">
                              <CheckCircle2 size={12} />
                            </button>
                            <button onClick={() => handleStatusChange(lead.id, 'lost')}
                              title="Mark Lost"
                              className="p-1.5 rounded-md bg-red-50 text-red-500 hover:bg-red-100 border border-red-100 cursor-pointer transition-all">
                              <Ban size={12} />
                            </button>
                          </>
                        )}
                        {(lead.status === 'won' || lead.status === 'lost' || lead.status === 'on_hold') && (
                          <button onClick={() => handleStatusChange(lead.id, 'active')}
                            title="Reactivate"
                            className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100 cursor-pointer transition-all text-[9px] font-bold">
                            Reactivate
                          </button>
                        )}
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
        ) : viewMode === 'board' ? (
          /* ── BOARD VIEW ── */
          <div className="flex flex-row gap-4 p-4 md:p-6 overflow-x-auto h-full pb-8">
            {stages.map(stage => {
              const stageLeads = sortedLeads.filter(l => l.pipeline_stage_id === stage.id && l.status === 'active')
              const isDragOver = dragOverStage === stage.id
              const stageValue = stageLeads.reduce((s, l) => s + (l.value || 0), 0)

              return (
                <div
                  key={stage.id}
                  onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id) }}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOverStage(null)
                    if (dragLeadId.current) handleMoveStage(dragLeadId.current, stage.id)
                  }}
                  className={`flex-shrink-0 w-72 bg-[#f8f9fa] border rounded-xl flex flex-col max-h-full transition-all duration-200 ${
                    isDragOver ? 'border-2 border-dashed border-[#00a884] bg-[#e7f7f4]/30 scale-[1.01]' : 'border-[#e9edef]'
                  }`}
                >
                  {/* Stage Header */}
                  <div className="p-3 border-b border-[#e9edef] flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                        <h3 className="text-[10px] font-black text-[#111b21] uppercase tracking-wider">{stage.name}</h3>
                      </div>
                      <span className="text-[9px] font-bold text-[#667781] bg-white px-2 py-0.5 rounded-full border border-[#e9edef]">
                        {stageLeads.length}
                      </span>
                    </div>
                    {stageValue > 0 && (
                      <p className="text-[10px] font-bold text-[#008069] font-mono mt-1">{formatCurrency(stageValue)}</p>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageLeads.length === 0 ? (
                      <div className="text-center py-8 text-[10px] text-[#8696a0] font-medium border border-dashed border-[#e9edef] rounded-lg">
                        No active deals
                      </div>
                    ) : stageLeads.map(lead => {
                      const name = contactName(lead)
                      const priorityCfg = PRIORITY_CONFIG[lead.priority || 'medium']
                      const PriorityIcon = priorityCfg.icon
                      return (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={() => { dragLeadId.current = lead.id }}
                          onDragEnd={() => { dragLeadId.current = null }}
                          onClick={() => setSelectedLeadId(lead.id)}
                          className="bg-white rounded-lg p-3 border border-[#e9edef] shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing transition-all group"
                          style={{ borderLeftWidth: '3px', borderLeftColor: stage.color }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold text-[#111b21] truncate">{lead.title}</p>
                              <p className="text-[10px] text-[#667781] font-medium truncate mt-0.5">{name}</p>
                            </div>
                            <span className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold flex-shrink-0 ${priorityCfg.bg} ${priorityCfg.color}`}>
                              <PriorityIcon size={8} />
                              {priorityCfg.label}
                            </span>
                          </div>

                          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[#f5f6f6]">
                            <span className="text-[11px] font-bold text-[#008069] font-mono">
                              {lead.value ? formatCurrency(lead.value) : '—'}
                            </span>
                            <span className="text-[9px] text-[#8696a0] font-medium">
                              {daysSince(lead.last_activity_at || lead.created_at)}
                            </span>
                          </div>

                          {/* Quick actions on hover */}
                          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleStatusChange(lead.id, 'won')}
                              className="flex-1 py-1 rounded-md bg-green-50 text-green-600 hover:bg-green-100 border border-green-100 text-[9px] font-bold cursor-pointer transition-all flex items-center justify-center gap-0.5">
                              <CheckCircle2 size={10} /> Won
                            </button>
                            <button onClick={() => handleStatusChange(lead.id, 'lost')}
                              className="flex-1 py-1 rounded-md bg-red-50 text-red-500 hover:bg-red-100 border border-red-100 text-[9px] font-bold cursor-pointer transition-all flex items-center justify-center gap-0.5">
                              <Ban size={10} /> Lost
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
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
        )}
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
              {/* Contact Searchable Select */}
              <FormField label="Contact">
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
                        required
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
              </FormField>

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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
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
                {features.enable_ai && (
                  <button type="button" onClick={handleAISummarize} disabled={isSaving || aiLoading}
                    className="px-3 py-2 rounded-lg border border-[#00a884]/20 bg-[#e7f7f4] text-[#008069] hover:bg-[#d4f0e8] cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1 text-xs font-bold" title="AI Profile">
                    {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-[#00a884]" />}
                    <span>AI Profile</span>
                  </button>
                )}
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
