'use client'

import { useRouter, usePathname } from 'next/navigation'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { canSeeAll } from '@/lib/rbac'
import Link from 'next/link'
import { MessageCircle, Users, TrendingUp, Settings, LogOut, Megaphone, Phone, X, ChevronUp, Key, Sun, Moon, Shield, Sparkles, Ticket, Menu, User, Briefcase } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AssistantDrawer } from '@/components/assistant-drawer'
import { TicketsDrawer } from '@/components/tickets-drawer'
import { DialogProvider } from '@/lib/dialog-context'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [userEmail, setUserEmail] = useState<string>('')
  const [userFullName, setUserFullName] = useState<string>('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string>('')
  const [orgSlug, setOrgSlug] = useState<string>('')
  const [userRole, setUserRole] = useState<string>('')
  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
  })
  const [credentialsStatus, setCredentialsStatus] = useState({
    twilio: false,
    sendgrid: false,
    openai: false,
  })
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [showTickets, setShowTickets] = useState(false)
  const [activeTicketsCount, setActiveTicketsCount] = useState(0)
  const [unreadChatsCount, setUnreadChatsCount] = useState(0)
  const [activeLeadsCount, setActiveLeadsCount] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [userSeeAll, setUserSeeAll] = useState<boolean>(true)
  const [ticketToast, setTicketToast] = useState<{ id: string; subject: string; contactName: string; conversationId: string } | null>(null)
  const [hasUnreadAssistantNotif, setHasUnreadAssistantNotif] = useState(false)
  const [showSideDrawer, setShowSideDrawer] = useState(false)
  const [hasActiveChat, setHasActiveChat] = useState(false)

  // Listen for active chat selections to dynamically auto-hide the mobile bottom navigation bar
  useEffect(() => {
    const handleActiveChatChange = (e: Event) => {
      const customEvent = e as CustomEvent
      setHasActiveChat(!!customEvent.detail?.hasActiveConversation)
    }
    window.addEventListener('active-conversation-changed', handleActiveChatChange)
    return () => window.removeEventListener('active-conversation-changed', handleActiveChatChange)
  }, [])

  // If path changes from dashboard, ensure chat view selection is reset
  useEffect(() => {
    if (pathname !== '/dashboard') {
      setHasActiveChat(false)
    }
  }, [pathname])

  const addAssistantNotification = (msg: string) => {
    const newNotif = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      msg,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    let current = []
    try {
      current = JSON.parse(localStorage.getItem('assistant_notifs') || '[]')
    } catch (e) {
      current = []
    }
    const updated = [newNotif, ...current].slice(0, 30)
    localStorage.setItem('assistant_notifs', JSON.stringify(updated))
    localStorage.setItem('assistant_has_unread', 'true')
    window.dispatchEvent(new Event('assistant-unread-changed'))
  }

  useEffect(() => {
    const checkUnread = () => {
      setHasUnreadAssistantNotif(localStorage.getItem('assistant_has_unread') === 'true')
    }
    checkUnread()
    window.addEventListener('assistant-unread-changed', checkUnread)
    return () => window.removeEventListener('assistant-unread-changed', checkUnread)
  }, [])

  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (storedTheme) {
      setTheme(storedTheme)
      if (storedTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    localStorage.setItem('theme', nextTheme)
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    window.dispatchEvent(new Event('theme-changed'))
  }

  // Global fetch interceptor to catch 401 Unauthorized errors and force logout
  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args)
        
        if (response.status === 401 && !window.location.pathname.includes('/login')) {
          const clone = response.clone()
          try {
            const data = await clone.json()
            if (data?.error?.includes('No active session found') || data?.error?.includes('Unauthorized') || data?.error?.includes('session')) {
              authSessionManager.clearSession()
              supabase.auth.signOut().catch(() => {})
              window.location.href = '/login?expired=true'
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
        
        return response
      } catch (error) {
        throw error
      }
    }
    
    return () => {
      window.fetch = originalFetch
    }
  }, [])

  useEffect(() => {
    const getUserEmail = async () => {
      await restoreSupabaseSession()

      let email = ''
      let id = ''

      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.user) {
        email = session.user.email || ''
        id = session.user.id
      } else {
        const storedUser = authSessionManager.getUser()
        if (storedUser) {
          email = storedUser.email || ''
          id = storedUser.id
        }
      }

      setUserEmail(email)

      if (id) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, full_name, organization_id, role, see_all')
          .eq('id', id)
          .maybeSingle()
        if (profile) {
          setUserId(profile.id)
          setUserSeeAll(profile.see_all !== false)
          if (profile.full_name) {
            setUserFullName(profile.full_name)
          }
          if (profile.organization_id) {
            setOrgId(profile.organization_id)
          }
          if (profile.role) {
            setUserRole(profile.role)
          }
        }
      }
    }
    getUserEmail()
  }, [])

  useEffect(() => {
    if (userRole === 'superadmin' && pathname === '/dashboard') {
      router.push('/dashboard/superadmin')
    }
  }, [userRole, pathname, router])

  useEffect(() => {
    if (!orgId) return

    const fetchOrgFeatures = async () => {
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('name, slug, enable_ai, enable_email, enable_messages, enable_phone_calls, twilio_account_sid, sendgrid_api_key, openai_api_key')
          .eq('id', orgId)
          .maybeSingle()
        if (org) {
          setOrgName(org.name || '')
          setOrgSlug(org.slug || '')
          setFeatures({
            enable_ai: org.enable_ai !== false,
            enable_email: org.enable_email !== false,
            enable_messages: org.enable_messages !== false,
            enable_phone_calls: org.enable_phone_calls !== false,
          })

          const twilioConfigured = !!org.twilio_account_sid
          const sendgridConfigured = !!org.sendgrid_api_key
          const openaiConfigured = !!org.openai_api_key

          setCredentialsStatus({
            twilio: twilioConfigured,
            sendgrid: sendgridConfigured,
            openai: openaiConfigured,
          })

          const isDismissed = localStorage.getItem('onboarding_dismissed') === 'true'
          const needsCredentials = !twilioConfigured || !sendgridConfigured || !openaiConfigured

          setShowOnboarding(needsCredentials && !isDismissed)
        }
      } catch (err) {
        console.error('Failed to load organization features:', err)
      }
    }

    fetchOrgFeatures()

    window.addEventListener('organization-features-changed', fetchOrgFeatures)
    return () => {
      window.removeEventListener('organization-features-changed', fetchOrgFeatures)
    }
  }, [orgId])

  useEffect(() => {
    if (ticketToast) {
      const timer = setTimeout(() => {
        setTicketToast(null)
      }, 7000)
      return () => clearTimeout(timer)
    }
  }, [ticketToast])

  useEffect(() => {
    if (!orgId) return

    const seeAll = canSeeAll({ role: userRole, see_all: userSeeAll } as any)

    const fetchActiveTicketsCount = async () => {
      try {
        let query = supabase
          .from('tickets')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'open')

        if (!seeAll && userId) {
          query = query.eq('assigned_to', userId)
        }

        const { count, error } = await query
        if (error) throw error
        setActiveTicketsCount(count || 0)
      } catch (err) {
        console.error('Error fetching active tickets count:', err)
      }
    }

    const fetchUnreadChatsCount = async () => {
      try {
        let query = supabase
          .from('conversations')
          .select('unread_count')
          .eq('organization_id', orgId)
          .gt('unread_count', 0)

        if (!seeAll && userId) {
          // Fetch active leads assigned to the user (map by contact_id!)
          const { data: activeLeads } = await supabase
            .from('leads')
            .select('contact_id')
            .eq('assigned_to', userId)
            .eq('status', 'active')
          const contactIds = (activeLeads || []).map(l => l.contact_id).filter(Boolean)

          // Fetch open tickets assigned to the user
          const { data: openTickets } = await supabase
            .from('tickets')
            .select('conversation_id')
            .eq('assigned_to', userId)
            .eq('status', 'open')
          const ticketConvIds = (openTickets || []).map(t => t.conversation_id).filter(Boolean)

          let orConditions = `assigned_to.eq.${userId}`
          if (contactIds.length > 0) {
            orConditions += `,contact_id.in.(${contactIds.map(id => `"${id}"`).join(',')})`
          }
          if (ticketConvIds.length > 0) {
            orConditions += `,id.in.(${ticketConvIds.map(id => `"${id}"`).join(',')})`
          }
          query = query.or(orConditions)
        }

        const { data, error } = await query
        if (error) throw error
        const totalUnreadMessages = (data || []).reduce((sum, c) => sum + (c.unread_count || 0), 0)
        setUnreadChatsCount(totalUnreadMessages)
      } catch (err) {
        console.error('Error fetching unread chats count:', err)
      }
    }

    const fetchActiveLeadsCount = async () => {
      try {
        let query = supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'active')

        if (!seeAll && userId) {
          query = query.eq('assigned_to', userId)
        }

        const { count, error } = await query
        if (error) throw error
        setActiveLeadsCount(count || 0)
      } catch (err) {
        console.error('Error fetching active leads count:', err)
      }
    }

    fetchActiveTicketsCount()
    fetchUnreadChatsCount()
    fetchActiveLeadsCount()

    // Tickets Realtime Channel
    const channel = supabase
      .channel('layout-tickets-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `organization_id=eq.${orgId}`
        },
        async (payload) => {
          fetchActiveTicketsCount()

          // Only alert for new tickets if they are assigned to this user, or if we have see_all permission
          if (payload.eventType === 'INSERT') {
            const isAssignedToMe = payload.new.assigned_to === userId
            if (!seeAll && !isAssignedToMe) {
              return
            }

            try {
              const { data: contact } = await supabase
                .from('contacts')
                .select('first_name, last_name, phone_number, whatsapp_number')
                .eq('id', payload.new.contact_id)
                .maybeSingle()

              const contactName = contact
                ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.whatsapp_number || contact.phone_number || 'Unknown'
                : 'Unknown'

              setTicketToast({
                id: payload.new.id,
                subject: payload.new.subject,
                contactName,
                conversationId: payload.new.conversation_id
              })

              addAssistantNotification(`🎫 New active ticket created: "${payload.new.subject}" for contact ${contactName}`)
            } catch (err) {
              console.error('Error handling new ticket notification:', err)
            }
          }
        }
      )
      .subscribe()

    // Conversations Realtime Channel
    const convChannel = supabase
      .channel('layout-conversations-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `organization_id=eq.${orgId}`
        },
        async (payload) => {
          fetchUnreadChatsCount()

          // Chat auto-reply notification check
          if (payload.eventType === 'UPDATE') {
            const isAssignedToMe = payload.new.assigned_to === userId
            if (!seeAll && !isAssignedToMe) return

            const oldVal = payload.old?.auto_reply_enabled
            const newVal = payload.new?.auto_reply_enabled
            
            if (newVal === false && oldVal !== false) {
              try {
                const { data: contact } = await supabase
                  .from('contacts')
                  .select('first_name, last_name, phone_number, whatsapp_number')
                  .eq('id', payload.new.contact_id)
                  .maybeSingle()
                  
                const contactName = contact
                  ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.whatsapp_number || contact.phone_number || 'Unknown'
                  : 'Unknown'
                  
                addAssistantNotification(`🤖 Auto-reply chatbot turned OFF for conversation with ${contactName}`)
              } catch (err) {
                console.error('Error handling chatbot disabled notification:', err)
              }
            }
          }
        }
      )
      .subscribe()

    // Leads Realtime Channel
    const leadsChannel = supabase
      .channel('layout-leads-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
          filter: `organization_id=eq.${orgId}`
        },
        async () => {
          fetchActiveLeadsCount()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(convChannel)
      supabase.removeChannel(leadsChannel)
    }
  }, [orgId, userId, userRole, userSeeAll])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    await supabase.auth.signOut()
    authSessionManager.clearSession()
    router.push('/login')
    router.refresh()
  }

  const seeAll = canSeeAll({ role: userRole, see_all: userSeeAll } as any)

  const navItems = [
    { href: '/dashboard', label: 'Conversations', icon: MessageCircle },
    { href: '/dashboard/tickets', label: 'Tickets', icon: Ticket },
    { href: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
    { href: '/dashboard/leads', label: 'Sales Pipeline', icon: TrendingUp },
    { href: '/dashboard/contacts', label: 'Contacts', icon: Users },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    { href: '/dashboard/superadmin', label: 'Super Admin', icon: Shield },
  ]

  const filteredNavItems = navItems.filter((item) => {
    // If user is superadmin, ONLY show the Super Admin dashboard link
    if (userRole === 'superadmin') {
      return item.href === '/dashboard/superadmin'
    }
    
    // For normal users, hide the Super Admin link
    if (item.href === '/dashboard/superadmin') {
      return false
    }

    // Role-based restriction: hide Campaigns, Contacts, and Settings if no full access
    if (!seeAll && (item.href === '/dashboard/campaigns' || item.href === '/dashboard/contacts' || item.href === '/dashboard/settings')) {
      return false
    }

    if (item.href === '/dashboard') {
      return features.enable_messages
    }
    if (item.href === '/dashboard/tickets') {
      return features.enable_messages
    }
    if (item.href === '/dashboard/campaigns' || item.href === '/dashboard/contacts') {
      return features.enable_messages || features.enable_email
    }
    return true
  })

  const isPageAllowed = () => {
    if (userRole === 'superadmin') {
      return pathname.startsWith('/dashboard/superadmin')
    }
    if (pathname.startsWith('/dashboard/superadmin') && userRole !== 'superadmin') return false

    // Role-based page access protection
    if (!seeAll && (pathname.startsWith('/dashboard/campaigns') || pathname.startsWith('/dashboard/contacts') || pathname.startsWith('/dashboard/settings'))) {
      return false
    }

    if (pathname === '/dashboard' && !features.enable_messages) return false
    if (pathname.startsWith('/dashboard/ivr')) return false
    if ((pathname.startsWith('/dashboard/campaigns') || pathname.startsWith('/dashboard/contacts')) && !features.enable_messages && !features.enable_email) return false
    return true
  }

  return (
    <DialogProvider>
      <div className="flex flex-col h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased overflow-hidden font-sans">


      {/* Main Body below app bar */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* WhatsApp Web Responsive vertical Sidebar / Mobile Bottom-ba        {/* DESKTOP VERTICAL SIDEBAR */}
        <aside className="hidden md:flex md:flex-col md:justify-between md:py-4 md:border-r md:border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900 md:w-[64px] md:h-full z-40 select-none flex-shrink-0">
          
          {/* Navigation Tabs (Vertical) */}
          <div className="flex flex-col items-center gap-4 w-full">
            <nav className="flex flex-col items-center gap-2">
              {filteredNavItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                
                return (
                  <span key={item.href} className="contents">
                    <Link
                      href={item.href}
                      title={item.label}
                      onClick={(e) => {
                        if (pathname === item.href) {
                          e.preventDefault()
                          if (item.href === '/dashboard') {
                            window.dispatchEvent(new Event('reset-active-chat'))
                          }
                          return
                        }
                        if (item.href === '/dashboard') {
                          window.dispatchEvent(new Event('reset-active-chat'))
                        }
                      }}
                      className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
                        isActive
                          ? 'bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] bg-gradient-to-b from-emerald-500 to-teal-400 rounded-r-full" />
                      )}
 
                      <Icon
                        size={18}
                        className={`transition-transform duration-300 group-hover:scale-110 ${
                          isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'
                        }`}
                      />

                      {/* Live Badge for Tickets */}
                      {item.href === '/dashboard/tickets' && activeTicketsCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-[#ef4444] text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm animate-pulse z-10">
                          {activeTicketsCount}
                        </span>
                      )}

                      {/* Live Badge for Conversations */}
                      {item.href === '/dashboard' && unreadChatsCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-[#ef4444] text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm animate-pulse z-10">
                          {unreadChatsCount}
                        </span>
                      )}

                      {/* Live Badge for Leads */}
                      {item.href === '/dashboard/leads' && activeLeadsCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-[#ef4444] text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm animate-pulse z-10">
                          {activeLeadsCount}
                        </span>
                      )}
                      
                      {/* Tooltip for desktop */}
                      <span className="absolute left-[65px] bg-slate-900 text-slate-100 dark:bg-slate-800 border border-slate-750 text-[10px] font-bold py-1.5 px-2.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap scale-90 group-hover:scale-100 origin-left">
                        {item.label}
                      </span>
                    </Link>
                  </span>
                )
              })}
            </nav>
          </div>

          {/* User profile, Assistant & Logout (Desktop) */}
          <div className="flex flex-col items-center gap-3 w-full">
            {/* Assistant Toggle */}
            {seeAll && (
              <button
                onClick={() => setShowAssistant((prev) => !prev)}
                title="Marketing Assistant"
                className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
                  showAssistant
                    ? 'bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <Sparkles size={18} className={`transition-transform duration-300 group-hover:scale-110 ${showAssistant ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
                {hasUnreadAssistantNotif && !showAssistant && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm animate-pulse z-10" />
                )}
                <span className="absolute left-[65px] bg-slate-900 text-slate-100 dark:bg-slate-800 border border-slate-750 text-[10px] font-bold py-1.5 px-2.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap scale-90 group-hover:scale-100 origin-left">
                  Assistant
                </span>
              </button>
            )}

            {/* Profile Link */}
            <Link
              href="/dashboard/profile"
              title="My Profile"
              className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
                pathname === '/dashboard/profile'
                  ? 'bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {pathname === '/dashboard/profile' && (
                <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] bg-gradient-to-b from-emerald-500 to-teal-400 rounded-r-full" />
              )}
              <div className="flex h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-[10px] border border-slate-200/50 dark:border-slate-700/50 select-none transition-all duration-200 group-hover:border-slate-350 dark:group-hover:border-slate-600">
                {userFullName ? userFullName.substring(0, 2).toUpperCase() : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'US')}
              </div>
              <span className="absolute left-[65px] bg-slate-900 text-slate-100 dark:bg-slate-800 border border-slate-750 text-[10px] font-bold py-1.5 px-2.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap scale-90 group-hover:scale-100 origin-left">
                Profile
              </span>
            </Link>
            
            {/* Logout Icon */}
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center justify-center h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-900/50 hover:bg-rose-500/10 border border-slate-200/50 dark:border-slate-800/80 text-slate-400 hover:text-rose-500 transition-all duration-200 shadow-sm cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        {/* MOBILE BOTTOM NAVIGATION BAR — 4 items only */}
        {!hasActiveChat && (
          <div className="md:hidden fixed bottom-0 left-0 right-0 h-[68px] bg-white/95 dark:bg-slate-900/95 border-t border-slate-200/60 dark:border-slate-800/80 backdrop-blur-md z-45 select-none shadow-[0_-4px_20px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.2)] flex items-center justify-around px-2" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {/* Chats */}
          {features.enable_messages && (
            <Link
              href="/dashboard"
              onClick={(e) => {
                if (pathname === '/dashboard') {
                  e.preventDefault()
                  window.dispatchEvent(new Event('reset-active-chat'))
                  return
                }
                window.dispatchEvent(new Event('reset-active-chat'))
              }}
              className="flex flex-col items-center justify-center flex-1 h-full py-1.5 group relative"
            >
              <div className={`w-12 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
                pathname === '/dashboard'
                  ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-[#00a884] dark:text-[#00e676] scale-105'
                  : 'text-slate-400 dark:text-slate-500'
              }`}>
                <MessageCircle size={20} />
              </div>
              <span className={`text-[9px] font-bold tracking-normal mt-0.5 uppercase ${
                pathname === '/dashboard' ? 'text-[#00a884] dark:text-[#00e676]' : 'text-slate-400 dark:text-slate-500'
              }`}>Chats</span>
              {unreadChatsCount > 0 && (
                <span className="absolute top-1 right-2 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm z-50 animate-pulse">
                  {unreadChatsCount}
                </span>
              )}
            </Link>
          )}

          {/* Tickets */}
          {features.enable_messages && (
            <Link
              href="/dashboard/tickets"
              onClick={(e) => { if (pathname === '/dashboard/tickets') e.preventDefault() }}
              className="flex flex-col items-center justify-center flex-1 h-full py-1.5 group relative"
            >
              <div className={`w-12 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
                pathname.startsWith('/dashboard/tickets')
                  ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-[#00a884] dark:text-[#00e676] scale-105'
                  : 'text-slate-400 dark:text-slate-500'
              }`}>
                <Ticket size={20} />
              </div>
              <span className={`text-[9px] font-bold tracking-normal mt-0.5 uppercase ${
                pathname.startsWith('/dashboard/tickets') ? 'text-[#00a884] dark:text-[#00e676]' : 'text-slate-400 dark:text-slate-500'
              }`}>Tickets</span>
              {activeTicketsCount > 0 && (
                <span className="absolute top-1 right-2 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm z-50 animate-pulse">
                  {activeTicketsCount}
                </span>
              )}
            </Link>
          )}

          {/* Pipeline */}
          <Link
            href="/dashboard/leads"
            onClick={(e) => { if (pathname === '/dashboard/leads') e.preventDefault() }}
            className="flex flex-col items-center justify-center flex-1 h-full py-1.5 group relative"
          >
            <div className={`w-12 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
              pathname.startsWith('/dashboard/leads')
                ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-[#00a884] dark:text-[#00e676] scale-105'
                : 'text-slate-400 dark:text-slate-500'
            }`}>
              <TrendingUp size={20} />
            </div>
            <span className={`text-[9px] font-bold tracking-normal mt-0.5 uppercase ${
              pathname.startsWith('/dashboard/leads') ? 'text-[#00a884] dark:text-[#00e676]' : 'text-slate-400 dark:text-slate-500'
            }`}>Pipeline</span>
            {activeLeadsCount > 0 && (
              <span className="absolute top-1 right-2 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm z-50 animate-pulse">
                {activeLeadsCount}
              </span>
            )}
          </Link>

          {/* More (opens side drawer) */}
          <button
            onClick={() => setShowSideDrawer(true)}
            className="flex flex-col items-center justify-center flex-1 h-full py-1.5 group relative border-0 bg-transparent cursor-pointer"
          >
            <div className={`w-12 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
              showSideDrawer
                ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-[#00a884] dark:text-[#00e676]'
                : 'text-slate-400 dark:text-slate-500'
            }`}>
              <Menu size={20} />
            </div>
            <span className={`text-[9px] font-bold tracking-normal mt-0.5 uppercase ${
              showSideDrawer ? 'text-[#00a884] dark:text-[#00e676]' : 'text-slate-400 dark:text-slate-500'
            }`}>More</span>
            {/* Unread dot for assistant notifications */}
            {hasUnreadAssistantNotif && (
              <span className="absolute top-1.5 right-3 w-2.5 h-2.5 bg-red-500 rounded-full border border-white dark:border-slate-900 animate-pulse" />
            )}
          </button>
          </div>
        )}

        {/* MOBILE SLIDE-OUT SIDE DRAWER */}
        {showSideDrawer && (
          <div className="md:hidden fixed inset-0 z-[100]">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-200"
              onClick={() => setShowSideDrawer(false)}
            />
            {/* Drawer Panel */}
            <div className="absolute top-0 left-0 bottom-0 w-[280px] bg-white dark:bg-[#111b21] shadow-2xl animate-in slide-in-from-left duration-300 flex flex-col">
              {/* User Header */}
              <div className="p-5 bg-gradient-to-br from-emerald-600 to-teal-500 text-white">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-base font-bold border border-white/30">
                    {userFullName ? userFullName.substring(0, 2).toUpperCase() : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'US')}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{userFullName || 'User'}</p>
                    <p className="text-[11px] text-white/70 truncate">{userEmail}</p>
                  </div>
                </div>
                <Link
                  href="/dashboard/profile"
                  onClick={() => setShowSideDrawer(false)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-white/80 hover:text-white transition-colors"
                >
                  <User size={11} />
                  View Profile
                </Link>
              </div>

              {/* Navigation Items */}
              <nav className="flex-1 overflow-y-auto py-2">
                {[
                  ...((seeAll && (features.enable_messages || features.enable_email)) ? [{ href: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone }] : []),
                  ...((seeAll && (features.enable_messages || features.enable_email)) ? [{ href: '/dashboard/contacts', label: 'Contacts', icon: Users }] : []),
                  ...(seeAll ? [{ href: '/dashboard/settings', label: 'Settings', icon: Settings }] : []),
                  { href: '/dashboard/profile', label: 'My Profile', icon: User },
                ].map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setShowSideDrawer(false)}
                      className={`flex items-center gap-3 px-5 py-3 text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-emerald-500/10 text-[#008069] dark:text-[#00e676] border-l-[3px] border-[#00a884]'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 border-l-[3px] border-transparent'
                      }`}
                    >
                      <Icon size={18} className={isActive ? 'text-[#00a884]' : 'text-slate-400 dark:text-slate-500'} />
                      {item.label}
                    </Link>
                  )
                })}

                {/* Assistant item */}
                {seeAll && (
                  <button
                    onClick={() => {
                      setShowSideDrawer(false)
                      setTimeout(() => setShowAssistant(true), 150)
                    }}
                    className="flex items-center gap-3 px-5 py-3 text-xs font-semibold transition-all text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 border-l-[3px] border-transparent w-full bg-transparent cursor-pointer relative"
                  >
                    <Sparkles size={18} className="text-slate-400 dark:text-slate-500" />
                    Assistant
                    {hasUnreadAssistantNotif && (
                      <span className="ml-auto w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                    )}
                  </button>
                )}
              </nav>

              {/* Theme Toggle */}
              <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-3">
                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-3 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors w-full bg-transparent cursor-pointer"
                >
                  {theme === 'light' ? <Moon size={18} className="text-slate-400" /> : <Sun size={18} className="text-amber-400" />}
                  {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                </button>
              </div>

              {/* Logout */}
              <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
                <button
                  onClick={() => {
                    setShowSideDrawer(false)
                    handleLogout()
                  }}
                  className="flex items-center gap-3 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors w-full bg-transparent cursor-pointer"
                >
                  <LogOut size={18} />
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className={`flex-1 overflow-hidden bg-slate-50 dark:bg-[#090d16] relative md:pb-0 md:h-full ${
          hasActiveChat 
            ? 'pb-0 h-full' 
            : 'pb-[68px] h-[calc(100vh-68px)]'
        }`}>
          <div className="h-full w-full p-0">
            {isPageAllowed() ? (
              children
            ) : (
              <div className="flex items-center justify-center h-full p-4 select-none">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-8 max-w-md w-full text-center shadow-xl animate-in fade-in duration-300">
                  <div className="mx-auto w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">Feature Disabled</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed font-semibold">
                    This feature has been disabled in the Global Features Configuration. Please contact an administrator or visit Settings to enable it.
                  </p>
                  <Link
                    href="/dashboard/settings"
                    className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-[0.98]"
                  >
                    Go to Settings
                  </Link>
                </div>
              </div>
            )}
          </div>
          
          {/* Onboarding Credentials Checklist Overlay */}
          {showOnboarding && (
            <div className={`fixed bottom-16 md:bottom-6 right-6 z-50 max-w-sm w-[calc(100%-3rem)] bg-[#f0f2f5] dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl p-5 select-none transition-all duration-300 transform ${isMinimized ? 'translate-y-[calc(100%-55px)]' : 'translate-y-0'}`}>
              {/* Card Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#e9edef] dark:border-[#2a3942] cursor-pointer" onClick={() => setIsMinimized(!isMinimized)}>
                <div className="flex items-center gap-2">
                  <span className="text-[#00a884]">🚀</span>
                  <h4 className="text-xs font-bold text-[#111b21] dark:text-white">Configure Your Workspace</h4>
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white p-1 rounded-full cursor-pointer hover:bg-[#e9edef] dark:hover:bg-[#2a3942] transition-colors">
                    <ChevronUp size={14} className={`transform transition-transform duration-300 ${isMinimized ? '' : 'rotate-180'}`} />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOnboarding(false);
                      localStorage.setItem('onboarding_dismissed', 'true');
                    }}
                    className="text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white p-1 rounded-full cursor-pointer hover:bg-[#e9edef] dark:hover:bg-[#2a3942] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Card Body */}
              {!isMinimized && (
                <div className="mt-3 space-y-3 animate-in fade-in zoom-in-95 duration-200">
                  <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed">
                    Welcome to ByokCRM! To enable communication features in your isolated workspace, configure the respective gateways.
                  </p>

                  <div className="bg-white dark:bg-[#111b21] rounded-xl p-3 border border-[#e9edef] dark:border-[#2a3942] space-y-3">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-[#667781] dark:text-[#8696a0] uppercase tracking-wider text-[9px]">Features & Channels</span>
                      <span className="text-[#00a884] font-mono text-[9px]">Status</span>
                    </div>

                    {/* SMS / WhatsApp */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-[#111b21] dark:text-white">WhatsApp & SMS Channel</span>
                        <span className={`text-[10px] font-bold ${credentialsStatus.twilio ? 'text-emerald-400' : 'text-amber-500'}`}>
                          {credentialsStatus.twilio ? '✓ Enabled' : '✗ Unconfigured'}
                        </span>
                      </div>
                      <p className="text-[9px] text-[#667781] dark:text-[#8696a0] font-medium leading-tight">
                        Enables 1-on-1 chats, WhatsApp templates, and bulk text campaigns.
                      </p>
                    </div>

                    {/* Email Campaigns */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-[#111b21] dark:text-white">Email Broadcasting Engine</span>
                        <span className={`text-[10px] font-bold ${credentialsStatus.sendgrid ? 'text-emerald-400' : 'text-amber-500'}`}>
                          {credentialsStatus.sendgrid ? '✓ Enabled' : '✗ Unconfigured'}
                        </span>
                      </div>
                      <p className="text-[9px] text-[#667781] dark:text-[#8696a0] font-medium leading-tight">
                        Enables visual HTML rich newsletters, sender verification, and email wizard.
                      </p>
                    </div>

                    {/* AI Copilot */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-[#111b21] dark:text-white">AI Copilot & Calling Bot</span>
                        <span className={`text-[10px] font-bold ${credentialsStatus.openai ? 'text-emerald-400' : 'text-amber-500'}`}>
                          {credentialsStatus.openai ? '✓ Enabled' : '✗ Unconfigured'}
                        </span>
                      </div>
                      <p className="text-[9px] text-[#667781] dark:text-[#8696a0] font-medium leading-tight">
                        Enables smart message suggestions, sitemap crawling RAG, and voice calling bots.
                      </p>
                    </div>
                  </div>

                  <Link
                    href="/dashboard/settings"
                    className="flex items-center justify-center w-full py-2.5 bg-[#00a884] hover:bg-[#008069] text-white rounded-xl text-xs font-bold shadow-sm transition-all text-center"
                  >
                    Setup Credentials Now
                  </Link>
                </div>
              )}
            </div>
          )}

           {/* Global AI Assistant Drawer */}
          {seeAll && (
            <AssistantDrawer
              isOpen={showAssistant}
              onClose={() => setShowAssistant(false)}
              orgId={orgId || ''}
              orgName={orgName}
            />
          )}

          {/* Support Tickets Drawer */}
          <TicketsDrawer
            isOpen={showTickets}
            onClose={() => setShowTickets(false)}
            orgId={orgId}
          />

          {/* Realtime Ticket Toast Notification */}
          {ticketToast && (
            <div className="fixed top-4 right-4 z-[9999] flex items-start gap-3 bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-emerald-500/30 dark:border-emerald-500/20 shadow-2xl animate-in slide-in-from-top-4 duration-300 max-w-sm w-full select-none" style={{ borderLeft: '4px solid #00a884' }}>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-[#111b21] dark:text-white mb-0.5">🎫 New Support Ticket</h4>
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{ticketToast.subject}</p>
                <p className="text-[9px] text-[#667781] dark:text-[#8696a0] font-semibold">From: {ticketToast.contactName}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    onClick={() => {
                      router.push(`/dashboard?conversationId=${ticketToast.conversationId}`)
                      setTicketToast(null)
                    }}
                    className="px-2.5 py-1 bg-[#00a884] hover:bg-[#008069] text-white text-[9px] font-bold rounded-lg shadow-xs hover:shadow-md transition-all cursor-pointer"
                  >
                    View Chat
                  </button>
                  <button
                    onClick={() => setTicketToast(null)}
                    className="px-2.5 py-1 bg-slate-150 hover:bg-slate-200 dark:bg-[#202d36] dark:hover:bg-[#2a3942] text-slate-700 dark:text-slate-200 text-[9px] font-bold rounded-lg shadow-xs transition-all cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
    </DialogProvider>
  )
}
