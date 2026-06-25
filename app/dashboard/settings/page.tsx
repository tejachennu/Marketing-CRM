'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { User, Organization } from '@/lib/types'
import { Key, Bell, Lock, BookOpen, FileText, Trash2, Plus, Loader2, Eye, EyeOff, Upload, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import * as XLSX from 'xlsx'

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
  const [chatbotBasePrompt, setChatbotBasePrompt] = useState('')
  const [emailProvider, setEmailProvider] = useState<'sendgrid' | 'smtp'>('sendgrid')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('')
  const [smtpEmail, setSmtpEmail] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [whatsappProvider, setWhatsappProvider] = useState<'twilio' | 'facebook'>('twilio')
  const [whatsappApiToken, setWhatsappApiToken] = useState('')
  const [whatsappDefaultPhone, setWhatsappDefaultPhone] = useState('')
  const [whatsappGraphApiVersion, setWhatsappGraphApiVersion] = useState('v25.0')
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState('')
  const [whatsappBusinessAccountId, setWhatsappBusinessAccountId] = useState('')
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [showTwilioToken, setShowTwilioToken] = useState(false)
  const [showSgKey, setShowSgKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)
  const [showWhatsappApiToken, setShowWhatsappApiToken] = useState(false)
  const [facebookWebhookUrl, setFacebookWebhookUrl] = useState('')

  // RAG Knowledge Base State
  const [activeTab, setActiveTab] = useState<'general' | 'knowledge' | 'teammates'>('general')
  const [articles, setArticles] = useState<any[]>([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Teammates management state
  const [teammates, setTeammates] = useState<any[]>([])
  const [loadingTeammates, setLoadingTeammates] = useState(false)
  const [addingTeammate, setAddingTeammate] = useState(false)
  const [teammateForm, setTeammateForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'agent'
  })
  const [teammateError, setTeammateError] = useState('')
  const [teammateSuccess, setTeammateSuccess] = useState('')

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
    if (user?.organization_id && activeTab === 'teammates') {
      loadTeammates(user.organization_id)
    }
  }, [user, activeTab])

  async function loadTeammates(orgId: string) {
    setLoadingTeammates(true)
    try {
      const res = await fetch(`/api/teammates?organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        setTeammates(data.teammates || [])
      } else {
        showNotification('error', data.error || 'Failed to load teammates', 'Error')
      }
    } catch (err: any) {
      console.error('Failed to load teammates:', err)
      showNotification('error', err.message || 'Failed to load teammates', 'Error')
    } finally {
      setLoadingTeammates(false)
    }
  }

  async function handleAddTeammate(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.organization_id) return

    const limit = organization?.max_teammates && organization.max_teammates > 0 ? organization.max_teammates : 4
    if (teammates.length >= limit) {
      showNotification('error', `Teammate limit reached. Your organization is limited to ${limit} teammates.`, 'Limit Reached')
      return
    }

    setAddingTeammate(true)
    setTeammateError('')
    setTeammateSuccess('')
    try {
      const res = await fetch('/api/teammates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: teammateForm.email.trim(),
          password: teammateForm.password,
          fullName: teammateForm.fullName.trim(),
          role: teammateForm.role,
          organizationId: user.organization_id
        })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add teammate')
      }
      setTeammateSuccess('Teammate successfully added!')
      setTeammateForm({
        email: '',
        password: '',
        fullName: '',
        role: 'agent'
      })
      showNotification('success', 'Teammate successfully added!', 'Teammate Added')
      await loadTeammates(user.organization_id)
    } catch (err: any) {
      console.error('Add teammate error:', err)
      setTeammateError(err.message || 'Failed to add teammate')
      showNotification('error', err.message || 'Failed to add teammate', 'Add Failed')
    } finally {
      setAddingTeammate(false)
    }
  }

  async function handleDeleteTeammate(teammateId: string) {
    if (!user?.organization_id) return
    if (!confirm('Are you sure you want to remove this teammate? They will no longer be able to log in.')) return

    try {
      const res = await fetch(`/api/teammates?userId=${teammateId}&organizationId=${user.organization_id}`, {
        method: 'DELETE'
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete teammate')
      }
      showNotification('success', 'Teammate removed successfully.', 'Teammate Removed')
      await loadTeammates(user.organization_id)
    } catch (err: any) {
      console.error('Delete teammate error:', err)
      showNotification('error', err.message || 'Failed to remove teammate.', 'Remove Failed')
    }
  }

  async function loadArticles(orgId: string) {
    setLoadingArticles(true)
    try {
      const res = await fetch(`/api/knowledge?organizationId=${orgId}`)
      const data = await res.json()
      setArticles(data.articles || [])
      setCurrentPage(1)
    } catch (err) {
      console.error('Failed to load articles:', err)
    } finally {
      setLoadingArticles(false)
    }
  }

  async function handleExcelImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json<any>(ws)

        if (data.length === 0) {
          showNotification('error', 'The uploaded Excel file is empty.', 'Import Failed')
          return
        }

        const sampleRow = data[0]
        let questionCol = ''
        let answerCol = ''

        const questionHeaders = ['question', 'title', 'faq', 'topic', 'q']
        const answerHeaders = ['answer', 'content', 'response', 'a', 'description']

        for (const key of Object.keys(sampleRow)) {
          const lowerKey = key.toLowerCase().trim()
          if (!questionCol && questionHeaders.some(h => lowerKey.includes(h))) {
            questionCol = key
          } else if (!answerCol && answerHeaders.some(h => lowerKey.includes(h))) {
            answerCol = key
          }
        }

        if (!questionCol || !answerCol) {
          const keys = Object.keys(sampleRow)
          if (keys.length >= 2) {
            questionCol = questionCol || keys[0]
            answerCol = answerCol || keys[1]
          } else {
            showNotification('error', 'Could not identify Question and Answer columns. Please ensure your Excel sheet has columns named "Question" and "Answer".', 'Import Failed')
            return
          }
        }

        const parsedItems = data
          .map(row => ({
            title: String(row[questionCol] || '').trim(),
            content: String(row[answerCol] || '').trim()
          }))
          .filter(item => item.title && item.content)

        if (parsedItems.length === 0) {
          showNotification('error', 'No valid FAQ rows found. Make sure questions and answers are not blank.', 'Import Failed')
          return
        }

        setImportProgress({ current: 0, total: parsedItems.length })
        let importedCount = 0

        for (let i = 0; i < parsedItems.length; i++) {
          const item = parsedItems[i]
          try {
            const res = await fetch('/api/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                organizationId: user.organization_id,
                type: 'manual',
                title: item.title,
                content: item.content
              })
            })
            if (res.ok) {
              importedCount++
            } else {
              const errData = await res.json().catch(() => ({}))
              console.error(`Failed to import item ${i + 1}:`, errData.error || res.statusText)
            }
          } catch (err) {
            console.error(`Failed to import item ${i + 1}:`, err)
          }
          setImportProgress({ current: i + 1, total: parsedItems.length })
        }

        showNotification('success', `Successfully imported ${importedCount} of ${parsedItems.length} FAQ items!`, 'Import Complete')
        await loadArticles(user.organization_id)
      } catch (err: any) {
        console.error('Excel parse error:', err)
        showNotification('error', err.message || 'Failed to read Excel file.', 'Import Failed')
      } finally {
        setImportProgress(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    }

    reader.readAsBinaryString(file)
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

  async function handleToggleFeature(featureKey: 'enable_ai' | 'enable_email' | 'enable_messages' | 'enable_phone_calls' | 'enable_sms', value: boolean) {
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
        setChatbotBasePrompt(orgData.chatbot_base_prompt || '')
        setEmailProvider(orgData.email_provider || 'sendgrid')
        setSmtpHost(orgData.smtp_host || '')
        setSmtpPort(orgData.smtp_port ? String(orgData.smtp_port) : '')
        setSmtpEmail(orgData.smtp_email || '')
        setSmtpPassword(orgData.smtp_password || '')
        setWhatsappProvider(orgData.whatsapp_provider || 'twilio')
        setWhatsappApiToken(orgData.whatsapp_api_token || '')
        setWhatsappDefaultPhone(orgData.whatsapp_default_phone || '')
        setWhatsappGraphApiVersion(orgData.whatsapp_graph_api_version || 'v25.0')
        setWhatsappPhoneNumberId(orgData.whatsapp_phone_number_id || '')
        setWhatsappBusinessAccountId(orgData.whatsapp_business_account_id || '')

        // Set organization-specific dynamic webhook URL
        if (typeof window !== 'undefined') {
          const orgSlug = orgData.slug || 'org'
          const dynamicPath = `${orgData.id}_${orgSlug}`
          setWebhookUrl(`${window.location.origin}/api/webhooks/twilio/${dynamicPath}`)
          setFacebookWebhookUrl(`${window.location.origin}/api/webhooks/facebook/${dynamicPath}`)
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
          chatbot_base_prompt: chatbotBasePrompt.trim() || null,
          email_provider: emailProvider,
          smtp_host: smtpHost.trim() || null,
          smtp_port: smtpPort ? parseInt(smtpPort) : null,
          smtp_email: smtpEmail.trim() || null,
          smtp_password: smtpPassword.trim() || null,
          whatsapp_provider: whatsappProvider,
          whatsapp_api_token: whatsappApiToken.trim() || null,
          whatsapp_default_phone: whatsappDefaultPhone.trim() || null,
          whatsapp_graph_api_version: whatsappGraphApiVersion.trim() || null,
          whatsapp_phone_number_id: whatsappPhoneNumberId.trim() || null,
          whatsapp_business_account_id: whatsappBusinessAccountId.trim() || null,
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
        chatbot_base_prompt: chatbotBasePrompt.trim() || null,
        email_provider: emailProvider,
        smtp_host: smtpHost.trim() || null,
        smtp_port: smtpPort ? parseInt(smtpPort) : null,
        smtp_email: smtpEmail.trim() || null,
        smtp_password: smtpPassword.trim() || null,
        whatsapp_provider: whatsappProvider,
        whatsapp_api_token: whatsappApiToken.trim() || null,
        whatsapp_default_phone: whatsappDefaultPhone.trim() || null,
        whatsapp_graph_api_version: whatsappGraphApiVersion.trim() || null,
        whatsapp_phone_number_id: whatsappPhoneNumberId.trim() || null,
        whatsapp_business_account_id: whatsappBusinessAccountId.trim() || null,
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

  const totalPages = Math.ceil(articles.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedArticles = articles.slice(startIndex, startIndex + itemsPerPage)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]"></div>
      </div>
    )
  }

  return (
    <div className="p-4 pb-20 md:pb-6 md:p-6 font-sans h-full bg-[#f0f2f5] dark:bg-[#0b141a] text-[#111b21] dark:text-[#e9edef] overflow-y-auto space-y-6 relative">
      {notification && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl animate-in slide-in-from-top-4 duration-300 max-w-sm w-full select-none" style={{ borderLeft: `4px solid ${notification.type === 'success' ? '#00a884' : notification.type === 'error' ? '#ef4444' : '#3b82f6'}` }}>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <h4 className="text-xs font-bold text-[#111b21] dark:text-white mb-1">{notification.title}</h4>
            )}
            <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed whitespace-pre-line">
              {notification.message}
            </p>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] p-1 rounded-full cursor-pointer transition-colors"
          >
            <Plus size={14} className="rotate-45" />
          </button>
        </div>
      )}
      <div className="mb-6 select-none flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111b21] dark:text-white">Settings</h1>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 font-semibold">Configure your CRM, AI knowledge base, and integrations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#e9edef] dark:border-[#202d36] mb-6">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 ${
            activeTab === 'general'
              ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
              : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
          }`}
        >
          General Settings
        </button>
        {organization?.enable_ai !== false && (
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === 'knowledge'
                ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
                : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
            }`}
          >
            <BookOpen size={13} />
            Knowledge Base (AI RAG)
          </button>
        )}
        <button
          onClick={() => setActiveTab('teammates')}
          className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
            activeTab === 'teammates'
              ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
              : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
          }`}
        >
          <Users size={13} />
          Manage Teammates
        </button>
      </div>

      {activeTab === 'general' && (
        <div className="space-y-6 max-w-4xl">
          {/* Organization Settings */}
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] dark:text-white mb-4">Organization</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={organization?.name || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] text-[#667781] dark:text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Organization Slug
                </label>
                <input
                  type="text"
                  value={organization?.slug || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] text-[#667781] dark:text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Global Features Configuration */}
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] dark:text-white mb-2">Global Features Configuration</h2>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-5 font-semibold leading-relaxed">
              Enable or disable core functionalities. Disabling a feature hides all related menu items, pages, tabs, and buttons across the workspace in real-time.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AI Copilot & Knowledge Base */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21] dark:text-white">AI Copilot & Knowledge Base</span>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed">Suggested conversation replies and scraped article RAG indexing</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_ai', organization?.enable_ai !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_ai !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
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
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21] dark:text-white">Messaging (WhatsApp & SMS)</span>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed">Live chat conversations, SMS broadcasts and approved templates</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_messages', organization?.enable_messages !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_messages !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
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
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21] dark:text-white">Email Campaigns</span>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed">Mass broadcast email marketing and custom message body templates</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_email', organization?.enable_email !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_email !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
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
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-bold text-[#111b21] dark:text-white">Phone Calls & IVR</span>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold leading-relaxed">Dynamic call flows, automated response menus and call logs</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFeature('enable_phone_calls', organization?.enable_phone_calls !== false ? false : true)}
                  className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                    organization?.enable_phone_calls !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
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
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] dark:text-white mb-4">Account</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] text-[#667781] dark:text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={user?.full_name || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] text-[#667781] dark:text-[#8696a0] rounded-lg text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <input
                  type="text"
                  value={user?.role || ''}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] text-[#667781] dark:text-[#8696a0] rounded-lg text-xs font-semibold capitalize"
                />
              </div>
            </div>
          </div>

          {/* Custom Credentials & Integrations Settings */}
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-[#202d36] pb-4">
              <div className="flex items-center gap-2">
                <Key size={20} className="text-[#00a884]" />
                <h2 className="text-base font-bold text-[#111b21] dark:text-white">Custom Credentials & Integrations</h2>
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

            <p className="text-xs text-[#667781] dark:text-[#8696a0] leading-relaxed font-semibold">
              Manage organization-specific credentials for external gateways. If any field is left blank, it will automatically fall back to using default environment configurations.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* WhatsApp & SMS Gateway Column */}
              <div className="space-y-6 border-b md:border-b-0 md:border-r border-[#e9edef] dark:border-[#202d36] pb-6 md:pb-0 md:pr-6 flex flex-col justify-start">
                
                {/* WHATSAPP GATEWAY SECTION */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">WhatsApp Gateway</h3>
                  
                  {/* Visual Mockup - Chat Inbox */}
                  <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[8px] text-[#667781] dark:text-slate-400 font-bold">
                      <span className="text-[#111b21] dark:text-white flex items-center gap-1">💬 Active Chat Session</span>
                      <span className="bg-emerald-500/20 text-[#00a884] px-1.5 py-0.5 rounded font-bold">Live Status</span>
                    </div>
                    <div className="space-y-1.5 max-h-16 overflow-hidden flex flex-col">
                      <div className="bg-white dark:bg-[#1f2c34] p-1.5 rounded-lg rounded-tl-none text-[9px] text-[#111b21] dark:text-slate-300 max-w-[85%] self-start border border-[#e9edef] dark:border-slate-800 leading-normal">
                        I want to set up automatic responses
                      </div>
                      <div className="bg-[#d9fdd3] dark:bg-[#005c4b] p-1.5 rounded-lg rounded-tr-none text-[9px] text-[#111b21] dark:text-white max-w-[85%] ml-auto border border-[#d9fdd3] dark:border-[#005c4b] text-right leading-normal">
                        Input your Account details and your gateway starts routing chats instantly!
                        <span className="text-emerald-600 dark:text-emerald-300 text-[6px] block mt-0.5 font-bold">10:15 AM ● ✓✓</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">
                      WhatsApp Gateway Provider
                    </label>
                    <div className="flex gap-4 mb-2 select-none">
                      <label className="flex items-center gap-2 text-xs font-bold text-[#111b21] dark:text-white cursor-pointer">
                        <input
                          type="radio"
                          name="whatsappProvider"
                          value="twilio"
                          checked={whatsappProvider === 'twilio'}
                          onChange={() => setWhatsappProvider('twilio')}
                          className="accent-[#00a884]"
                        />
                        Twilio Gateway
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-[#111b21] dark:text-white cursor-pointer">
                        <input
                          type="radio"
                          name="whatsappProvider"
                          value="facebook"
                          checked={whatsappProvider === 'facebook'}
                          onChange={() => setWhatsappProvider('facebook')}
                          className="accent-[#00a884]"
                        />
                        Direct Facebook API
                      </label>
                    </div>
                  </div>

                  {whatsappProvider === 'twilio' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          Account SID
                        </label>
                        <input
                          type="text"
                          value={twilioAccountSid}
                          onChange={(e) => setTwilioAccountSid(e.target.value)}
                          placeholder="Gateway Account SID"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          Auth Token
                        </label>
                        <div className="relative">
                          <input
                            type={showTwilioToken ? 'text' : 'password'}
                            value={twilioAuthToken}
                            onChange={(e) => setTwilioAuthToken(e.target.value)}
                            placeholder="Gateway Auth Token"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTwilioToken(!showTwilioToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer"
                          >
                            {showTwilioToken ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          WhatsApp Sender Number
                        </label>
                        <input
                          type="text"
                          value={twilioWhatsappNumber}
                          onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                          placeholder="+14155238886 or whatsapp:+14155238886"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                        <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                          Include the sender prefix (e.g., whatsapp:+14155238886)
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          WhatsApp Cloud API Token
                        </label>
                        <div className="relative">
                          <input
                            type={showWhatsappApiToken ? 'text' : 'password'}
                            value={whatsappApiToken}
                            onChange={(e) => setWhatsappApiToken(e.target.value)}
                            placeholder="EAAG..."
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWhatsappApiToken(!showWhatsappApiToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer"
                          >
                            {showWhatsappApiToken ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          WhatsApp Phone Number ID
                        </label>
                        <input
                          type="text"
                          value={whatsappPhoneNumberId}
                          onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                          placeholder="e.g. 109876543210987"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          WhatsApp Business Account ID (WABA ID)
                        </label>
                        <input
                          type="text"
                          value={whatsappBusinessAccountId}
                          onChange={(e) => setWhatsappBusinessAccountId(e.target.value)}
                          placeholder="e.g. 102938475647382"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                        <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                          Required to fetch message templates from Meta. Find it in Meta Business Suite → WhatsApp Manager → Settings.
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                            Default Sender Phone Number
                          </label>
                          <input
                            type="text"
                            value={whatsappDefaultPhone}
                            onChange={(e) => setWhatsappDefaultPhone(e.target.value)}
                            placeholder="e.g. +14155238886"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                            API Version
                          </label>
                          <input
                            type="text"
                            value={whatsappGraphApiVersion}
                            onChange={(e) => setWhatsappGraphApiVersion(e.target.value)}
                            placeholder="v25.0"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Divider Line */}
                <div className="border-t border-[#e9edef] dark:border-[#202d36] my-2"></div>

                {/* SMS GATEWAY SECTION */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">SMS Gateway</h3>
                    
                    {/* Toggle switch: only render if Twilio is configured */}
                    {twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== '' ? (
                      <button
                        type="button"
                        onClick={() => handleToggleFeature('enable_sms', organization?.enable_sms !== false ? false : true)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                          organization?.enable_sms !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            organization?.enable_sms !== false ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    ) : (
                      <span className="text-[10px] text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded">
                        Requires Twilio
                      </span>
                    )}
                  </div>

                  {/* SMS Visual Status Mockup */}
                  <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[8px] text-[#667781] dark:text-slate-400 font-bold">
                      <span className="text-[#111b21] dark:text-white flex items-center gap-1">💬 SMS Gateway Connection</span>
                      <span className={`${
                        organization?.enable_sms !== false && twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== ''
                          ? 'bg-emerald-500/20 text-[#00a884]'
                          : 'bg-gray-500/20 text-gray-500'
                      } px-1.5 py-0.5 rounded font-bold`}>
                        {organization?.enable_sms !== false && twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== ''
                          ? 'Active & Enabled'
                          : 'Inactive / Disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Warning message if Twilio credentials are not configured */}
                  {!(twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== '') ? (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/50 rounded-lg text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed font-medium">
                      ⚠️ Twilio credentials are required to use the SMS Gateway. 
                      {whatsappProvider === 'facebook' 
                        ? ' Please configure Twilio Account SID and Auth Token below to enable the SMS Gateway.'
                        : ' Please configure Twilio Gateway credentials in the WhatsApp Gateway section above.'
                      }
                    </div>
                  ) : null}

                  {/* If using Facebook for WhatsApp, render Twilio input fields under SMS Gateway section */}
                  {whatsappProvider === 'facebook' && (
                    <div className="space-y-4 pt-1">
                      <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold">
                        Enter Twilio credentials below to send SMS.
                      </p>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          Twilio Account SID (for SMS)
                        </label>
                        <input
                          type="text"
                          value={twilioAccountSid}
                          onChange={(e) => setTwilioAccountSid(e.target.value)}
                          placeholder="Twilio Account SID"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          Twilio Auth Token (for SMS)
                        </label>
                        <div className="relative">
                          <input
                            type={showTwilioToken ? 'text' : 'password'}
                            value={twilioAuthToken}
                            onChange={(e) => setTwilioAuthToken(e.target.value)}
                            placeholder="Twilio Auth Token"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTwilioToken(!showTwilioToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer"
                          >
                            {showTwilioToken ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SMS sender phone number input */}
                  {twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== '' && (
                    <div>
                      <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                        SMS Sender Phone Number
                      </label>
                      <input
                        type="text"
                        value={twilioWhatsappNumber}
                        onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                        placeholder="e.g. +13185069063"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                      />
                      <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                        Twilio active phone number used for outgoing SMS broadcasts.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Email Broadcast & AI Sections */}
              <div className="space-y-6">
                {/* Email Broadcast Engine */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">Email Broadcast Engine</h3>
                  
                  {/* Visual Mockup - Email Dispatch */}
                  <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[8px] text-[#667781] dark:text-slate-400 font-bold">
                      <span className="text-[#111b21] dark:text-white flex items-center gap-1">📧 Marketing Campaign Wizard</span>
                      <span className="text-[#00a884] font-bold">99.8% Sent</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-700 dark:text-slate-300">
                      <div className="bg-white dark:bg-[#1f2c34] p-1.5 rounded border border-[#e9edef] dark:border-slate-800 font-semibold">
                        <span className="text-slate-400 dark:text-slate-500 block text-[7px] font-bold">Subject</span>
                        Summer Sales Campaign
                      </div>
                      <div className="bg-white dark:bg-[#1f2c34] p-1.5 rounded border border-[#e9edef] dark:border-slate-800 font-semibold">
                        <span className="text-slate-400 dark:text-slate-500 block text-[7px] font-bold">Status</span>
                        Dispatched to 1,500 leads
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider">
                      Email Service Provider
                    </label>
                    <div className="flex gap-4 mb-2 select-none">
                      <label className="flex items-center gap-2 text-xs font-bold text-[#111b21] dark:text-white cursor-pointer">
                        <input
                          type="radio"
                          name="emailProvider"
                          value="sendgrid"
                          checked={emailProvider === 'sendgrid'}
                          onChange={() => setEmailProvider('sendgrid')}
                          className="accent-[#00a884]"
                        />
                        SendGrid API
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-[#111b21] dark:text-white cursor-pointer">
                        <input
                          type="radio"
                          name="emailProvider"
                          value="smtp"
                          checked={emailProvider === 'smtp'}
                          onChange={() => setEmailProvider('smtp')}
                          className="accent-[#00a884]"
                        />
                        Custom SMTP (Nodemailer)
                      </label>
                    </div>
                  </div>

                  {emailProvider === 'sendgrid' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          Email API Key
                        </label>
                        <div className="relative">
                          <input
                            type={showSgKey ? 'text' : 'password'}
                            value={sendgridApiKey}
                            onChange={(e) => setSendgridApiKey(e.target.value)}
                            placeholder="Email Gateway API Key"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSgKey(!showSgKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer"
                          >
                            {showSgKey ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          From Email Address
                        </label>
                        <input
                          type="email"
                          value={sendgridFromEmail}
                          onChange={(e) => setSendgridFromEmail(e.target.value)}
                          placeholder="no-reply@yourdomain.com"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                            SMTP Host
                          </label>
                          <input
                            type="text"
                            value={smtpHost}
                            onChange={(e) => setSmtpHost(e.target.value)}
                            placeholder="smtp.mailgun.org"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                            SMTP Port
                          </label>
                          <input
                            type="text"
                            value={smtpPort}
                            onChange={(e) => setSmtpPort(e.target.value)}
                            placeholder="587"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          SMTP Username / Email
                        </label>
                        <input
                          type="email"
                          value={smtpEmail}
                          onChange={(e) => setSmtpEmail(e.target.value)}
                          placeholder="postmaster@yourdomain.com"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                          SMTP Password
                        </label>
                        <div className="relative">
                          <input
                            type={showSmtpPassword ? 'text' : 'password'}
                            value={smtpPassword}
                            onChange={(e) => setSmtpPassword(e.target.value)}
                            placeholder="SMTP password"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer"
                          >
                            {showSmtpPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* AI Assistant Engine */}
                <div className="space-y-4 border-t border-[#e9edef] dark:border-[#202d36] pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">AI Assistant Engine</h3>
                  
                  {/* Visual Mockup - AI suggestions */}
                  <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[8px] text-[#667781] dark:text-slate-400 font-bold">
                      <span className="text-[#111b21] dark:text-white flex items-center gap-1">🤖 AI Suggested Replies</span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">Copilot Active</span>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto py-0.5">
                      <div className="bg-[#00a884]/15 border border-[#00a884]/25 text-[#00a884] text-[8px] px-2 py-1 rounded-full whitespace-nowrap font-bold">
                        🤖 AI: Book Consultation Call
                      </div>
                      <div className="bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-slate-800 text-slate-700 dark:text-slate-300 text-[8px] px-2 py-1 rounded-full whitespace-nowrap font-bold">
                        AI: Send Pricing FAQ
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                      AI API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showOpenaiKey ? 'text' : 'password'}
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="AI Model API Key"
                        className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] cursor-pointer"
                      >
                        {showOpenaiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                      AI Chatbot Base Prompt (System Prompt)
                    </label>
                    <textarea
                      rows={6}
                      value={chatbotBasePrompt}
                      onChange={(e) => setChatbotBasePrompt(e.target.value)}
                      placeholder="Enter the custom base/system prompt for your chatbot. Leaving this blank will fall back to the default strict customer service prompt."
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white resize-y"
                    />
                    <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                      Configure your custom AI agent persona, rules, and fallbacks. The chatbot answers questions based on this prompt combined with your RAG knowledge base.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Webhook URLs setup block */}
            <div className="bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-bold text-[#111b21] dark:text-white">Dynamic Webhook Configurations</h3>
              <p className="text-[11px] text-[#667781] dark:text-[#8696a0] leading-relaxed font-semibold">
                Configure your messaging gateway sandbox or phone number to send message triggers and status alerts directly to this workspace instance:
              </p>
              
              {whatsappProvider === 'twilio' ? (
                <div className="space-y-3">
                  <div>
                    <span className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase mb-1">
                      Incoming Message Webhook (Twilio)
                    </span>
                    <div className="bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                      <code className="text-xs text-[#00e676] font-mono">{webhookUrl || 'Loading dynamic webhook...'}</code>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase mb-1">
                      Status Callback Webhook (Twilio)
                    </span>
                    <div className="bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                      <code className="text-xs text-[#00e676] font-mono">
                        {webhookUrl ? `${webhookUrl}/status` : 'Loading status callback...'}
                      </code>
                    </div>
                  </div>

                  <div className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold flex items-start gap-1">
                    <span className="text-amber-500 font-bold">⚠️</span>
                    <span>Make sure to select HTTP POST in the Twilio Sandbox/Numbers configuration screen when saving these webhook links.</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <span className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase mb-1">
                      Callback URL (Facebook Webhook)
                    </span>
                    <div className="bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                      <code className="text-xs text-[#00e676] font-mono">{facebookWebhookUrl || 'Loading facebook webhook...'}</code>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase mb-1">
                      Verify Token (Facebook Webhook Verification)
                    </span>
                    <div className="bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                      <code className="text-xs text-[#00e676] font-mono">{organization?.id || 'Save credentials to view Organization ID'}</code>
                    </div>
                  </div>

                  <div className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold flex items-start gap-1">
                    <span className="text-amber-500 font-bold">⚠️</span>
                    <span>Enter this Callback URL and Verify Token in your Meta App Dashboard under WhatsApp Webhook settings. Subscribe to "messages" webhook fields.</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Support */}
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21] dark:text-white">Need Help?</h2>
            </div>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-4 font-semibold">
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
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={20} className="text-[#00a884]" />
              <h2 className="text-base font-bold text-[#111b21] dark:text-white">Add Manual FAQ / Policy</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Question or Title
                </label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  placeholder="e.g. What is the fee for passport renewal?"
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Answer or Content
                </label>
                <textarea
                  rows={4}
                  value={manualContent}
                  onChange={e => setManualContent(e.target.value)}
                  placeholder="e.g. The standard passport renewal fee is $130. Expedited processing costs an additional $60."
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white resize-y"
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
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#1f2c34] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Indexed Knowledge Base</h3>
                <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] bg-[#f0f2f5] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] px-2.5 py-0.5 rounded-full">
                  {articles.length} items
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleExcelImport}
                  accept=".xlsx, .xls"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importProgress !== null || loadingArticles}
                  className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Upload size={12} />
                  <span>Import Excel</span>
                </button>
              </div>
            </div>

            {loadingArticles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[#00a884]" />
              </div>
            ) : articles.length === 0 ? (
              <div className="p-12 text-center text-[#667781] dark:text-[#8696a0]">
                <BookOpen size={36} className="text-[#e9edef] dark:text-[#202d36] mx-auto mb-3" />
                <p className="text-xs font-bold">No knowledge items added yet</p>
                <p className="text-[10px] font-medium mt-1">Add your first FAQ item above to build your knowledge base.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#1f2c34] text-[9px] font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
                      <th className="px-6 py-3">Question</th>
                      <th className="px-6 py-3">Answer Preview</th>
                      <th className="px-6 py-3">Indexed Date</th>
                      <th className="px-6 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedArticles.map((art) => (
                      <tr key={art.id} className="border-b border-[#e9edef] dark:border-[#202d36] last:border-b-0 hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 transition-colors">
                        <td className="px-6 py-3.5 font-bold text-[#111b21] dark:text-white max-w-xs">
                          <p className="truncate">{art.title}</p>
                        </td>
                        <td className="px-6 py-3.5 text-[#667781] dark:text-[#8696a0] font-medium text-[10px] max-w-sm">
                          <p className="line-clamp-2 whitespace-normal">{art.content?.substring(0, 120)}{art.content?.length > 120 ? '...' : ''}</p>
                        </td>
                        <td className="px-6 py-3.5 text-[#667781] dark:text-[#8696a0] font-medium">
                          {new Date(art.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <button
                            onClick={() => handleDeleteArticle(art.id)}
                            className="p-1 text-rose-500 hover:text-rose-600 hover:bg-[#f0f2f5] dark:hover:bg-[#202d36] rounded transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="px-6 py-4 border-t border-[#e9edef] dark:border-[#202d36]/50 bg-[#f0f2f5] dark:bg-[#1f2c34]/20 flex items-center justify-between select-none text-[11px] text-[#667781] dark:text-[#8696a0]">
                    <div className="font-semibold">
                      Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, articles.length)} of {articles.length} items
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 border border-[#e9edef] dark:border-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 disabled:opacity-50 text-[#111b21] dark:text-white rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed font-bold"
                      >
                        <ChevronLeft size={12} />
                        <span>Previous</span>
                      </button>
                      <span className="font-bold text-[#111b21] dark:text-white px-2">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 border border-[#e9edef] dark:border-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 disabled:opacity-50 text-[#111b21] dark:text-white rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed font-bold"
                      >
                        <span>Next</span>
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'teammates' && (
        <div className="space-y-6 max-w-4xl">
          {/* Teammates Usage & Limits Card */}
          <div className="bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[#111b21] dark:text-white flex items-center gap-2">
                  <Users className="text-[#00a884]" size={20} />
                  Teammate Account Slots
                </h2>
                <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 font-semibold">
                  Manage your organization's members, roles, and system logins.
                </p>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-[#111b21] dark:text-white">
                  {teammates.length} / {organization?.max_teammates && organization.max_teammates > 0 ? organization.max_teammates : 4} Slots Filled
                </span>
                <div className="w-40 bg-[#f0f2f5] dark:bg-[#1f2c34] h-2 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="bg-[#00a884] h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        (teammates.length / (organization?.max_teammates && organization.max_teammates > 0 ? organization.max_teammates : 4)) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Add Teammate Form */}
            <div className="lg:col-span-1 bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] p-6 shadow-sm h-fit">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0] mb-4">
                Add New Teammate
              </h3>
              <form onSubmit={handleAddTeammate} className="space-y-4">
                {teammateError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-lg text-rose-600 dark:text-rose-400 text-[10px] font-semibold">
                    {teammateError}
                  </div>
                )}
                {teammateSuccess && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                    {teammateSuccess}
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={teammateForm.fullName}
                    onChange={(e) => setTeammateForm({ ...teammateForm, fullName: e.target.value })}
                    placeholder="e.g. Jane Doe"
                    className="w-full px-3.5 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={teammateForm.email}
                    onChange={(e) => setTeammateForm({ ...teammateForm, email: e.target.value })}
                    placeholder="jane@company.com"
                    className="w-full px-3.5 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={teammateForm.password}
                    onChange={(e) => setTeammateForm({ ...teammateForm, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1">
                    Workspace Role
                  </label>
                  <select
                    value={teammateForm.role}
                    onChange={(e) => setTeammateForm({ ...teammateForm, role: e.target.value })}
                    className="w-full px-3.5 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold text-[#111b21] dark:text-white"
                  >
                    <option value="agent">Agent (Standard)</option>
                    <option value="admin">Admin (Full Settings Access)</option>
                    <option value="viewer">Viewer (Read-Only)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={addingTeammate || teammates.length >= (organization?.max_teammates && organization.max_teammates > 0 ? organization.max_teammates : 4)}
                  className="w-full bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white py-2 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {addingTeammate ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  <span>Create Account</span>
                </button>
              </form>
            </div>

            {/* Teammates List */}
            <div className="lg:col-span-2 bg-white dark:bg-[#111b21] rounded-lg border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden flex flex-col justify-start">
              <div className="px-6 py-4 border-b border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#1f2c34] flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Active Teammates</h3>
                <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] bg-[#f0f2f5] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] px-2.5 py-0.5 rounded-full">
                  {teammates.length} users
                </span>
              </div>

              {loadingTeammates ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-[#00a884]" />
                </div>
              ) : teammates.length === 0 ? (
                <div className="p-12 text-center text-[#667781] dark:text-[#8696a0]">
                  <Users size={36} className="text-[#e9edef] dark:text-[#202d36] mx-auto mb-3" />
                  <p className="text-xs font-bold">No teammates found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {/* Table view on larger screens, card list on small screens */}
                  <div className="hidden sm:block">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#1f2c34] text-[9px] font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
                          <th className="px-6 py-3">Name</th>
                          <th className="px-6 py-3">Email</th>
                          <th className="px-6 py-3">Role</th>
                          <th className="px-6 py-3">Joined Date</th>
                          <th className="px-6 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teammates.map((member) => (
                          <tr
                            key={member.id}
                            className="border-b border-[#e9edef] dark:border-[#202d36] last:border-b-0 hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 transition-colors"
                          >
                            <td className="px-6 py-3.5 font-bold text-[#111b21] dark:text-white">
                              {member.full_name || 'N/A'}
                            </td>
                            <td className="px-6 py-3.5 text-[#667781] dark:text-[#8696a0] font-semibold">
                              {member.email}
                            </td>
                            <td className="px-6 py-3.5">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                                member.role === 'admin' || member.role === 'owner' || member.role === 'OrgAdmin' || member.role === 'superadmin'
                                  ? 'bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900'
                                  : member.role === 'viewer'
                                  ? 'bg-gray-50 dark:bg-gray-950/20 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-900'
                                  : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                              }`}>
                                {member.role}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-[#667781] dark:text-[#8696a0] font-medium">
                              {new Date(member.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              {member.id !== user?.id && member.role !== 'owner' ? (
                                <button
                                  onClick={() => handleDeleteTeammate(member.id)}
                                  className="p-1 text-rose-500 hover:text-rose-600 hover:bg-[#f0f2f5] dark:hover:bg-[#202d36] rounded transition-colors cursor-pointer"
                                  title="Remove Teammate"
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : (
                                <span className="text-[10px] text-[#8696a0] font-semibold">Protected</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Responsive Cards list view on mobile */}
                  <div className="sm:hidden p-4 space-y-3">
                    {teammates.map((member) => (
                      <div
                        key={member.id}
                        className="p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5]/40 dark:bg-[#1f2c34]/20 space-y-2 relative"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="text-xs font-bold text-[#111b21] dark:text-white">
                              {member.full_name || 'N/A'}
                            </h4>
                            <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold">
                              {member.email}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border ${
                            member.role === 'admin' || member.role === 'owner' || member.role === 'OrgAdmin' || member.role === 'superadmin'
                              ? 'bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900'
                              : member.role === 'viewer'
                              ? 'bg-gray-50 dark:bg-gray-950/20 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-900'
                              : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                          }`}>
                            {member.role}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-[#667781] dark:text-[#8696a0] pt-1">
                          <span>Joined {new Date(member.created_at).toLocaleDateString()}</span>
                          {member.id !== user?.id && member.role !== 'owner' ? (
                            <button
                              onClick={() => handleDeleteTeammate(member.id)}
                              className="text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded transition-all cursor-pointer"
                            >
                              <Trash2 size={11} />
                              <span>Remove</span>
                            </button>
                          ) : (
                            <span className="text-[9px] text-[#8696a0] font-bold bg-[#f0f2f5] dark:bg-[#111b21] px-2 py-1 rounded border border-[#e9edef] dark:border-[#2a3942]">
                              Protected
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Excel Import Progress Overlay */}
      {importProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center space-y-4">
            <Loader2 size={32} className="animate-spin text-[#00a884] mx-auto" />
            <div>
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Importing FAQ Items</h3>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 font-semibold leading-relaxed">
                Please wait while we generate vector embeddings and index your FAQ items.
              </p>
            </div>
            <div className="bg-[#f0f2f5] dark:bg-[#111b21] h-2 w-full rounded-full overflow-hidden">
              <div 
                className="bg-[#00a884] h-full transition-all duration-300"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
            <div className="text-[11px] text-[#667781] dark:text-[#8696a0] font-bold">
              Processed {importProgress.current} of {importProgress.total} items ({Math.round((importProgress.current / importProgress.total) * 100)}%)
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
