'use client'

import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import {
  Shield,
  Building,
  Users,
  Megaphone,
  Phone,
  Trash2,
  Edit2,
  Search,
  Plus,
  Loader2,
  Sparkles,
  MessageSquare,
  Key,
  Check,
  X,
  AlertTriangle,
  UserCheck,
  Sliders,
  Mail,
  RefreshCw,
  Eye,
  EyeOff,
  Database,
  BookOpen,
  FileText,
  Upload,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'

// Define interfaces
interface OrgStats {
  id: string
  name: string
  slug: string
  created_at: string
  usersCount: number
  contactsCount: number
  messagesCount: number
  aiTokens: number
  aiCost: number
}

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: string
  created_at: string
  organization_id: string
  organization?: {
    name: string
    slug: string
  }
}

interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
  enable_ai: boolean
  enable_email: boolean
  enable_messages: boolean
  enable_phone_calls: boolean
  enable_sms: boolean
  twilio_account_sid?: string | null
  twilio_auth_token?: string | null
  twilio_whatsapp_number?: string | null
  sendgrid_api_key?: string | null
  sendgrid_from_email?: string | null
  openai_api_key?: string | null
  chatbot_base_prompt?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contact_address?: string | null
  email_provider?: string | null
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_email?: string | null
  smtp_password?: string | null
  whatsapp_provider?: string | null
  whatsapp_api_token?: string | null
  whatsapp_default_phone?: string | null
  whatsapp_graph_api_version?: string | null
  whatsapp_phone_number_id?: string | null
  whatsapp_business_account_id?: string | null
}

// iOS Style Toggle Switch
interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

function ToggleSwitch({ checked, onChange, label, description }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-2.5 select-none transition-all">
      <div className="flex flex-col pr-4">
        <span className="text-[11px] font-bold text-neutral-800 dark:text-neutral-100 transition-colors">
          {label}
        </span>
        {description && (
          <span className="text-[9px] text-neutral-500 dark:text-[#8696a0] font-semibold mt-0.5 leading-tight">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5.5 w-10.5 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
          checked ? 'bg-[#00a884] shadow-[0_0_8px_rgba(0,168,132,0.3)]' : 'bg-neutral-200 dark:bg-neutral-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

export default function SuperAdminPage() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'analytics' | 'organizations' | 'users'>('analytics')

  // Selected Organization Settings
  const [selectedOrgSettings, setSelectedOrgSettings] = useState<Organization | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  // Organization settings page tab
  const [settingsActiveTab, setSettingsActiveTab] = useState<'general' | 'knowledge'>('general')

  // Organization settings states
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

  // Contact Information states
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactAddress, setContactAddress] = useState('')

  // Webhook URLs
  const [webhookUrl, setWebhookUrl] = useState('')
  const [facebookWebhookUrl, setFacebookWebhookUrl] = useState('')

  // Show/Hide credentials state
  const [showTwilioToken, setShowTwilioToken] = useState(false)
  const [showSgKey, setShowSgKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)
  const [showWhatsappApiToken, setShowWhatsappApiToken] = useState(false)

  // Knowledge base state for RAG FAQ
  const [articles, setArticles] = useState<any[]>([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalPages = Math.ceil(articles.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedArticles = articles.slice(startIndex, startIndex + itemsPerPage)

  // Load selected organization settings into state
  useEffect(() => {
    if (selectedOrgSettings) {
      setSettingsActiveTab('general')
      setTwilioAccountSid(selectedOrgSettings.twilio_account_sid || '')
      setTwilioAuthToken(selectedOrgSettings.twilio_auth_token || '')
      setTwilioWhatsappNumber(selectedOrgSettings.twilio_whatsapp_number || '')
      setSendgridApiKey(selectedOrgSettings.sendgrid_api_key || '')
      setSendgridFromEmail(selectedOrgSettings.sendgrid_from_email || '')
      setOpenaiApiKey(selectedOrgSettings.openai_api_key || '')
      setChatbotBasePrompt(selectedOrgSettings.chatbot_base_prompt || '')
      setEmailProvider((selectedOrgSettings.email_provider as 'sendgrid' | 'smtp') || 'sendgrid')
      setSmtpHost(selectedOrgSettings.smtp_host || '')
      setSmtpPort(selectedOrgSettings.smtp_port ? String(selectedOrgSettings.smtp_port) : '')
      setSmtpEmail(selectedOrgSettings.smtp_email || '')
      setSmtpPassword(selectedOrgSettings.smtp_password || '')
      setWhatsappProvider((selectedOrgSettings.whatsapp_provider as 'twilio' | 'facebook') || 'twilio')
      setWhatsappApiToken(selectedOrgSettings.whatsapp_api_token || '')
      setWhatsappDefaultPhone(selectedOrgSettings.whatsapp_default_phone || '')
      setWhatsappGraphApiVersion(selectedOrgSettings.whatsapp_graph_api_version || 'v25.0')
      setWhatsappPhoneNumberId(selectedOrgSettings.whatsapp_phone_number_id || '')
      setWhatsappBusinessAccountId(selectedOrgSettings.whatsapp_business_account_id || '')

      setContactName(selectedOrgSettings.contact_name || '')
      setContactPhone(selectedOrgSettings.contact_phone || '')
      setContactEmail(selectedOrgSettings.contact_email || '')
      setContactAddress(selectedOrgSettings.contact_address || '')

      if (typeof window !== 'undefined') {
        const orgSlug = selectedOrgSettings.slug || 'org'
        const dynamicPath = `${selectedOrgSettings.id}_${orgSlug}`
        setWebhookUrl(`${window.location.origin}/api/webhooks/twilio/${dynamicPath}`)
        setFacebookWebhookUrl(`${window.location.origin}/api/webhooks/facebook/${dynamicPath}`)
      }

      loadOrgArticles(selectedOrgSettings.id)
    }
  }, [selectedOrgSettings])

  async function loadOrgArticles(orgId: string) {
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
    if (!file || !selectedOrgSettings) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json<any>(ws)

        if (data.length === 0) {
          triggerAlert('error', 'The uploaded Excel file is empty.')
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
            triggerAlert('error', 'Could not identify Question and Answer columns. Please ensure your Excel sheet has columns named "Question" and "Answer".')
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
          triggerAlert('error', 'No valid FAQ rows found. Make sure questions and answers are not blank.')
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
                organizationId: selectedOrgSettings.id,
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

        triggerAlert('success', `Successfully imported ${importedCount} of ${parsedItems.length} FAQ items!`)
        await loadOrgArticles(selectedOrgSettings.id)
      } catch (err: any) {
        console.error('Excel parse error:', err)
        triggerAlert('error', err.message || 'Failed to read Excel file.')
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
    if (!manualTitle.trim() || !manualContent.trim() || !selectedOrgSettings) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: selectedOrgSettings.id,
          type: 'manual',
          title: manualTitle.trim(),
          content: manualContent.trim()
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add FAQ')
      setManualTitle('')
      setManualContent('')
      triggerAlert('success', 'FAQ successfully added to knowledge base!')
      await loadOrgArticles(selectedOrgSettings.id)
    } catch (err: any) {
      console.error('Add manual error:', err)
      triggerAlert('error', err.message || 'Failed to add FAQ.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDeleteArticle(id: string) {
    if (!selectedOrgSettings || !confirm('Are you sure you want to delete this article? It will be removed from the AI RAG index.')) return
    try {
      const res = await fetch(`/api/knowledge?id=${id}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Delete failed')
      await loadOrgArticles(selectedOrgSettings.id)
    } catch (err) {
      console.error('Delete article error:', err)
      triggerAlert('error', 'Failed to delete article.')
    }
  }

  async function handleToggleFeature(featureKey: 'enable_ai' | 'enable_email' | 'enable_messages' | 'enable_phone_calls' | 'enable_sms', value: boolean) {
    if (!selectedOrgSettings) return
    
    // Optimistic update
    const updatedOrg = { ...selectedOrgSettings, [featureKey]: value }
    setSelectedOrgSettings(updatedOrg)
    
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch(`/api/superadmin/organizations/${selectedOrgSettings.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ [featureKey]: value })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update feature settings')
      
      triggerAlert('success', `Successfully ${value ? 'enabled' : 'disabled'} feature.`)
      loadOrganizations()
    } catch (err: any) {
      console.error('Failed to update feature:', err)
      triggerAlert('error', err.message || 'Failed to update feature settings.')
      setSelectedOrgSettings(selectedOrgSettings)
    }
  }

  async function handleSaveCredentials() {
    if (!selectedOrgSettings) return
    setSavingCredentials(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch(`/api/superadmin/organizations/${selectedOrgSettings.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
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
          contact_name: contactName.trim() || null,
          contact_phone: contactPhone.trim() || null,
          contact_email: contactEmail.trim() || null,
          contact_address: contactAddress.trim() || null,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save settings')

      setSelectedOrgSettings({
        ...selectedOrgSettings,
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
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_address: contactAddress.trim() || null,
      })

      triggerAlert('success', 'Organization settings updated successfully.')
      loadOrganizations()
    } catch (err: any) {
      console.error('Failed to save settings:', err)
      triggerAlert('error', err.message || 'Failed to save settings.')
    } finally {
      setSavingCredentials(false)
    }
  }

  // Overall statistics
  const [stats, setStats] = useState({
    organizations: 0,
    contacts: 0,
    messages: 0,
    campaigns: 0,
    totalAiTokens: 0,
    totalAiCost: 0,
  })

  // Data lists
  const [orgStatsList, setOrgStatsList] = useState<OrgStats[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])

  // Loadings
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingOrgs, setLoadingOrgs] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(true)

  // Modals state
  const [showOrgModal, setShowOrgModal] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)

  // Search/Filters
  const [orgSearch, setOrgSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [userOrgFilter, setUserOrgFilter] = useState('all')

  // Form states
  const [orgForm, setOrgForm] = useState({
    name: '',
    slug: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    contact_address: '',
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
    enable_sms: true,
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_whatsapp_number: '',
    sendgrid_api_key: '',
    sendgrid_from_email: '',
    openai_api_key: '',
    chatbot_base_prompt: '',
  })
  const [userForm, setUserForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'Manager',
    organizationId: ''
  })



  // Show/Hide password field
  const [showPass, setShowPass] = useState(false)

  // Error/Success banners
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [submittingOrg, setSubmittingOrg] = useState(false)
  const [submittingUser, setSubmittingUser] = useState(false)

  // Trigger alert banner
  const triggerAlert = (type: 'success' | 'error', message: string) => {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 5000)
  }

  // Load overall metrics & activity list
  async function loadAnalytics() {
    setLoadingStats(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch('/api/superadmin/analytics', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) throw new Error('Failed to load analytics')
      const data = await res.json()
      if (data.success) {
        setStats(data.stats)
        setOrgStatsList(data.organizationsList)
      }
    } catch (err: any) {
      console.error(err)
      triggerAlert('error', err.message || 'Failed to load system metrics')
    } finally {
      setLoadingStats(false)
    }
  }

  // Load all organizations
  async function loadOrganizations() {
    setLoadingOrgs(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch('/api/superadmin/organizations', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) throw new Error('Failed to fetch organizations')
      const data = await res.json()
      if (data.success) {
        setOrganizations(data.organizations)
      }
    } catch (err: any) {
      console.error(err)
      triggerAlert('error', err.message || 'Failed to load organizations')
    } finally {
      setLoadingOrgs(false)
    }
  }

  // Load all users
  async function loadUsers() {
    setLoadingUsers(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch('/api/superadmin/users', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) throw new Error('Failed to fetch users')
      const data = await res.json()
      if (data.success) {
        setUsers(data.users)
      }
    } catch (err: any) {
      console.error(err)
      triggerAlert('error', err.message || 'Failed to load users list')
    } finally {
      setLoadingUsers(false)
    }
  }

  // Initial fetch
  useEffect(() => {
    loadAnalytics()
    loadOrganizations()
    loadUsers()
  }, [])

  // Auto-fill slug from organization name
  const handleOrgNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    setOrgForm({ ...orgForm, name, slug })
  }

  // Create Organization
  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault()
    if (!orgForm.name || !orgForm.slug) return

    setSubmittingOrg(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch('/api/superadmin/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(orgForm)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create organization')

      triggerAlert('success', `Organization "${orgForm.name}" created successfully.`)
      setOrgForm({
        name: '',
        slug: '',
        contact_name: '',
        contact_email: '',
        contact_phone: '',
        contact_address: '',
        enable_ai: true,
        enable_email: true,
        enable_messages: true,
        enable_phone_calls: true,
        enable_sms: true,
        twilio_account_sid: '',
        twilio_auth_token: '',
        twilio_whatsapp_number: '',
        sendgrid_api_key: '',
        sendgrid_from_email: '',
        openai_api_key: '',
        chatbot_base_prompt: '',
      })
      setShowOrgModal(false)
      loadOrganizations()
      loadAnalytics()
    } catch (err: any) {
      triggerAlert('error', err.message)
    } finally {
      setSubmittingOrg(false)
    }
  }

  // Edit organization details (e.g. rename slug)
  async function handleUpdateOrgDetails(e: React.FormEvent) {
    e.preventDefault()
    if (!editingOrg) return

    setSubmittingOrg(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch(`/api/superadmin/organizations/${editingOrg.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: editingOrg.name, slug: editingOrg.slug })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update organization details')

      triggerAlert('success', 'Organization renamed successfully.')
      setEditingOrg(null)
      loadOrganizations()
      loadAnalytics()
    } catch (err: any) {
      triggerAlert('error', err.message)
    } finally {
      setSubmittingOrg(false)
    }
  }



  // Delete Organization
  async function handleDeleteOrg(orgId: string, name: string) {
    if (!confirm(`Are you absolutely sure you want to delete organization "${name}"?\nAll users, contacts, messages, and campaigns under this organization will be permanently deleted.`)) {
      return
    }

    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch(`/api/superadmin/organizations/${orgId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete organization')
      }

      triggerAlert('success', `Organization "${name}" has been deleted.`)
      if (selectedOrgSettings?.id === orgId) {
        setSelectedOrgSettings(null)
      }
      loadOrganizations()
      loadAnalytics()
      loadUsers()
    } catch (err: any) {
      triggerAlert('error', err.message)
    }
  }

  // Create User
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    const { fullName, email, password, role, organizationId } = userForm
    if (!fullName || !email || !password || !role || !organizationId) {
      triggerAlert('error', 'All fields are required to create a user.')
      return
    }

    setSubmittingUser(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch('/api/superadmin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(userForm)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create user')

      triggerAlert('success', `User/Manager "${fullName}" created successfully.`)
      setUserForm({ fullName: '', email: '', password: '', role: 'Manager', organizationId: '' })
      setShowUserModal(false)
      loadUsers()
      loadAnalytics()
    } catch (err: any) {
      triggerAlert('error', err.message)
    } finally {
      setSubmittingUser(false)
    }
  }

  // Update User profile
  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault()
    if (!editingUser) return

    setSubmittingUser(true)
    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch(`/api/superadmin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fullName: editingUser.full_name,
          role: editingUser.role,
          organizationId: editingUser.organization_id,
          email: editingUser.email
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update user profile')

      triggerAlert('success', 'User profile updated successfully.')
      setEditingUser(null)
      loadUsers()
    } catch (err: any) {
      triggerAlert('error', err.message)
    } finally {
      setSubmittingUser(false)
    }
  }

  // Delete User
  async function handleDeleteUser(userId: string, email: string) {
    if (!confirm(`Are you sure you want to delete user "${email}"?\nThis action will delete their profile and disable their authentication credentials.`)) {
      return
    }

    try {
      const token = authSessionManager.getSession()?.access_token
      const res = await fetch(`/api/superadmin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete user')
      }

      triggerAlert('success', `User "${email}" deleted successfully.`)
      loadUsers()
      loadAnalytics()
    } catch (err: any) {
      triggerAlert('error', err.message)
    }
  }

  // Helper arrays
  const rolesList = ['owner', 'admin', 'member', 'salesemployees', 'saleslead', 'superadmin', 'OrgAdmin', 'Manager']

  // Filters calculation
  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
    org.slug.toLowerCase().includes(orgSearch.toLowerCase())
  )

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      (user.full_name || '').toLowerCase().includes(userSearch.toLowerCase())
    const matchesOrg = userOrgFilter === 'all' || user.organization_id === userOrgFilter
    return matchesSearch && matchesOrg
  })

  return (
    <div className="h-full w-full overflow-y-auto bg-gradient-to-br from-neutral-50 via-neutral-100 to-amber-50/10 dark:from-[#0b141a] dark:via-[#0c1317] dark:to-[#080d10] p-6 space-y-6 transition-all duration-300">
      
      {/* Alert banner */}
      {alert && (
        <div className={`fixed top-16 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl border shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-4 duration-300 ${
          alert.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
        }`}>
          {alert.type === 'success' ? (
            <div className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">
              <Check size={14} />
            </div>
          ) : (
            <div className="h-6 w-6 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-500">
              <AlertTriangle size={14} />
            </div>
          )}
          <span className="text-xs font-bold tracking-tight">{alert.message}</span>
        </div>
      )}

      {/* Header Dashboard section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 select-none pb-2">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 dark:border-emerald-500/40 text-[9px] font-extrabold uppercase tracking-wider text-[#00a884] dark:text-emerald-400">
            <Shield size={10} className="animate-pulse" />
            <span>SUPER ADMIN POWER PANEL</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-neutral-800 dark:text-white mt-2 leading-none">
            System Administration
          </h1>
          <p className="text-xs text-neutral-500 dark:text-[#8696a0] font-semibold mt-2.5">
            Configure gateways, control feature gates, and manage users and tenants globally.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Refresh action */}
          <button
            onClick={() => {
              loadAnalytics()
              loadOrganizations()
              loadUsers()
              triggerAlert('success', 'Data reloaded successfully.')
            }}
            className="flex items-center justify-center h-10 w-10 rounded-xl bg-white dark:bg-[#111b21] border border-neutral-200 dark:border-[#202d36] text-[#667781] dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-[#202d36]/50 transition-all cursor-pointer shadow-sm"
            title="Reload Data"
          >
            <RefreshCw size={15} />
          </button>
          
          <button
            onClick={() => {
              if (organizations.length === 0) {
                triggerAlert('error', 'Please load organizations first.')
                return
              }
              setUserForm({
                fullName: '',
                email: '',
                password: '',
                role: 'Manager',
                organizationId: organizations[0]?.id || ''
              })
              setShowUserModal(true)
            }}
            className="flex items-center gap-1.5 h-10 px-4 bg-neutral-800 hover:bg-neutral-900 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-800 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm hover:shadow-md active:scale-95"
          >
            <Plus size={14} />
            <span>Add User</span>
          </button>
          
          <button
            onClick={() => {
              setOrgForm({
                name: '',
                slug: '',
                contact_name: '',
                contact_email: '',
                contact_phone: '',
                contact_address: '',
                enable_ai: true,
                enable_email: true,
                enable_messages: true,
                enable_phone_calls: true,
                enable_sms: true,
                twilio_account_sid: '',
                twilio_auth_token: '',
                twilio_whatsapp_number: '',
                sendgrid_api_key: '',
                sendgrid_from_email: '',
                openai_api_key: '',
                chatbot_base_prompt: '',
              })
              setShowOrgModal(true)
            }}
            className="flex items-center gap-1.5 h-10 px-4 bg-gradient-to-r from-[#00a884] to-teal-600 hover:from-[#009070] hover:to-teal-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm hover:shadow-md hover:shadow-teal-500/10 active:scale-95"
          >
            <Plus size={14} />
            <span>Add Organization</span>
          </button>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="bg-white/80 dark:bg-[#111b21]/80 backdrop-blur-md border border-neutral-200/60 dark:border-neutral-800/60 p-1.5 rounded-2xl flex items-center gap-1.5 select-none w-fit shadow-sm">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'analytics' 
              ? 'bg-neutral-800 dark:bg-white text-white dark:text-neutral-800 shadow-sm' 
              : 'text-neutral-500 dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white'
          }`}
        >
          Analytics Overview
        </button>
        <button
          onClick={() => setActiveTab('organizations')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'organizations' 
              ? 'bg-neutral-800 dark:bg-white text-white dark:text-neutral-800 shadow-sm' 
              : 'text-neutral-500 dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white'
          }`}
        >
          Organizations ({organizations.length})
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'users' 
              ? 'bg-neutral-800 dark:bg-white text-white dark:text-neutral-800 shadow-sm' 
              : 'text-neutral-500 dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white'
          }`}
        >
          Users & Managers ({users.length})
        </button>
      </div>

      {/* TAB CONTENT: ANALYTICS OVERVIEW */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* KPI grid panel */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            
            {/* Organizations count */}
            <div className="bg-white dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-5 hover:shadow-md transition-all group select-none hover:border-[#00a884]/30 dark:hover:border-emerald-500/30">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 dark:text-[#8696a0]">Organizations</span>
                <div className="h-8 w-8 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Building size={15} />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-black text-neutral-800 dark:text-white tracking-tight">
                  {loadingStats ? <Loader2 size={18} className="animate-spin text-neutral-400" /> : stats.organizations}
                </span>
                <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-black uppercase tracking-wider">active</span>
              </div>
            </div>

            {/* Users count */}
            <div className="bg-white dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-5 hover:shadow-md transition-all group select-none hover:border-blue-500/30 dark:hover:border-blue-500/30">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 dark:text-[#8696a0]">Total Users</span>
                <div className="h-8 w-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Users size={15} />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-black text-neutral-800 dark:text-white tracking-tight">
                  {loadingStats ? <Loader2 size={18} className="animate-spin text-neutral-400" /> : stats.users}
                </span>
                <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-black uppercase tracking-wider">system</span>
              </div>
            </div>

            {/* Contacts count */}
            <div className="bg-white dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-5 hover:shadow-md transition-all group select-none hover:border-indigo-500/30 dark:hover:border-indigo-500/30">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 dark:text-[#8696a0]">Total Contacts</span>
                <div className="h-8 w-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <UserCheck size={15} />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-black text-neutral-800 dark:text-white tracking-tight">
                  {loadingStats ? <Loader2 size={18} className="animate-spin text-neutral-400" /> : stats.contacts}
                </span>
                <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-black uppercase tracking-wider">records</span>
              </div>
            </div>

            {/* Messages sent/received */}
            <div className="bg-white dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-5 hover:shadow-md transition-all group select-none hover:border-emerald-500/30 dark:hover:border-emerald-500/30">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 dark:text-[#8696a0]">Messages Log</span>
                <div className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <MessageSquare size={15} />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-black text-neutral-800 dark:text-white tracking-tight">
                  {loadingStats ? <Loader2 size={18} className="animate-spin text-neutral-400" /> : stats.messages}
                </span>
                <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-black uppercase tracking-wider">sent/recv</span>
              </div>
            </div>

            {/* Campaigns sent */}
            <div className="bg-white dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-5 hover:shadow-md transition-all group select-none hover:border-rose-500/30 dark:hover:border-rose-500/30">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 dark:text-[#8696a0]">Campaigns</span>
                <div className="h-8 w-8 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Megaphone size={15} />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-black text-neutral-800 dark:text-white tracking-tight">
                  {loadingStats ? <Loader2 size={18} className="animate-spin text-neutral-400" /> : stats.campaigns}
                </span>
                <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-black uppercase tracking-wider">dispatched</span>
              </div>
            </div>

            {/* AI Costing */}
            <div className="bg-white dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-5 hover:shadow-md transition-all group select-none hover:border-amber-500/30 dark:hover:border-amber-500/30">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 dark:text-[#8696a0]">Total AI Costing</span>
                <div className="h-8 w-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Sparkles size={15} />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-black text-neutral-800 dark:text-white tracking-tight">
                  {loadingStats ? <Loader2 size={18} className="animate-spin text-neutral-400" /> : `$${stats.totalAiCost.toFixed(4)}`}
                </span>
                <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-black uppercase tracking-wider">({(stats.totalAiTokens / 1000).toFixed(1)}k tokens)</span>
              </div>
            </div>

          </div>

          {/* Org activity breakdown list */}
          <div className="bg-white/90 dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5 select-none">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-[#00a884]" />
                <h3 className="text-xs font-black text-neutral-800 dark:text-white uppercase tracking-wider">
                  Tenant Resource Allocation & Metrics
                </h3>
              </div>
            </div>
            
            {loadingStats ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-3">
                <Loader2 className="animate-spin text-[#00a884]" size={24} />
                <span className="text-xs text-neutral-400 dark:text-[#8696a0] font-semibold">Analyzing database tables...</span>
              </div>
            ) : orgStatsList.length === 0 ? (
              <div className="text-center py-16 text-xs text-neutral-400 dark:text-[#8696a0] font-semibold">
                No organizations exist in the system yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-200/80 dark:border-neutral-800/80 text-neutral-400 dark:text-[#8696a0] font-bold">
                      <th className="py-3 px-4">Organization Name</th>
                      <th className="py-3 px-4">Slug Identifier</th>
                      <th className="py-3 px-4 text-center">Managers</th>
                      <th className="py-3 px-4 text-center">Contacts</th>
                      <th className="py-3 px-4 text-center">Campaigns</th>
                      <th className="py-3 px-4 text-center">Messages</th>
                      <th className="py-3 px-4 text-center">AI Cost</th>
                      <th className="py-3 px-4 text-right">Created Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                    {orgStatsList.map((org) => (
                      <tr key={org.id} className="hover:bg-neutral-50/50 dark:hover:bg-[#1f2c34]/20 transition-all">
                        <td className="py-3.5 px-4 font-bold text-neutral-800 dark:text-white">{org.name}</td>
                        <td className="py-3.5 px-4"><span className="font-mono text-[10px] text-neutral-400 dark:text-[#8696a0] bg-neutral-100 dark:bg-[#1f2c34] px-2 py-0.5 rounded-lg">{org.slug}</span></td>
                        <td className="py-3.5 px-4 text-center font-bold text-neutral-700 dark:text-neutral-200">{org.usersCount}</td>
                        <td className="py-3.5 px-4 text-center font-bold text-blue-500">{org.contactsCount}</td>
                        <td className="py-3.5 px-4 text-center font-bold text-rose-500">{org.campaignsCount}</td>
                        <td className="py-3.5 px-4 text-center font-bold text-emerald-500">{org.messagesCount}</td>
                        <td className="py-3.5 px-4 text-center font-bold text-amber-500">${(org.aiCost || 0).toFixed(4)}</td>
                        <td className="py-3.5 px-4 text-right text-neutral-400 dark:text-[#8696a0] font-semibold">
                          {new Date(org.created_at).toLocaleDateString()}
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

      {/* TAB CONTENT: ORGANIZATIONS MANAGER */}
      {activeTab === 'organizations' && selectedOrgSettings === null && (
        <div className="bg-white/95 dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-6 shadow-sm space-y-4">
          
          {/* Table controls */}
          <div className="flex items-center justify-between gap-4 select-none">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3.5 top-3 text-neutral-400 dark:text-[#8696a0]" />
              <input
                type="text"
                placeholder="Search organizations by name or slug..."
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] dark:focus:border-[#00a884] text-neutral-800 dark:text-white"
              />
            </div>
          </div>

          {/* List */}
          {loadingOrgs ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="animate-spin text-[#00a884]" size={24} />
              <span className="text-xs text-neutral-400 dark:text-[#8696a0] font-semibold">Fetching organizations...</span>
            </div>
          ) : filteredOrgs.length === 0 ? (
            <div className="text-center py-16 text-xs text-neutral-400 dark:text-[#8696a0] font-semibold">
              No organizations match the filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-neutral-200/80 dark:border-neutral-800/80 text-neutral-400 dark:text-[#8696a0] font-bold">
                    <th className="py-3 px-4">Organization Name</th>
                    <th className="py-3 px-4">Slug Identifier</th>
                    <th className="py-3 px-4">Feature Toggles</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                  {filteredOrgs.map((org) => {
                    return (
                      <tr 
                        key={org.id} 
                        className="hover:bg-neutral-50/50 dark:hover:bg-[#1f2c34]/20 transition-all cursor-pointer"
                        onClick={() => setSelectedOrgSettings(org)}
                      >
                        <td className="py-4 px-4 font-bold text-neutral-800 dark:text-white">
                          {org.name}
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-mono text-[10px] text-neutral-400 dark:text-[#8696a0] bg-neutral-100 dark:bg-[#1f2c34] px-2 py-0.5 rounded-lg">
                            {org.slug}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex flex-wrap gap-1.5 select-none">
                            {org.enable_ai !== false ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 font-extrabold text-[9px]">
                                <span className="h-1 w-1 rounded-full bg-purple-500 animate-pulse" /> AI
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 font-bold text-[9px]">Disabled</span>
                            )}
                            
                            {org.enable_email !== false ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-extrabold text-[9px]">
                                <span className="h-1 w-1 rounded-full bg-blue-500" /> Email
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 font-bold text-[9px]">Disabled</span>
                            )}
                            
                            {org.enable_messages !== false ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-extrabold text-[9px]">
                                <span className="h-1 w-1 rounded-full bg-emerald-500" /> Chat
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 font-bold text-[9px]">Disabled</span>
                            )}
                            
                            {org.enable_phone_calls !== false ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-extrabold text-[9px]">
                                <span className="h-1 w-1 rounded-full bg-amber-500" /> Phone
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 font-bold text-[9px]">Disabled</span>
                            )}

                            {org.enable_sms !== false ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-extrabold text-[9px]">
                                <span className="h-1 w-1 rounded-full bg-rose-500" /> SMS
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 font-bold text-[9px]">Disabled</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setEditingOrg(org)
                            }}
                            className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-[#202d36] dark:hover:bg-[#2a3942] text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
                            title="Rename Organization"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteOrg(org.id, org.name)}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 transition-colors cursor-pointer"
                            title="Delete Organization"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'organizations' && selectedOrgSettings !== null && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Header block with Back button */}
          <div className="flex items-center gap-3 border-b border-neutral-200 dark:border-[#202d36] pb-4 select-none">
            <button
              onClick={() => setSelectedOrgSettings(null)}
              className="flex items-center justify-center h-10 px-3 rounded-xl bg-white dark:bg-[#111b21] border border-neutral-200 dark:border-[#202d36] text-[#667781] dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-[#202d36]/50 transition-all cursor-pointer shadow-sm gap-1.5"
            >
              <ChevronLeft size={16} />
              <span className="text-xs font-bold">Back to Organizations</span>
            </button>
            <div className="h-6 w-px bg-neutral-200 dark:bg-[#202d36]" />
            <div>
              <h2 className="text-base font-black text-neutral-800 dark:text-white flex items-center gap-2">
                <span>{selectedOrgSettings.name} Settings</span>
                <span className="font-mono text-[9px] text-neutral-400 dark:text-[#8696a0] bg-neutral-100 dark:bg-[#1f2c34] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                  {selectedOrgSettings.slug}
                </span>
              </h2>
              <p className="text-[10px] text-neutral-500 dark:text-[#8696a0] font-semibold mt-0.5">
                Configure features, custom credentials, integrations and RAG knowledge base for this organization.
              </p>
            </div>
          </div>

          {/* Tab Selection */}
          <div className="flex border-b border-neutral-200 dark:border-[#202d36] mb-6">
            <button
              onClick={() => setSettingsActiveTab('general')}
              className={`px-4 py-2 text-xs font-extrabold transition-all cursor-pointer border-b-2 ${
                settingsActiveTab === 'general'
                  ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
                  : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white'
              }`}
            >
              General Settings
            </button>
            {selectedOrgSettings.enable_ai !== false && (
              <button
                onClick={() => setSettingsActiveTab('knowledge')}
                className={`px-4 py-2 text-xs font-extrabold transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                  settingsActiveTab === 'knowledge'
                    ? 'border-[#00a884] text-[#008069] dark:text-[#00e676]'
                    : 'border-transparent text-[#667781] dark:text-[#8696a0] hover:text-neutral-800 dark:hover:text-white'
                }`}
              >
                <BookOpen size={13} />
                Knowledge Base (AI RAG)
              </button>
            )}
          </div>

          {settingsActiveTab === 'general' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start animate-in fade-in duration-200">
              
              {/* Left Column: Organization detail, features toggles, SMTP, Webhooks */}
              <div className="space-y-6">
                
                {/* Card: Organization Details & Contact Info */}
                <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-sm space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#00a884] flex items-center gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800">
                    <Building size={14} />
                    <span>Organization Info</span>
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                        Name
                      </label>
                      <input
                        type="text"
                        value={selectedOrgSettings.name}
                        disabled
                        className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317]/50 text-neutral-500 dark:text-[#8696a0] rounded-xl text-xs font-semibold cursor-not-allowed"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                        Slug Identifier
                      </label>
                      <input
                        type="text"
                        value={selectedOrgSettings.slug}
                        disabled
                        className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317]/50 text-neutral-500 dark:text-[#8696a0] rounded-xl text-xs font-semibold cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                        Contact Person
                      </label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884]"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                        Contact Phone
                      </label>
                      <input
                        type="text"
                        placeholder="+1..."
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      placeholder="info@org.com"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                      Address
                    </label>
                    <input
                      type="text"
                      placeholder="123 Main St, City"
                      value={contactAddress}
                      onChange={(e) => setContactAddress(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-[#e9edef] dark:border-[#202d36] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884]"
                    />
                  </div>
                </div>

                {/* Card: Feature Gateways */}
                <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-sm space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#00a884] flex items-center gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800">
                    <Sliders size={14} />
                    <span>Global Features Configuration</span>
                  </h3>
                  <p className="text-[10px] text-neutral-500 dark:text-[#8696a0] font-semibold leading-relaxed">
                    Enable or disable core functionalities. Disabling a feature hides all related menu items, pages, tabs, and buttons across the workspace in real-time.
                  </p>
                  
                  <div className="space-y-3">
                    {/* AI Copilot toggle */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                      <div className="flex flex-col gap-0.5 pr-2">
                        <span className="text-xs font-bold text-[#111b21] dark:text-white">AI Copilot & Knowledge Base</span>
                        <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-semibold leading-normal">Suggested conversation replies and scraped article RAG indexing</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleFeature('enable_ai', selectedOrgSettings.enable_ai !== false ? false : true)}
                        className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                          selectedOrgSettings.enable_ai !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                            selectedOrgSettings.enable_ai !== false ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Chat / Messaging toggle */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                      <div className="flex flex-col gap-0.5 pr-2">
                        <span className="text-xs font-bold text-[#111b21] dark:text-white">Messaging (WhatsApp & SMS)</span>
                        <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-semibold leading-normal">Live chat conversations, SMS broadcasts and templates</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleFeature('enable_messages', selectedOrgSettings.enable_messages !== false ? false : true)}
                        className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                          selectedOrgSettings.enable_messages !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                            selectedOrgSettings.enable_messages !== false ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Email Broadcast toggle */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                      <div className="flex flex-col gap-0.5 pr-2">
                        <span className="text-xs font-bold text-[#111b21] dark:text-white">Email Campaigns</span>
                        <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-semibold leading-normal">Mass broadcast email marketing and custom templates</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleFeature('enable_email', selectedOrgSettings.enable_email !== false ? false : true)}
                        className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                          selectedOrgSettings.enable_email !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                            selectedOrgSettings.enable_email !== false ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Phone Calls toggle */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34]">
                      <div className="flex flex-col gap-0.5 pr-2">
                        <span className="text-xs font-bold text-[#111b21] dark:text-white">Phone Calls & IVR</span>
                        <span className="text-[9px] text-[#667781] dark:text-[#8696a0] font-semibold leading-normal">Dynamic call flows, automated menus and logs</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleFeature('enable_phone_calls', selectedOrgSettings.enable_phone_calls !== false ? false : true)}
                        className={`w-11 h-6 rounded-full transition-colors duration-200 relative focus:outline-none cursor-pointer select-none flex-shrink-0 ${
                          selectedOrgSettings.enable_phone_calls !== false ? 'bg-[#00a884]' : 'bg-[#e9edef] dark:bg-[#2a3942]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                            selectedOrgSettings.enable_phone_calls !== false ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card: Webhooks */}
                <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold text-neutral-800 dark:text-white flex items-center gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800">
                    <Database size={14} className="text-[#00a884]" />
                    <span>Dynamic Webhook Configurations</span>
                  </h3>
                  <p className="text-[10px] text-neutral-500 dark:text-[#8696a0] leading-relaxed font-semibold">
                    Configure messaging gateway webhook triggers directly in your gateway dashboards:
                  </p>

                  {whatsappProvider === 'twilio' ? (
                    <div className="space-y-3">
                      <div>
                        <span className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase mb-1">
                          Incoming Message Webhook (Twilio)
                        </span>
                        <div className="bg-[#f0f2f5] dark:bg-[#0c1317] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                          <code className="text-xs text-[#00e676] font-mono">{webhookUrl || 'Loading dynamic webhook...'}</code>
                        </div>
                      </div>

                      <div>
                        <span className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase mb-1">
                          Status Callback Webhook (Twilio)
                        </span>
                        <div className="bg-[#f0f2f5] dark:bg-[#0c1317] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                          <code className="text-xs text-[#00e676] font-mono">
                            {webhookUrl ? `${webhookUrl}/status` : 'Loading status callback...'}
                          </code>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <span className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase mb-1">
                          Callback URL (Facebook Webhook)
                        </span>
                        <div className="bg-[#f0f2f5] dark:bg-[#0c1317] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                          <code className="text-xs text-[#00e676] font-mono">{facebookWebhookUrl || 'Loading facebook webhook...'}</code>
                        </div>
                      </div>

                      <div>
                        <span className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase mb-1">
                          Verify Token (Facebook Webhook Verification)
                        </span>
                        <div className="bg-[#f0f2f5] dark:bg-[#0c1317] px-3 py-2 rounded-lg border border-[#e9edef] dark:border-[#2a3942] select-all break-all">
                          <code className="text-xs text-[#00e676] font-mono">{selectedOrgSettings.id}</code>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Right Column: Custom Gateways (WhatsApp, SMS, Email, AI) and Save */}
              <div className="space-y-6 bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-sm">
                
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800 select-none">
                  <div className="flex items-center gap-2">
                    <Key size={16} className="text-[#00a884]" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-neutral-850 dark:text-white">Credentials & Integrations</h3>
                  </div>
                  <button
                    onClick={handleSaveCredentials}
                    disabled={savingCredentials}
                    className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white rounded-lg transition-all text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    {savingCredentials ? <Loader2 size={13} className="animate-spin" /> : null}
                    <span>Save Configuration</span>
                  </button>
                </div>

                <p className="text-[10px] text-neutral-500 dark:text-[#8696a0] leading-relaxed font-semibold">
                  Manage organization-specific credentials for external gateways. If any field is left blank, it will automatically fall back to using default environment configurations.
                </p>

                {/* WhatsApp Gateway Settings */}
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">WhatsApp Gateway</h4>
                  
                  <div className="flex flex-col gap-2">
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                      Provider Selection
                    </label>
                    <div className="flex gap-4 select-none">
                      <label className="flex items-center gap-2 text-xs font-semibold text-neutral-855 dark:text-white cursor-pointer">
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
                      <label className="flex items-center gap-2 text-xs font-semibold text-neutral-855 dark:text-white cursor-pointer">
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
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          Account SID
                        </label>
                        <input
                          type="text"
                          value={twilioAccountSid}
                          onChange={(e) => setTwilioAccountSid(e.target.value)}
                          placeholder="Twilio Account SID"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          Auth Token
                        </label>
                        <div className="relative">
                          <input
                            type={showTwilioToken ? 'text' : 'password'}
                            value={twilioAuthToken}
                            onChange={(e) => setTwilioAuthToken(e.target.value)}
                            placeholder="Twilio Auth Token"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTwilioToken(!showTwilioToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            {showTwilioToken ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          WhatsApp Sender Number
                        </label>
                        <input
                          type="text"
                          value={twilioWhatsappNumber}
                          onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                          placeholder="whatsapp:+14155238886"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          WhatsApp Cloud API Token
                        </label>
                        <div className="relative">
                          <input
                            type={showWhatsappApiToken ? 'text' : 'password'}
                            value={whatsappApiToken}
                            onChange={(e) => setWhatsappApiToken(e.target.value)}
                            placeholder="EAAG..."
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWhatsappApiToken(!showWhatsappApiToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            {showWhatsappApiToken ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                            Phone Number ID
                          </label>
                          <input
                            type="text"
                            value={whatsappPhoneNumberId}
                            onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                            placeholder="Phone Number ID"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                            Business ID
                          </label>
                          <input
                            type="text"
                            value={whatsappBusinessAccountId}
                            onChange={(e) => setWhatsappBusinessAccountId(e.target.value)}
                            placeholder="WABA ID"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                            Default Sender Phone
                          </label>
                          <input
                            type="text"
                            value={whatsappDefaultPhone}
                            onChange={(e) => setWhatsappDefaultPhone(e.target.value)}
                            placeholder="+1..."
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                            API Version
                          </label>
                          <input
                            type="text"
                            value={whatsappGraphApiVersion}
                            onChange={(e) => setWhatsappGraphApiVersion(e.target.value)}
                            placeholder="v25.0"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">SMS Gateway</h4>
                  
                  {whatsappProvider === 'facebook' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          Twilio Account SID (for SMS)
                        </label>
                        <input
                          type="text"
                          value={twilioAccountSid}
                          onChange={(e) => setTwilioAccountSid(e.target.value)}
                          placeholder="Twilio Account SID"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          Twilio Auth Token (for SMS)
                        </label>
                        <div className="relative">
                          <input
                            type={showTwilioToken ? 'text' : 'password'}
                            value={twilioAuthToken}
                            onChange={(e) => setTwilioAuthToken(e.target.value)}
                            placeholder="Twilio Auth Token"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTwilioToken(!showTwilioToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            {showTwilioToken ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                      SMS Sender Phone Number
                    </label>
                    <input
                      type="text"
                      value={twilioWhatsappNumber}
                      onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                      placeholder="e.g. +14155238886"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                    />
                  </div>
                </div>

                {/* Email Broadcast Settings */}
                <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">Email Broadcast Engine</h4>
                  
                  <div className="flex flex-col gap-2">
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                      Provider Selection
                    </label>
                    <div className="flex gap-4 select-none">
                      <label className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-white cursor-pointer">
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
                      <label className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-white cursor-pointer">
                        <input
                          type="radio"
                          name="emailProvider"
                          value="smtp"
                          checked={emailProvider === 'smtp'}
                          onChange={() => setEmailProvider('smtp')}
                          className="accent-[#00a884]"
                        />
                        Custom SMTP
                      </label>
                    </div>
                  </div>

                  {emailProvider === 'sendgrid' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          Sendgrid API Key
                        </label>
                        <div className="relative">
                          <input
                            type={showSgKey ? 'text' : 'password'}
                            value={sendgridApiKey}
                            onChange={(e) => setSendgridApiKey(e.target.value)}
                            placeholder="SG..."
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSgKey(!showSgKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            {showSgKey ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          Verified From Email
                        </label>
                        <input
                          type="email"
                          value={sendgridFromEmail}
                          onChange={(e) => setSendgridFromEmail(e.target.value)}
                          placeholder="info@yourdomain.com"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                          <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                            SMTP Host
                          </label>
                          <input
                            type="text"
                            value={smtpHost}
                            onChange={(e) => setSmtpHost(e.target.value)}
                            placeholder="smtp.gmail.com"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                            SMTP Port
                          </label>
                          <input
                            type="text"
                            value={smtpPort}
                            onChange={(e) => setSmtpPort(e.target.value)}
                            placeholder="465"
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          SMTP Username / Email
                        </label>
                        <input
                          type="email"
                          value={smtpEmail}
                          onChange={(e) => setSmtpEmail(e.target.value)}
                          placeholder="user@yourdomain.com"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                          SMTP Password
                        </label>
                        <div className="relative">
                          <input
                            type={showSmtpPassword ? 'text' : 'password'}
                            value={smtpPassword}
                            onChange={(e) => setSmtpPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                          >
                            {showSmtpPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Assistant Settings */}
                <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">AI Assistant Engine</h4>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                      OpenAI API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showOpenaiKey ? 'text' : 'password'}
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-proj-..."
                        className="w-full pl-3.5 pr-10 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                      >
                        {showOpenaiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1">
                      AI Chatbot Base Prompt (System Prompt)
                    </label>
                    <textarea
                      rows={6}
                      value={chatbotBasePrompt}
                      onChange={(e) => setChatbotBasePrompt(e.target.value)}
                      placeholder="You are a helpful customer support agent representing our company..."
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white resize-y"
                    />
                  </div>
                </div>

              </div>

            </div>
          )}

          {settingsActiveTab === 'knowledge' && (
            <div className="space-y-6 max-w-4xl animate-in fade-in duration-200">

              {/* Add FAQ panel */}
              <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <FileText size={20} className="text-[#00a884]" />
                  <h2 className="text-base font-bold text-neutral-850 dark:text-white">Add Manual FAQ / Policy</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                      Question or Title
                    </label>
                    <input
                      type="text"
                      value={manualTitle}
                      onChange={e => setManualTitle(e.target.value)}
                      placeholder="e.g. What is the fee for passport renewal?"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                      Answer or Content
                    </label>
                    <textarea
                      rows={4}
                      value={manualContent}
                      onChange={e => setManualContent(e.target.value)}
                      placeholder="e.g. The standard passport renewal fee is $130..."
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white resize-y"
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
              <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#1f2c34] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold text-neutral-850 dark:text-white">Indexed Knowledge Base</h3>
                    <span className="text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] bg-[#f0f2f5] dark:bg-[#111b21] border border-neutral-200 dark:border-[#2a3942] px-2.5 py-0.5 rounded-full">
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
                        <tr className="border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#1f2c34] text-[9px] font-black uppercase tracking-wider text-neutral-500 dark:text-[#8696a0]">
                          <th className="px-6 py-3">Question</th>
                          <th className="px-6 py-3">Answer Preview</th>
                          <th className="px-6 py-3">Indexed Date</th>
                          <th className="px-6 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedArticles.map((art) => (
                          <tr key={art.id} className="border-b border-neutral-100 dark:border-neutral-800 last:border-b-0 hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 transition-colors">
                            <td className="px-6 py-3.5 font-bold text-neutral-850 dark:text-white max-w-xs">
                              <p className="truncate">{art.title}</p>
                            </td>
                            <td className="px-6 py-3.5 text-neutral-500 dark:text-[#8696a0] font-medium text-[10px] max-w-sm">
                              <p className="line-clamp-2 whitespace-normal">{art.content?.substring(0, 120)}{art.content?.length > 120 ? '...' : ''}</p>
                            </td>
                            <td className="px-6 py-3.5 text-neutral-500 dark:text-[#8696a0] font-medium">
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
                      <div className="px-6 py-4 border-t border-neutral-150 dark:border-neutral-800 bg-[#f0f2f5] dark:bg-[#1f2c34]/20 flex items-center justify-between select-none text-[11px] text-neutral-500 dark:text-[#8696a0]">
                        <div className="font-semibold">
                          Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, articles.length)} of {articles.length} items
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 border border-neutral-200 dark:border-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 disabled:opacity-50 text-neutral-800 dark:text-white rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed font-bold"
                          >
                            <ChevronLeft size={12} />
                            <span>Previous</span>
                          </button>
                          <span className="font-bold text-neutral-800 dark:text-white px-2">
                            Page {currentPage} of {totalPages}
                          </span>
                          <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 border border-neutral-200 dark:border-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 disabled:opacity-50 text-neutral-800 dark:text-white rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed font-bold"
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
        </div>
      )}

      {/* TAB CONTENT: USER & MANAGER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="bg-white/95 dark:bg-[#111b21] border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl p-6 shadow-sm space-y-5">
          
          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
            
            {/* Search inputs */}
            <div className="flex items-center gap-3 w-full sm:w-auto flex-1 max-w-xl">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3.5 top-3.5 text-neutral-400 dark:text-[#8696a0]" />
                <input
                  type="text"
                  placeholder="Search system users by name or email..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                />
              </div>

              {/* Organization filter dropdown */}
              <div className="w-52">
                <select
                  value={userOrgFilter}
                  onChange={(e) => setUserOrgFilter(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-bold focus:outline-none text-neutral-800 dark:text-white cursor-pointer"
                >
                  <option value="all">All Organizations</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            </div>

          </div>

          {/* User profiles Table */}
          {loadingUsers ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="animate-spin text-[#00a884]" size={24} />
              <span className="text-xs text-neutral-400 dark:text-[#8696a0] font-semibold">Retrieving users database...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-16 text-xs text-neutral-400 dark:text-[#8696a0] font-semibold">
              No users match the search terms.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-neutral-200/80 dark:border-neutral-800/80 text-neutral-400 dark:text-[#8696a0] font-bold">
                    <th className="py-3 px-4">Full Name</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Assigned Tenant</th>
                    <th className="py-3 px-4">Role Permission</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-neutral-50/50 dark:hover:bg-[#1f2c34]/20 transition-all">
                      <td className="py-4 px-4 font-bold text-neutral-800 dark:text-white">
                        {user.full_name || '—'}
                      </td>
                      <td className="py-4 px-4 font-semibold text-neutral-500 dark:text-neutral-300">
                        {user.email}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1.5">
                          <Building size={12} className="text-neutral-400" />
                          <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                            {user.organization?.name || 'Isolated tenant'}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${
                          user.role === 'superadmin' 
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' 
                            : user.role === 'OrgAdmin'
                            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                            : user.role === 'Manager'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right space-x-1">
                        <button
                          onClick={() => setEditingUser(user)}
                          className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-[#202d36] dark:hover:bg-[#2a3942] text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
                          title="Edit User Details"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 transition-colors cursor-pointer"
                          title="Delete User"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL: ADD ORGANIZATION */}
      {showOrgModal && (
        <div className="fixed inset-0 bg-neutral-900/60 dark:bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 backdrop-blur-sm select-none">
          <div className="bg-white dark:bg-[#111b21] rounded-3xl max-w-lg w-full border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-200/80 dark:border-[#202d36] pb-3">
              <div>
                <h3 className="text-xs font-black text-neutral-800 dark:text-white uppercase tracking-wider">
                  Create Organization
                </h3>
                <span className="text-[9px] text-neutral-400 dark:text-[#8696a0] font-bold mt-1 block">
                  Fill in the basic and contact information below.
                </span>
              </div>
              <button 
                onClick={() => setShowOrgModal(false)}
                className="text-[#667781] hover:text-[#111b21] dark:hover:text-white p-1 rounded-full hover:bg-white dark:hover:bg-[#2a3942] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateOrg} className="space-y-4 animate-in fade-in duration-200">
              {/* Name & Slug */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                    Organization Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme Corporation"
                    value={orgForm.name}
                    onChange={(e) => handleOrgNameChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                    Slug Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="acme-corp"
                    value={orgForm.slug}
                    onChange={(e) => setOrgForm({ ...orgForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '') })}
                    className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Contact Name & Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={orgForm.contact_name}
                    onChange={(e) => setOrgForm({ ...orgForm, contact_name: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    placeholder="+1..."
                    value={orgForm.contact_phone}
                    onChange={(e) => setOrgForm({ ...orgForm, contact_phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Contact Email */}
              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Contact Email Address
                </label>
                <input
                  type="email"
                  placeholder="contact@acme.com"
                  value={orgForm.contact_email}
                  onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                />
              </div>

              {/* Address */}
              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Address
                </label>
                <input
                  type="text"
                  placeholder="123 Corporate Way, Suite 100"
                  value={orgForm.contact_address}
                  onChange={(e) => setOrgForm({ ...orgForm, contact_address: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submittingOrg || !orgForm.name || !orgForm.slug}
                  className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008069] disabled:bg-neutral-300 dark:disabled:bg-neutral-700 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/10 active:scale-[0.98]"
                >
                  {submittingOrg ? <Loader2 size={14} className="animate-spin text-neutral-400" /> : <Check size={14} />}
                  <span>Save & Create Org</span>
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL: RENAME ORGANIZATION */}
      {editingOrg && (
        <div className="fixed inset-0 bg-neutral-900/60 dark:bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 backdrop-blur-sm select-none">
          <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] rounded-3xl max-w-md w-full border border-neutral-200 dark:border-[#2a3942] p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-[#2a3942] pb-3">
              <h3 className="text-xs font-black text-neutral-800 dark:text-white uppercase tracking-wider">
                Edit Organization Details
              </h3>
              <button 
                onClick={() => setEditingOrg(null)}
                className="text-[#667781] hover:text-[#111b21] dark:hover:text-white p-1 rounded-full hover:bg-white dark:hover:bg-[#2a3942] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUpdateOrgDetails} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Organization Name
                </label>
                <input
                  type="text"
                  required
                  value={editingOrg.name}
                  onChange={(e) => setEditingOrg({ ...editingOrg, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Slug
                </label>
                <input
                  type="text"
                  required
                  value={editingOrg.slug}
                  onChange={(e) => setEditingOrg({ ...editingOrg, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '') })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submittingOrg}
                className="w-full mt-2 py-3 bg-[#00a884] hover:bg-[#008069] disabled:bg-neutral-300 dark:disabled:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-[0.98]"
              >
                {submittingOrg ? <Loader2 size={14} className="animate-spin text-neutral-400" /> : <Check size={14} />}
                <span>Save Changes</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD USER / MANAGER */}
      {showUserModal && (
        <div className="fixed inset-0 bg-neutral-900/60 dark:bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 backdrop-blur-sm select-none">
          <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] rounded-3xl max-w-md w-full border border-neutral-200 dark:border-[#2a3942] p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-[#2a3942] pb-3">
              <h3 className="text-xs font-black text-neutral-800 dark:text-white uppercase tracking-wider">
                Add New Manager / User
              </h3>
              <button 
                onClick={() => setShowUserModal(false)}
                className="text-[#667781] hover:text-[#111b21] dark:hover:text-white p-1 rounded-full hover:bg-white dark:hover:bg-[#2a3942] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3">
              
              <div className="space-y-1">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Organization Assignment
                </label>
                <select
                  required
                  value={userForm.organizationId}
                  onChange={(e) => setUserForm({ ...userForm, organizationId: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-bold focus:outline-none text-neutral-800 dark:text-white cursor-pointer"
                >
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={userForm.fullName}
                  onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@organization.com"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Temporary Password
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3.5 top-3 text-neutral-400 hover:text-neutral-600 cursor-pointer"
                  >
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  System Role
                </label>
                <select
                  required
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-bold focus:outline-none text-neutral-800 dark:text-white cursor-pointer"
                >
                  {rolesList.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={submittingUser}
                className="w-full mt-3 py-3 bg-[#00a884] hover:bg-[#008069] disabled:bg-neutral-300 dark:disabled:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-[0.98]"
              >
                {submittingUser ? <Loader2 size={14} className="animate-spin text-neutral-400" /> : <Check size={14} />}
                <span>Create User Profile</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER PROFILE */}
      {editingUser && (
        <div className="fixed inset-0 bg-neutral-900/60 dark:bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 backdrop-blur-sm select-none">
          <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] rounded-3xl max-w-md w-full border border-neutral-200 dark:border-[#2a3942] p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-[#2a3942] pb-3">
              <h3 className="text-xs font-black text-neutral-800 dark:text-white uppercase tracking-wider">
                Edit User Details
              </h3>
              <button 
                onClick={() => setEditingUser(null)}
                className="text-[#667781] hover:text-[#111b21] dark:hover:text-white p-1 rounded-full hover:bg-white dark:hover:bg-[#2a3942] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Organization Assignment
                </label>
                <select
                  required
                  value={editingUser.organization_id}
                  onChange={(e) => setEditingUser({ ...editingUser, organization_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-bold focus:outline-none text-neutral-800 dark:text-white cursor-pointer"
                >
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editingUser.full_name || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-semibold focus:outline-none focus:border-[#00a884] text-neutral-800 dark:text-white shadow-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider">
                  System Role
                </label>
                <select
                  required
                  value={editingUser.role}
                  onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 dark:border-[#202d36] bg-white dark:bg-[#0c1317] rounded-xl text-xs font-bold focus:outline-none text-neutral-800 dark:text-white cursor-pointer"
                >
                  {rolesList.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={submittingUser}
                className="w-full mt-2 py-3 bg-[#00a884] hover:bg-[#008069] disabled:bg-neutral-300 dark:disabled:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-[0.98]"
              >
                {submittingUser ? <Loader2 size={14} className="animate-spin text-neutral-400" /> : <Check size={14} />}
                <span>Save Changes</span>
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
