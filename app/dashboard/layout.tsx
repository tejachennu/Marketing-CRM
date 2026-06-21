'use client'

import { useRouter, usePathname } from 'next/navigation'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import Link from 'next/link'
import { MessageCircle, Users, TrendingUp, Settings, LogOut, Megaphone, Phone } from 'lucide-react'
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
  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
  })

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
          .select('enable_ai, enable_email, enable_messages, enable_phone_calls')
          .eq('id', orgId)
          .maybeSingle()
        if (org) {
          setFeatures({
            enable_ai: org.enable_ai !== false,
            enable_email: org.enable_email !== false,
            enable_messages: org.enable_messages !== false,
            enable_phone_calls: org.enable_phone_calls !== false,
          })
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
    <div className="flex flex-col md:flex-row h-screen bg-[#eae6df] text-[#111b21] antialiased overflow-hidden font-sans">
      {/* WhatsApp Web Responsive vertical Sidebar / Mobile Bottom-bar */}
      <aside className="fixed bottom-0 left-0 right-0 h-14 w-full flex flex-row justify-around items-center border-t border-[#e9edef] bg-[#f0f2f5] md:relative md:h-screen md:w-[60px] md:flex-col md:justify-between md:py-4 md:border-r md:border-t-0 z-40 select-none flex-shrink-0">
        
        {/* Navigation Tabs (Vertical/Horizontal) */}
        <div className="flex flex-row md:flex-col items-center gap-1 md:gap-4 w-full h-full md:h-auto justify-around md:justify-start">
          
          {/* Logo (Desktop Only) */}
          <div className="hidden md:flex h-9 w-9 rounded-full bg-[#00a884] items-center justify-center shadow-sm mb-2 text-white">
            <MessageCircle size={18} />
          </div>

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
                      ? 'bg-[#e9edef] text-[#008069]'
                      : 'text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]/60'
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
                      isActive ? 'text-[#00a884]' : 'text-[#8696a0] group-hover:text-[#54656f]'
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
            className="h-9 w-9 rounded-full bg-[#dfe5e7] flex items-center justify-center font-bold text-[#54656f] text-xs border border-[#e9edef] select-none cursor-pointer"
          >
            {userFullName ? userFullName.substring(0, 2).toUpperCase() : (userEmail ? userEmail.substring(0, 2).toUpperCase() : 'US')}
          </div>
          
          {/* Logout Icon */}
          <button
            onClick={handleLogout}
            title="Logout"
            className="flex items-center justify-center h-10 w-10 rounded-xl bg-white hover:bg-rose-50 border border-[#e9edef] text-[#54656f] hover:text-rose-600 transition-all duration-200 shadow-sm cursor-pointer"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Area (occupies full height and width with padding on mobile for bottom bar) */}
      <main className="flex-1 overflow-hidden bg-[#eae6df] relative pb-14 md:pb-0 h-[calc(100vh-3.5rem)] md:h-screen">
        <div className="h-full w-full p-0">
          {isPageAllowed() ? (
            children
          ) : (
            <div className="flex items-center justify-center h-full p-4 select-none">
              <div className="bg-white rounded-2xl border border-[#e9edef] p-8 max-w-md w-full text-center shadow-xl animate-in fade-in duration-300">
                <div className="mx-auto w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-[#111b21] mb-2">Feature Disabled</h2>
                <p className="text-xs text-[#667781] mb-6 leading-relaxed font-semibold">
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
      </main>
    </div>
  )
}
