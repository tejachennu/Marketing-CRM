'use client'

import { useRouter, usePathname } from 'next/navigation'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import Link from 'next/link'
import { MessageCircle, Users, TrendingUp, Settings, LogOut, Megaphone, Phone, X, ChevronUp, Key, Sun, Moon, Shield, Sparkles, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AssistantDrawer } from '@/components/assistant-drawer'
import { TicketsDrawer } from '@/components/tickets-drawer'

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
          .select('full_name, organization_id, role')
          .eq('id', id)
          .maybeSingle()
        if (profile) {
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

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    await supabase.auth.signOut()
    authSessionManager.clearSession()
    router.push('/login')
    router.refresh()
  }

  const navItems = [
    { href: '/dashboard', label: 'Conversations', icon: MessageCircle },
    { href: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone },
    { href: '/dashboard/leads', label: 'Sales Pipeline', icon: TrendingUp },
    { href: '/dashboard/contacts', label: 'Contacts', icon: Users },
    { href: '/dashboard/ivr', label: 'IVR Workflows', icon: Phone },
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

    if (item.href === '/dashboard') {
      return features.enable_messages
    }
    if (item.href === '/dashboard/ivr') {
      return features.enable_phone_calls
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
    if (pathname === '/dashboard' && !features.enable_messages) return false
    if (pathname.startsWith('/dashboard/ivr') && !features.enable_phone_calls) return false
    if ((pathname.startsWith('/dashboard/campaigns') || pathname.startsWith('/dashboard/contacts')) && !features.enable_messages && !features.enable_email) return false
    return true
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased overflow-hidden font-sans">
      {/* Top Header status bar */}
      <header className="h-14 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800/80 px-5 flex items-center justify-between flex-shrink-0 select-none z-50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white font-bold text-xs shadow-sm shadow-emerald-500/20">
            <Key size={14} className="rotate-45" />
          </div>
          <div>
            <h1 className="text-xs font-black text-slate-900 dark:text-white leading-none">ByokCRM Panel</h1>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold block mt-1">
              ● Active Workspace ({orgSlug || 'canada-tenant'})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700/80 border border-slate-200/50 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-all duration-200 shadow-sm cursor-pointer"
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          {/* User profile & Logout (Mobile Only) */}
          <div className="flex md:hidden items-center gap-1.5">
            <div 
              title={userFullName || userEmail}
              className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-[10px] border border-slate-200/50 dark:border-slate-700/50 select-none shadow-sm"
            >
              {userFullName ? userFullName.substring(0, 2).toUpperCase() : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'US')}
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-500/10 border border-slate-200/50 dark:border-slate-700/50 text-slate-400 hover:text-rose-500 transition-all duration-200 shadow-sm cursor-pointer"
            >
              <LogOut size={13} />
            </button>
          </div>

          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border transition-all duration-200 ${
            credentialsStatus.twilio 
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400' 
              : 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${credentialsStatus.twilio ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span>WhatsApp/SMS: {credentialsStatus.twilio ? 'Active' : 'Unconfigured'}</span>
          </div>
          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border transition-all duration-200 ${
            credentialsStatus.openai 
              ? 'bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400' 
              : 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${credentialsStatus.openai ? 'bg-blue-500' : 'bg-amber-500'}`} />
            <span>AI Assistant: {credentialsStatus.openai ? 'Active' : 'Unconfigured'}</span>
          </div>
          <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse" />
        </div>
      </header>

      {/* Main Body below app bar */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* WhatsApp Web Responsive vertical Sidebar / Mobile Bottom-bar */}
        <aside className="fixed bottom-0 left-0 right-0 h-14 w-full flex flex-row items-center border-t border-slate-100 dark:border-slate-800/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md md:relative md:h-full md:w-[64px] md:flex-col md:justify-between md:py-4 md:border-r md:border-slate-100 dark:border-slate-800/80 md:border-t-0 z-40 select-none flex-shrink-0 overflow-x-auto scrollbar-none">
          
          {/* Navigation Tabs (Vertical/Horizontal) */}
          <div className="flex flex-row md:flex-col items-center gap-1.5 md:gap-4 w-full h-full md:h-auto justify-start md:justify-start px-2 md:px-0">
            
            <nav className="flex flex-row md:flex-col items-center gap-1.5 md:gap-2 justify-start md:justify-start">
              {filteredNavItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                
                return (
                  <span key={item.href} className="contents">
                    <Link
                      href={item.href}
                      title={item.label}
                      className={`flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
                        isActive
                          ? 'bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      {/* Vertical active indicator on desktop */}
                      {isActive && (
                        <span className="hidden md:block absolute left-0 top-2.5 bottom-2.5 w-[3px] bg-gradient-to-b from-emerald-500 to-teal-400 rounded-r-full" />
                      )}
                      {/* Horizontal active indicator on mobile */}
                      {isActive && (
                        <span className="block md:hidden absolute bottom-0 left-2.5 right-2.5 h-[3px] bg-gradient-to-r from-emerald-500 to-teal-400 rounded-t-full" />
                      )}
 
                      <Icon
                        size={18}
                        className={`transition-transform duration-300 group-hover:scale-110 ${
                          isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'
                        }`}
                      />
                      
                      {/* Tooltip for desktop */}
                      <span className="absolute left-[65px] bg-slate-900 text-slate-100 dark:bg-slate-800 border border-slate-750 text-[10px] font-bold py-1.5 px-2.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap scale-90 group-hover:scale-100 origin-left hidden md:block">
                        {item.label}
                      </span>
                    </Link>
 
                    {/* Render Tickets button right after Conversations */}
                    {item.href === '/dashboard' && features.enable_messages && (
                      <button
                        type="button"
                        onClick={() => setShowTickets(true)}
                        title="Support Tickets"
                        className={`flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-xl transition-all duration-300 group relative cursor-pointer flex-shrink-0 ${
                          showTickets
                            ? 'bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        {showTickets && (
                          <span className="hidden md:block absolute left-0 top-2.5 bottom-2.5 w-[3px] bg-gradient-to-b from-emerald-500 to-teal-400 rounded-r-full" />
                        )}
                        {showTickets && (
                          <span className="block md:hidden absolute bottom-0 left-2.5 right-2.5 h-[3px] bg-gradient-to-r from-emerald-500 to-teal-400 rounded-t-full" />
                        )}
 
                        <Ticket
                          size={18}
                          className={`transition-transform duration-300 group-hover:scale-110 ${
                            showTickets ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'
                          }`}
                        />
                        
                        <span className="absolute left-[65px] bg-slate-900 text-slate-100 dark:bg-slate-800 border border-slate-750 text-[10px] font-bold py-1.5 px-2.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap scale-90 group-hover:scale-100 origin-left hidden md:block">
                          Tickets
                        </span>
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>
          </div>

          {/* User profile & Logout (Desktop Only) */}
          <div className="hidden md:flex flex-col items-center gap-4 w-full">
            {/* Circular Avatar */}
            <div 
              title={userFullName || userEmail}
              className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-xs border border-slate-200/50 dark:border-slate-700/50 select-none cursor-pointer shadow-sm hover:border-slate-350 dark:hover:border-slate-600 transition-all duration-200"
            >
              {userFullName ? userFullName.substring(0, 2).toUpperCase() : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'US')}
            </div>
            
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

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden bg-slate-50 dark:bg-[#090d16] relative pb-14 md:pb-0 h-[calc(100vh-3.5rem)] md:h-full">
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

          {/* Global AI Assistant Floating Trigger */}
          <button
            onClick={() => setShowAssistant(true)}
            title="Open Marketing Assistant"
            className="fixed right-6 bottom-20 md:bottom-6 w-12 h-12 bg-gradient-to-tr from-emerald-600 to-teal-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 active:scale-95 transition-all z-40 hover:scale-110 duration-200 cursor-pointer border border-emerald-500/30 hover:shadow-emerald-500/40"
          >
            <Sparkles size={20} className="animate-pulse" />
          </button>

          {/* Global AI Assistant Drawer */}
          <AssistantDrawer
            isOpen={showAssistant}
            onClose={() => setShowAssistant(false)}
            orgId={orgId || ''}
            orgName={orgName}
          />

          {/* Support Tickets Drawer */}
          <TicketsDrawer
            isOpen={showTickets}
            onClose={() => setShowTickets(false)}
            orgId={orgId}
          />
        </main>
      </div>
    </div>
  )
}
