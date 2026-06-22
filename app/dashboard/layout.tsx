'use client'

import { useRouter, usePathname } from 'next/navigation'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import Link from 'next/link'
import { MessageCircle, Users, TrendingUp, Settings, LogOut, Megaphone, Phone, X, ChevronUp, Key, Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

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
          .select('full_name, organization_id')
          .eq('id', id)
          .maybeSingle()
        if (profile) {
          if (profile.full_name) {
            setUserFullName(profile.full_name)
          }
          if (profile.organization_id) {
            setOrgId(profile.organization_id)
          }
        }
      }
    }
    getUserEmail()
  }, [])

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
  ]

  const filteredNavItems = navItems.filter((item) => {
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
    if (pathname === '/dashboard' && !features.enable_messages) return false
    if (pathname.startsWith('/dashboard/ivr') && !features.enable_phone_calls) return false
    if ((pathname.startsWith('/dashboard/campaigns') || pathname.startsWith('/dashboard/contacts')) && !features.enable_messages && !features.enable_email) return false
    return true
  }

  return (
    <div className="flex flex-col h-screen bg-[#eae6df] dark:bg-[#0b141a] text-[#111b21] dark:text-white antialiased overflow-hidden font-sans">
      {/* Top Header status bar */}
      <header className="h-14 bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] px-5 flex items-center justify-between flex-shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold text-xs shadow-md">
            <Key size={14} className="rotate-45" />
          </div>
          <div>
            <h1 className="text-xs font-black text-[#111b21] dark:text-white leading-none">ByokCRM Panel</h1>
            <span className="text-[9px] text-[#00a884] font-bold block mt-1">
              ● Active Workspace ({orgSlug || 'canada-tenant'})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-[#e9edef] dark:bg-[#202d36] hover:bg-[#dfe5e7] dark:hover:bg-[#2a3942] border border-[#e9edef] dark:border-[#202d36] text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white transition-all duration-200 shadow-sm cursor-pointer mr-1"
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-extrabold border ${
            credentialsStatus.twilio 
              ? 'bg-[#00a884]/10 border-[#00a884]/20 text-[#00a884]' 
              : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
          }`}>
            <span>WhatsApp/SMS: {credentialsStatus.twilio ? 'Active' : 'Unconfigured'}</span>
          </div>
          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-extrabold border ${
            credentialsStatus.openai 
              ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' 
              : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
          }`}>
            <span>AI Assistant: {credentialsStatus.openai ? 'Active' : 'Unconfigured'}</span>
          </div>
          <div className="h-2.5 w-2.5 rounded-full bg-[#00a884] animate-pulse" />
        </div>
      </header>

      {/* Main Body below app bar */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* WhatsApp Web Responsive vertical Sidebar / Mobile Bottom-bar */}
        <aside className="fixed bottom-0 left-0 right-0 h-14 w-full flex flex-row justify-around items-center border-t border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#111b21] md:relative md:h-full md:w-[60px] md:flex-col md:justify-between md:py-4 md:border-r md:border-[#e9edef] dark:border-[#202d36] md:border-t-0 z-40 select-none flex-shrink-0">
          
          {/* Navigation Tabs (Vertical/Horizontal) */}
          <div className="flex flex-row md:flex-col items-center gap-1 md:gap-4 w-full h-full md:h-auto justify-around md:justify-start">
            
            <nav className="flex flex-row md:flex-col items-center gap-1 md:gap-2 w-full justify-around md:justify-start">
              {filteredNavItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={`flex items-center justify-center w-12 h-12 md:w-11 md:h-11 rounded-xl transition-all duration-200 group relative ${
                      isActive
                        ? 'bg-[#e9edef] dark:bg-[#202d36] text-[#00a884]'
                        : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-[#e9edef]/60 dark:hover:bg-[#202d36]/60'
                    }`}
                  >
                    {/* Vertical active indicator on desktop */}
                    {isActive && (
                      <span className="hidden md:block absolute left-0 top-2 bottom-2 w-[3px] bg-[#00a884] rounded-r-md" />
                    )}
                    {/* Horizontal active indicator on mobile */}
                    {isActive && (
                      <span className="block md:hidden absolute bottom-0 left-2 right-2 h-[3px] bg-[#00a884] rounded-t-md" />
                    )}

                    <Icon
                      size={20}
                      className={`transition-transform duration-300 group-hover:scale-110 ${
                        isActive ? 'text-[#00a884]' : 'text-[#667781] dark:text-[#8696a0] group-hover:text-[#111b21] dark:group-hover:text-white'
                      }`}
                    />
                    
                    {/* Tooltip for desktop */}
                    <span className="absolute left-[65px] bg-[#111b21] text-white text-[10px] font-bold py-1.5 px-2.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap scale-90 group-hover:scale-100 origin-left hidden md:block">
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </nav>
          </div>

          {/* User profile & Logout (Desktop Only) */}
          <div className="hidden md:flex flex-col items-center gap-4 w-full">
            {/* Circular Avatar */}
            <div 
              title={userFullName || userEmail}
              className="h-9 w-9 rounded-full bg-[#e9edef] dark:bg-[#202d36] flex items-center justify-center font-bold text-[#667781] dark:text-[#8696a0] text-xs border border-[#e9edef] dark:border-[#202d36] select-none cursor-pointer"
            >
              {userFullName ? userFullName.substring(0, 2).toUpperCase() : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'US')}
            </div>
            
            {/* Logout Icon */}
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center justify-center h-10 w-10 rounded-xl bg-[#e9edef] dark:bg-[#111b21] hover:bg-[#dfe5e7] dark:hover:bg-[#202d36] border border-[#e9edef] dark:border-[#202d36] text-[#667781] dark:text-[#8696a0] hover:text-rose-400 transition-all duration-200 shadow-sm cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden bg-[#eae6df] dark:bg-[#0c1317] relative pb-14 md:pb-0 h-[calc(100vh-3.5rem)] md:h-full">
          <div className="h-full w-full p-0">
            {isPageAllowed() ? (
              children
            ) : (
              <div className="flex items-center justify-center h-full p-4 select-none">
                <div className="bg-[#f0f2f5] dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] p-8 max-w-md w-full text-center shadow-xl animate-in fade-in duration-300">
                  <div className="mx-auto w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                  <h2 className="text-base font-bold text-[#111b21] dark:text-white mb-2">Feature Disabled</h2>
                  <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-6 leading-relaxed font-semibold">
                    This feature has been disabled in the Global Features Configuration. Please contact an administrator or visit Settings to enable it.
                  </p>
                  <Link
                    href="/dashboard/settings"
                    className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-[#00a884] hover:bg-[#008069] text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-[0.98]"
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
        </main>
      </div>
    </div>
  )
}
