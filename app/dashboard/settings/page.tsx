'use client'

import { CopyPhoneButton } from '@/components/ui/copy-phone-button'
import { WhatsAppEmbeddedSignup } from '@/components/whatsapp-embedded-signup'

import { useEffect, useState, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { useConfirm } from '@/lib/dialog-context'
import { User, Organization } from '@/lib/types'
import { getRoleDisplay, ASSIGNABLE_ROLES, canManageTeam, isManager } from '@/lib/rbac'
import { Key, Bell, Lock, BookOpen, FileText, Trash2, Plus, Loader2, Eye, EyeOff, Upload, ChevronLeft, ChevronRight, Users, Sun, Moon, Shield, UserCheck, UserX, Search, Edit2, Tags, Pencil, X, Download, Mail, Check, Copy, Server, Settings as SettingsIcon, Building2, User as UserIcon, Globe, LifeBuoy, Sparkles, MessageCircle, Phone, Palette } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import * as XLSX from 'xlsx'

type SettingsTab = 'general' | 'knowledge' | 'teammates' | 'appearance'

// ── Shared styles: defined once so every section looks and focuses the same ──
const cardClass =
  'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,20,26,0.05)]'
const labelInlineClass =
  'block text-[11px] font-semibold text-[#54656f] dark:text-[#8696a0] uppercase tracking-wide'
const labelClass = `${labelInlineClass} mb-1.5`
const inputClass =
  'w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#d1d7db] dark:border-[#2a3942] rounded-lg text-[13px] font-medium text-[#111b21] dark:text-white placeholder:text-[#8696a0] transition-shadow focus:outline-none focus:border-[#00a884] focus:ring-2 focus:ring-[#00a884]/20'
const secretInputClass = `${inputClass} pr-10`
const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 bg-[#008069] hover:bg-[#006d59] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer whitespace-nowrap'
const secondaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 bg-white dark:bg-[#1f2c34] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] border border-[#d1d7db] dark:border-[#2a3942] text-[#111b21] dark:text-white rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap'

/** Card heading: icon chip, title, optional description and a right-aligned action. */
function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-9 w-9 shrink-0 rounded-xl bg-[#00a884]/10 text-[#008069] dark:text-[#00e676] flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold leading-tight text-[#111b21] dark:text-white">{title}</h2>
          {description && (
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00a884] ${
        checked ? 'bg-[#00a884]' : 'bg-[#d1d7db] dark:bg-[#2a3942]'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

/** A feature switch with its icon, name and one-line explanation. */
function FeatureRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: LucideIcon
  title: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-[#f8f9fa] dark:bg-[#1f2c34]/60">
      <div
        className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center transition-colors ${
          checked
            ? 'bg-[#00a884]/10 text-[#008069] dark:text-[#00e676]'
            : 'bg-[#e9edef] dark:bg-[#2a3942] text-[#8696a0]'
        }`}
      >
        <Icon size={17} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-[#111b21] dark:text-white">{title}</p>
        <p className="text-[11px] text-[#667781] dark:text-[#8696a0] leading-relaxed">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

/** Read-only detail shown as plain text instead of a greyed-out input. */
function ReadOnlyField({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className={labelInlineClass}>{label}</dt>
      <dd
        className={`mt-1.5 text-[13px] font-semibold text-[#111b21] dark:text-white truncate ${mono ? 'font-mono' : ''}`}
        title={value || undefined}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

export default function SettingsPage() {
  const confirm = useConfirm()
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const isMasterOrg = organization?.id === '303b7a2d-281c-403c-b794-54d1e195ca69'
  const [loading, setLoading] = useState(true)
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState('')

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
  const [currency, setCurrency] = useState('USD')
  const [ticketEmailEnabled, setTicketEmailEnabled] = useState(false)
  const [ticketEmailRecipients, setTicketEmailRecipients] = useState<string[]>([])

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (storedTheme) {
      setTheme(storedTheme)
    }
  }, [])

  const toggleTheme = (nextTheme: 'light' | 'dark') => {
    setTheme(nextTheme)
    localStorage.setItem('theme', nextTheme)
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    window.dispatchEvent(new Event('theme-changed'))
  }
  const [articles, setArticles] = useState<any[]>([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [editingArticle, setEditingArticle] = useState<any | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [ragSearchQuery, setRagSearchQuery] = useState('')

  // Reset page when RAG search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [ragSearchQuery])

  // Teammates management state
  const [teammates, setTeammates] = useState<any[]>([])
  const [loadingTeammates, setLoadingTeammates] = useState(false)
  const [addingTeammate, setAddingTeammate] = useState(false)
  const [teammateForm, setTeammateForm] = useState({
    email: '',
    fullName: '',
    role: 'agent'
  })
  const [teammateError, setTeammateError] = useState('')
  const [teammateSuccess, setTeammateSuccess] = useState('')

  // Service Synonyms State
  type SynonymGroup = { canonical: string; aliases: string[] }
  const [synonymGroups, setSynonymGroups] = useState<SynonymGroup[]>([])
  const [loadingSynonyms, setLoadingSynonyms] = useState(false)
  const [savingSynonyms, setSavingSynonyms] = useState(false)
  const [synonymModalOpen, setSynonymModalOpen] = useState(false)
  const [editingSynonymIndex, setEditingSynonymIndex] = useState<number | null>(null)
  const [synonymFormCanonical, setSynonymFormCanonical] = useState('')
  const [synonymFormAliases, setSynonymFormAliases] = useState<string[]>([])
  const [synonymAliasInput, setSynonymAliasInput] = useState('')

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

  // Export Environment Variables (.env) State
  const [exportEnvEmail, setExportEnvEmail] = useState('tejachennu17@gmail.com')
  const [isExportingEnv, setIsExportingEnv] = useState(false)
  const [exportEnvResult, setExportEnvResult] = useState<{
    success: boolean
    emailed: boolean
    recipient?: string
    varCount?: number
    envText?: string
    message?: string
  } | null>(null)
  const [copiedEnv, setCopiedEnv] = useState(false)
  const [showEnvPreview, setShowEnvPreview] = useState(false)

  async function handleExportEnvEmail() {
    if (!exportEnvEmail.trim()) {
      showNotification('error', 'Please enter a valid destination email address.', 'Export Error')
      return
    }
    setIsExportingEnv(true)
    try {
      const res = await fetch('/api/settings/export-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: exportEnvEmail.trim() }),
      })
      const data = await res.json()
      setExportEnvResult(data.success ? data : null)
      if (data.success) {
        if (data.emailed) {
          showNotification('success', `Environment variables (.env) sent to ${data.recipient}! (${data.varCount} variables found)`, 'Export Sent')
        } else {
          showNotification('info', `Variables extracted (${data.varCount} keys), but email could not be sent: ${data.message || 'SMTP not configured'}. You can download or copy them below!`, 'Variables Ready')
        }
      } else {
        showNotification('error', data.error || 'Failed to export environment variables', 'Export Failed')
      }
    } catch (err: any) {
      console.error('Export ENV error:', err)
      showNotification('error', err.message || 'Failed to export environment variables', 'Export Error')
    } finally {
      setIsExportingEnv(false)
    }
  }

  async function handleDownloadEnv() {
    try {
      // Fetched (not opened in a new tab) so the request carries the session token
      const res = await fetch('/api/settings/export-env?download=true')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to download environment variables')
      }
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = '.env.local'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to download environment variables', 'Download Failed')
    }
  }

  async function handleCopyEnv() {
    if (exportEnvResult?.envText) {
      await navigator.clipboard.writeText(exportEnvResult.envText)
      setCopiedEnv(true)
      showNotification('success', 'Environment variables copied to clipboard!', 'Copied')
      setTimeout(() => setCopiedEnv(false), 3000)
      return
    }

    setIsExportingEnv(true)
    try {
      const res = await fetch('/api/settings/export-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: exportEnvEmail.trim() }),
      })
      const data = await res.json()
      setExportEnvResult(data.success ? data : null)
      if (data.envText) {
        await navigator.clipboard.writeText(data.envText)
        setCopiedEnv(true)
        showNotification('success', `Copied ${data.varCount} environment variables to clipboard!`, 'Copied')
        setTimeout(() => setCopiedEnv(false), 3000)
      } else {
        showNotification('error', data.error || 'No environment variables found', 'Copy Failed')
      }
    } catch (err: any) {
      showNotification('error', 'Failed to fetch environment variables', 'Error')
    } finally {
      setIsExportingEnv(false)
    }
  }

  useEffect(() => {
    if (user?.organization_id) {
      loadTeammates(user.organization_id)
      if (activeTab === 'knowledge') {
        loadArticles(user.organization_id)
        loadSynonyms(user.organization_id)
      }
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
          fullName: teammateForm.fullName.trim(),
          role: teammateForm.role,
          organizationId: user.organization_id
        })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add teammate')
      }
      setTeammateSuccess('Teammate successfully added and invitation email sent!')
      setTeammateForm({
        email: '',
        fullName: '',
        role: 'agent'
      })
      showNotification('success', 'Teammate added and invitation email sent!', 'Teammate Added')
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
    if (!(await confirm({ title: 'Remove this teammate?', message: 'They will no longer be able to log in.', confirmLabel: 'Remove', destructive: true }))) return

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

  async function handleToggleTeammatePermission(teammateId: string, field: 'see_all' | 'read_only', currentVal: boolean) {
    if (!user?.organization_id) return
    const newVal = !currentVal
    try {
      const res = await fetch('/api/teammates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: teammateId,
          organizationId: user.organization_id,
          [field === 'see_all' ? 'seeAll' : 'readOnly']: newVal
        })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update teammate permission')
      }

      setTeammates(prev => prev.map(member =>
        member.id === teammateId
          ? { ...member, [field]: newVal }
          : member
      ))

      showNotification('success', 'Teammate permissions updated successfully.', 'Permissions Updated')
    } catch (err: any) {
      console.error('Update teammate permission error:', err)
      showNotification('error', err.message || 'Failed to update teammate permission.', 'Update Failed')
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
    if (!user) return
    if (!(await confirm({ title: 'Delete this article?', message: 'It will be removed from the AI search index.', confirmLabel: 'Delete', destructive: true }))) return
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

  async function handleSaveEdit() {
    if (!editingArticle || !editTitle.trim() || !editContent.trim() || !user) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/knowledge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingArticle.id,
          title: editTitle.trim(),
          content: editContent.trim()
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update FAQ')
      setEditingArticle(null)
      setEditTitle('')
      setEditContent('')
      showNotification('success', 'FAQ successfully updated in knowledge base!', 'FAQ Updated')
      await loadArticles(user.organization_id)
    } catch (err: any) {
      console.error('Update FAQ error:', err)
      showNotification('error', err.message || 'Failed to update FAQ.', 'Error Updating FAQ')
    } finally {
      setActionLoading(false)
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
        setWhatsappProvider(orgData.id === '303b7a2d-281c-403c-b794-54d1e195ca69' ? (orgData.whatsapp_provider || 'twilio') : 'facebook')
        setWhatsappApiToken(orgData.whatsapp_api_token || '')
        setWhatsappDefaultPhone(orgData.whatsapp_default_phone || '')
        setWhatsappGraphApiVersion(orgData.whatsapp_graph_api_version || 'v25.0')
        setWhatsappPhoneNumberId(orgData.whatsapp_phone_number_id || '')
        setWhatsappBusinessAccountId(orgData.whatsapp_business_account_id || '')
        setCurrency(orgData.currency || 'USD')
        setTicketEmailEnabled(orgData.ticket_email_enabled === true)
        setTicketEmailRecipients(orgData.ticket_email_recipients || [])
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
          currency: currency,
          ticket_email_enabled: ticketEmailEnabled,
          ticket_email_recipients: ticketEmailRecipients,
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
        currency: currency,
        ticket_email_enabled: ticketEmailEnabled,
        ticket_email_recipients: ticketEmailRecipients,
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

  const filteredArticles = articles.filter(art => {
    const query = ragSearchQuery.toLowerCase().trim()
    if (!query) return true
    return (
      (art.title?.toLowerCase() || '').includes(query) ||
      (art.content?.toLowerCase() || '').includes(query)
    )
  })

  const totalPages = Math.ceil(filteredArticles.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedArticles = filteredArticles.slice(startIndex, startIndex + itemsPerPage)

  // ── Service Synonyms CRUD ──────────────────────────────────
  async function loadSynonyms(orgId: string) {
    setLoadingSynonyms(true)
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('service_synonyms')
        .eq('id', orgId)
        .maybeSingle()
      if (error) throw error
      setSynonymGroups((data?.service_synonyms as SynonymGroup[]) || [])
    } catch (err) {
      console.error('Failed to load service synonyms:', err)
      showNotification('error', 'Failed to load service synonyms.', 'Load Failed')
    } finally {
      setLoadingSynonyms(false)
    }
  }

  async function saveSynonyms(updated: SynonymGroup[]) {
    if (!organization) return
    setSavingSynonyms(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ service_synonyms: updated })
        .eq('id', organization.id)
      if (error) throw error
      setSynonymGroups(updated)
      showNotification('success', 'Service synonyms updated successfully.', 'Synonyms Saved')
    } catch (err: any) {
      console.error('Failed to save synonyms:', err)
      showNotification('error', err.message || 'Failed to save synonyms.', 'Save Failed')
    } finally {
      setSavingSynonyms(false)
    }
  }

  async function triggerReEmbed(changedGroup?: SynonymGroup, oldGroup?: SynonymGroup) {
    if (!organization) return
    try {
      showNotification('info', 'Updating affected article embeddings in the background...', 'Syncing Embeddings')
      const res = await fetch('/api/knowledge/re-embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          organizationId: organization.id,
          changedGroup,
          oldGroup
        })
      })

      if (!res.ok) {
        throw new Error(await res.text())
      }

      const data = await res.json()
      if (data.success) {
        if (data.total > 0) {
          showNotification(
            'success',
            `Successfully re-embedded ${data.updated} article(s) matching "${changedGroup?.canonical || oldGroup?.canonical}".`,
            'Sync Complete'
          )
        } else {
          console.log('[Re-Embed] No articles affected by synonym change.')
        }
      }
    } catch (err: any) {
      console.error('Failed to trigger background re-embedding:', err)
      showNotification(
        'error',
        'Could not update all vector embeddings. New synonyms might take a while to match.',
        'Sync Delayed'
      )
    }
  }

  function openAddSynonymModal() {
    setEditingSynonymIndex(null)
    setSynonymFormCanonical('')
    setSynonymFormAliases([])
    setSynonymAliasInput('')
    setSynonymModalOpen(true)
  }

  function openEditSynonymModal(index: number) {
    const group = synonymGroups[index]
    setEditingSynonymIndex(index)
    setSynonymFormCanonical(group.canonical)
    setSynonymFormAliases([...group.aliases])
    setSynonymAliasInput('')
    setSynonymModalOpen(true)
  }

  function handleSynonymAliasKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addAliasFromInput()
    }
  }

  function addAliasFromInput() {
    const raw = synonymAliasInput
    const tags = raw.split(',').map(s => s.trim()).filter(Boolean)
    const unique = tags.filter(t => !synonymFormAliases.some(a => a.toLowerCase() === t.toLowerCase()))
    if (unique.length > 0) {
      setSynonymFormAliases(prev => [...prev, ...unique])
    }
    setSynonymAliasInput('')
  }

  function removeAlias(idx: number) {
    setSynonymFormAliases(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSaveSynonymForm() {
    const canonical = synonymFormCanonical.trim()
    if (!canonical) return
    // Flush any remaining text in alias input
    const remaining = synonymAliasInput.split(',').map(s => s.trim()).filter(Boolean)
    const allAliases = [...synonymFormAliases, ...remaining.filter(t => !synonymFormAliases.some(a => a.toLowerCase() === t.toLowerCase()))]

    const entry: SynonymGroup = { canonical, aliases: allAliases }
    let updated: SynonymGroup[]
    if (editingSynonymIndex !== null) {
      updated = synonymGroups.map((g, i) => (i === editingSynonymIndex ? entry : g))
    } else {
      updated = [...synonymGroups, entry]
    }
    await saveSynonyms(updated)
    setSynonymModalOpen(false)
    triggerReEmbed(entry)
  }

  async function handleDeleteSynonym(index: number) {
    if (!(await confirm({ title: 'Delete this synonym group?', message: 'The AI will stop treating these terms as equivalent.', confirmLabel: 'Delete', destructive: true }))) return
    const oldGroup = synonymGroups[index]
    const updated = synonymGroups.filter((_, i) => i !== index)
    await saveSynonyms(updated)
    triggerReEmbed(undefined, oldGroup)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]"></div>
      </div>
    )
  }

  const settingsTabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    ...(organization?.enable_ai !== false
      ? [{ id: 'knowledge' as const, label: 'Knowledge Base', icon: BookOpen }]
      : []),
    { id: 'teammates', label: 'Teammates', icon: Users },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ]

  return (
    <div className="p-4 pb-20 md:pb-6 md:p-6 font-sans h-full bg-[#f0f2f5] dark:bg-[#0b141a] text-[#111b21] dark:text-[#e9edef] overflow-y-auto space-y-5 relative">
      {notification && (
        <div role="status" aria-live="polite" className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl animate-in slide-in-from-top-4 duration-300 max-w-sm w-[calc(100%-2rem)]" style={{ borderLeft: `4px solid ${notification.type === 'success' ? '#00a884' : notification.type === 'error' ? '#ef4444' : '#3b82f6'}` }}>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <h4 className="text-xs font-bold text-[#111b21] dark:text-white mb-1">{notification.title}</h4>
            )}
            <p className="text-xs text-[#54656f] dark:text-[#aebac1] leading-relaxed whitespace-pre-line">
              {notification.message}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotification(null)}
            className="text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] p-1 rounded-full cursor-pointer transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="select-none flex items-center gap-3 w-full max-w-6xl mx-auto">
        <div className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-tr from-[#008069] to-[#00a884] text-white flex items-center justify-center shadow-sm">
          <SettingsIcon size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111b21] dark:text-white">Settings</h1>
          <p className="text-xs sm:text-[13px] text-[#667781] dark:text-[#8696a0] mt-0.5">Configure your CRM, AI knowledge base, and integrations</p>
        </div>
      </div>

      {/* Tabs: stay pinned while the page scrolls */}
      <div className="sticky top-0 z-20 -mx-4 px-4 md:-mx-6 md:px-6 py-2 bg-[#f0f2f5]/90 dark:bg-[#0b141a]/90 backdrop-blur-sm">
        <div className="w-full max-w-6xl mx-auto">
          <div
            role="tablist"
            aria-label="Settings sections"
            className="inline-flex max-w-full overflow-x-auto no-scrollbar gap-1 p-1 rounded-xl bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#202d36] shadow-[0_1px_2px_rgba(11,20,26,0.05)]"
          >
            {settingsTabs.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(id)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#008069] text-white shadow-sm'
                      : 'text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {activeTab === 'general' && (
        <div className="space-y-5 w-full max-w-6xl mx-auto">
          {/* Organization & Account: read-only details, shown side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className={cardClass}>
              <SectionHeader icon={Building2} title="Organization" description="Your workspace identity." />
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ReadOnlyField label="Organization Name" value={organization?.name} />
                <ReadOnlyField label="Organization Slug" value={organization?.slug} mono />
              </dl>
            </section>

            <section className={cardClass}>
              <SectionHeader icon={UserIcon} title="Account" description="The user you are signed in as." />
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ReadOnlyField label="Full Name" value={user?.full_name} />
                <ReadOnlyField label="Email" value={user?.email} />
                <div className="sm:col-span-2 min-w-0">
                  <dt className={labelInlineClass}>Role</dt>
                  <dd className="mt-1.5 flex flex-wrap items-center gap-2">
                    {user?.role ? (
                      <>
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${getRoleDisplay(user.role).bg} ${getRoleDisplay(user.role).color} ${getRoleDisplay(user.role).border}`}>
                          {getRoleDisplay(user.role).label}
                        </span>
                        <span className="text-xs text-[#667781] dark:text-[#8696a0]">{getRoleDisplay(user.role).description}</span>
                      </>
                    ) : (
                      <span className="text-[13px] font-semibold text-[#111b21] dark:text-white">—</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          {/* Global Features Configuration */}
          <section className={cardClass}>
            <SectionHeader
              icon={Sparkles}
              title="Features"
              description="Turn core functionality on or off. A disabled feature hides its menu items, pages, tabs and buttons across the workspace immediately."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FeatureRow
                icon={Sparkles}
                title="AI Copilot & Knowledge Base"
                description="Suggested conversation replies and scraped article indexing"
                checked={organization?.enable_ai !== false}
                onChange={() => handleToggleFeature('enable_ai', organization?.enable_ai !== false ? false : true)}
              />
              <FeatureRow
                icon={MessageCircle}
                title={isMasterOrg ? 'Messaging (WhatsApp & SMS)' : 'WhatsApp Messaging'}
                description={isMasterOrg ? 'Live chat conversations, SMS broadcasts and approved templates' : 'Live chat conversations and approved templates'}
                checked={organization?.enable_messages !== false}
                onChange={() => handleToggleFeature('enable_messages', organization?.enable_messages !== false ? false : true)}
              />
              {isMasterOrg && (
                <FeatureRow
                  icon={Mail}
                  title="Email Campaigns"
                  description="Mass broadcast email marketing and custom message body templates"
                  checked={organization?.enable_email !== false}
                  onChange={() => handleToggleFeature('enable_email', organization?.enable_email !== false ? false : true)}
                />
              )}
              {isMasterOrg && (
                <FeatureRow
                  icon={Phone}
                  title="Phone Calls & IVR"
                  description="Dynamic call flows, automated response menus and call logs"
                  checked={organization?.enable_phone_calls !== false}
                  onChange={() => handleToggleFeature('enable_phone_calls', organization?.enable_phone_calls !== false ? false : true)}
                />
              )}
            </div>
          </section>

          {/* Regional Preferences */}
          <section className={cardClass}>
            <SectionHeader
              icon={Globe}
              title="Regional Preferences"
              description="Used for formatting values in the Sales Pipeline and Analytics."
              action={
                <button type="button" onClick={handleSaveCredentials} disabled={savingCredentials} className={primaryButtonClass}>
                  {savingCredentials ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>Save Preferences</span>
                </button>
              }
            />
            <div className="max-w-xs">
              <label htmlFor="settings-currency" className={labelClass}>
                Currency
              </label>
              <select
                id="settings-currency"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </section>

          {/* Ticket Email Notifications */}
          {isMasterOrg && (
            <section className={cardClass}>
              <SectionHeader
                icon={Bell}
                title="Ticket Email Notifications"
                description="Automated email alerts when new customer support tickets are opened."
                action={
                  <button type="button" onClick={handleSaveCredentials} disabled={savingCredentials} className={primaryButtonClass}>
                    {savingCredentials ? <Loader2 size={13} className="animate-spin" /> : null}
                    <span>Save Notifications</span>
                  </button>
                }
              />

              <FeatureRow
                icon={Mail}
                title="Enable Ticket Alert Emails"
                description="Sends an email alert containing ticket details, contact info, and a quick dashboard link"
                checked={ticketEmailEnabled}
                onChange={() => setTicketEmailEnabled(!ticketEmailEnabled)}
              />

              {ticketEmailEnabled && (
                <div className="mt-4 space-y-3 animate-in fade-in duration-200">
                  <label className={labelInlineClass}>
                    Notification Recipients
                  </label>
                  <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold">Select which organization members should receive email notifications:</p>

                  {teammates.length === 0 ? (
                    <div className="text-xs text-[#667781] dark:text-[#8696a0] py-2 italic font-semibold">
                      No active teammates found. Please add team members in the "Teammates" tab first.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-3 bg-[#f8f9fa] dark:bg-[#0b0f19] space-y-3">
                      {teammates.map((member) => {
                        const isChecked = ticketEmailRecipients.includes(member.id)
                        return (
                          <label key={member.id} className="flex items-center gap-3 text-xs font-semibold text-[#111b21] dark:text-white cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setTicketEmailRecipients([...ticketEmailRecipients, member.id])
                                } else {
                                  setTicketEmailRecipients(ticketEmailRecipients.filter(id => id !== member.id))
                                }
                              }}
                              className="rounded border-[#e9edef] dark:border-[#2a3942] text-[#00a884] focus:ring-[#00a884] accent-[#00a884] h-4 w-4"
                            />
                            <div className="flex flex-col">
                              <span className="font-bold">{member.full_name || 'Unnamed Teammate'}</span>
                              <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium">
                                {member.email} • <span className="uppercase text-[10px] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-black">{member.role}</span>
                              </span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Custom Credentials & Integrations Settings */}
          <div className={cardClass}>
            <SectionHeader
              icon={Key}
              title="Credentials & Integrations"
              description={isMasterOrg
                ? 'Connect the messaging, email and AI providers this workspace sends through.'
                : 'Connect your WhatsApp Business account to this workspace.'}
              action={
                <button type="button" onClick={handleSaveCredentials} disabled={savingCredentials} className={primaryButtonClass}>
                  {savingCredentials ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>Save Credentials</span>
                </button>
              }
            />

            <div className={`grid grid-cols-1 ${isMasterOrg ? 'md:grid-cols-2' : ''} gap-6`}>
              {/* WhatsApp & SMS Gateway Column */}
              <div className={`space-y-6 ${isMasterOrg ? 'border-b md:border-b-0 md:border-r border-[#e9edef] dark:border-[#202d36] pb-6 md:pb-0 md:pr-6' : ''} flex flex-col justify-start`}>

                {/* WHATSAPP GATEWAY SECTION */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">WhatsApp Gateway</h3>

                  {/* Visual Mockup - Chat Inbox */}
                  <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                    <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[10px] text-[#667781] dark:text-slate-400 font-bold">
                      <span className="text-[#111b21] dark:text-white flex items-center gap-1">💬 Active Chat Session</span>
                      <span className="bg-emerald-500/20 text-[#00a884] px-1.5 py-0.5 rounded font-bold">Live Status</span>
                    </div>
                    <div className="space-y-1.5 max-h-16 overflow-hidden flex flex-col">
                      <div className="bg-white dark:bg-[#1f2c34] p-1.5 rounded-lg rounded-tl-none text-[10px] text-[#111b21] dark:text-slate-300 max-w-[85%] self-start border border-[#e9edef] dark:border-slate-800 leading-normal">
                        I want to set up automatic responses
                      </div>
                      <div className="bg-[#d9fdd3] dark:bg-[#005c4b] p-1.5 rounded-lg rounded-tr-none text-[10px] text-[#111b21] dark:text-white max-w-[85%] ml-auto border border-[#d9fdd3] dark:border-[#005c4b] text-right leading-normal">
                        Input your Account details and your gateway starts routing chats instantly!
                        <span className="text-emerald-600 dark:text-emerald-300 text-[10px] block mt-0.5 font-bold">10:15 AM ● ✓✓</span>
                      </div>
                    </div>
                  </div>

                  {isMasterOrg && (
                    <div className="flex flex-col gap-2">
                      <label className={labelInlineClass}>
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
                  )}

                  {isMasterOrg && whatsappProvider === 'twilio' ? (
                    <>
                      <div>
                        <label className={labelClass}>
                          Account SID
                        </label>
                        <input
                          type="text"
                          value={twilioAccountSid}
                          onChange={(e) => setTwilioAccountSid(e.target.value)}
                          placeholder="Gateway Account SID"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className={labelClass}>
                          Auth Token
                        </label>
                        <div className="relative">
                          <input
                            type={showTwilioToken ? 'text' : 'password'}
                            value={twilioAuthToken}
                            onChange={(e) => setTwilioAuthToken(e.target.value)}
                            placeholder="Gateway Auth Token"
                            className={secretInputClass}
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
                        <label className={labelClass}>
                          WhatsApp Sender Number
                        </label>
                        <input
                          type="text"
                          value={twilioWhatsappNumber}
                          onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                          placeholder="+14155238886 or whatsapp:+14155238886"
                          className={inputClass}
                        />
                        <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                          Include the sender prefix (e.g., whatsapp:+14155238886)
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      {organization && (
                        <WhatsAppEmbeddedSignup
                          organizationId={organization.id}
                          isConnected={Boolean(whatsappPhoneNumberId && (whatsappApiToken || whatsappBusinessAccountId))}
                          currentWabaId={whatsappBusinessAccountId}
                          currentPhoneNumberId={whatsappPhoneNumberId}
                          currentPhoneNumber={whatsappDefaultPhone}
                          onSuccess={(data) => {
                            if (data.wabaId) setWhatsappBusinessAccountId(data.wabaId)
                            if (data.phoneNumberId) setWhatsappPhoneNumberId(data.phoneNumberId)
                            if (data.displayPhoneNumber) setWhatsappDefaultPhone(data.displayPhoneNumber)
                            loadData()
                          }}
                          onDisconnect={() => {
                            setWhatsappBusinessAccountId('')
                            setWhatsappPhoneNumberId('')
                            setWhatsappDefaultPhone('')
                            setWhatsappApiToken('')
                            loadData()
                          }}
                        />
                      )}

                      {isMasterOrg && (
                        <details className="group border border-[#e9edef] dark:border-[#2a3942] rounded-lg p-3 bg-white dark:bg-[#111b21]/40">
                          <summary className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider cursor-pointer list-none flex items-center justify-between select-none">
                            <span>Manual API Credentials & Advanced Settings</span>
                            <span className="text-[10px] text-[#00a884] font-semibold group-open:hidden">Show ▼</span>
                            <span className="text-[10px] text-[#00a884] font-semibold hidden group-open:inline">Hide ▲</span>
                          </summary>

                          <div className="space-y-4 pt-3.5 mt-2 border-t border-[#e9edef] dark:border-[#2a3942]">
                            <div>
                              <label className={labelClass}>
                                WhatsApp Cloud API Token
                              </label>
                              <div className="relative">
                                <input
                                  type={showWhatsappApiToken ? 'text' : 'password'}
                                  value={whatsappApiToken}
                                  onChange={(e) => setWhatsappApiToken(e.target.value)}
                                  placeholder="EAAG..."
                                  className={secretInputClass}
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
                              <label className={labelClass}>
                                WhatsApp Phone Number ID
                              </label>
                              <input
                                type="text"
                                value={whatsappPhoneNumberId}
                                onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                                placeholder="e.g. 109876543210987"
                                className={inputClass}
                              />
                            </div>

                            <div>
                              <label className={labelClass}>
                                WhatsApp Business Account ID (WABA ID)
                              </label>
                              <input
                                type="text"
                                value={whatsappBusinessAccountId}
                                onChange={(e) => setWhatsappBusinessAccountId(e.target.value)}
                                placeholder="e.g. 102938475647382"
                                className={inputClass}
                              />
                              <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                                Required to fetch message templates from Meta. Auto-filled during Embedded Signup.
                              </p>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                              <div className="col-span-2">
                                <div className="flex items-center justify-between mb-1.5">
                                  <label className={labelInlineClass}>
                                    Default Sender Phone Number
                                  </label>
                                  {whatsappDefaultPhone.trim() && (
                                    <CopyPhoneButton phoneNumber={whatsappDefaultPhone} iconSize={11} className="text-[10px]" showText displayText="Copy" />
                                  )}
                                </div>
                                <input
                                  type="text"
                                  value={whatsappDefaultPhone}
                                  onChange={(e) => setWhatsappDefaultPhone(e.target.value)}
                                  placeholder="e.g. +14155238886"
                                  className={inputClass}
                                />
                              </div>
                              <div>
                                <label className={labelClass}>
                                  API Version
                                </label>
                                <input
                                  type="text"
                                  value={whatsappGraphApiVersion}
                                  onChange={(e) => setWhatsappGraphApiVersion(e.target.value)}
                                  placeholder="v25.0"
                                  className={inputClass}
                                />
                              </div>
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>

                {isMasterOrg && (
                  <>
                    {/* Divider Line */}
                    <div className="border-t border-[#e9edef] dark:border-[#202d36] my-2"></div>

                    {/* SMS GATEWAY SECTION */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">SMS Gateway</h3>

                        {/* Toggle switch: only render if Twilio is configured */}
                        {twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== '' ? (
                          <Toggle
                            label="SMS Gateway"
                            checked={organization?.enable_sms !== false}
                            onChange={() => handleToggleFeature('enable_sms', organization?.enable_sms !== false ? false : true)}
                          />
                        ) : (
                          <span className="text-[10px] text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded">
                            Requires Twilio
                          </span>
                        )}
                      </div>

                      {/* SMS Visual Status Mockup */}
                      <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                        <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[10px] text-[#667781] dark:text-slate-400 font-bold">
                          <span className="text-[#111b21] dark:text-white flex items-center gap-1">💬 SMS Gateway Connection</span>
                          <span className={`${organization?.enable_sms !== false && twilioAccountSid.trim() !== '' && twilioAuthToken.trim() !== ''
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
                            <label className={labelClass}>
                              Twilio Account SID (for SMS)
                            </label>
                            <input
                              type="text"
                              value={twilioAccountSid}
                              onChange={(e) => setTwilioAccountSid(e.target.value)}
                              placeholder="Twilio Account SID"
                              className={inputClass}
                            />
                          </div>

                          <div>
                            <label className={labelClass}>
                              Twilio Auth Token (for SMS)
                            </label>
                            <div className="relative">
                              <input
                                type={showTwilioToken ? 'text' : 'password'}
                                value={twilioAuthToken}
                                onChange={(e) => setTwilioAuthToken(e.target.value)}
                                placeholder="Twilio Auth Token"
                                className={secretInputClass}
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
                          <div className="flex items-center justify-between mb-1.5">
                            <label className={labelInlineClass}>
                              SMS Sender Phone Number
                            </label>
                            {twilioWhatsappNumber.trim() && (
                              <CopyPhoneButton phoneNumber={twilioWhatsappNumber} iconSize={11} className="text-[10px]" showText displayText="Copy" />
                            )}
                          </div>
                          <input
                            type="text"
                            value={twilioWhatsappNumber}
                            onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                            placeholder="e.g. +13185069063"
                            className={inputClass}
                          />
                          <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                            Twilio active phone number used for outgoing SMS broadcasts.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Email Broadcast & AI Sections */}
              {isMasterOrg && (
                <div className="space-y-6">
                  {/* Email Broadcast Engine */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#00a884]">Email Broadcast Engine</h3>

                    {/* Visual Mockup - Email Dispatch */}
                    <div className="bg-[#f0f2f5] dark:bg-[#0b0f19] p-3 rounded-xl border border-[#e9edef] dark:border-[#202d36] select-none text-[10px] space-y-2">
                      <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[10px] text-[#667781] dark:text-slate-400 font-bold">
                        <span className="text-[#111b21] dark:text-white flex items-center gap-1">📧 Marketing Campaign Wizard</span>
                        <span className="text-[#00a884] font-bold">99.8% Sent</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-700 dark:text-slate-300">
                        <div className="bg-white dark:bg-[#1f2c34] p-1.5 rounded border border-[#e9edef] dark:border-slate-800 font-semibold">
                          <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold">Subject</span>
                          Summer Sales Campaign
                        </div>
                        <div className="bg-white dark:bg-[#1f2c34] p-1.5 rounded border border-[#e9edef] dark:border-slate-800 font-semibold">
                          <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold">Status</span>
                          Dispatched to 1,500 leads
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className={labelInlineClass}>
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
                          <label className={labelClass}>
                            Email API Key
                          </label>
                          <div className="relative">
                            <input
                              type={showSgKey ? 'text' : 'password'}
                              value={sendgridApiKey}
                              onChange={(e) => setSendgridApiKey(e.target.value)}
                              placeholder="Email Gateway API Key"
                              className={secretInputClass}
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
                          <label className={labelClass}>
                            From Email Address
                          </label>
                          <input
                            type="email"
                            value={sendgridFromEmail}
                            onChange={(e) => setSendgridFromEmail(e.target.value)}
                            placeholder="no-reply@yourdomain.com"
                            className={inputClass}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className={labelClass}>
                              SMTP Host
                            </label>
                            <input
                              type="text"
                              value={smtpHost}
                              onChange={(e) => setSmtpHost(e.target.value)}
                              placeholder="smtp.mailgun.org"
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label className={labelClass}>
                              SMTP Port
                            </label>
                            <input
                              type="text"
                              value={smtpPort}
                              onChange={(e) => setSmtpPort(e.target.value)}
                              placeholder="587"
                              className={inputClass}
                            />
                          </div>
                        </div>

                        <div>
                          <label className={labelClass}>
                            SMTP Username / Email
                          </label>
                          <input
                            type="email"
                            value={smtpEmail}
                            onChange={(e) => setSmtpEmail(e.target.value)}
                            placeholder="postmaster@yourdomain.com"
                            className={inputClass}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>
                            SMTP Password
                          </label>
                          <div className="relative">
                            <input
                              type={showSmtpPassword ? 'text' : 'password'}
                              value={smtpPassword}
                              onChange={(e) => setSmtpPassword(e.target.value)}
                              placeholder="SMTP password"
                              className={secretInputClass}
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
                      <div className="flex items-center justify-between border-b border-[#e9edef] dark:border-slate-800 pb-1.5 text-[10px] text-[#667781] dark:text-slate-400 font-bold">
                        <span className="text-[#111b21] dark:text-white flex items-center gap-1">🤖 AI Suggested Replies</span>
                        <span className="text-blue-600 dark:text-blue-400 font-bold">Copilot Active</span>
                      </div>
                      <div className="flex gap-1.5 overflow-x-auto py-0.5">
                        <div className="bg-[#00a884]/15 border border-[#00a884]/25 text-[#00a884] text-[10px] px-2 py-1 rounded-full whitespace-nowrap font-bold">
                          🤖 AI: Book Consultation Call
                        </div>
                        <div className="bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-slate-800 text-slate-700 dark:text-slate-300 text-[10px] px-2 py-1 rounded-full whitespace-nowrap font-bold">
                          AI: Send Pricing FAQ
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>
                        AI API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showOpenaiKey ? 'text' : 'password'}
                          value={openaiApiKey}
                          onChange={(e) => setOpenaiApiKey(e.target.value)}
                          placeholder="AI Model API Key"
                          className={secretInputClass}
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
                      <label className={labelClass}>
                        AI Chatbot Base Prompt (System Prompt)
                      </label>
                      <textarea
                        rows={6}
                        value={chatbotBasePrompt}
                        onChange={(e) => setChatbotBasePrompt(e.target.value)}
                        placeholder="Enter the custom base/system prompt for your chatbot. Leaving this blank will fall back to the default strict customer service prompt."
                        className={`${inputClass} resize-y`}
                      />
                      <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
                        Configure your custom AI agent persona, rules, and fallbacks. The chatbot answers questions based on this prompt combined with your knowledge base.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Environment Variables Export & Backup */}
          {isMasterOrg && (
            <div className={cardClass}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#00a884]/10 dark:bg-[#00a884]/20 flex items-center justify-center text-[#00a884]">
                    <Server size={18} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#111b21] dark:text-white flex items-center gap-2">
                      Export Environment Variables (.env)
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-[#00a884]">
                        Cloud Backup
                      </span>
                    </h2>
                    <p className="text-xs text-[#667781] dark:text-[#8696a0] font-medium">
                      Export and backup all server configuration keys directly to your email address or local developer machine.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadEnv}
                    className="px-3 py-1.5 bg-[#f0f2f5] dark:bg-[#202d36] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#111b21] dark:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Download .env.local file directly"
                  >
                    <Download size={14} />
                    Download .env
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyEnv}
                    disabled={isExportingEnv}
                    className="px-3 py-1.5 bg-[#f0f2f5] dark:bg-[#202d36] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#111b21] dark:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Copy .env content to clipboard"
                  >
                    {copiedEnv ? <Check size={14} className="text-[#00a884]" /> : <Copy size={14} />}
                    {copiedEnv ? 'Copied!' : 'Copy to Clipboard'}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#f0f2f5]/60 dark:bg-[#1f2c34]/50 border border-[#e9edef] dark:border-[#2a3942] space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1 w-full">
                    <label className={labelClass}>
                      Destination Email Address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        value={exportEnvEmail}
                        onChange={(e) => setExportEnvEmail(e.target.value)}
                        placeholder="tejachennu17@gmail.com"
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold text-[#111b21] dark:text-white"
                      />
                      <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportEnvEmail}
                    disabled={isExportingEnv}
                    className="w-full sm:w-auto px-5 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm whitespace-nowrap"
                  >
                    {isExportingEnv ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        Sending .env...
                      </>
                    ) : (
                      <>
                        <Mail size={15} />
                        Send .env to Email
                      </>
                    )}
                  </button>
                </div>

                {exportEnvResult && (
                  <div className="mt-3 p-3 rounded-lg bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#111b21] dark:text-white flex items-center gap-1.5">
                        {exportEnvResult.emailed ? (
                          <span className="text-[#00a884]">● Email Delivered</span>
                        ) : (
                          <span className="text-amber-500">● Variables Retrieved</span>
                        )}
                        <span className="text-[#667781] dark:text-[#8696a0] font-normal">
                          ({exportEnvResult.varCount || 0} variables detected)
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowEnvPreview(!showEnvPreview)}
                        className="text-[#00a884] hover:underline font-semibold text-[11px]"
                      >
                        {showEnvPreview ? 'Hide Preview' : 'Show Masked Preview'}
                      </button>
                    </div>

                    <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
                      {exportEnvResult.message || (exportEnvResult.emailed ? `Sent successfully to ${exportEnvResult.recipient}` : 'Ready for download or copy.')}
                    </p>

                    {showEnvPreview && exportEnvResult.envText && (
                      <div className="relative mt-2">
                        <pre className="p-3 bg-[#f0f2f5] dark:bg-[#0c1317] rounded-lg text-[11px] font-mono text-[#111b21] dark:text-[#00e676] overflow-x-auto max-h-56 border border-[#e9edef] dark:border-[#202d36]">
                          {exportEnvResult.envText}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-medium flex items-center gap-1.5">
                  <span className="text-amber-500">💡</span>
                  <span>
                    <strong>Workflow Tip:</strong> After pushing your code to the live deployment (e.g. Vercel / Railway / Cloud Host), click <strong>Send .env to Email</strong> or <strong>Download .env</strong> to instantly retrieve your production configuration for local development.
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Support */}
          <section className={cardClass}>
            <SectionHeader
              icon={LifeBuoy}
              title="Need Help?"
              description="Check out the workspace guide or contact our support team for help configuring your custom gateways."
            />
            <div className="flex flex-wrap gap-2.5">
              <a href="#guide" className={primaryButtonClass}>
                Workspace Guide
              </a>
              <a href="mailto:support@byokcrm.com" className={secondaryButtonClass}>
                <Mail size={14} />
                Contact Support
              </a>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div className="space-y-5 w-full max-w-6xl mx-auto">

          {/* Add FAQ panel */}
          <div className={cardClass}>
            <SectionHeader
              icon={FileText}
              title="Add Manual FAQ / Policy"
              description="Items added here are indexed for AI search and chatbot replies."
            />

            <div className="space-y-4">
              <div>
                <label className={labelClass}>
                  Question or Title
                </label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  placeholder="e.g. What is the fee for passport renewal?"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>
                  Answer or Content
                </label>
                <textarea
                  rows={4}
                  value={manualContent}
                  onChange={e => setManualContent(e.target.value)}
                  placeholder="e.g. The standard passport renewal fee is $130. Expedited processing costs an additional $60."
                  className={`${inputClass} resize-y`}
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

          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e9edef] dark:border-[#202d36] bg-[#f0f2f5] dark:bg-[#1f2c34] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Indexed Knowledge Base</h3>
                <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] bg-[#f0f2f5] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] px-2.5 py-0.5 rounded-full">
                  {filteredArticles.length === articles.length ? `${articles.length} items` : `${filteredArticles.length} of ${articles.length} found`}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-1 max-w-sm">
                <div className="relative w-full">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#667781] dark:text-[#8696a0]" />
                  <input
                    type="text"
                    value={ragSearchQuery}
                    onChange={e => setRagSearchQuery(e.target.value)}
                    placeholder="Search FAQs & policies..."
                    className="w-full pl-9 pr-3.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-[11px] font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white"
                  />
                </div>

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
                  className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <Upload size={12} />
                  <span>Import</span>
                </button>
              </div>
            </div>

            {loadingArticles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[#00a884]" />
              </div>
            ) : filteredArticles.length === 0 ? (
              <div className="p-12 text-center text-[#667781] dark:text-[#8696a0]">
                <BookOpen size={36} className="text-[#e9edef] dark:text-[#202d36] mx-auto mb-3" />
                <p className="text-xs font-bold">No matching items found</p>
                <p className="text-[10px] font-medium mt-1">Try refining your search query.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#1f2c34] text-[10px] font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
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
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => {
                                setEditingArticle(art)
                                setEditTitle(art.title || '')
                                setEditContent(art.content || '')
                              }}
                              className="p-1 text-[#008069] dark:text-emerald-400 hover:bg-[#f0f2f5] dark:hover:bg-[#202d36] rounded transition-colors cursor-pointer"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteArticle(art.id)}
                              className="p-1 text-rose-500 hover:text-rose-600 hover:bg-[#f0f2f5] dark:hover:bg-[#202d36] rounded transition-colors cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="px-6 py-4 border-t border-[#e9edef] dark:border-[#202d36]/50 bg-[#f0f2f5] dark:bg-[#1f2c34]/20 flex items-center justify-between select-none text-[11px] text-[#667781] dark:text-[#8696a0]">
                    <div className="font-semibold">
                      Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, filteredArticles.length)} of {filteredArticles.length} items
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
          {/* Service Synonyms Section */}
          <div className={cardClass}>
            <SectionHeader
              icon={Tags}
              title="Service Synonyms"
              description="Map the different terms customers use (aliases) to your canonical knowledge base terminology, so the chatbot finds the right answer."
              action={
                <button type="button" onClick={openAddSynonymModal} className={primaryButtonClass}>
                  <Plus size={14} />
                  Add Synonym Group
                </button>
              }
            />

            {loadingSynonyms ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin text-[#00a884]" />
              </div>
            ) : synonymGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e9edef] dark:border-[#2a3942] p-8 flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 rounded-full bg-[#00a884]/10 flex items-center justify-center mb-2">
                  <Tags size={18} className="text-[#00a884]" />
                </div>
                <h3 className="text-xs font-bold text-[#111b21] dark:text-white mb-1">No service synonym groups yet</h3>
                <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-semibold max-w-sm">
                  Create synonym groups to map alternative customer search terms and phrases to your canonical services.
                </p>
                <button
                  onClick={openAddSynonymModal}
                  className="mt-3 h-8 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white text-[11px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus size={12} />
                  Create First Group
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {synonymGroups.map((group, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-50/50 dark:bg-[#1f2c34]/20 rounded-xl border border-[#e9edef] dark:border-[#202d36] p-4 shadow-xs hover:shadow-sm transition-shadow group relative"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00a884]/10 text-[#008069] dark:text-[#00e676] text-[10px] font-bold border border-[#00a884]/20">
                        <Tags size={11} />
                        Category: {group.canonical}
                      </span>
                      <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditSynonymModal(idx)}
                          className="p-1 rounded hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] hover:text-[#008069] dark:hover:text-[#00e676] transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteSynonym(idx)}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-[#667781] dark:text-[#8696a0] hover:text-red-500 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    {group.aliases.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {group.aliases.map((alias, aIdx) => (
                          <span
                            key={aIdx}
                            className="inline-block px-2 py-0.5 rounded bg-white dark:bg-[#1f2c34] text-[#54656f] dark:text-[#8696a0] text-[10px] font-semibold border border-[#e9edef] dark:border-[#2a3942]"
                          >
                            {alias}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-[#8696a0] dark:text-[#667781] italic font-semibold">No aliases defined</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'teammates' && (
        <div className="space-y-5 w-full max-w-6xl mx-auto">
          {/* Teammates Usage & Limits Card */}
          <div className={cardClass}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 shrink-0 rounded-xl bg-[#00a884]/10 text-[#008069] dark:text-[#00e676] flex items-center justify-center">
                  <Users size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold leading-tight text-[#111b21] dark:text-white">Teammate Account Slots</h2>
                  <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1 leading-relaxed">
                    Manage your organization's members, roles, and system logins.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:items-end">
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

          {/* Role Guide */}
          <div className="bg-gradient-to-r from-[#f0fdf9] to-[#f0f2f5] dark:from-[#0d2318]/30 dark:to-[#1f2c34]/40 rounded-lg border border-[#e9edef] dark:border-[#202d36] p-4 shadow-sm">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-[#00a884] mb-3 flex items-center gap-1.5">
              <Shield size={12} />
              Role Permissions Guide
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ASSIGNABLE_ROLES.map(r => {
                const rd = getRoleDisplay(r.value)
                return (
                  <div key={r.value} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border flex-shrink-0 ${rd.bg} ${rd.color} ${rd.border}`}>
                      {rd.label}
                    </span>
                    <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold leading-tight">{r.description}</p>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-[#8696a0] mt-3 border-t border-[#e9edef] dark:border-[#2a3942] pt-2.5">
              💡 <strong className="text-[#667781]">Full Access</strong> toggle grants a Sales Employee visibility into all org chats & leads. &nbsp;
              <strong className="text-[#667781]">Read Only</strong> toggle allows viewing but blocks sending/editing.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Add Teammate Form */}
            <div className={`lg:col-span-1 ${cardClass} h-fit`}>
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
                    Workspace Role
                  </label>
                  <select
                    value={teammateForm.role}
                    onChange={(e) => setTeammateForm({ ...teammateForm, role: e.target.value })}
                    className="w-full px-3.5 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold text-[#111b21] dark:text-white"
                  >
                    {ASSIGNABLE_ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label} — {r.description}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[#8696a0] mt-1">
                    {ASSIGNABLE_ROLES.find(r => r.value === teammateForm.role)?.description}
                  </p>
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
            <div className="lg:col-span-2 bg-white dark:bg-[#111b21] rounded-2xl border border-[#e9edef] dark:border-[#202d36] shadow-sm overflow-hidden flex flex-col justify-start">
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
                    <table className="w-full min-w-[850px] text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#1f2c34] text-[10px] font-black uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3">Email</th>
                          <th className="px-4 py-3">Role</th>
                          <th className="px-4 py-3 text-center">See All</th>
                          <th className="px-4 py-3 text-center">Read Only</th>
                          <th className="px-4 py-3">Joined Date</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teammates.map((member) => (
                          <tr
                            key={member.id}
                            className="border-b border-[#e9edef] dark:border-[#202d36] last:border-b-0 hover:bg-[#f0f2f5] dark:hover:bg-[#1f2c34]/50 transition-colors"
                          >
                            <td className="px-4 py-3.5 font-bold text-[#111b21] dark:text-white">
                              {member.full_name || 'N/A'}
                            </td>
                            <td className="px-4 py-3.5 text-[#667781] dark:text-[#8696a0] font-semibold">
                              {member.email}
                            </td>
                            <td className="px-4 py-3.5">
                              {(() => {
                                const rd = getRoleDisplay(member.role)
                                return (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${rd.bg} ${rd.color} ${rd.border}`}>
                                    {rd.label}
                                  </span>
                                )
                              })()}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {/* Full Access toggle: see_all ON + read_only OFF */}
                              <div className="flex flex-col items-center gap-0.5">
                                <button
                                  onClick={() => handleToggleTeammatePermission(member.id, 'see_all', member.see_all)}
                                  disabled={isManager({ role: member.role } as any)}
                                  title={isManager({ role: member.role } as any) ? 'Admins/Managers always see all' : (member.see_all ? 'Revoke access' : 'Grant full access')}
                                  className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${member.see_all || isManager({ role: member.role } as any) ? 'bg-[#00a884]' : 'bg-slate-200 dark:bg-slate-700'
                                    }`}
                                >
                                  <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${member.see_all || isManager({ role: member.role } as any) ? 'translate-x-3' : 'translate-x-0'
                                    }`} />
                                </button>
                                <span className="text-[10px] text-[#8696a0] font-semibold">{isManager({ role: member.role } as any) ? 'always' : member.see_all ? 'on' : 'off'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {/* Read-only toggle: restricts editing even if see_all is on */}
                              <div className="flex flex-col items-center gap-0.5">
                                <button
                                  onClick={() => handleToggleTeammatePermission(member.id, 'read_only', member.read_only)}
                                  disabled={isManager({ role: member.role } as any)}
                                  title={isManager({ role: member.role } as any) ? 'Admins/Managers are never read-only' : (member.read_only ? 'Remove read-only' : 'Set read-only')}
                                  className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${member.read_only && !isManager({ role: member.role } as any) ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'
                                    }`}
                                >
                                  <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${member.read_only && !isManager({ role: member.role } as any) ? 'translate-x-3' : 'translate-x-0'
                                    }`} />
                                </button>
                                <span className="text-[10px] text-[#8696a0] font-semibold">{member.read_only && !isManager({ role: member.role } as any) ? 'on' : 'off'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-[#667781] dark:text-[#8696a0] font-medium">
                              {new Date(member.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3.5 text-center">
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
                          {(() => {
                            const rd = getRoleDisplay(member.role)
                            return (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${rd.bg} ${rd.color} ${rd.border}`}>
                                {rd.label}
                              </span>
                            )
                          })()}
                        </div>
                        <div className="flex items-center gap-4 py-1.5 border-t border-b border-[#e9edef]/60 dark:border-[#2a3942]/60 select-none text-[10px] font-bold">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-wide">Full Access</span>
                            <button
                              onClick={() => handleToggleTeammatePermission(member.id, 'see_all', member.see_all)}
                              disabled={isManager({ role: member.role } as any)}
                              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${member.see_all || isManager({ role: member.role } as any) ? 'bg-[#00a884]' : 'bg-slate-200 dark:bg-slate-700'
                                }`}
                            >
                              <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${member.see_all || isManager({ role: member.role } as any) ? 'translate-x-3' : 'translate-x-0'
                                }`} />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-wide">Read Only</span>
                            <button
                              onClick={() => handleToggleTeammatePermission(member.id, 'read_only', member.read_only)}
                              disabled={isManager({ role: member.role } as any)}
                              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${member.read_only && !isManager({ role: member.role } as any) ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'
                                }`}
                            >
                              <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${member.read_only && !isManager({ role: member.role } as any) ? 'translate-x-3' : 'translate-x-0'
                                }`} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[#667781] dark:text-[#8696a0] pt-1">
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
                            <span className="text-[10px] text-[#8696a0] font-bold bg-[#f0f2f5] dark:bg-[#111b21] px-2 py-1 rounded border border-[#e9edef] dark:border-[#2a3942]">
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
      {activeTab === 'appearance' && (
        <div className="space-y-5 w-full max-w-6xl mx-auto">
          <div className={cardClass}>
            <SectionHeader
              icon={Palette}
              title="Appearance"
              description="Customize how the application looks for you on this device."
            />

            <div className="grid grid-cols-2 gap-4 max-w-md">
              <button
                type="button"
                aria-pressed={theme === 'light'}
                onClick={() => toggleTheme('light')}
                className={`flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 transition-all cursor-pointer ${theme === 'light'
                    ? 'border-[#00a884] bg-[#f0f2f5] dark:bg-[#0c1317]'
                    : 'border-[#e9edef] dark:border-[#202d36] hover:border-[#00a884]/50'
                  }`}
              >
                <Sun size={32} className={theme === 'light' ? 'text-amber-500' : 'text-[#667781] dark:text-[#8696a0]'} />
                <span className={`text-xs font-bold ${theme === 'light' ? 'text-[#111b21] dark:text-white' : 'text-[#667781] dark:text-[#8696a0]'}`}>Light Mode</span>
              </button>

              <button
                type="button"
                aria-pressed={theme === 'dark'}
                onClick={() => toggleTheme('dark')}
                className={`flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 transition-all cursor-pointer ${theme === 'dark'
                    ? 'border-[#00a884] bg-[#f0f2f5] dark:bg-[#0c1317]'
                    : 'border-[#e9edef] dark:border-[#202d36] hover:border-[#00a884]/50'
                  }`}
              >
                <Moon size={32} className={theme === 'dark' ? 'text-indigo-400' : 'text-[#667781] dark:text-[#8696a0]'} />
                <span className={`text-xs font-bold ${theme === 'dark' ? 'text-[#111b21] dark:text-white' : 'text-[#667781] dark:text-[#8696a0]'}`}>Dark Mode</span>
              </button>
            </div>
          </div>
        </div>
      )}



      {/* ── Synonym Add/Edit Modal ─────────────────────────── */}
      {synonymModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 text-[#111b21] dark:text-white">
            <div className="p-6 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2">
                <Tags size={16} className="text-[#00a884]" />
                {editingSynonymIndex !== null ? 'Edit Synonym Group' : 'Add Synonym Group'}
              </h3>
              <button
                onClick={() => setSynonymModalOpen(false)}
                className="text-[#667781] dark:text-slate-400 hover:text-[#111b21] dark:hover:text-white transition-colors p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-lg cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Canonical Term
                </label>
                <input
                  type="text"
                  value={synonymFormCanonical}
                  onChange={(e) => setSynonymFormCanonical(e.target.value)}
                  placeholder='e.g. "Technical Support" or "Billing"'
                  className={inputClass}
                />
                <p className="text-[10px] text-[#8696a0] mt-1 font-semibold">The standard term used in your knowledge base</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">
                  Aliases
                </label>
                <div className="flex flex-wrap gap-1.5 p-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus-within:border-[#00a884] rounded-lg transition-colors min-h-[42px]">
                  {synonymFormAliases.map((alias, aIdx) => (
                    <span
                      key={aIdx}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#00a884]/10 text-[#008069] dark:text-[#00e676] text-[11px] font-bold border border-[#00a884]/20"
                    >
                      {alias}
                      <button
                        onClick={() => removeAlias(aIdx)}
                        className="hover:text-red-500 transition-colors cursor-pointer ml-0.5"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={synonymAliasInput}
                    onChange={(e) => setSynonymAliasInput(e.target.value)}
                    onKeyDown={handleSynonymAliasKeyDown}
                    onBlur={addAliasFromInput}
                    placeholder={synonymFormAliases.length === 0 ? 'Type alias and press Enter or comma to add...' : 'Add more...'}
                    className="flex-1 min-w-[120px] bg-transparent focus:outline-none text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white py-0.5"
                  />
                </div>
                <p className="text-[10px] text-[#8696a0] mt-1 font-semibold">Press Enter or comma to add each alias. These are the alternative terms customers might use.</p>
              </div>
            </div>
            <div className="p-6 bg-[#f0f2f5] dark:bg-[#1f2c34]/40 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-end gap-3 select-none">
              <button
                type="button"
                onClick={() => setSynonymModalOpen(false)}
                className="h-9 px-4 rounded-lg border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-slate-50 dark:hover:bg-[#2a3942] text-xs font-bold text-[#54656f] dark:text-[#8696a0] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSynonymForm}
                disabled={savingSynonyms || !synonymFormCanonical.trim()}
                className="h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                {savingSynonyms && <Loader2 size={13} className="animate-spin" />}
                <span>{editingSynonymIndex !== null ? 'Save Changes' : 'Add Group'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Knowledge Article Modal */}
      {editingArticle && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 text-[#111b21] dark:text-white">
            <div className="p-6 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Edit FAQ / Policy</h3>
              <button
                onClick={() => setEditingArticle(null)}
                className="text-[#667781] dark:text-slate-400 hover:text-[#111b21] dark:hover:text-white transition-colors p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-lg"
              >
                <Plus className="rotate-45" size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Question or Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Answer or Content</label>
                <textarea
                  rows={6}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className={`${inputClass} resize-y`}
                />
              </div>
            </div>
            <div className="p-6 bg-[#f0f2f5] dark:bg-[#1f2c34]/40 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-end gap-3 select-none">
              <button
                type="button"
                onClick={() => setEditingArticle(null)}
                className="h-9 px-4 rounded-lg border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-slate-50 dark:hover:bg-[#2a3942] text-xs font-bold text-[#54656f] dark:text-[#8696a0] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={actionLoading || !editTitle.trim() || !editContent.trim()}
                className="h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 size={13} className="animate-spin" />}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
