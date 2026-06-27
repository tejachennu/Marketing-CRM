'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { useAlert } from '@/lib/dialog-context'
import { Ticket, Clock, CheckCircle2, MessageSquare, TrendingUp, Search, Calendar, X, ChevronLeft, ChevronRight, Loader2, User, Users } from 'lucide-react'

interface TicketItem {
  id: string
  subject: string
  status: string
  created_at: string
  conversation_id: string
  contact_id: string
  assigned_to: string | null
  contacts?: {
    first_name: string | null
    last_name: string | null
    phone_number: string
    email: string | null
  }
}

interface PipelineStage {
  id: string
  name: string
  position: number
}

interface OrgUser {
  id: string
  full_name: string | null
  email: string
}

export default function TicketsPage() {
  const router = useRouter()
  const alert = useAlert()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('')
  const [adminSeeAll, setAdminSeeAll] = useState<boolean>(true)
  const [readOnlyMode, setReadOnlyMode] = useState<boolean>(false)

  const toggleSeeAll = () => {
    const newVal = !adminSeeAll
    setAdminSeeAll(newVal)
    localStorage.setItem('admin_see_all', String(newVal))
  }

  const toggleReadOnly = () => {
    const newVal = !readOnlyMode
    setReadOnlyMode(newVal)
    localStorage.setItem('admin_read_only', String(newVal))
  }
  
  // UI states
  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active')
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    resolved: 0
  })

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const pageSize = 10

  // Move to Lead Modal state
  const [showLeadModal, setShowLeadModal] = useState<TicketItem | null>(null)
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [leadForm, setLeadForm] = useState({
    title: '',
    value: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    stageId: '',
    assignedTo: '',
    resolveTicket: true
  })
  const [modalLoading, setModalLoading] = useState(false)

  // Load base user & org details
  useEffect(() => {
    async function initUser() {
      try {
        await restoreSupabaseSession()
        const storedUser = authSessionManager.getUser()
        if (!storedUser?.id) {
          router.push('/login')
          return
        }
        setUserId(storedUser.id)

        const { data: profile } = await supabase
          .from('users')
          .select('organization_id, role, see_all, read_only')
          .eq('id', storedUser.id)
          .maybeSingle()

        if (profile?.organization_id) {
          setOrgId(profile.organization_id)
        }
        if (profile?.role) {
          setUserRole(profile.role)
          setAdminSeeAll(profile.see_all !== false)
          setReadOnlyMode(profile.read_only === true)
        }
      } catch (err) {
        console.error('Error initializing user in tickets page:', err)
      }
    }
    initUser()
  }, [router])

  // Fetch reference data for Lead Conversion modal
  useEffect(() => {
    if (!orgId) return
    async function fetchReferenceData() {
      try {
        const { data: stagesData } = await supabase
          .from('pipeline_stages')
          .select('id, name, position')
          .eq('organization_id', orgId)
          .order('position')
        
        setStages(stagesData || [])
        if (stagesData && stagesData.length > 0) {
          setLeadForm(prev => ({ ...prev, stageId: stagesData[0].id }))
        }

        const { data: usersData } = await supabase
          .from('users')
          .select('id, full_name, email')
          .eq('organization_id', orgId)
        
        setOrgUsers(usersData || [])
      } catch (err) {
        console.error('Error fetching reference data:', err)
      }
    }
    fetchReferenceData()
  }, [orgId])

  // Fetch Tickets Stats
  const fetchStats = useCallback(async () => {
    if (!orgId) return
    try {
      const seeAll = adminSeeAll

      let totalQ = supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)

      let activeQ = supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'open')

      let resolvedQ = supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'resolved')

      if (!seeAll && userId) {
        totalQ = totalQ.eq('assigned_to', userId)
        activeQ = activeQ.eq('assigned_to', userId)
        resolvedQ = resolvedQ.eq('assigned_to', userId)
      }

      const [totalRes, activeRes, resolvedRes] = await Promise.all([
        totalQ,
        activeQ,
        resolvedQ
      ])

      setStats({
        total: totalRes.count || 0,
        active: activeRes.count || 0,
        resolved: resolvedRes.count || 0
      })
    } catch (err) {
      console.error('Error fetching tickets stats:', err)
    }
  }, [orgId, userId, userRole, adminSeeAll])

  // Main Tickets Fetcher
  const fetchTickets = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const seeAll = adminSeeAll

      let query = supabase
        .from('tickets')
        .select(`
          id,
          subject,
          status,
          created_at,
          conversation_id,
          contact_id,
          assigned_to,
          contacts (
            first_name,
            last_name,
            phone_number,
            email
          )
        `, { count: 'exact' })
        .eq('organization_id', orgId)
        .eq('status', activeTab === 'active' ? 'open' : 'resolved')

      if (!seeAll && userId) {
        query = query.eq('assigned_to', userId)
      }

      // Apply search scoping
      if (searchTerm.trim()) {
        const search = searchTerm.trim()
        
        const { data: matchedContacts } = await supabase
          .from('contacts')
          .select('id')
          .eq('organization_id', orgId)
          .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%`)

        const contactIds = (matchedContacts || []).map(c => c.id)
        if (contactIds.length > 0) {
          query = query.or(`subject.ilike.%${search}%,contact_id.in.(${contactIds.join(',')})`)
        } else {
          query = query.ilike('subject', `%${search}%`)
        }
      }

      // Apply Date Filters
      if (fromDate) {
        query = query.gte('created_at', new Date(fromDate).toISOString())
      }
      if (toDate) {
        const endOfDay = new Date(toDate)
        endOfDay.setHours(23, 59, 59, 999)
        query = query.lte('created_at', endOfDay.toISOString())
      }

      // Order & Paginate
      const offset = (currentPage - 1) * pageSize
      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1)

      if (error) throw error

      setTickets((data || []).map((t: any) => ({
        ...t,
        contacts: Array.isArray(t.contacts) ? t.contacts[0] : t.contacts
      })) as TicketItem[])

      setTotalCount(count || 0)
      setTotalPages(Math.ceil((count || 0) / pageSize) || 1)
    } catch (err) {
      console.error('Error fetching tickets list:', err)
    } finally {
      setLoading(false)
    }
  }, [orgId, activeTab, searchTerm, fromDate, toDate, currentPage, userId, userRole, adminSeeAll])

  // Refetch when dependencies change
  useEffect(() => {
    if (orgId) {
      fetchTickets()
      fetchStats()
    }
  }, [orgId, activeTab, fromDate, toDate, currentPage, fetchTickets, fetchStats])

  // Realtime update listener
  useEffect(() => {
    if (!orgId) return
    const channel = supabase
      .channel('tickets-page-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `organization_id=eq.${orgId}` },
        () => {
          fetchTickets()
          fetchStats()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId, fetchTickets, fetchStats])

  // Search input debouncer helper
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
    setCurrentPage(1)
  }

  // Resolve Ticket Action
  const handleResolveTicket = async (ticketId: string) => {
    if (readOnlyMode) {
      alert({ title: 'Read-Only Mode', message: 'You cannot resolve tickets while Read-Only Mode is active.' })
      return
    }
    setActionLoading(ticketId)
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, status: 'resolved' })
      })
      const data = await res.json()
      if (data.success) {
        setTickets(prev => prev.filter(t => t.id !== ticketId))
        fetchStats()
      }
    } catch (err) {
      console.error('Error resolving ticket:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const [assignLoading, setAssignLoading] = useState<string | null>(null)

  // Assign Ticket to Teamate Action
  const handleAssignTicket = async (ticketId: string, assignedToId: string | null) => {
    if (readOnlyMode) {
      alert({ title: 'Read-Only Mode', message: 'You cannot assign tickets while Read-Only Mode is active.' })
      return
    }
    setAssignLoading(ticketId)
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ assigned_to: assignedToId || null })
        .eq('id', ticketId)
      
      if (error) throw error
      
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, assigned_to: assignedToId } : t))
      fetchStats()
    } catch (err) {
      console.error('Failed to assign ticket:', err)
      alert({ title: 'Error', message: 'Failed to assign ticket.' })
    } finally {
      setAssignLoading(null)
    }
  }

  // Convert/Move Ticket to Lead
  const handleOpenLeadModal = (ticket: TicketItem) => {
    setLeadForm({
      title: `Ticket: ${ticket.subject}`,
      value: '',
      priority: 'medium',
      stageId: stages[0]?.id || '',
      assignedTo: userId || '',
      resolveTicket: true
    })
    setShowLeadModal(ticket)
  }

  const handleConvertLead = async (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnlyMode) {
      alert({ title: 'Read-Only Mode', message: 'You cannot convert tickets to leads while Read-Only Mode is active.' })
      return
    }
    if (!showLeadModal || !orgId) return
    setModalLoading(true)
    try {
      // 1. Create lead record
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert([{
          organization_id: orgId,
          contact_id: showLeadModal.contact_id,
          title: leadForm.title,
          description: `Converted from Ticket conversion: ${showLeadModal.subject}`,
          pipeline_stage_id: leadForm.stageId || null,
          value: leadForm.value ? parseFloat(leadForm.value) : null,
          priority: leadForm.priority,
          status: 'active',
          source: 'whatsapp',
          assigned_to: leadForm.assignedTo || null,
          created_by: userId,
          last_activity_at: new Date().toISOString()
        }])
        .select()
        .single()

      if (leadErr) throw leadErr

      // 2. Link conversation to lead
      if (lead) {
        const { error: convErr } = await supabase
          .from('conversations')
          .update({ lead_id: lead.id })
          .eq('id', showLeadModal.conversation_id)

        if (convErr) console.error('Error linking lead to conversation:', convErr)
      }

      // 3. Optionally Resolve Ticket
      if (leadForm.resolveTicket) {
        await fetch('/api/tickets', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId: showLeadModal.id, status: 'resolved' })
        })
      }

      setShowLeadModal(null)
      fetchTickets()
      fetchStats()
    } catch (err) {
      console.error('Failed to convert ticket to lead:', err)
    } finally {
      setModalLoading(false)
    }
  }

  // Formats relative time
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    } catch {
      return ''
    }
  }

  return (
    <div className="p-4 pb-20 md:pb-6 md:p-6 font-sans h-full bg-[#f0f2f5] dark:bg-[#0b141a] text-[#111b21] dark:text-[#e9edef] overflow-y-auto space-y-6 relative">
      
      {/* Header */}
      <div className="flex items-center justify-between select-none flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111b21] dark:text-white">Support Tickets</h1>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 font-semibold">Manage, resolve, and convert customer support inquiries.</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 select-none">
        
        {/* Total Stats */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] p-5 shadow-xs flex items-center justify-between transition-all duration-300 hover:shadow-md">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">Total Tickets</span>
            <h3 className="text-2xl font-extrabold text-slate-800 dark:text-white leading-none">{stats.total}</h3>
          </div>
          <div className="h-10 w-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-650 dark:text-indigo-400 flex items-center justify-center">
            <Ticket size={20} />
          </div>
        </div>

        {/* Active Stats */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] p-5 shadow-xs flex items-center justify-between transition-all duration-300 hover:shadow-md">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">Active Inquiries</span>
            <h3 className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 leading-none">{stats.active}</h3>
          </div>
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <Clock size={20} className="animate-pulse" />
          </div>
        </div>

        {/* Resolved Stats */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] p-5 shadow-xs flex items-center justify-between transition-all duration-300 hover:shadow-md">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">Resolved Tickets</span>
            <h3 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 leading-none">{stats.resolved}</h3>
          </div>
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCircle2 size={20} />
          </div>
        </div>

      </div>

      {/* Main Filter toolbar and ticket rows */}
      <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden flex flex-col justify-start">
        
        {/* Toolbar Header */}
        <div className="p-4 border-b border-[#e9edef] dark:border-[#202d36] flex flex-col gap-4">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            
            {/* Tabs */}
            <div className="flex border-b border-transparent">
              <button
                onClick={() => { setActiveTab('active'); setCurrentPage(1) }}
                className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'active'
                    ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
                    : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                }`}
              >
                <Clock size={13} />
                <span>Active ({stats.active})</span>
              </button>
              <button
                onClick={() => { setActiveTab('closed'); setCurrentPage(1) }}
                className={`px-4 py-2 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'closed'
                    ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
                    : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                }`}
              >
                <CheckCircle2 size={13} />
                <span>Closed / Resolved ({stats.resolved})</span>
              </button>
            </div>

            {/* Clear filters shortcut */}
            {(searchTerm || fromDate || toDate) && (
              <button
                onClick={() => { setSearchTerm(''); setFromDate(''); setToDate(''); setCurrentPage(1) }}
                className="text-[10px] font-bold text-red-500 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1 bg-red-500/10 px-2.5 py-1.5 rounded-lg border border-red-500/20 w-fit self-end sm:self-auto cursor-pointer"
              >
                <X size={11} />
                <span>Clear All Filters</span>
              </button>
            )}

          </div>

          {/* Filtering inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            
            {/* Search Input */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search size={14} />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Search by subject or contact name..."
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
              />
            </div>

            {/* From Date filter */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Calendar size={14} />
              </span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setCurrentPage(1) }}
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none text-xs font-semibold text-[#111b21] dark:text-white"
                placeholder="From Date"
              />
            </div>

            {/* To Date filter */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Calendar size={14} />
              </span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setCurrentPage(1) }}
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none text-xs font-semibold text-[#111b21] dark:text-white"
                placeholder="To Date"
              />
            </div>

          </div>

        </div>

        {/* Tickets List Area */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="animate-spin text-[#00a884]" size={30} />
            <p className="text-xs text-[#667781] dark:text-[#8696a0] font-bold uppercase tracking-wider">Fetching Inquiries...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-20 text-center select-none">
            <Ticket size={48} className="mx-auto text-slate-200 dark:text-slate-800 mb-4 animate-bounce duration-[1500ms]" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-350">No tickets found</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse text-xs select-none">
              <thead>
                <tr className="border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#1f2c34] text-[9px] font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
                  <th className="px-6 py-3.5">Ticket / Inquiry Subject</th>
                  <th className="px-6 py-3.5">Contact Customer</th>
                  <th className="px-6 py-3.5">Date Created</th>
                  <th className="px-6 py-3.5">Assigned To</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e9edef] dark:divide-[#2a3942]">
                {tickets.map((ticket) => {
                  const name = ticket.contacts 
                    ? `${ticket.contacts.first_name || ''} ${ticket.contacts.last_name || ''}`.trim() || 'Unknown'
                    : 'Unknown'
                  
                  return (
                    <tr key={ticket.id} className="hover:bg-slate-50/50 dark:hover:bg-[#1f2c34]/20 transition-all group">
                      
                      {/* Subject */}
                      <td className="px-6 py-4">
                        <div className="font-bold text-[#111b21] dark:text-white max-w-sm truncate group-hover:text-[#00a884] transition-colors leading-relaxed">
                          {ticket.subject}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-xs">
                          ID: {ticket.id}
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-350">
                        <div>{name}</div>
                        <div className="text-[10px] text-slate-455 dark:text-slate-500 font-medium">
                          {ticket.contacts?.phone_number || ''}
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-400 font-medium">
                        {formatTime(ticket.created_at)}
                      </td>

                      {/* Assigned To */}
                      <td className="px-6 py-4">
                        {['super_admin', 'org_admin', 'org_manager', 'owner', 'admin', 'superadmin', 'OrgAdmin', 'Manager', 'saleslead'].includes(userRole) && !readOnlyMode ? (
                          <select
                            value={ticket.assigned_to || ''}
                            onChange={(e) => handleAssignTicket(ticket.id, e.target.value || null)}
                            disabled={assignLoading === ticket.id}
                            className="px-2.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs font-semibold text-[#111b21] dark:text-white focus:outline-none focus:border-[#00a884] disabled:opacity-50"
                          >
                            <option value="">Unassigned</option>
                            {orgUsers.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.full_name || u.email}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-semibold text-slate-700 dark:text-slate-350">
                            {orgUsers.find(u => u.id === ticket.assigned_to)?.full_name || 'Unassigned'}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                          ticket.status === 'open'
                            ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200/40 dark:border-amber-900/30'
                            : 'bg-emerald-50 dark:bg-emerald-950/15 text-emerald-700 dark:text-emerald-400 border-emerald-200/40 dark:border-emerald-900/30'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${ticket.status === 'open' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          <span>{ticket.status === 'open' ? 'Active' : 'Resolved'}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          
                          {/* Open Chat */}
                          <button
                            onClick={() => router.push(`/dashboard?conversationId=${ticket.conversation_id}`)}
                            title="Open Conversation"
                            className="p-1.5 hover:bg-[#00a884]/10 text-slate-400 hover:text-[#00a884] rounded-lg transition-colors cursor-pointer"
                          >
                            <MessageSquare size={14} />
                          </button>

                          {/* Move to Lead */}
                          {!readOnlyMode && (
                            <button
                              onClick={() => handleOpenLeadModal(ticket)}
                              title="Move to Pipeline Lead"
                              className="p-1.5 hover:bg-indigo-500/10 text-slate-400 hover:text-indigo-500 rounded-lg transition-colors cursor-pointer"
                            >
                              <TrendingUp size={14} />
                            </button>
                          )}

                          {/* Resolve inline */}
                          {ticket.status === 'open' && !readOnlyMode && (
                            <button
                              onClick={() => handleResolveTicket(ticket.id)}
                              disabled={actionLoading === ticket.id}
                              title="Mark Resolved"
                              className="p-1.5 hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-500 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {actionLoading === ticket.id ? (
                                <Loader2 size={14} className="animate-spin text-emerald-500" />
                              ) : (
                                <CheckCircle2 size={14} />
                              )}
                            </button>
                          )}

                        </div>
                      </td>

                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile View: Cards */}
          <div className="block md:hidden divide-y divide-[#e9edef] dark:divide-[#2a3942]">
            {tickets.map((ticket) => {
              const name = ticket.contacts 
                ? `${ticket.contacts.first_name || ''} ${ticket.contacts.last_name || ''}`.trim() || 'Unknown'
                : 'Unknown'
              
              return (
                <div key={ticket.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-[#111b21] dark:text-white leading-relaxed break-words">{ticket.subject}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">ID: {ticket.id}</p>
                    </div>
                    
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase border shrink-0 ${
                      ticket.status === 'open'
                        ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200/40 dark:border-amber-900/30'
                        : 'bg-emerald-50 dark:bg-emerald-950/15 text-emerald-700 dark:text-emerald-450 border-emerald-200/40 dark:border-emerald-900/30'
                    }`}>
                      <span>{ticket.status === 'open' ? 'Active' : 'Resolved'}</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-350">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 dark:text-slate-500 font-bold">Contact:</span>
                      <span>{name}</span>
                      {ticket.contacts?.phone_number && (
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                      )}
                      <span className="font-mono text-[10px] text-slate-500">{ticket.contacts?.phone_number || ''}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 dark:text-slate-500 font-bold">Assignee:</span>
                      {['super_admin', 'org_admin', 'org_manager', 'owner', 'admin', 'superadmin', 'OrgAdmin', 'Manager', 'saleslead'].includes(userRole) && !readOnlyMode ? (
                        <select
                          value={ticket.assigned_to || ''}
                          onChange={(e) => handleAssignTicket(ticket.id, e.target.value || null)}
                          disabled={assignLoading === ticket.id}
                          className="px-2 py-1 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-lg text-[10px] font-semibold text-[#111b21] dark:text-white focus:outline-none focus:border-[#00a884] disabled:opacity-50"
                        >
                          <option value="">Unassigned</option>
                          {orgUsers.map(u => (
                            <option key={u.id} value={u.id}>
                              {u.full_name || u.email}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span>{orgUsers.find(u => u.id === ticket.assigned_to)?.full_name || 'Unassigned'}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-slate-455 dark:text-slate-500 text-[10px]">
                      <Clock size={11} />
                      <span>{formatTime(ticket.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-dashed border-[#e9edef]/60 dark:border-[#2a3942]/60">
                    {/* Open Chat */}
                    <button
                      onClick={() => router.push(`/dashboard?conversationId=${ticket.conversation_id}`)}
                      className="p-2 hover:bg-[#00a884]/10 text-slate-500 hover:text-[#00a884] dark:hover:text-[#00e676] rounded-xl transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                    >
                      <MessageSquare size={13} />
                      <span>Chat</span>
                    </button>

                    {/* Move to Lead */}
                    {!readOnlyMode && (
                      <button
                        onClick={() => handleOpenLeadModal(ticket)}
                        className="p-2 hover:bg-indigo-500/10 text-slate-500 hover:text-indigo-500 rounded-xl transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                      >
                        <TrendingUp size={13} />
                        <span>Pipeline</span>
                      </button>
                    )}

                    {/* Resolve inline */}
                    {ticket.status === 'open' && !readOnlyMode && (
                      <button
                        onClick={() => handleResolveTicket(ticket.id)}
                        disabled={actionLoading === ticket.id}
                        className="p-2 hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-500 rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 text-[10px] font-bold"
                      >
                        {actionLoading === ticket.id ? (
                          <Loader2 size={13} className="animate-spin text-emerald-500" />
                        ) : (
                          <CheckCircle2 size={13} />
                        )}
                        <span>Resolve</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-[#e9edef] dark:border-[#202d36] flex items-center justify-between select-none">
            <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold">
              Showing page {currentPage} of {totalPages} ({totalCount} total results)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1 || loading}
                className="p-2 border border-[#e9edef] dark:border-[#2a3942] rounded-xl hover:bg-slate-50 dark:hover:bg-[#1f2c34] text-slate-550 dark:text-slate-350 disabled:opacity-50 disabled:hover:bg-transparent transition-all cursor-pointer flex items-center justify-center"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages || loading}
                className="p-2 border border-[#e9edef] dark:border-[#2a3942] rounded-xl hover:bg-slate-50 dark:hover:bg-[#1f2c34] text-slate-555 dark:text-slate-355 disabled:opacity-50 disabled:hover:bg-transparent transition-all cursor-pointer flex items-center justify-center"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Conversion to Pipeline Lead Modal */}
      {showLeadModal && (
        <div className="fixed inset-0 bg-slate-950/20 dark:bg-slate-950/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div 
            className="fixed inset-0" 
            onClick={() => setShowLeadModal(null)} 
          />
          <div className="relative bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] shadow-2xl max-w-md w-full overflow-hidden select-none animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#e9edef] dark:border-[#202d36] flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-500">
                <TrendingUp size={18} />
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Convert to Pipeline Lead</h3>
              </div>
              <button 
                onClick={() => setShowLeadModal(null)}
                className="text-slate-400 hover:text-slate-650 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleConvertLead} className="p-6 space-y-4 text-xs">
              
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                  Lead Opportunity Title
                </label>
                <input
                  type="text"
                  required
                  value={leadForm.title}
                  onChange={(e) => setLeadForm({ ...leadForm, title: e.target.value })}
                  placeholder="e.g. Upgrade to Pro Package"
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none font-semibold text-[#111b21] dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Deal Value ($ USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={leadForm.value}
                    onChange={(e) => setLeadForm({ ...leadForm, value: e.target.value })}
                    placeholder="e.g. 500"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none font-semibold text-[#111b21] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Priority Level
                  </label>
                  <select
                    value={leadForm.priority}
                    onChange={(e) => setLeadForm({ ...leadForm, priority: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none font-semibold text-[#111b21] dark:text-white"
                  >
                    <option value="low">Cold (Low)</option>
                    <option value="medium">Warm (Medium)</option>
                    <option value="high">Hot (High)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Pipeline Stage
                  </label>
                  <select
                    value={leadForm.stageId}
                    onChange={(e) => setLeadForm({ ...leadForm, stageId: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none font-semibold text-[#111b21] dark:text-white"
                  >
                    {stages.length === 0 ? (
                      <option value="">No stages config</option>
                    ) : (
                      stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Assign Account To
                  </label>
                  <select
                    value={leadForm.assignedTo}
                    onChange={(e) => setLeadForm({ ...leadForm, assignedTo: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl focus:outline-none font-semibold text-[#111b21] dark:text-white"
                  >
                    <option value="">Select teammate</option>
                    {orgUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                  </select>
                </div>
              </div>

              <div className="py-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="resolveTicket"
                  checked={leadForm.resolveTicket}
                  onChange={(e) => setLeadForm({ ...leadForm, resolveTicket: e.target.checked })}
                  className="w-3.5 h-3.5 rounded text-[#00a884] focus:ring-[#00a884] border-slate-350 bg-slate-50 cursor-pointer"
                />
                <label htmlFor="resolveTicket" className="font-semibold text-slate-650 dark:text-slate-350 cursor-pointer select-none">
                  Automatically mark this support ticket as resolved.
                </label>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-[#e9edef] dark:border-[#202d36] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLeadModal(null)}
                  className="px-4 py-2 border border-[#e9edef] dark:border-[#2a3942] rounded-xl hover:bg-slate-50 dark:hover:bg-[#2a3942]/40 text-slate-700 dark:text-slate-300 font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white rounded-xl font-bold shadow-xs hover:shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {modalLoading && <Loader2 size={13} className="animate-spin" />}
                  <span>Convert to Lead</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  )
}
