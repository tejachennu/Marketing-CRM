'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { User, Organization } from '@/lib/types'
import { Key, Bell, Lock, BookOpen, FileText, Trash2, Plus, Loader2, Eye, EyeOff } from 'lucide-react'

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  
  // Custom multi-tenant credentials state
  const [twilioAccountSid, setTwilioAccountSid] = useState('')
  const [twilioAuthToken, setTwilioAuthToken] = useState('')
  const [twilioWhatsappNumber, setTwilioWhatsappNumber] = useState('')
  const [sendgridApiKey, setSendgridApiKey] = useState('')
  const [sendgridFromEmail, setSendgridFromEmail] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [showTwilioToken, setShowTwilioToken] = useState(false)
  const [showSgKey, setShowSgKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)

  // RAG Knowledge Base State
  const [activeTab, setActiveTab] = useState<'general' | 'knowledge'>('general')
  const [articles, setArticles] = useState<any[]>([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

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

      if (orgData) {
        setOrganization(orgData)
        setTwilioAccountSid(orgData.twilio_account_sid || '')
        setTwilioAuthToken(orgData.twilio_auth_token || '')
        setTwilioWhatsappNumber(orgData.twilio_whatsapp_number || '')
        setSendgridApiKey(orgData.sendgrid_api_key || '')
        setSendgridFromEmail(orgData.sendgrid_from_email || '')
        setOpenaiApiKey(orgData.openai_api_key || '')

        // Set organization-specific dynamic webhook URL
        if (typeof window !== 'undefined') {
          const orgSlug = orgData.slug || 'org'
          const dynamicPath = `${orgData.id}_${orgSlug}`
          setWebhookUrl(`${window.location.origin}/api/webhooks/twilio/${dynamicPath}`)
        }
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveCredentials() {
    if (!organization) return
    setSavingCredentials(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          twilio_account_sid: twilioAccountSid.trim() || null,
          twilio_auth_token: twilioAuthToken.trim() || null,
          twilio_whatsapp_number: twilioWhatsappNumber.trim() || null,
          sendgrid_api_key: sendgridApiKey.trim() || null,
          sendgrid_from_email: sendgridFromEmail.trim() || null,
          openai_api_key: openaiApiKey.trim() || null,
        })
        .eq('id', organization.id)

      if (error) throw error

      setOrganization({
        ...organization,
        twilio_account_sid: twilioAccountSid.trim() || null,
        twilio_auth_token: twilioAuthToken.trim() || null,
        twilio_whatsapp_number: twilioWhatsappNumber.trim() || null,
        sendgrid_api_key: sendgridApiKey.trim() || null,
        sendgrid_from_email: sendgridFromEmail.trim() || null,
        openai_api_key: openaiApiKey.trim() || null,
      })

      showNotification('success', 'Organization credentials updated successfully.', 'Credentials Saved')
      window.dispatchEvent(new Event('organization-features-changed'))
    } catch (err: any) {
      console.error('Failed to save credentials:', err)
      showNotification('error', 'Failed to save credentials.', 'Save Failed')
    } finally {
      setSavingCredentials(false)
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
    <div className="p-4 md:p-6 font-sans h-full bg-[#0b141a] text-[#e9edef] overflow-y-auto space-y-6 relative">
      {notification && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-[#1f2c34] p-4 rounded-xl border border-[#2a3942] shadow-2xl animate-in slide-in-from-top-4 duration-300 max-w-sm w-full select-none" style={{ borderLeft: `4px solid ${notification.type === 'success' ? '#00a884' : notification.type === 'error' ? '#ef4444' : '#3b82f6'}` }}>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <h4 className="text-xs font-bold text-white mb-1">{notification.title}</h4>
            )}
            <p className="text-[11px] text-[#8696a0] font-semibold leading-relaxed whitespace-pre-line">
              {notification.message}
            </p>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] p-1 rounded-full cursor-pointer transition-colors"
          >
            <Plus size={14} className="rotate-45" />
          </button>
        </div>
      )}
      <div className="mb-6 select-none flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
          <p className="text-xs text-[#8696a0] mt-1 font-semibold">Configure your CRM, AI knowledge base, and integrations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#202d36] mb-6">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 ${
            activeTab === 'general'
              ? 'border-[#00a884] text-[#008069]'
              : 'border-transparent text-[#8696a0] hover:text-white'
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
                : 'border-transparent text-[#8696a0] hover:text-white'
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
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] p-6 shadow-sm">
            <h2 className="text-base font-bold text-white mb-4">Organization</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={organization?.name || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#202d36] bg-[#0c1317] text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Organization Slug
                </label>
                <input
                  type="text"
                  value={organization?.slug || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#202d36] bg-[#0c1317] text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Global Features Configuration */}
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] p-6 shadow-sm">
            <h2 className="text-base font-bold text-white mb-2">Global Features Configuration</h2>
            <p className="text-xs text-[#8696a0] mb-5 font-semibold leading-relaxed">
              Enable or disable core functionalities. Disabling a feature hides all related menu items, pages, tabs, and buttons across the workspace in real-time.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AI Copilot & Knowledge Base */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#2a3942] bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-white">AI Copilot & Knowledge Base</span>
                  <span className="text-[10px] text-[#8696a0] font-semibold leading-relaxed">Suggested conversation replies and scraped article RAG indexing</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_ai', organization?.enable_ai !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_ai !== false ? 'bg-[#00a884]' : 'bg-[#2a3942]'
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
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#2a3942] bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-white">Messaging (WhatsApp & SMS)</span>
                  <span className="text-[10px] text-[#8696a0] font-semibold leading-relaxed">Live chat conversations, SMS broadcasts and approved templates</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_messages', organization?.enable_messages !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_messages !== false ? 'bg-[#00a884]' : 'bg-[#2a3942]'
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
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#2a3942] bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-white">Email Campaigns</span>
                  <span className="text-[10px] text-[#8696a0] font-semibold leading-relaxed">Mass broadcast email marketing and custom message body templates</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_email', organization?.enable_email !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_email !== false ? 'bg-[#00a884]' : 'bg-[#2a3942]'
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
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#2a3942] bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-white">Phone Calls & IVR</span>
                  <span className="text-[10px] text-[#8696a0] font-semibold leading-relaxed">Dynamic call flows, automated response menus and call logs</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_phone_calls', organization?.enable_phone_calls !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_phone_calls !== false ? 'bg-[#00a884]' : 'bg-[#2a3942]'
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
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] p-6 shadow-sm">
            <h2 className="text-base font-bold text-white mb-4">Account</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#202d36] bg-[#0c1317] text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={user?.full_name || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#202d36] bg-[#0c1317] text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <input
                  type="text"
                  value={user?.role || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#202d36] bg-[#0c1317] text-[#8696a0] rounded-lg text-xs font-semibold capitalize"
                />
              </div>
            </div>
          </div>

          {/* Custom Credentials & Integrations Settings */}
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-[#202d36] pb-4">
              <div className="flex items-center gap-2">
                <Key size={20} className="text-[#00a884]" />
                <h2 className="text-base font-bold text-white">Custom Credentials & Integrations</h2>
              </div>
              <button
                type="button"
                onClick={handleSaveCredentials}
                disabled={savingCredentials}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white rounded-lg transition-all text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                {savingCredentials ? <Loader2 size={13} className="animate-spin" /> : null}
                <span>Save Credentials</span>
              </button>
            </div>

            <p className="text-xs text-[#8696a0] leading-relaxed font-semibold">
              Manage organization-specific credentials for external gateways. If any field is left blank, it will automatically fall back to using default environment configurations.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* WhatsApp & SMS Gateway Section */}
              <div className="space-y-4 border-b md:border-b-0 md:border-r border-[#202d36] pb-6 md:pb-0 md:pr-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">WhatsApp & SMS Gateway</h3>
                
                {/* Visual Mockup - Chat Inbox */}
                <div className="bg-[#0b0f19] p-3 rounded-xl border border-[#202d36] select-none text-[10px] space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[8px] text-slate-400 font-bold">
                    <span className="text-white flex items-center gap-1">💬 Active Chat Session</span>
                    <span className="bg-emerald-500/20 text-[#00a884] px-1.5 py-0.5 rounded font-bold">Live Status</span>
                  </div>
                  <div className="space-y-1.5 max-h-16 overflow-hidden flex flex-col">
                    <div className="bg-[#1f2c34] p-1.5 rounded-lg rounded-tl-none text-[9px] text-slate-300 max-w-[85%] self-start border border-slate-800 leading-normal">
                      I want to set up automatic responses
                    </div>
                    <div className="bg-[#005c4b] p-1.5 rounded-lg rounded-tr-none text-[9px] text-white max-w-[85%] ml-auto border border-[#005c4b] text-right leading-normal">
                      Input your Account details and your gateway starts routing chats instantly!
                      <span className="text-emerald-300 text-[6px] block mt-0.5 font-bold">10:15 AM ● ✓✓</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                    Account SID
                  </label>
                  <input
                    type="text"
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                    placeholder="Gateway Account SID"
                    className="w-full px-3.5 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                    Auth Token
                  </label>
                  <div className="relative">
                    <input
                      type={showTwilioToken ? 'text' : 'password'}
                      value={twilioAuthToken}
                      onChange={(e) => setTwilioAuthToken(e.target.value)}
                      placeholder="Gateway Auth Token"
                      className="w-full pl-3.5 pr-10 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTwilioToken(!showTwilioToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#e9edef] cursor-pointer"
                    >
                      {showTwilioToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                    WhatsApp Sender Number
                  </label>
                  <input
                    type="text"
                    value={twilioWhatsappNumber}
                    onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                    placeholder="+14155238886 or whatsapp:+14155238886"
                    className="w-full px-3.5 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                  />
                  <p className="text-[10px] text-[#8696a0] font-semibold mt-1">
                    Include the sender prefix (e.g., whatsapp:+14155238886)
                  </p>
                </div>
              </div>

              {/* Email Broadcast & AI Sections */}
              <div className="space-y-6">
                {/* Email Broadcast Engine */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">Email Broadcast Engine</h3>
                  
                  {/* Visual Mockup - Email Dispatch */}
                  <div className="bg-[#0b0f19] p-3 rounded-xl border border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[8px] text-slate-400 font-bold">
                      <span className="text-white flex items-center gap-1">📧 Marketing Campaign Wizard</span>
                      <span className="text-[#00a884] font-bold">99.8% Sent</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-300">
                      <div className="bg-[#1f2c34] p-1.5 rounded border border-slate-800 font-semibold">
                        <span className="text-slate-500 block text-[7px] font-bold">Subject</span>
                        Summer Sales Campaign
                      </div>
                      <div className="bg-[#1f2c34] p-1.5 rounded border border-slate-800 font-semibold">
                        <span className="text-slate-500 block text-[7px] font-bold">Status</span>
                        Dispatched to 1,500 leads
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                      Email API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showSgKey ? 'text' : 'password'}
                        value={sendgridApiKey}
                        onChange={(e) => setSendgridApiKey(e.target.value)}
                        placeholder="Email Gateway API Key"
                        className="w-full pl-3.5 pr-10 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSgKey(!showSgKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#e9edef] cursor-pointer"
                      >
                        {showSgKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                      From Email Address
                    </label>
                    <input
                      type="email"
                      value={sendgridFromEmail}
                      onChange={(e) => setSendgridFromEmail(e.target.value)}
                      placeholder="no-reply@yourdomain.com"
                      className="w-full px-3.5 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                    />
                  </div>
                </div>

                {/* AI Assistant Engine */}
                <div className="space-y-4 border-t border-[#202d36] pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">AI Assistant Engine</h3>
                  
                  {/* Visual Mockup - AI suggestions */}
                  <div className="bg-[#0b0f19] p-3 rounded-xl border border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[8px] text-slate-400 font-bold">
                      <span className="text-white flex items-center gap-1">🤖 AI Suggested Replies</span>
                      <span className="text-blue-400 font-bold">Copilot Active</span>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto py-0.5">
                      <div className="bg-[#00a884]/15 border border-[#00a884]/25 text-[#00a884] text-[8px] px-2 py-1 rounded-full whitespace-nowrap font-bold">
                        🤖 AI: Book Consultation Call
                      </div>
                      <div className="bg-[#1f2c34] border border-slate-800 text-slate-300 text-[8px] px-2 py-1 rounded-full whitespace-nowrap font-bold">
                        AI: Send Pricing FAQ
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                      AI API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showOpenaiKey ? 'text' : 'password'}
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="AI Model API Key"
                        className="w-full pl-3.5 pr-10 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#e9edef] cursor-pointer"
                      >
                        {showOpenaiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Webhook URLs setup block */}
            <div className="bg-[#1f2c34] border border-[#2a3942] rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-bold text-white">Dynamic Webhook Configurations</h3>
              <p className="text-[11px] text-[#8696a0] leading-relaxed font-semibold">
                Configure your messaging gateway sandbox or phone number to send message triggers and status alerts directly to this workspace instance:
              </p>
              
              <div className="space-y-3">
                <div>
                  <span className="block text-[10px] font-bold text-[#8696a0] uppercase mb-1">
                    Incoming Message Webhook
                  </span>
                  <div className="bg-[#111b21] px-3 py-2 rounded-lg border border-[#2a3942] select-all break-all">
                    <code className="text-xs text-[#00e676] font-mono">{webhookUrl || 'Loading dynamic webhook...'}</code>
                  </div>
                </div>

                <div>
                  <span className="block text-[10px] font-bold text-[#8696a0] uppercase mb-1">
                    Status Callback Webhook
                  </span>
                  <div className="bg-[#111b21] px-3 py-2 rounded-lg border border-[#2a3942] select-all break-all">
                    <code className="text-xs text-[#00e676] font-mono">
                      {webhookUrl ? `${webhookUrl}/status` : 'Loading status callback...'}
                    </code>
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-[#8696a0] font-semibold flex items-start gap-1">
                <span className="text-amber-500 font-bold">⚠️</span>
                <span>Make sure to select HTTP POST in the gateway Sandbox/Numbers configuration screen when saving these webhook links.</span>
              </div>
            </div>
          </div>

          {/* Support */}
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-white">Need Help?</h2>
            </div>
            <p className="text-xs text-[#8696a0] mb-4 font-semibold">
              Check out the workspace guide or contact our support team for help configuring your custom gateways.
            </p>
            <div className="flex gap-3">
              <a
                href="#guide"
                className="inline-block px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors text-xs font-bold shadow-sm"
              >
                Workspace Guide
              </a>
              <a
                href="mailto:support@byokcrm.com"
                className="inline-block px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors text-xs font-bold shadow-sm"
              >
                Contact Support
              </a>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div className="space-y-6 max-w-4xl">

          {/* Add FAQ panel */}
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-white">Add Manual FAQ / Policy</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Question or Title
                </label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  placeholder="e.g. What is the fee for passport renewal?"
                  className="w-full px-3.5 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Answer or Content
                </label>
                <textarea
                  rows={4}
                  value={manualContent}
                  onChange={e => setManualContent(e.target.value)}
                  placeholder="e.g. The standard passport renewal fee is $130. Expedited processing costs an additional $60."
                  className="w-full px-3.5 py-2.5 bg-[#1f2c34] border border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] text-white resize-y"
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
          <div className="bg-[#111b21] rounded-lg border border-[#202d36] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#202d36] bg-[#1f2c34] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Indexed Knowledge Base</h3>
              <span className="text-[10px] font-bold text-[#8696a0] bg-[#111b21] border border-[#2a3942] px-2.5 py-0.5 rounded-full">
                {articles.length} items
              </span>
            </div>

            {loadingArticles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[#00a884]" />
              </div>
            ) : articles.length === 0 ? (
              <div className="p-12 text-center text-[#8696a0]">
                <BookOpen size={36} className="text-[#202d36] mx-auto mb-3" />
                <p className="text-xs font-bold">No articles indexed yet</p>
                <p className="text-[10px] font-medium mt-1">Start by scraping web pages or adding FAQs above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#2a3942] bg-[#1f2c34] text-[9px] font-black uppercase tracking-wider text-[#8696a0]">
                      <th className="px-6 py-3">Title / Question</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Source URL</th>
                      <th className="px-6 py-3">Indexed Date</th>
                      <th className="px-6 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((art) => (
                      <tr key={art.id} className="border-b border-[#202d36] last:border-b-0 hover:bg-[#1f2c34]/50 transition-colors">
                        <td className="px-6 py-3.5 font-bold text-white max-w-xs">
                          <p className="truncate">{art.title}</p>
                          {art.description && (
                            <p className="text-[10px] text-[#8696a0] font-medium leading-relaxed mt-0.5 line-clamp-2 max-w-[320px] whitespace-normal font-sans">
                              {art.description}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-[#8696a0] font-semibold text-[10px]">
                          {art.source_url ? (
                            <span className="px-2 py-0.5 rounded-full bg-[#002a22] text-[#00e676] border border-[#00a884]/20 font-bold text-[9px]">
                              Scraped
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-[#0b2e4f] text-[#3b82f6] border border-blue-500/20 font-bold text-[9px]">
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
                              className="text-[#00e676] hover:underline"
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
                            className="p-1 text-rose-500 hover:text-rose-600 hover:bg-[#202d36] rounded transition-colors cursor-pointer"
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
