'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { User, Organization } from '@/lib/types'
import { Key, Bell, Lock, BookOpen, Globe, FileText, Trash2, Plus, Loader2 } from 'lucide-react'

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  // RAG Knowledge Base State
  const [activeTab, setActiveTab] = useState<'general' | 'knowledge'>('general')
  const [articles, setArticles] = useState<any[]>([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [sitemapProgress, setSitemapProgress] = useState<{
    current: number
    total: number
    activeUrl: string
    successCount: number
    failedCount: number
  } | null>(null)

  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info'
    message: string
    title?: string
  } | null>(null)

  const notificationTimeoutRef = useRef<any>(null)

  function showNotification(type: 'success' | 'error' | 'info', message: string, title = '') {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current)
    }
    setNotification({ type, message, title })
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null)
      notificationTimeoutRef.current = null
    }, 5000)
  }

  useEffect(() => {
    if (user?.organization_id && activeTab === 'knowledge') {
      loadArticles(user.organization_id)
    }
  }, [user, activeTab])

  async function loadArticles(orgId: string) {
    setLoadingArticles(true)
    try {
      const res = await fetch(`/api/knowledge?organizationId=${orgId}`)
      const data = await res.json()
      setArticles(data.articles || [])
    } catch (err) {
      console.error('Failed to load articles:', err)
    } finally {
      setLoadingArticles(false)
    }
  }

  async function handleScrapeUrl() {
    if (!scrapeUrl.trim() || !user) return
    setActionLoading(true)
    setSitemapProgress(null)
    try {
      const targetUrl = scrapeUrl.trim()
      const isSitemap = targetUrl.toLowerCase().endsWith('.xml') || targetUrl.toLowerCase().includes('sitemap')

      if (isSitemap) {
        // 1. Fetch URLs from sitemap
        const sitemapRes = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId: user.organization_id,
            type: 'parse_sitemap',
            url: targetUrl
          })
        })
        const sitemapData = await sitemapRes.json()
        if (!sitemapRes.ok) throw new Error(sitemapData.error || 'Failed to parse sitemap')
        const urls = sitemapData.urls || []
        if (urls.length === 0) {
          throw new Error('No valid article URLs found inside sitemap.')
        }

        // 2. Start iterating and scraping each URL
        setSitemapProgress({
          current: 0,
          total: urls.length,
          activeUrl: '',
          successCount: 0,
          failedCount: 0
        })

        let successes = 0
        let failures = 0
        for (let i = 0; i < urls.length; i++) {
          const currentUrl = urls[i]
          setSitemapProgress(prev => prev ? { ...prev, current: i + 1, activeUrl: currentUrl } : null)
          try {
            const scrapeRes = await fetch('/api/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                organizationId: user.organization_id,
                type: 'scrape',
                url: currentUrl
              })
            })
            if (!scrapeRes.ok) {
              throw new Error('Failed to scrape')
            }
            successes++
            setSitemapProgress(prev => prev ? { ...prev, successCount: successes } : null)
          } catch (e) {
            console.error(`Sitemap scrape failure for URL: ${currentUrl}`, e)
            failures++
            setSitemapProgress(prev => prev ? { ...prev, failedCount: failures } : null)
          }
          // Slight delay to prevent rate limits
          await new Promise(resolve => setTimeout(resolve, 200))
        }

        setScrapeUrl('')
        showNotification(
          'success', 
          `Successfully indexed: ${successes} articles.\nFailed: ${failures}`, 
          'Sitemap Crawl Complete'
        )
        setSitemapProgress(null)
        await loadArticles(user.organization_id)

      } else {
        // Standard single URL scrape
        const res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId: user.organization_id,
            type: 'scrape',
            url: targetUrl
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to scrape')
        setScrapeUrl('')
        showNotification('success', 'Article successfully scraped and indexed!', 'Scrape Success')
        await loadArticles(user.organization_id)
      }
    } catch (err: any) {
      console.error('Scrape error:', err)
      showNotification('error', err.message || 'Scrape failed. Please check the URL and try again.', 'Scrape Failed')
      setSitemapProgress(null)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleAddManual() {
    if (!manualTitle.trim() || !manualContent.trim() || !user) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: user.organization_id,
          type: 'manual',
          title: manualTitle.trim(),
          content: manualContent.trim()
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add FAQ')
      setManualTitle('')
      setManualContent('')
      showNotification('success', 'FAQ successfully added to knowledge base!', 'FAQ Added')
      await loadArticles(user.organization_id)
    } catch (err: any) {
      console.error('Add manual error:', err)
      showNotification('error', err.message || 'Failed to add FAQ.', 'Error Adding FAQ')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDeleteArticle(id: string) {
    if (!user || !confirm('Are you sure you want to delete this article? It will be removed from the AI RAG index.')) return
    try {
      const res = await fetch(`/api/knowledge?id=${id}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Delete failed')
      await loadArticles(user.organization_id)
    } catch (err) {
      console.error('Delete article error:', err)
      showNotification('error', 'Failed to delete article.', 'Delete Failed')
    }
  }

  async function handleToggleFeature(featureKey: 'enable_ai' | 'enable_email' | 'enable_messages' | 'enable_phone_calls', value: boolean) {
    if (!organization || !user) return
    
    // Optimistic update
    const updatedOrg = { ...organization, [featureKey]: value }
    setOrganization(updatedOrg)
    
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ [featureKey]: value })
        .eq('id', organization.id)
      
      if (error) throw error
      
      showNotification('success', `Successfully ${value ? 'enabled' : 'disabled'} feature.`, 'Settings Updated')
      
      // Dispatch a custom event to notify the layout sidebar to reload feature flags in real-time
      window.dispatchEvent(new Event('organization-features-changed'))
    } catch (err: any) {
      console.error('Failed to update feature:', err)
      showNotification('error', `Failed to update feature settings.`, 'Update Failed')
      // Revert state
      setOrganization(organization)
    }
  }

  useEffect(() => {
    if (organization && organization.enable_ai === false && activeTab === 'knowledge') {
      setActiveTab('general')
    }
  }, [organization, activeTab])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Restore the Supabase session from localStorage first
      await restoreSupabaseSession()

      // Try supabase auth first, then fall back to our session manager
      let userId: string | null = null

      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        userId = authUser.id
      } else {
        // Fallback: use authSessionManager
        const storedUser = authSessionManager.getUser()
        if (storedUser?.id) {
          userId = storedUser.id
        }
      }

      if (!userId) return

      // Get or create user profile
      const email = authUser?.email || authSessionManager.getUser()?.email || ''
      const userData = await ensureUserProfile(userId, email)

      if (!userData) return

      setUser(userData)

      // Get organization
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userData.organization_id)
        .single()

      setOrganization(orgData)

      // Set webhook URL
      if (typeof window !== 'undefined') {
        setWebhookUrl(`${window.location.origin}/api/webhooks/twilio`)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]"></div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 font-sans h-full overflow-y-auto space-y-6 relative">
      {notification && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-white p-4 rounded-xl border border-[#e9edef] shadow-xl animate-in slide-in-from-top-4 duration-300 max-w-sm w-full select-none" style={{ borderLeft: `4px solid ${notification.type === 'success' ? '#00a884' : notification.type === 'error' ? '#ef4444' : '#3b82f6'}` }}>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <h4 className="text-xs font-bold text-[#111b21] mb-1">{notification.title}</h4>
            )}
            <p className="text-[11px] text-[#54656f] font-semibold leading-relaxed whitespace-pre-line">
              {notification.message}
            </p>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-[#8696a0] hover:text-[#54656f] hover:bg-[#f0f2f5] p-1 rounded-full cursor-pointer transition-colors"
          >
            <Plus size={14} className="rotate-45" />
          </button>
        </div>
      )}
      <div className="mb-6 select-none flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111b21]">Settings</h1>
          <p className="text-xs text-[#667781] mt-1 font-semibold">Configure your CRM, AI knowledge base, and integrations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#e9edef] mb-6">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 ${
            activeTab === 'general'
              ? 'border-[#00a884] text-[#008069]'
              : 'border-transparent text-[#8696a0] hover:text-[#54656f]'
          }`}
        >
          General Settings
        </button>
        {organization?.enable_ai !== false && (
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === 'knowledge'
                ? 'border-[#00a884] text-[#008069]'
                : 'border-transparent text-[#8696a0] hover:text-[#54656f]'
            }`}
          >
            <BookOpen size={13} />
            Knowledge Base (AI RAG)
          </button>
        )}
      </div>

      {activeTab === 'general' && (
        <div className="space-y-6 max-w-4xl">
          {/* Organization Settings */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] mb-4">Organization</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={organization?.name || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] bg-[#f0f2f5] text-[#667781] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Organization Slug
                </label>
                <input
                  type="text"
                  value={organization?.slug || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] bg-[#f0f2f5] text-[#667781] rounded-lg text-xs font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Global Features Configuration */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] mb-2">Global Features Configuration</h2>
            <p className="text-xs text-[#667781] mb-5 font-semibold leading-relaxed">
              Enable or disable core functionalities. Disabling a feature hides all related menu items, pages, tabs, and buttons across the workspace in real-time.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AI Copilot & Knowledge Base */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] bg-[#f8f9fa]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21]">AI Copilot & Knowledge Base</span>
                  <span className="text-[10px] text-[#667781] font-semibold leading-relaxed">Suggested conversation replies and scraped article RAG indexing</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_ai', organization?.enable_ai !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_ai !== false ? 'bg-[#00a884]' : 'bg-[#ced4da]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                      organization?.enable_ai !== false ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Messaging (WhatsApp & SMS) */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] bg-[#f8f9fa]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21]">Messaging (WhatsApp & SMS)</span>
                  <span className="text-[10px] text-[#667781] font-semibold leading-relaxed">Live chat conversations, SMS broadcasts and approved templates</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_messages', organization?.enable_messages !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_messages !== false ? 'bg-[#00a884]' : 'bg-[#ced4da]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                      organization?.enable_messages !== false ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Email Campaigns */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] bg-[#f8f9fa]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21]">Email Campaigns</span>
                  <span className="text-[10px] text-[#667781] font-semibold leading-relaxed">SendGrid broadcast email marketing and custom message body templates</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_email', organization?.enable_email !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_email !== false ? 'bg-[#00a884]' : 'bg-[#ced4da]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                      organization?.enable_email !== false ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Phone Calls & IVR */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] bg-[#f8f9fa]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21]">Phone Calls & IVR</span>
                  <span className="text-[10px] text-[#667781] font-semibold leading-relaxed">Dynamic Twilio IVR workflows, automated call handling and logs</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_phone_calls', organization?.enable_phone_calls !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_phone_calls !== false ? 'bg-[#00a884]' : 'bg-[#ced4da]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                      organization?.enable_phone_calls !== false ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Account Settings */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] mb-4">Account</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] bg-[#f0f2f5] text-[#667781] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={user?.full_name || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] bg-[#f0f2f5] text-[#667781] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <input
                  type="text"
                  value={user?.role || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] bg-[#f0f2f5] text-[#667781] rounded-lg text-xs font-semibold capitalize"
                />
              </div>
            </div>
          </div>

          {/* Twilio Integration */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Key size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21]">Twilio Integration</h2>
            </div>

            <div className="bg-[#e7f7f4] border border-[#00a884]/20 rounded-lg p-4 mb-4">
              <p className="text-xs text-[#008069] font-bold">
                Setup Instructions:
              </p>
              <ol className="text-xs text-[#008069] mt-2 list-decimal list-inside space-y-1 font-medium">
                <li>Go to your Twilio Console</li>
                <li>Find your WhatsApp Sandbox or Business Account</li>
                <li>In Messaging settings, set the webhook URL to:</li>
                <li className="font-mono text-[10px] bg-white p-2 rounded mt-2 border border-[#00a884]/10 select-all break-all">
                  {webhookUrl}
                </li>
                <li>Select POST for the webhook method</li>
                <li>Save and test the webhook</li>
              </ol>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Twilio WhatsApp Phone Number
                </label>
                <input
                  type="text"
                  value={twilioPhoneNumber}
                  onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                  placeholder="+1234567890 or whatsapp:+1234567890"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0]"
                />
                <p className="text-[10px] text-[#667781] mt-1.5 font-medium">
                  Your Twilio WhatsApp number (with optional &apos;whatsapp:&apos; prefix)
                </p>
              </div>

              <div>
                <p className="text-xs text-[#111b21] font-bold mb-2">
                  Webhook URL to configure in Twilio:
                </p>
                <div className="bg-[#f0f2f5] p-3 rounded-lg border border-[#e9edef] select-all">
                  <code className="text-xs text-[#54656f] break-all font-mono">{webhookUrl}</code>
                </div>
              </div>
            </div>
          </div>

          {/* Environment Variables */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Lock size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21]">Environment Variables</h2>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs text-amber-800 font-bold">
                Required Variables:
              </p>
              <ul className="text-xs text-amber-800 mt-2 space-y-1 list-disc list-inside font-medium">
                <li>TWILIO_ACCOUNT_SID</li>
                <li>TWILIO_AUTH_TOKEN</li>
                <li>NEXT_PUBLIC_SUPABASE_URL</li>
                <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
                <li>OPENAI_API_KEY (for AI Features)</li>
                <li>SENDGRID_API_KEY (for Email Campaigns)</li>
                <li>SENDGRID_FROM_EMAIL (Default sender address)</li>
              </ul>
            </div>
            <p className="text-xs text-[#667781] mt-4 font-semibold">
              Set these in your Vercel project settings under Environment Variables.
            </p>
          </div>

          {/* Support */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21]">Need Help?</h2>
            </div>
            <p className="text-xs text-[#667781] mb-4 font-semibold">
              Check out the Twilio and Supabase documentation for more information on setting up your CRM.
            </p>
            <div className="flex gap-3">
              <a
                href="https://www.twilio.com/docs/whatsapp"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors text-xs font-bold shadow-sm"
              >
                Twilio WhatsApp Docs
              </a>
              <a
                href="https://supabase.com/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors text-xs font-bold shadow-sm"
              >
                Supabase Docs
              </a>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div className="space-y-6 max-w-4xl">
          {/* Web page scraper panel */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Globe size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21]">Index Website Articles</h2>
            </div>

            <p className="text-xs text-[#667781] mb-4 leading-relaxed font-medium">
              Paste URLs from your company website (e.g. <strong>consularhelpdesk.com</strong>) to crawl them. The text content will be parsed, cleaned, and indexed in your local knowledge base so the AI Copilot can use them as verified context when replying to clients.
            </p>

            <div className="flex gap-2">
              <input
                type="url"
                value={scrapeUrl}
                onChange={e => setScrapeUrl(e.target.value)}
                placeholder="e.g. https://consularhelpdesk.com/renew-us-passport-guide/ or sitemap.xml"
                className="flex-1 px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0]"
              />
              <button
                onClick={handleScrapeUrl}
                disabled={actionLoading || !scrapeUrl.trim()}
                className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-4 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                <span>Scrape & Index</span>
              </button>
            </div>

            {sitemapProgress && (
              <div className="mt-4 p-4 bg-[#f0f2f5] border border-[#e9edef] rounded-lg space-y-3 select-none">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-[#111b21]">Sitemap Import Progress</span>
                  <span className="font-bold font-mono text-[#008069]">
                    {sitemapProgress.current} / {sitemapProgress.total} ({Math.round((sitemapProgress.current / sitemapProgress.total) * 100)}%)
                  </span>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-[#e9edef] h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-[#00a884] h-full transition-all duration-300"
                    style={{ width: `${(sitemapProgress.current / sitemapProgress.total) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] text-[#667781] font-semibold">
                  <span className="truncate max-w-[280px]" title={sitemapProgress.activeUrl}>
                    Active: {sitemapProgress.activeUrl || 'Starting...'}
                  </span>
                  <span className="shrink-0 flex gap-2 font-mono">
                    <span className="text-emerald-600 font-bold">✓ {sitemapProgress.successCount}</span>
                    <span className="text-rose-500 font-bold">✗ {sitemapProgress.failedCount}</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Add FAQ panel */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21]">Add Manual FAQ / Policy</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Question or Title
                </label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  placeholder="e.g. What is the fee for passport renewal?"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5">
                  Answer or Content
                </label>
                <textarea
                  rows={4}
                  value={manualContent}
                  onChange={e => setManualContent(e.target.value)}
                  placeholder="e.g. The standard passport renewal fee is $130. Expedited processing costs an additional $60."
                  className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] resize-y"
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleAddManual}
                  disabled={actionLoading || !manualTitle.trim() || !manualContent.trim()}
                  className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-4 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Plus size={13} />
                  <span>Add FAQ Item</span>
                </button>
              </div>
            </div>
          </div>

          {/* Indexed Knowledge panel */}
          <div className="bg-white rounded-lg border border-[#e9edef] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e9edef] bg-[#f8f9fa] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111b21]">Indexed Knowledge Base</h3>
              <span className="text-[10px] font-bold text-[#667781] bg-white border border-[#e9edef] px-2.5 py-0.5 rounded-full">
                {articles.length} items
              </span>
            </div>

            {loadingArticles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[#00a884]" />
              </div>
            ) : articles.length === 0 ? (
              <div className="p-12 text-center text-[#667781]">
                <BookOpen size={36} className="text-[#e9edef] mx-auto mb-3" />
                <p className="text-xs font-bold">No articles indexed yet</p>
                <p className="text-[10px] font-medium mt-1">Start by scraping web pages or adding FAQs above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#e9edef] bg-[#f8f9fa] text-[9px] font-black uppercase tracking-wider text-[#667781]">
                      <th className="px-6 py-3">Title / Question</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Source URL</th>
                      <th className="px-6 py-3">Indexed Date</th>
                      <th className="px-6 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((art) => (
                      <tr key={art.id} className="border-b border-[#f5f6f6] last:border-b-0 hover:bg-[#f8f9fa] transition-colors">
                        <td className="px-6 py-3.5 font-bold text-[#111b21] max-w-xs">
                          <p className="truncate">{art.title}</p>
                          {art.description && (
                            <p className="text-[10px] text-[#667781] font-medium leading-relaxed mt-0.5 line-clamp-2 max-w-[320px] whitespace-normal font-sans">
                              {art.description}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-[#54656f] font-semibold text-[10px]">
                          {art.source_url ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-[9px]">
                              Scraped
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-bold text-[9px]">
                              Manual FAQ
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-[#8696a0] max-w-xs truncate font-mono text-[10px]">
                          {art.source_url ? (
                            <a
                              href={art.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#008069] hover:underline"
                            >
                              {art.source_url}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-[#8696a0] font-medium">
                          {new Date(art.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <button
                            onClick={() => handleDeleteArticle(art.id)}
                            className="p-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
