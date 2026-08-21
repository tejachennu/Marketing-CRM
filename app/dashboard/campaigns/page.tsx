'use client'

import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { 
  Megaphone, 
  Plus, 
  Loader2, 
  BarChart3, 
  Users, 
  CheckCircle, 
  AlertCircle, 
  Upload, 
  X, 
  ChevronRight, 
  ChevronLeft, 
  ArrowLeft, 
  RefreshCw, 
  Eye, 
  Phone, 
  Database,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ExternalLink,
  Copy,
  FileText,
  Play,
  Send,
  TrendingUp,
  Target,
  Square,
  RotateCcw
} from 'lucide-react'
import Link from 'next/link'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'

interface Campaign {
  id: string
  name: string
  template_name: string
  template_body: string
  status: string
  total_contacts: number
  sent_count: number
  failed_count: number
  created_at: string
  channel?: string
  sender?: string
  subject?: string
}

interface CampaignLog {
  id: string
  phone_number: string | null
  email_address: string | null
  status: string
  error_message: string | null
  variables_mapped: Record<string, any>
  message_sid: string | null
  created_at: string
}

interface Template {
  sid: string
  name: string
  raw_name?: string
  whatsapp_template_name?: string
  body: string
  variables: string[]
  sampleValues?: Record<string, string>
  category: string
  language?: string
  approval_status?: string
  rejection_reason?: string | null
  isDbTemplate?: boolean
  source?: string
  components?: any[]
}

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  company: string | null
  email: string | null
  tags?: string[]
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateFetchError, setTemplateFetchError] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [selectedCampaignLogs, setSelectedCampaignLogs] = useState<CampaignLog[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  // Add-template inline panel state
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const [newTplCategory, setNewTplCategory] = useState('UTILITY')
  const [newTplLanguage, setNewTplLanguage] = useState('en')
  const [newTplBody, setNewTplBody] = useState('')
  const [newTplSaving, setNewTplSaving] = useState(false)
  const [newTplError, setNewTplError] = useState('')

  // Campaigns list pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCampaignsCount, setTotalCampaignsCount] = useState(0)

  const [wizardStep, setWizardStep] = useState(1)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  
  // Dashboard Search & Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'sms' | 'email'>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  
  const [audienceSource, setAudienceSource] = useState<'db' | 'excel'>('excel')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelData, setExcelData] = useState<any[]>([])
  const [excelHeaders, setExcelHeaders] = useState<string[]>([])
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [contactSearchTerm, setContactSearchTerm] = useState('')
  
  // Mapping state: maps template placeholders "1", "2" to column names / attributes
  const [phoneColumn, setPhoneColumn] = useState('')
  const [contactNameColumn, setContactNameColumn] = useState('')
  const [contactLastNameColumn, setContactLastNameColumn] = useState('')
  const [contactTagColumn, setContactTagColumn] = useState('')
  const [customCampaignTag, setCustomCampaignTag] = useState('')
  const [variableMappings, setVariableMappings] = useState<Record<string, string>>({})
  const [variableMappingTypes, setVariableMappingTypes] = useState<Record<string, 'dynamic' | 'static'>>({})
  const [staticVariableValues, setStaticVariableValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // New multi-channel states
  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
    enable_sms: true,
  })
  const [channel, setChannel] = useState<'whatsapp' | 'sms' | 'email'>('whatsapp')
  const [sender, setSender] = useState('')
  const [subject, setSubject] = useState('')
  const [customMessageBody, setCustomMessageBody] = useState('')
  const [customVariables, setCustomVariables] = useState<string[]>([])
  const [availableSenders, setAvailableSenders] = useState<{
    smsSenders: Array<{ value: string; label: string }>
    whatsappSenders: Array<{ value: string; label: string }>
    emailSenders: Array<{ value: string; label: string }>
  }>({ smsSenders: [], whatsappSenders: [], emailSenders: [] })
  const [isLoadingSenders, setIsLoadingSenders] = useState(false)
  const [editorMode, setEditorMode] = useState<'visual' | 'code'>('visual')
  const [detailsPreviewMode, setDetailsPreviewMode] = useState<'preview' | 'raw'>('preview')
  const visualEditorRef = useRef<HTMLDivElement>(null)

  // Sync state to visual editor element
  useEffect(() => {
    if (visualEditorRef.current && editorMode === 'visual') {
      if (visualEditorRef.current.innerHTML !== customMessageBody) {
        visualEditorRef.current.innerHTML = customMessageBody || ''
      }
    }
  }, [customMessageBody, editorMode])

  const handleVisualEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML
    handleCustomMessageBodyChange(html)
  }

  const handleCustomMessageBodyChange = (text: string) => {
    setCustomMessageBody(text)
    const matches = text.match(/\{\{([^}]+)\}\}/g) || []
    const uniqueVars = Array.from(new Set(matches.map(m => m.replace(/<[^>]*>/g, '').replace(/[\{\}]/g, ''))))
    uniqueVars.sort((a, b) => {
      const numA = parseInt(a)
      const numB = parseInt(b)
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB
      return a.localeCompare(b)
    })
    setCustomVariables(uniqueVars)
  }

  // Pre-populate message body when template selection changes
  useEffect(() => {
    if (selectedTemplate) {
      handleCustomMessageBodyChange(selectedTemplate.body)
    } else {
      handleCustomMessageBodyChange('')
    }
  }, [selectedTemplate])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const loadFeaturesAndData = async () => {
      try {
        await restoreSupabaseSession()
        let userId: string | null = null
        const { data: { user: authUser } } = await supabase.auth.getUser()
        if (authUser) userId = authUser.id
        else {
          const storedUser = authSessionManager.getUser()
          if (storedUser?.id) userId = storedUser.id
        }
        if (userId) {
          const email = authUser?.email || authSessionManager.getUser()?.email || ''
          const userData = await ensureUserProfile(userId, email)
          if (userData) {
            setUser(userData)
            const { data: orgData } = await supabase
              .from('organizations')
              .select('enable_ai, enable_email, enable_messages, enable_phone_calls, enable_sms')
              .eq('id', userData.organization_id)
              .maybeSingle()
            if (orgData) {
              const enabledFeatures = {
                enable_ai: orgData.enable_ai !== false,
                enable_email: orgData.enable_email !== false,
                enable_messages: orgData.enable_messages !== false,
                enable_phone_calls: orgData.enable_phone_calls !== false,
                enable_sms: orgData.enable_sms !== false,
              }
              setFeatures(enabledFeatures)
              if (!enabledFeatures.enable_messages && enabledFeatures.enable_email) {
                setChannel('email')
              }
            }
            const orgId = userData.organization_id
            fetchCampaigns(1, true, orgId)
            fetchTemplates(orgId)
            fetchContacts(orgId)
            fetchSenders(orgId)
          }
        }
      } catch (err) {
        console.error('Error loading organization features:', err)
      }
    }

    loadFeaturesAndData()
  }, [])

  const fetchSenders = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    setIsLoadingSenders(true)
    try {
      const res = await fetch(`/api/campaigns/senders?organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        setAvailableSenders({
          smsSenders: data.smsSenders || [],
          whatsappSenders: data.whatsappSenders || [],
          emailSenders: data.emailSenders || []
        })
      }
    } catch (err) {
      console.error('Error fetching senders:', err)
    } finally {
      setIsLoadingSenders(false)
    }
  }

  // Auto-set default sender when channel or availableSenders change
  useEffect(() => {
    const senders =
      channel === 'whatsapp' ? availableSenders.whatsappSenders :
      channel === 'sms' ? availableSenders.smsSenders :
      availableSenders.emailSenders;
    if (senders && senders.length > 0) {
      setSender(senders[0].value)
    } else {
      setSender('')
    }
  }, [channel, availableSenders])

  // Auto-select first configured channel when availableSenders or features change
  useEffect(() => {
    const channels: Array<'whatsapp' | 'sms' | 'email'> = []
    if (features.enable_messages && availableSenders.whatsappSenders.length > 0) {
      channels.push('whatsapp')
    }
    if (features.enable_messages && features.enable_sms && availableSenders.smsSenders.length > 0) {
      channels.push('sms')
    }
    if (features.enable_email && availableSenders.emailSenders.length > 0) {
      channels.push('email')
    }
    if (channels.length > 0 && !channels.includes(channel)) {
      setChannel(channels[0])
    }
  }, [availableSenders, features, channel])

  // Auto-polling for active campaigns
  useEffect(() => {
    const hasProcessing = campaigns.some(c => c.status === 'PROCESSING' || c.status === 'PENDING')
    if (!hasProcessing) return

    const interval = setInterval(() => {
      fetchCampaigns(currentPage, false)
      if (selectedCampaign && (selectedCampaign.status === 'PROCESSING' || selectedCampaign.status === 'PENDING')) {
        fetchCampaignDetails(selectedCampaign.id, false)
      }
    }, 4000)

    return () => clearInterval(interval)
  }, [campaigns, selectedCampaign, currentPage])

  const fetchCampaigns = async (pageVal: number = 1, showLoader = true, orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    if (showLoader) setIsLoading(true)
    try {
      const res = await fetch(`/api/campaigns?page=${pageVal}&limit=10&organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        setCampaigns(data.campaigns)
        setCurrentPage(data.pagination.page)
        setTotalPages(data.pagination.pages)
        setTotalCampaignsCount(data.pagination.total)
      }
    } catch (err) {
      console.error('Error fetching campaigns:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  const handleStopCampaign = async (campaignId: string) => {
    setActionLoadingId(campaignId)
    try {
      const res = await fetch('/api/campaigns/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId })
      })
      const data = await res.json()
      if (data.success) {
        await fetchCampaigns(currentPage)
        if (selectedCampaign?.id === campaignId) {
          await fetchCampaignDetails(campaignId)
        }
      } else {
        alert(data.error || 'Failed to stop campaign')
      }
    } catch (err) {
      console.error('Error stopping campaign:', err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRerunCampaign = async (campaignId: string, rerunType: 'failed_only' | 'all' = 'failed_only') => {
    setActionLoadingId(campaignId)
    try {
      const res = await fetch('/api/campaigns/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, rerunType })
      })
      const data = await res.json()
      if (data.success) {
        await fetchCampaigns(currentPage)
        if (selectedCampaign?.id === campaignId) {
          await fetchCampaignDetails(campaignId)
        }
      } else {
        alert(data.error || 'Failed to rerun campaign')
      }
    } catch (err) {
      console.error('Error rerunning campaign:', err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const fetchTemplates = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    setTemplateFetchError(null)
    try {
      const res = await fetch(`/api/templates?organizationId=${orgId}`)
      const data = await res.json()
      if (data.error) {
        setTemplateFetchError(data.error)
      }
      if (data.templates) {
        setTemplates(data.templates)
      }
    } catch (err: any) {
      console.error('Error fetching templates:', err)
      setTemplateFetchError(err.message || 'Failed to load templates')
    }
  }

  const handleSaveNewTemplate = async () => {
    setNewTplError('')
    if (!newTplName.trim()) { setNewTplError('Template name is required.'); return }
    if (!newTplBody.trim()) { setNewTplError('Template body is required.'); return }
    setNewTplSaving(true)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: user?.organization_id,
          name: newTplName.trim().toLowerCase().replace(/\s+/g, '_'),
          category: newTplCategory,
          language: newTplLanguage,
          body: newTplBody.trim()
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setNewTplError(data.error || 'Failed to save template.')
        return
      }
      // Reload templates then auto-select the new one
      await fetchTemplates()
      setShowAddTemplate(false)
      setNewTplName('')
      setNewTplBody('')
      setNewTplCategory('UTILITY')
      setNewTplLanguage('en')
    } catch (err: any) {
      setNewTplError(err.message || 'Network error')
    } finally {
      setNewTplSaving(false)
    }
  }

  const fetchContacts = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    setIsLoadingContacts(true)
    try {
      const res = await fetch(`/api/contacts?all=true&organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        const loadedContacts = data.contacts || []
        setContacts(loadedContacts)
        setSelectedContactIds(loadedContacts.map((c: any) => c.id))
      }
    } catch (err) {
      console.error('Error fetching contacts:', err)
    } finally {
      setIsLoadingContacts(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchCampaigns(currentPage, false)
    setIsRefreshing(false)
  }

  const fetchCampaignDetails = async (campaignId: string, showLoader = true) => {
    if (showLoader) setIsLoadingLogs(true)
    try {
      const res = await fetch(`/api/campaigns?id=${campaignId}`)
      const data = await res.json()
      if (data.success) {
        setSelectedCampaign(data.campaign)
        setSelectedCampaignLogs(data.logs)
        setDetailsPreviewMode('preview')
      }
    } catch (err) {
      console.error('Error fetching campaign details:', err)
    } finally {
      setIsLoadingLogs(false)
    }
  }

  const handleDownloadLogsReport = () => {
    if (!selectedCampaign || selectedCampaignLogs.length === 0) return

    // Format log records for the spreadsheet
    const reportData = selectedCampaignLogs.map((log) => {
      const variables = Object.entries(log.variables_mapped || {})
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')

      return {
        Recipient: selectedCampaign.channel === 'email' 
          ? (log.email_address || log.phone_number || '-') 
          : (log.phone_number || log.email_address || '-'),
        Status: log.status,
        'Message SID / ID': log.message_sid || '-',
        'Variables Mapped': variables,
        'Error / Details': log.error_message || '-',
        'Sent At': new Date(log.created_at).toLocaleString()
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(reportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Delivery Logs')

    // Save and download file
    const fileName = `${selectedCampaign.name.toLowerCase().replace(/\s+/g, '_')}_delivery_logs.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  // Helper to strictly identify phone number column (excluding any column with 'name')
  const isPhoneHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    if (/name/i.test(h)) return false // Exclude Contact Name, Customer Name, Full Name, etc.
    return (
      /phone|mobile|cell|tel|whatsapp/i.test(h) ||
      /contact.*(num|no|#)/i.test(h) ||
      /phone.*(num|no|#)/i.test(h) ||
      /mobile.*(num|no|#)/i.test(h) ||
      /^(phone|mobile|cell|tel|whatsapp|contact_no|phone_no|mobile_no)$/i.test(h)
    )
  }

  const isNameHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    return (
      /^(contact\s*name|first\s*name|customer\s*name|patient\s*name|full\s*name|client\s*name|name)$/i.test(h) ||
      /contact.*name|first.*name|customer.*name|patient.*name|full.*name|client.*name|^name$/i.test(h)
    )
  }

  const isLastNameHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    return /^(last\s*name|surname)$/i.test(h) || /last.*name|surname/i.test(h)
  }

  const isTagHeader = (header: string) => {
    const h = header.trim().toLowerCase()
    return /^(tag|tags|category|group|segment|label)$/i.test(h) || /tag|category|segment/i.test(h)
  }

  // Helper to auto-map template placeholders to Excel columns or Contact attributes
  const autoDetectVariableMappings = (
    variables: string[],
    headers: string[],
    sampleVals?: Record<string, string>
  ) => {
    const mappings: Record<string, string> = {}
    const types: Record<string, 'dynamic' | 'static'> = {}
    const statics: Record<string, string> = {}

    variables.forEach((v) => {
      const isMedia = v.includes('image_url') || v.includes('video_url') || v.includes('document_url') || v.includes('filename')
      types[v] = isMedia ? 'static' : 'dynamic'
      statics[v] = sampleVals?.[v] || ''
      mappings[v] = ''

      if (!isMedia && headers.length > 0) {
        const vClean = v.toLowerCase().trim()

        // 1. Placeholder 1 or First Name / Contact Name / Name
        if (vClean === '1' || /^(first_name|name|contact_name|customer_name|patient_name|full_name)$/i.test(vClean)) {
          const matchedNameHeader = 
            headers.find(h => /^(contact\s*name|first\s*name|customer\s*name|patient\s*name|full\s*name|client\s*name|name)$/i.test(h.trim())) ||
            headers.find(h => /contact.*name|first.*name|customer.*name|patient.*name|full.*name|client.*name|^name$/i.test(h.trim())) ||
            (headers.includes('first_name') ? 'first_name' : '')
          
          if (matchedNameHeader) {
            mappings[v] = matchedNameHeader
            types[v] = 'dynamic'
          }
        }
        // 2. Placeholder 2 or Last Name / Company / Date
        else if (vClean === '2' || /^(last_name|surname|company|date|location)$/i.test(vClean)) {
          const matchedSecondHeader = 
            headers.find(h => /^(last\s*name|surname)$/i.test(h.trim())) ||
            headers.find(h => /last.*name|surname/i.test(h.trim())) ||
            headers.find(h => /^(company|organization|org)$/i.test(h.trim())) ||
            headers.find(h => /company|organization|date|appointment|city|location/i.test(h.trim())) ||
            (headers.includes('last_name') ? 'last_name' : '')

          if (matchedSecondHeader) {
            mappings[v] = matchedSecondHeader
            types[v] = 'dynamic'
          }
        }
        // 3. Placeholder 3+ or other named variables
        else {
          const exactMatch = headers.find(h => h.trim().toLowerCase() === vClean)
          if (exactMatch) {
            mappings[v] = exactMatch
            types[v] = 'dynamic'
          } else {
            const partialMatch = headers.find(h => h.trim().toLowerCase().includes(vClean) || vClean.includes(h.trim().toLowerCase()))
            if (partialMatch) {
              mappings[v] = partialMatch
              types[v] = 'dynamic'
            }
          }
        }
      }
    })

    return { mappings, types, statics }
  }

  // Handle Excel File Drop/Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setExcelFile(file)
    setErrorMsg('')

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(worksheet)
        
        if (json.length === 0) {
          setErrorMsg('The Excel sheet appears to be empty.')
          return
        }

        setExcelData(json)
        const headers = Object.keys(json[0] || {})
        setExcelHeaders(headers)
        
        // Auto-select phone or email column with strict keyword matching
        if (channel === 'email') {
          const emailKey = headers.find(h => /email|mail|e-mail/i.test(h.trim())) || ''
          setPhoneColumn(emailKey)
        } else {
          const phoneKey = headers.find(isPhoneHeader) || ''
          setPhoneColumn(phoneKey)
        }

        // Auto-detect Name, Last Name, and Tag columns
        const nameKey = headers.find(isNameHeader) || ''
        setContactNameColumn(nameKey)

        const lastNameKey = headers.find(isLastNameHeader) || ''
        setContactLastNameColumn(lastNameKey)

        const tagKey = headers.find(isTagHeader) || ''
        setContactTagColumn(tagKey)

        // Auto-detect variable mappings immediately for active template/variables
        const variablesToMap = channel === 'whatsapp' ? (selectedTemplate?.variables || []) : customVariables
        if (variablesToMap.length > 0) {
          const { mappings, types, statics } = autoDetectVariableMappings(
            variablesToMap,
            headers,
            selectedTemplate?.sampleValues
          )
          setVariableMappings(mappings)
          setVariableMappingTypes(types)
          setStaticVariableValues(statics)
        }
      } catch (err) {
        console.error(err)
        setErrorMsg('Failed to parse Excel file. Ensure it is a valid .xlsx or .xls sheet.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const resetWizard = () => {
    setWizardStep(1)
    setNewCampaignName('')
    setSelectedTemplate(null)
    setAudienceSource('excel')
    setExcelFile(null)
    setExcelData([])
    setExcelHeaders([])
    setPhoneColumn('')
    setContactNameColumn('')
    setContactLastNameColumn('')
    setContactTagColumn('')
    setCustomCampaignTag('')
    setSelectedContactIds(contacts.map(c => c.id))
    setContactSearchTerm('')
    setVariableMappings({})
    setErrorMsg('')
    setChannel('whatsapp')
    setSender('')
    setSubject('')
    setCustomMessageBody('')
    setCustomVariables([])
    setEditorMode('visual')
  }

  const startNewCampaign = () => {
    resetWizard()
    setIsCreateOpen(true)
  }

  const handleNextStep = () => {
    if (wizardStep === 1) {
      if (!newCampaignName.trim()) {
        setErrorMsg('Please specify a campaign name.')
        return
      }
      if (!sender.trim()) {
        setErrorMsg('Please select or write a sender.')
        return
      }
      if (channel === 'email' && !subject.trim()) {
        setErrorMsg('Please specify an email subject line.')
        return
      }
      if (channel === 'whatsapp' && !selectedTemplate) {
        setErrorMsg('Please select an approved template.')
        return
      }
      if ((channel === 'sms' || channel === 'email') && !customMessageBody.trim()) {
        setErrorMsg('Please specify a message body.')
        return
      }
      setErrorMsg('')
      setWizardStep(2)
    } else if (wizardStep === 2) {
      if (audienceSource === 'excel') {
        if (excelData.length === 0) {
          setErrorMsg('Please upload a valid Excel or CSV sheet.')
          return
        }
        if (!phoneColumn) {
          setErrorMsg(channel === 'email' ? 'Please select the column mapping to the recipient email address.' : 'Please select the column mapping to the recipient phone number.')
          return
        }
      } else {
        if (contacts.length === 0) {
          setErrorMsg('No contacts found in database. Create contacts first or upload Excel.')
          return
        }
        if (selectedContactIds.length === 0) {
          setErrorMsg('Please select at least one contact to message.')
          return
        }
      }
      setErrorMsg('')
      
      // Auto-detect mappings when proceeding to Step 3
      const variablesToMap = channel === 'whatsapp'
        ? (selectedTemplate?.variables || [])
        : customVariables;
      
      const headersToUse = audienceSource === 'excel' 
        ? excelHeaders 
        : ['first_name', 'last_name', 'company', 'email', 'phone_number']

      const { mappings, types, statics } = autoDetectVariableMappings(
        variablesToMap,
        headersToUse,
        selectedTemplate?.sampleValues
      )

      // Merge with any existing user selections
      setVariableMappings(prev => {
        const merged = { ...mappings }
        Object.keys(prev).forEach(k => {
          if (prev[k]) merged[k] = prev[k]
        })
        return merged
      })
      setVariableMappingTypes(prev => {
        const merged = { ...types }
        Object.keys(prev).forEach(k => {
          if (prev[k]) merged[k] = prev[k]
        })
        return merged
      })
      setStaticVariableValues(prev => {
        const merged = { ...statics }
        Object.keys(prev).forEach(k => {
          if (prev[k]) merged[k] = prev[k]
        })
        return merged
      })
      setWizardStep(3)
    } else if (wizardStep === 3) {
      // Validate mapping completed
      const unmapped = Object.entries(variableMappingTypes).filter(([tplVar, type]) => {
        if (type === 'static') {
          return !staticVariableValues[tplVar]?.trim()
        } else {
          return !variableMappings[tplVar]
        }
      })
      if (unmapped.length > 0) {
        setErrorMsg('Please complete all variable mappings or static values before proceeding.')
        return
      }
      setErrorMsg('')
      setWizardStep(4)
    }
  }

  const handlePrevStep = () => {
    setErrorMsg('')
    setWizardStep(prev => prev - 1)
  }

  // Prepares audience array using mapping choices
  const compileAudience = () => {
    if (audienceSource === 'excel') {
      return excelData.map(row => {
        const variables: Record<string, string> = {}
        Object.keys(variableMappingTypes).forEach(tplVar => {
          const type = variableMappingTypes[tplVar]
          if (type === 'static') {
            variables[tplVar] = staticVariableValues[tplVar] || ''
          } else {
            const colName = variableMappings[tplVar]
            variables[tplVar] = String(row[colName] || '')
          }
        })
        // Attach contact name, last name, and tags so CRM contacts save accurately
        if (contactNameColumn && row[contactNameColumn]) {
          variables['first_name'] = String(row[contactNameColumn] || '').trim()
          variables['contact_name'] = String(row[contactNameColumn] || '').trim()
          variables['name'] = String(row[contactNameColumn] || '').trim()
        }
        if (contactLastNameColumn && row[contactLastNameColumn]) {
          variables['last_name'] = String(row[contactLastNameColumn] || '').trim()
        }
        if (contactTagColumn && row[contactTagColumn]) {
          variables['tag'] = String(row[contactTagColumn] || '').trim()
          variables['tags'] = String(row[contactTagColumn] || '').trim()
        } else if (customCampaignTag) {
          variables['tag'] = customCampaignTag.trim()
          variables['tags'] = customCampaignTag.trim()
        }

        if (channel === 'email') {
          return {
            email: String(row[phoneColumn] || '').trim(),
            variables
          }
        } else {
          return {
            phone: String(row[phoneColumn] || '').replace(/[^\d+]/g, ''),
            variables
          }
        }
      }).filter(item => channel === 'email' ? (item.email && item.email.includes('@')) : (item.phone && item.phone.length > 5))
    } else {
      // Database contacts mapping
      const selectedContacts = contacts.filter(c => selectedContactIds.includes(c.id))
      return selectedContacts.map(c => {
        const variables: Record<string, string> = {}
        Object.keys(variableMappingTypes).forEach(tplVar => {
          const type = variableMappingTypes[tplVar]
          if (type === 'static') {
            variables[tplVar] = staticVariableValues[tplVar] || ''
          } else {
            const attr = variableMappings[tplVar]
            const key = attr as keyof Contact
            variables[tplVar] = String(c[key] || '')
          }
        })

        // Ensure default variables are always populated from contact fields if not explicitly mapped
        const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.first_name || 'Valued Customer'
        if (!variables['1']) variables['1'] = c.first_name || fullName
        if (!variables['name']) variables['name'] = c.first_name || fullName
        if (!variables['first_name']) variables['first_name'] = c.first_name || fullName
        if (!variables['contact_name']) variables['contact_name'] = fullName
        if (!variables['2'] && c.last_name) variables['2'] = c.last_name
        if (!variables['last_name'] && c.last_name) variables['last_name'] = c.last_name
        if (c.company && !variables['company']) variables['company'] = c.company
        if (Array.isArray(c.tags) && c.tags.length > 0 && !variables['tag']) variables['tag'] = c.tags.join(', ')

        if (channel === 'email') {
          return {
            email: c.email || '',
            variables
          }
        } else {
          return {
            phone: c.phone_number,
            variables
          }
        }
      }).filter(item => channel === 'email' ? (item.email && item.email.includes('@')) : (item.phone && item.phone.length > 5))
    }
  }

  const handleLaunchCampaign = async () => {
    setIsSubmitting(true)
    setErrorMsg('')
    
    try {
      const audienceList = compileAudience()
      
      if (audienceList.length === 0) {
        setErrorMsg('The derived audience list is empty. Verify recipient mappings.')
        setIsSubmitting(false)
        return
      }

      // 1. Create campaign in DB
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCampaignName,
          templateName: selectedTemplate?.whatsapp_template_name || selectedTemplate?.raw_name || selectedTemplate?.name?.split('•')[0]?.trim() || 'custom_message',
          templateBody: customMessageBody,
          templateSid: selectedTemplate?.sid || null,
          templateLanguage: selectedTemplate?.language || 'en',
          audience: audienceList,
          channel,
          sender,
          subject: channel === 'email' ? subject : undefined,
          organizationId: user?.organization_id || undefined,
          createdBy: user?.id || undefined
        })
      })

      const createData = await createRes.json()
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create campaign record.')
      }

      const campaignId = createData.campaign.id

      // 2. Trigger asynchronous background run API
      const runRes = await fetch('/api/campaigns/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId })
      })

      const runData = await runRes.json()
      if (!runRes.ok || !runData.success) {
        console.error('Trigger running error, but campaign record was created:', runData)
      }

      setIsCreateOpen(false)
      fetchCampaigns(1, true)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An unexpected error occurred during dispatch.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getPreviewMessage = () => {
    let preview = customMessageBody
    if (!preview) return ''
    
    const variablesToMap = channel === 'whatsapp' 
      ? (selectedTemplate?.variables || []) 
      : customVariables;

    // Preview with first row/contact
    if (audienceSource === 'excel' && excelData.length > 0) {
      Object.keys(variableMappingTypes).forEach(tplVar => {
        const type = variableMappingTypes[tplVar]
        let val = ''
        if (type === 'static') {
          val = staticVariableValues[tplVar] || ''
        } else {
          const colName = variableMappings[tplVar]
          val = excelData[0][colName] || `[${colName}]`
        }
        preview = preview.replace(new RegExp(`\\{\\{${tplVar}\\}\\}`, 'g'), String(val))
      })
    } else if (audienceSource === 'db' && selectedContactIds.length > 0) {
      const selectedContacts = contacts.filter(c => selectedContactIds.includes(c.id))
      Object.keys(variableMappingTypes).forEach(tplVar => {
        const type = variableMappingTypes[tplVar]
        let val = ''
        if (type === 'static') {
          val = staticVariableValues[tplVar] || ''
        } else {
          const attr = variableMappings[tplVar]
          const rawVal = selectedContacts[0][attr as keyof Contact]
          val = Array.isArray(rawVal) ? rawVal.join(', ') : (String(rawVal || '') || `[${attr}]`)
        }
        preview = preview.replace(new RegExp(`\\{\\{${tplVar}\\}\\}`, 'g'), String(val))
      })
    } else {
      // Default fallback placeholders
      variablesToMap.forEach(v => {
        const type = variableMappingTypes[v]
        const val = type === 'static' ? (staticVariableValues[v] || `[Static ${v}]`) : `[Value ${v}]`
        preview = preview.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), val)
      })
    }
    return preview
  }

  // Stats
  const totalCampaigns = campaigns.length
  const totalSent = campaigns.reduce((acc, c) => acc + c.sent_count, 0)
  const totalFailed = campaigns.reduce((acc, c) => acc + c.failed_count, 0)
  const totalContacts = campaigns.reduce((acc, c) => acc + c.total_contacts, 0)
  const successRate = totalSent + totalFailed > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 0

  // Filter campaigns locally based on search query, channel selection, and status selection
  const filteredCampaigns = campaigns.filter(c => {
    const nameMatch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                      c.template_name.toLowerCase().includes(searchTerm.toLowerCase())
    const chan = c.channel || 'whatsapp'
    const channelMatch = filterChannel === 'all' || chan === filterChannel
    const statusMatch = filterStatus === 'all' || 
                        (filterStatus === 'sending' && (c.status === 'PROCESSING' || c.status === 'PENDING')) ||
                        (filterStatus === 'completed' && c.status === 'COMPLETED') ||
                        (filterStatus === 'failed' && c.status === 'FAILED')
    return nameMatch && channelMatch && statusMatch
  })

  // Sub-renderers for clean structure and to avoid truncation errors
  const renderHeader = () => (
    <div className="bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#2a3942] p-4 md:py-5 md:px-6 relative flex-shrink-0">
      <div className="max-w-6xl mx-auto flex flex-row items-center justify-between gap-3 relative z-10">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-[#008069] dark:text-emerald-400 stroke-[2.5] shrink-0" />
            <h1 className="text-base md:text-xl font-bold text-[#111b21] dark:text-white tracking-tight">
              Bulk Campaigns
            </h1>
          </div>
          <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-semibold mt-1">
            {totalCampaigns} total campaigns · {campaigns.filter(c => c.status === 'COMPLETED').length} completed · {campaigns.filter(c => c.status === 'PROCESSING' || c.status === 'PENDING').length} active
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <button 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-9 px-3 bg-white dark:bg-[#202d36] hover:bg-slate-50 dark:hover:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-lg text-[#008069] dark:text-emerald-400 flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer disabled:opacity-40"
            title="Refresh campaigns"
          >
            <RefreshCw size={12} className={`${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
          <button 
            onClick={startNewCampaign}
            className="h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#008069] text-white flex items-center gap-1.5 text-xs font-bold shadow-sm transition-all cursor-pointer hover:scale-[1.01]"
          >
            <Plus size={14} strokeWidth={2.5} />
            <span>Launch Campaign</span>
          </button>
        </div>
      </div>
    </div>
  )

  const renderStatsGrid = () => (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex items-center gap-3.5 hover:shadow-sm transition-all">
        <div className="h-10 w-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white shrink-0">
          <Send size={15} />
        </div>
        <div className="min-w-0">
          <span className="text-[9px] uppercase font-black tracking-widest text-[#8696a0] block truncate">Delivered</span>
          <p className="text-lg font-black text-[#111b21] dark:text-white leading-none mt-1">{totalSent}</p>
        </div>
      </div>
      <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex items-center gap-3.5 hover:shadow-sm transition-all">
        <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
          <TrendingUp size={15} />
        </div>
        <div className="min-w-0">
          <span className="text-[9px] uppercase font-black tracking-widest text-[#8696a0] block truncate">Avg Success</span>
          <p className="text-lg font-black text-blue-600 dark:text-blue-400 leading-none mt-1">{successRate}%</p>
        </div>
      </div>
      <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex items-center gap-3.5 hover:shadow-sm transition-all">
        <div className="h-10 w-10 rounded-lg bg-red-500 flex items-center justify-center text-white shrink-0">
          <AlertCircle size={15} />
        </div>
        <div className="min-w-0">
          <span className="text-[9px] uppercase font-black tracking-widest text-[#8696a0] block truncate">Failed</span>
          <p className="text-lg font-black text-red-500 dark:text-red-400 leading-none mt-1">{totalFailed}</p>
        </div>
      </div>
      <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex items-center gap-3.5 hover:shadow-sm transition-all">
        <div className="h-10 w-10 rounded-lg bg-slate-600 flex items-center justify-center text-white shrink-0">
          <Target size={15} />
        </div>
        <div className="min-w-0">
          <span className="text-[9px] uppercase font-black tracking-widest text-[#8696a0] block truncate">Total Dispatched</span>
          <p className="text-lg font-black text-[#111b21] dark:text-white leading-none mt-1">{totalContacts}</p>
        </div>
      </div>
    </div>
  )

  const renderFiltersBar = () => (
    <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex-1 max-w-sm">
        <input 
          type="text" 
          placeholder="Search campaigns..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 bg-slate-50 dark:bg-[#202d36]/40 border border-[#e9edef] dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-[#111b21] dark:text-white"
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-slate-100 dark:bg-[#202d36] p-0.5 rounded-lg border border-slate-150 dark:border-slate-800">
          {[
            { value: 'all', label: 'All' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'sms', label: 'SMS' },
            { value: 'email', label: 'Email' }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilterChannel(opt.value as any)}
              className={`px-3 py-1 text-[11px] font-bold rounded transition-all cursor-pointer ${
                filterChannel === opt.value
                  ? 'bg-white dark:bg-[#2a3942] text-[#008069] dark:text-emerald-400 shadow-xs'
                  : 'text-[#667781] dark:text-[#8696a0]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-2 py-1.5 bg-slate-50 dark:bg-[#202d36] border border-[#e9edef] dark:border-slate-700 rounded-lg text-xs text-[#111b21] dark:text-white font-semibold cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="sending">Sending</option>
          <option value="failed">Failed</option>
        </select>
      </div>
    </div>
  )

  const renderCampaignList = () => (
    <div className="space-y-3.5">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl shadow-xs">
          <Loader2 className="animate-spin text-[#00a884] mb-2" size={24} />
          <span className="text-xs text-[#8696a0]">Loading campaign records...</span>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center p-12 py-16 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl shadow-xs">
          <Megaphone className="text-[#8696a0] mb-3 opacity-60" size={24} />
          <p className="font-bold text-xs text-[#111b21] dark:text-white">No campaigns match search filters</p>
          <p className="text-[10px] mt-1 text-[#667781] dark:text-[#8696a0]">Launch a new campaign using the top right button.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredCampaigns.map((c) => {
            const isProcessing = c.status === 'PROCESSING' || c.status === 'PENDING'
            const progressPct = c.total_contacts > 0 ? Math.round(((c.sent_count + c.failed_count) / c.total_contacts) * 100) : 0
            
            const channelIcon = (() => {
              const chan = c.channel || 'whatsapp'
              if (chan === 'email') return <Mail size={13} className="text-blue-600" />
              if (chan === 'sms') return <MessageSquare size={13} className="text-amber-600" />
              return <Phone size={13} className="text-[#008069]" />
            })()

            const channelBadgeColor = (() => {
              const chan = c.channel || 'whatsapp'
              if (chan === 'email') return 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 border-blue-100 dark:border-blue-900/30'
              if (chan === 'sms') return 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 border-amber-100 dark:border-amber-900/30'
              return 'bg-[#e7f7f4] dark:bg-emerald-950/20 text-[#008069] border-[#00a884]/20'
            })()

            return (
              <div 
                key={c.id}
                onClick={() => fetchCampaignDetails(c.id)}
                className="bg-white dark:bg-[#1f2c34] p-3 md:p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 group"
              >
                <div className="flex-1 min-w-0 flex items-start gap-2.5">
                  <div className={`h-8 w-8 md:h-9 md:w-9 rounded-lg flex items-center justify-center shrink-0 border ${channelBadgeColor}`}>
                    {channelIcon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-xs text-[#111b21] dark:text-white truncate group-hover:text-[#008069] dark:group-hover:text-emerald-400 transition-colors">{c.name}</h3>
                    <div className="flex flex-wrap items-center gap-x-1.5 mt-0.5 text-[9px] md:text-[10px] text-[#8696a0] font-semibold">
                      <span>Template: <strong className="text-[#54656f] dark:text-[#8696a0]">{c.template_name}</strong></span>
                      <span>•</span>
                      <span>{new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-56 shrink-0 space-y-1">
                  <div className="flex justify-between items-center text-[9px] text-[#667781] dark:text-[#8696a0] font-bold">
                    <span>Dispatch progress:</span>
                    <span className="font-mono">{c.sent_count + c.failed_count} / {c.total_contacts} ({progressPct}%)</span>
                  </div>
                  <div className="h-1.5 bg-[#e9edef] dark:bg-[#202d36] rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        c.status === 'FAILED' ? 'bg-red-500' :
                        isProcessing ? 'bg-amber-400' :
                        'bg-[#008069]'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
                  <span className={`text-[9px] font-black px-2 py-0.5 md:py-1 rounded border ${
                    c.status === 'COMPLETED' ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border-emerald-100 dark:border-emerald-900/30' :
                    c.status === 'PROCESSING' ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 border-amber-100 dark:border-amber-900/30 animate-pulse' :
                    c.status === 'STOPPED' || c.status === 'CANCELLED' ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 border-rose-100 dark:border-rose-900/30' :
                    c.status === 'FAILED' ? 'bg-red-50 dark:bg-red-950/20 text-red-600 border-red-150 dark:border-red-900/30' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-150'
                  }`}>
                    {c.status}
                  </span>

                  {/* Stop / Rerun Actions */}
                  {(c.status === 'PROCESSING' || c.status === 'PENDING') ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStopCampaign(c.id)
                      }}
                      disabled={actionLoadingId === c.id}
                      className="h-7 md:h-8 px-2 md:px-2.5 rounded border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 text-[9px] md:text-[10px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer shrink-0 transition-colors disabled:opacity-50"
                      title="Stop Campaign execution"
                    >
                      {actionLoadingId === c.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Square size={10} className="fill-current" />
                      )}
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRerunCampaign(c.id, 'failed_only')
                      }}
                      disabled={actionLoadingId === c.id}
                      className="h-7 md:h-8 px-2 md:px-2.5 rounded border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 text-[9px] md:text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 cursor-pointer shrink-0 transition-colors disabled:opacity-50"
                      title="Rerun failed & pending recipients only"
                    >
                      {actionLoadingId === c.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RotateCcw size={11} />
                      )}
                      <span>Rerun Failed & Pending</span>
                    </button>
                  )}
                  
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        const res = await fetch(`/api/campaigns?id=${c.id}`)
                        const data = await res.json()
                        if (data.success && data.logs) {
                          const reportData = data.logs.map((log: any) => {
                            const variables = Object.entries(log.variables_mapped || {})
                              .map(([k, v]) => `${k}:${v}`)
                              .join(', ')
                            return {
                              Recipient: c.channel === 'email' 
                                ? (log.email_address || log.phone_number || '-') 
                                : (log.phone_number || log.email_address || '-'),
                              Status: log.status,
                              'Message SID / ID': log.message_sid || '-',
                              'Variables Mapped': variables,
                              'Error / Details': log.error_message || '-',
                              'Sent At': new Date(log.created_at).toLocaleString()
                            }
                          })
                          const worksheet = XLSX.utils.json_to_sheet(reportData)
                          const workbook = XLSX.utils.book_new()
                          XLSX.utils.book_append_sheet(workbook, worksheet, 'Logs')
                          XLSX.writeFile(workbook, `${c.name.toLowerCase().replace(/\s+/g, '_')}_report.xlsx`)
                        }
                      } catch (err) {
                        console.error('Error downloading log report from card:', err)
                      }
                    }}
                    className="h-7 md:h-8 w-7 md:w-8 rounded border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                    title="Download Excel Report"
                  >
                    <FileSpreadsheet size={12} className="text-[#008069] dark:text-emerald-400" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      fetchCampaignDetails(c.id)
                    }}
                    className="h-7 md:h-8 px-2 md:px-2.5 rounded border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] text-[9px] md:text-[10px] font-bold text-[#54656f] dark:text-[#8696a0] flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Eye size={11} className="md:size-3" />
                    <span>Stats</span>
                  </button>
                </div>

              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderPagination = () => {
    if (totalPages <= 1) return null

    const pageNumbers = []
    const maxVisiblePages = 5
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2))
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1)

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1)
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(i)
    }

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 mt-2 border-t border-[#e9edef] dark:border-[#2a3942]">
        <div className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0]">
          Showing <span className="text-[#111b21] dark:text-white">{(currentPage - 1) * 10 + 1}</span> to{' '}
          <span className="text-[#111b21] dark:text-white">{Math.min(currentPage * 10, totalCampaignsCount)}</span> of{' '}
          <span className="text-[#111b21] dark:text-white">{totalCampaignsCount}</span> campaigns
        </div>
        
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => fetchCampaigns(currentPage - 1)}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"
            title="Previous page"
          >
            <ChevronLeft size={14} />
          </button>

          {startPage > 1 && (
            <>
              <button
                type="button"
                onClick={() => fetchCampaigns(1)}
                className={`h-8 px-3 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                  currentPage === 1
                    ? 'bg-[#008069] text-white shadow-xs'
                    : 'border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0]'
                }`}
              >
                1
              </button>
              {startPage > 2 && (
                <span className="text-[11px] font-bold text-[#8696a0] px-1 select-none">...</span>
              )}
            </>
          )}

          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => fetchCampaigns(page)}
              className={`h-8 w-8 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                currentPage === page
                  ? 'bg-[#008069] text-white shadow-xs font-black'
                  : 'border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0]'
              }`}
            >
              {page}
            </button>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && (
                <span className="text-[11px] font-bold text-[#8696a0] px-1 select-none">...</span>
              )}
              <button
                type="button"
                onClick={() => fetchCampaigns(totalPages)}
                className={`h-8 px-3 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                  currentPage === totalPages
                    ? 'bg-[#008069] text-white shadow-xs'
                    : 'border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0]'
                }`}
              >
                {totalPages}
              </button>
            </>
          )}

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => fetchCampaigns(currentPage + 1)}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e9edef] dark:border-slate-700 bg-white dark:bg-[#202d36] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"
            title="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    )
  }

  const renderDetailsModal = () => {
    if (!selectedCampaign) return null

    return (
      <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center z-50 p-4 md:p-6 select-none animate-in fade-in duration-200">
        <div className="bg-white dark:bg-[#1c282f] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 border dark:border-[#2a3942]">
          
          {/* Modal Header */}
          <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-5 py-4 flex items-center justify-between flex-shrink-0 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#008069] via-[#00a884] to-[#00c49a]" />
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[#111b21] dark:text-white truncate leading-tight">{selectedCampaign.name}</h2>
              <div className="flex flex-wrap items-center gap-x-2 mt-1.5 text-[10px] font-bold text-[#8696a0]">
                <span>{new Date(selectedCampaign.created_at).toLocaleString()}</span>
                <span>•</span>
                <span className="uppercase text-[#008069]">{(selectedCampaign.channel || 'whatsapp')}</span>
                {selectedCampaign.sender && (
                  <>
                    <span>•</span>
                    <span className="font-mono truncate max-w-[150px]">sender: {selectedCampaign.sender}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {(selectedCampaign.status === 'PROCESSING' || selectedCampaign.status === 'PENDING') ? (
                <button
                  type="button"
                  onClick={() => handleStopCampaign(selectedCampaign.id)}
                  disabled={actionLoadingId === selectedCampaign.id}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Stop Campaign execution"
                >
                  {actionLoadingId === selectedCampaign.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Square size={10} className="fill-current" />
                  )}
                  <span>Stop Campaign</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRerunCampaign(selectedCampaign.id, 'failed_only')}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Rerun failed and pending recipients only"
                  >
                    {actionLoadingId === selectedCampaign.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    <span>Rerun Failed & Pending</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRerunCampaign(selectedCampaign.id, 'all')}
                    disabled={actionLoadingId === selectedCampaign.id}
                    className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Reset and rerun full campaign for all recipients"
                  >
                    <span>Rerun All</span>
                  </button>
                </div>
              )}

              <button
                onClick={() => fetchCampaignDetails(selectedCampaign.id)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-[#8696a0] cursor-pointer transition-colors"
                title="Reload data"
              >
                <RefreshCw size={14} />
              </button>
              <button 
                onClick={() => setSelectedCampaign(null)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-[#54656f] dark:text-[#8696a0] cursor-pointer transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scrollable contents */}
          <div className="flex-1 overflow-y-auto space-y-4 p-5 pb-8 scrollbar-thin bg-slate-50/35 dark:bg-[#121b22]/20">
            
            {/* Modal Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[8px] font-black uppercase text-[#8696a0]">Targets</div>
                <div className="text-base font-black text-[#111b21] dark:text-white mt-1">{selectedCampaign.total_contacts}</div>
              </div>
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[8px] font-black uppercase text-emerald-600 dark:text-emerald-400">Sent</div>
                <div className="text-base font-black text-[#008069] dark:text-emerald-400 mt-1">{selectedCampaign.sent_count}</div>
              </div>
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[8px] font-black uppercase text-red-500">Failed</div>
                <div className="text-base font-black text-red-500 mt-1">{selectedCampaign.failed_count}</div>
              </div>
              <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
                <div className="text-[8px] font-black uppercase text-blue-600 dark:text-blue-400">Success</div>
                <div className="text-base font-black text-blue-600 dark:text-blue-400 mt-1">
                  {selectedCampaign.total_contacts > 0 
                    ? Math.round((selectedCampaign.sent_count / selectedCampaign.total_contacts) * 100) 
                    : 0}%
                </div>
              </div>
            </div>

            {/* Message Content Preview */}
            <div className="p-4 bg-white dark:bg-[#1f2c34] rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#667781] dark:text-[#8696a0]">
                  <FileText size={14} className="text-[#00a884]" />
                  <span>MESSAGE CONTENT</span>
                </div>
                {selectedCampaign.channel === 'email' && /<[a-z][\s\S]*>/i.test(selectedCampaign.template_body || '') && (
                  <div className="flex bg-[#f0f2f5] dark:bg-[#202d36] p-0.5 rounded-lg border border-[#e9edef] dark:border-[#2a3942]">
                    <button
                      type="button"
                      onClick={() => setDetailsPreviewMode('preview')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                        detailsPreviewMode === 'preview'
                          ? 'bg-white dark:bg-slate-700 text-[#111b21] dark:text-white shadow-xs'
                          : 'text-[#667781] dark:text-[#8696a0]'
                      }`}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailsPreviewMode('raw')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                        detailsPreviewMode === 'raw'
                          ? 'bg-white dark:bg-slate-700 text-[#111b21] dark:text-white shadow-xs'
                          : 'text-[#667781] dark:text-[#8696a0]'
                      }`}
                    >
                      HTML
                    </button>
                  </div>
                )}
              </div>

              {selectedCampaign.channel === 'email' && /<[a-z][\s\S]*>/i.test(selectedCampaign.template_body || '') && detailsPreviewMode === 'preview' ? (
                <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-lg overflow-hidden bg-white dark:bg-slate-900 max-w-full shadow-inner">
                  <iframe
                    srcDoc={selectedCampaign.template_body}
                    title="Email Template Preview"
                    className="w-full h-60 border-0"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : selectedCampaign.channel === 'whatsapp' ? (
                <div className="flex justify-start">
                  <div className="bg-[#efeae2] dark:bg-[#0b141a]/60 p-4 rounded-xl border border-emerald-100 dark:border-emerald-950/20 max-w-lg w-full shadow-inner relative">
                    <div className="bg-white dark:bg-[#1f2c34] rounded-lg p-3 text-xs leading-relaxed text-[#111b21] dark:text-white shadow-sm relative rounded-tl-none font-sans max-w-[90%]">
                      <p className="whitespace-pre-wrap break-words">{selectedCampaign.template_body}</p>
                      <div className="text-[8px] text-[#8696a0] text-right mt-1 font-semibold">
                        {new Date(selectedCampaign.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#f8f9fa] dark:bg-[#1c282f] border border-[#e9edef] dark:border-[#2a3942] text-xs font-mono text-[#54656f] dark:text-[#8696a0] whitespace-pre-wrap max-h-40 overflow-y-auto shadow-inner">
                  {selectedCampaign.template_body}
                </div>
              )}
            </div>

            {/* Delivery Logs Table */}
            <div className="p-4 bg-white dark:bg-[#1f2c34] rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-3 text-xs font-bold text-[#667781] dark:text-[#8696a0]">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-[#00a884]" />
                  <span>DELIVERY LOGS</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCampaignLogs.length > 0 && (
                    <button
                      onClick={handleDownloadLogsReport}
                      className="h-7 px-2.5 rounded border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/25 hover:bg-[#e7f7f4] dark:hover:bg-[#008069]/10 text-[9px] md:text-[10px] font-bold text-[#008069] dark:text-emerald-400 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Export logs to Excel"
                    >
                      <FileSpreadsheet size={11} />
                      <span>Download Report</span>
                    </button>
                  )}
                  <span className="text-[10px] bg-slate-100 dark:bg-[#2a3942] px-2 py-0.5 rounded text-[#54656f] dark:text-[#8696a0]">
                    {selectedCampaignLogs.length} messages
                  </span>
                </div>
              </div>

              <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-lg overflow-hidden shadow-xs">
                {isLoadingLogs ? (
                  <div className="flex flex-col items-center justify-center h-40 bg-[#f8f9fa] dark:bg-[#202d36]/20">
                    <Loader2 className="animate-spin text-[#00a884] mb-2" size={20} />
                    <span className="text-xs text-[#8696a0]">Loading log entries...</span>
                  </div>
                ) : selectedCampaignLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 bg-[#f8f9fa] dark:bg-[#202d36]/20 text-[#8696a0] text-xs">
                    No logs found.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-60 overflow-y-auto scrollbar-thin">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#f8f9fa] dark:bg-[#202d36] border-b border-[#e9edef] dark:border-[#2a3942] text-[#667781] dark:text-[#8696a0] font-bold sticky top-0 z-10">
                          <th className="p-2.5 font-bold">Recipient</th>
                          <th className="p-2.5 font-bold">Status</th>
                          <th className="p-2.5 font-bold">Variables</th>
                          <th className="p-2.5 font-bold">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f5f6f6] dark:divide-[#2a3942]/65 bg-white dark:bg-[#1f2c34]">
                        {selectedCampaignLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-[#f8f9fa]/50 dark:hover:bg-[#2a3942]/20">
                            <td className="p-2.5 font-bold text-[#111b21] dark:text-white truncate max-w-[140px]">
                              {selectedCampaign.channel === 'email' 
                                ? (log.email_address || log.phone_number || '-') 
                                : (log.phone_number || log.email_address || '-')}
                            </td>
                            <td className="p-2.5">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-black text-[9px] ${
                                log.status === 'SENT' ? 'bg-emerald-50 dark:bg-emerald-950/20 text-[#008069]' : 'bg-red-50 dark:bg-red-950/20 text-red-650'
                              }`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="p-2.5">
                              <div className="flex flex-wrap gap-1 max-w-[160px]">
                                {Object.entries(log.variables_mapped).map(([k, v]) => (
                                  <span key={k} className="bg-slate-50 dark:bg-slate-850 px-1 py-0.5 rounded text-[8px] border border-slate-100 dark:border-slate-800 text-[#54656f] dark:text-[#8696a0] font-bold font-mono">
                                    {k}:{String(v)}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-2.5 text-red-500 max-w-[120px] truncate" title={log.error_message || ''}>
                              {log.error_message || log.message_sid || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Modal Footer */}
          <div className="px-5 py-4 bg-[#f0f2f5] dark:bg-[#1f2c34] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-end flex-shrink-0">
            <button
              onClick={() => setSelectedCampaign(null)}
              className="px-4 py-2 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#e9edef] rounded-xl text-xs font-bold transition-all cursor-pointer border border-[#e9edef] dark:border-[#2a3942]"
            >
              Close
            </button>
          </div>

        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#f0f2f5] dark:bg-[#0b141a] overflow-hidden relative select-none">
      {renderHeader()}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0 bg-slate-50/50 dark:bg-[#0c1317]">
        <div className="max-w-6xl mx-auto space-y-6">
          {renderStatsGrid()}
          {renderFiltersBar()}
          {renderCampaignList()}
          {renderPagination()}
        </div>
      </div>
      {renderDetailsModal()}

      {/* Creation Wizard Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#1c282f] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200 border dark:border-[#2a3942]">
            {/* Modal Header */}
            <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-[#111b21] dark:text-white">Create Bulk Campaign</h3>
                <p className="text-[10px] text-[#667781] dark:text-[#8696a0] mt-0.5">Step {wizardStep} of 4: {
                  wizardStep === 1 ? 'Details & Template' :
                  wizardStep === 2 ? 'Select Target Audience' :
                  wizardStep === 3 ? 'Map Variables' :
                  'Launch Confirmation'
                }</p>
              </div>
              <button 
                onClick={() => setIsCreateOpen(false)}
                className="p-1 hover:bg-[#e9edef] rounded-full text-[#54656f] dark:text-[#8696a0] transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-white dark:bg-[#1c282f]">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-xs text-red-600">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* STEP 1: Details & Template Selection */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Campaign Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. June Promotional Discount"
                      value={newCampaignName}
                      onChange={(e) => setNewCampaignName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-[#111b21] dark:text-white"
                    />
                  </div>

                  {/* Channel Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Campaign Channel</label>
                    <div className="grid grid-cols-3 gap-2">
                      {features.enable_messages && availableSenders.whatsappSenders.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setChannel('whatsapp')}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            channel === 'whatsapp'
                              ? 'bg-[#e7f7f4] border-[#00a884] text-[#008069]'
                              : 'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                          }`}
                        >
                          WhatsApp
                        </button>
                      )}
                      {features.enable_messages && features.enable_sms && availableSenders.smsSenders.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setChannel('sms')}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            channel === 'sms'
                              ? 'bg-amber-50 border-amber-500 text-amber-700'
                              : 'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                          }`}
                        >
                          SMS
                        </button>
                      )}
                      {features.enable_email && availableSenders.emailSenders.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setChannel('email')}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            channel === 'email'
                              ? 'bg-blue-50 border-blue-500 text-blue-700'
                              : 'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                          }`}
                        >
                          Email
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sender Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Sender (From)</label>
                    {isLoadingSenders ? (
                      <div className="text-xs text-[#8696a0] flex items-center gap-1.5 py-1">
                        <Loader2 size={12} className="animate-spin text-[#00a884]" />
                        <span>Fetching senders...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <select
                          value={sender}
                          onChange={(e) => setSender(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                        >
                          <option value="">-- Choose Sender ID / Number --</option>
                          {channel === 'whatsapp' && availableSenders.whatsappSenders.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                          {channel === 'sms' && availableSenders.smsSenders.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                          {channel === 'email' && availableSenders.emailSenders.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                          <option value="custom_write_in">-- Write Custom Sender --</option>
                        </select>
                        
                        {(sender === 'custom_write_in' || !availableSenders[channel === 'whatsapp' ? 'whatsappSenders' : channel === 'sms' ? 'smsSenders' : 'emailSenders']?.some(s => s.value === sender)) && (
                          <input
                            type="text"
                            placeholder={
                              channel === 'email' ? 'e.g. sales@yourdomain.com' :
                              channel === 'sms' ? 'e.g. +1234567890 or service SID' :
                              'e.g. whatsapp:+1234567890'
                            }
                            value={sender === 'custom_write_in' ? '' : sender}
                            onChange={(e) => setSender(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-semibold text-[#111b21] dark:text-white"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Email Subject Selection */}
                  {channel === 'email' && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Email Subject</label>
                      <input 
                        type="text" 
                        placeholder="Enter email subject line..."
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">
                      {channel === 'whatsapp' ? 'Approved Gateway Template' : 'Choose Base Template (Optional)'}
                    </label>
                    <select
                      value={selectedTemplate?.sid || ''}
                      onChange={(e) => {
                        const tpl = templates.find(t => t.sid === e.target.value) || null
                        setSelectedTemplate(tpl)
                      }}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-[#111b21] dark:text-white border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                    >
                      <option value="">
                        {channel === 'whatsapp' ? '-- Choose approved template --' : '-- Write custom message or choose template --'}
                      </option>
                      {templates.map(t => {
                        const statusTag = t.approval_status === 'APPROVED' ? '✓ Approved' : t.approval_status === 'REJECTED' ? '✕ Rejected' : t.approval_status === 'PENDING' ? '⏳ Pending' : '✓'
                        const langTag = t.language ? `[${t.language}]` : '[en]'
                        const catTag = t.category ? `[${t.category}]` : ''
                        return (
                          <option key={t.sid} value={t.sid}>
                            {t.whatsapp_template_name || t.raw_name || t.name} • {statusTag} {langTag} {catTag}
                          </option>
                        )
                      })}
                    </select>

                    {/* Selected Template Details Card */}
                    {selectedTemplate && channel === 'whatsapp' && (
                      <div className="mt-2 p-3.5 bg-slate-50 dark:bg-[#1f2c34] rounded-xl border border-slate-200 dark:border-[#2a3942] space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-800 dark:text-white">
                              {selectedTemplate.whatsapp_template_name || selectedTemplate.raw_name || selectedTemplate.name}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              selectedTemplate.approval_status === 'APPROVED' || !selectedTemplate.approval_status
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                : selectedTemplate.approval_status === 'PENDING'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                            }`}>
                              {selectedTemplate.approval_status === 'APPROVED' || !selectedTemplate.approval_status ? '✓ WhatsApp Approved' : selectedTemplate.approval_status}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] font-mono">
                            <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-semibold border border-slate-300 dark:border-slate-700">
                              Language: {selectedTemplate.language || 'en'}
                            </span>
                            <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-semibold border border-blue-200 dark:border-blue-800">
                              {selectedTemplate.category || 'UTILITY'}
                            </span>
                            <span className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-semibold border border-purple-200 dark:border-purple-800">
                              {selectedTemplate.source === 'meta' ? 'Meta Cloud' : selectedTemplate.source === 'twilio' ? 'Twilio Content' : 'Custom'}
                            </span>
                          </div>
                        </div>

                        <div className="p-2.5 bg-white dark:bg-[#111b21] rounded-lg border border-slate-200 dark:border-[#3b4a54] text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed">
                          {selectedTemplate.body}
                        </div>

                        {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Placeholders:</span>
                            {selectedTemplate.variables.map(v => (
                              <span key={v} className="bg-[#00a884]/10 text-[#00a884] dark:bg-[#00a884]/20 border border-[#00a884]/30 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
                                {"{{"}{v}{"}}"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {channel === 'whatsapp' && templateFetchError && (
                      <div className="mt-1 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-250/30 text-xs flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                          <AlertCircle size={13} className="shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
                          <span>WhatsApp API Credentials Issue</span>
                        </div>
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-normal">
                          {templateFetchError}
                        </p>
                        <a 
                          href="/dashboard/settings" 
                          className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline mt-0.5"
                        >
                          Go to Settings → Credentials to update token & IDs
                        </a>
                      </div>
                    )}

                    {/* Add Template inline panel */}
                    {channel === 'whatsapp' && (
                      <div>
                        {!showAddTemplate ? (
                          <button
                            type="button"
                            onClick={() => setShowAddTemplate(true)}
                            className="text-[10px] font-semibold text-[#00a884] hover:text-[#00876d] flex items-center gap-1 mt-1 cursor-pointer"
                          >
                            <span className="text-base leading-none">+</span> Register Meta-approved template
                          </button>
                        ) : (
                          <div className="mt-2 p-3 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-xl border border-[#e9edef] dark:border-[#3b4a54] flex flex-col gap-2">
                            <p className="text-[10px] font-bold text-[#54656f] dark:text-[#8696a0] uppercase tracking-wide">Add Approved Template</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-[#54656f] dark:text-[#8696a0] font-semibold">Name</label>
                                <input
                                  type="text"
                                  placeholder="e.g. form_filling"
                                  value={newTplName}
                                  onChange={e => setNewTplName(e.target.value)}
                                  className="w-full mt-0.5 px-2.5 py-1.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#3b4a54] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-[#54656f] dark:text-[#8696a0] font-semibold">Category</label>
                                <select
                                  value={newTplCategory}
                                  onChange={e => setNewTplCategory(e.target.value)}
                                  className="w-full mt-0.5 px-2.5 py-1.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#3b4a54] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                                >
                                  <option value="UTILITY">Utility</option>
                                  <option value="MARKETING">Marketing</option>
                                  <option value="AUTHENTICATION">Authentication</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] text-[#54656f] dark:text-[#8696a0] font-semibold">Message Body</label>
                              <textarea
                                rows={3}
                                placeholder="Enter template body. Use {{1}}, {{2}} for variables."
                                value={newTplBody}
                                onChange={e => setNewTplBody(e.target.value)}
                                className="w-full mt-0.5 px-2.5 py-1.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#3b4a54] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono resize-none dark:text-white"
                              />
                            </div>
                            {newTplError && <p className="text-[10px] text-red-500">{newTplError}</p>}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={newTplSaving}
                                onClick={handleSaveNewTemplate}
                                className="flex-1 py-1.5 text-xs font-bold bg-[#00a884] hover:bg-[#00876d] text-white rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {newTplSaving ? 'Saving...' : 'Save Template'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setShowAddTemplate(false); setNewTplError('') }}
                                className="px-3 py-1.5 text-xs font-bold text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white border border-[#e9edef] dark:border-[#3b4a54] rounded-lg transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Message Body</label>
                      {channel === 'email' && (
                        <div className="flex bg-[#f0f2f5] p-0.5 rounded-lg border border-[#e9edef]">
                          <button
                            type="button"
                            onClick={() => setEditorMode('visual')}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              editorMode === 'visual'
                                ? 'bg-white text-[#111b21] dark:text-white shadow-sm'
                                : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white'
                            }`}
                          >
                            Visual Editor
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditorMode('code')}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              editorMode === 'code'
                                ? 'bg-white text-[#111b21] dark:text-white shadow-sm'
                                : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white'
                            }`}
                          >
                            HTML Code / Plain Text
                          </button>
                        </div>
                      )}
                    </div>
                    {channel === 'whatsapp' ? (
                      <textarea
                        readOnly
                        placeholder="Select a WhatsApp template above to populate message body..."
                        value={customMessageBody}
                        rows={4}
                        className="w-full px-3.5 py-2.5 bg-[#f8f9fa] border border-[#e9edef] rounded-xl text-xs focus:outline-none font-mono resize-none text-[#667781] dark:text-[#8696a0]"
                      />
                    ) : channel === 'email' && editorMode === 'visual' ? (
                      <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-xl overflow-hidden bg-white dark:bg-[#2a3942] focus-within:ring-1 focus-within:ring-[#00a884]">
                        {/* Formatting Toolbar */}
                        <div className="flex flex-wrap items-center gap-1 bg-[#f0f2f5] border-b border-[#e9edef] p-1.5 select-none">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('bold', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Bold"
                          >
                            <Bold size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('italic', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Italic"
                          >
                            <Italic size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('underline', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Underline"
                          >
                            <Underline size={14} />
                          </button>
                          <div className="w-px h-4 bg-[#e9edef] mx-1" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('insertUnorderedList', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Bullet List"
                          >
                            <List size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('insertOrderedList', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Numbered List"
                          >
                            <ListOrdered size={14} />
                          </button>
                          <div className="w-px h-4 bg-[#e9edef] mx-1" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('justifyLeft', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Align Left"
                          >
                            <AlignLeft size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('justifyCenter', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Align Center"
                          >
                            <AlignCenter size={14} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('justifyRight', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all"
                            title="Align Right"
                          >
                            <AlignRight size={14} />
                          </button>
                          <div className="w-px h-4 bg-[#e9edef] mx-1" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              document.execCommand('removeFormat', false)
                            }}
                            className="p-1.5 hover:bg-[#e9edef] rounded text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white transition-all text-xs font-bold px-2"
                            title="Clear Formatting"
                          >
                            Tx
                          </button>
                        </div>
                        {/* contentEditable editor */}
                        <div
                          ref={visualEditorRef}
                          contentEditable
                          onInput={handleVisualEditorInput}
                          className="min-h-[160px] max-h-[320px] p-3.5 text-xs focus:outline-none overflow-y-auto text-[#111b21] dark:text-white font-sans prose prose-sm max-w-none"
                          data-placeholder="Type or format your rich email template here..."
                        />
                        <style dangerouslySetInnerHTML={{ __html: `
                          [contenteditable]:empty:before {
                            content: attr(data-placeholder);
                            color: #8696a0;
                            cursor: text;
                          }
                        `}} />
                      </div>
                    ) : (
                      <textarea
                        placeholder="Compose your custom message here... Use {{name}} or {{1}} placeholders to map columns dynamically."
                        value={customMessageBody}
                        onChange={(e) => handleCustomMessageBodyChange(e.target.value)}
                        rows={5}
                        className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono resize-y text-[#111b21] dark:text-white"
                      />
                    )}
                    {customVariables.length > 0 && (
                      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0]">Detected Variables:</span>
                        {customVariables.map(v => (
                          <span key={v} className="bg-[#00a884]/10 border border-[#00a884]/20 text-[#008069] text-[10px] px-1.5 py-0.5 rounded-md font-bold font-mono">
                            {"{{"}{v}{"}}"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: Select Target Audience */}
              {wizardStep === 2 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setAudienceSource('excel')
                        setErrorMsg('')
                      }}
                      className={`p-4 rounded-xl border text-center flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200 ${
                        audienceSource === 'excel'
                          ? 'border-[#00a884] bg-[#e7f7f4]/40 text-[#008069]'
                          : 'border-[#e9edef] bg-white hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                      }`}
                    >
                      <FileSpreadsheet size={24} />
                      <span className="font-bold text-xs">Upload Excel / CSV</span>
                      <span className="text-[10px] opacity-80">Drag .xlsx sheet columns to send</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAudienceSource('db')
                        setErrorMsg('')
                      }}
                      className={`p-4 rounded-xl border text-center flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200 ${
                        audienceSource === 'db'
                          ? 'border-[#00a884] bg-[#e7f7f4]/40 text-[#008069]'
                          : 'border-[#e9edef] bg-white hover:bg-[#f8f9fa] text-[#54656f] dark:text-[#8696a0]'
                      }`}
                    >
                      <Database size={24} />
                      <span className="font-bold text-xs">CRM Database Contacts</span>
                      <span className="text-[10px] opacity-80">Use existing database records ({contacts.length})</span>
                    </button>
                  </div>

                  {audienceSource === 'excel' ? (
                    <div className="space-y-4">
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-[#e9edef] hover:border-[#00a884] rounded-2xl p-6 text-center cursor-pointer transition-all bg-[#f8f9fa] flex flex-col items-center justify-center gap-2"
                      >
                        <Upload size={28} className="text-[#8696a0]" />
                        <span className="text-xs font-bold text-[#111b21] dark:text-white">
                          {excelFile ? excelFile.name : 'Upload your Excel spreadsheet'}
                        </span>
                        <span className="text-[10px] text-[#667781] dark:text-[#8696a0]">
                          Supports .xlsx, .xls, .csv formats
                        </span>
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                        />
                      </div>

                      {excelData.length > 0 && (
                        <div className="space-y-3">
                          <div className="p-3 bg-[#e7f7f4] border border-[#00a884]/20 rounded-xl flex items-center justify-between text-xs text-[#008069]">
                            <span className="font-bold">Loaded {excelData.length} records successfully!</span>
                            <button 
                              onClick={() => {
                                setExcelFile(null)
                                setExcelData([])
                                setExcelHeaders([])
                              }}
                              className="p-1 hover:bg-[#008069]/10 rounded-full"
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-50 dark:bg-[#111b21] p-3.5 rounded-xl border border-slate-200 dark:border-[#2a3942]">
                            {/* Phone / Email Column */}
                            <div className="flex flex-col gap-1 sm:col-span-2">
                              <label className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                                <span>{channel === 'email' ? 'Map Email Address Column *' : 'Map Phone Number Column *'}</span>
                                <span className="text-[10px] text-slate-400 font-normal">(Required)</span>
                              </label>
                              <select
                                value={phoneColumn}
                                onChange={(e) => setPhoneColumn(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-emerald-300 dark:border-emerald-700/60 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                              >
                                <option value="">
                                  {channel === 'email' ? '-- Choose recipient email header --' : '-- Choose recipient phone header --'}
                                </option>
                                {excelHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </div>

                            {/* Contact Name / First Name Column */}
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">
                                Contact / First Name Column
                              </label>
                              <select
                                value={contactNameColumn}
                                onChange={(e) => setContactNameColumn(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                              >
                                <option value="">-- Do not map / Extract from variables --</option>
                                {excelHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </div>

                            {/* Last Name Column */}
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">
                                Last Name Column (Optional)
                              </label>
                              <select
                                value={contactLastNameColumn}
                                onChange={(e) => setContactLastNameColumn(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                              >
                                <option value="">-- None / Split from full name --</option>
                                {excelHeaders.map(h => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </div>

                            {/* Tag Column & Custom Tag */}
                            <div className="flex flex-col gap-1 sm:col-span-2">
                              <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0] flex items-center justify-between">
                                <span>Save Contact Tags</span>
                                <span className="text-[10px] text-slate-400 font-normal">Saves tag to CRM contacts</span>
                              </label>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <select
                                  value={contactTagColumn}
                                  onChange={(e) => setContactTagColumn(e.target.value)}
                                  className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                                >
                                  <option value="">-- From Excel Column (None) --</option>
                                  {excelHeaders.map(h => (
                                    <option key={h} value={h}>Excel: {h}</option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  placeholder="Or enter custom tag (e.g. HPV Camp, Lot 1)"
                                  value={customCampaignTag}
                                  onChange={(e) => setCustomCampaignTag(e.target.value)}
                                  className="w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#3b4a54] rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {/* Tenant Contacts Summary & Action Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 p-3 rounded-xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-[#00a884] rounded-lg shrink-0">
                            <Users size={18} />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>Broadcast to</span>
                              <span className="bg-[#00a884] text-white px-2 py-0.5 rounded-full text-[11px] font-extrabold font-mono">
                                {selectedContactIds.length} / {contacts.length}
                              </span>
                              <span>tenant contacts</span>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                              {selectedContactIds.length === contacts.length
                                ? '✓ All contacts across the entire tenant are selected'
                                : `${contacts.length - selectedContactIds.length} contacts currently excluded`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={() => setSelectedContactIds(contacts.map(c => c.id))}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                              selectedContactIds.length === contacts.length
                                ? 'bg-[#00a884] text-white shadow-sm'
                                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-emerald-50'
                            }`}
                          >
                            Select All ({contacts.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedContactIds([])}
                            className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      {/* Search Bar */}
                      <div className="relative">
                        <input
                          type="text"
                          placeholder={channel === 'email' ? "Search tenant contacts by name, email, company..." : "Search tenant contacts by name, phone, company, tag..."}
                          value={contactSearchTerm}
                          onChange={(e) => setContactSearchTerm(e.target.value)}
                          className="w-full px-3.5 py-2 bg-[#f0f2f5] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-semibold text-[#111b21] dark:text-white"
                        />
                      </div>

                      {/* Contacts Scroll List */}
                      <div className="max-h-60 overflow-y-auto border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-2 bg-white dark:bg-[#111b21] space-y-1 scrollbar-thin">
                        {isLoadingContacts ? (
                          <div className="flex flex-col items-center justify-center py-8 gap-2 text-xs text-[#008069] font-bold">
                            <Loader2 className="animate-spin" size={18} />
                            <span>Loading all tenant contacts...</span>
                          </div>
                        ) : contacts.filter(c => {
                          const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase()
                          const targetField = (channel === 'email' ? c.email || '' : c.phone_number).toLowerCase()
                          const company = (c.company || '').toLowerCase()
                          const tags = Array.isArray(c.tags) ? c.tags.join(' ').toLowerCase() : ''
                          const search = contactSearchTerm.toLowerCase()
                          return name.includes(search) || targetField.includes(search) || company.includes(search) || tags.includes(search)
                        }).length === 0 ? (
                          <div className="text-center py-6 text-[#8696a0] text-xs font-medium">No contacts match search</div>
                        ) : (
                          contacts.filter(c => {
                            const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase()
                            const targetField = (channel === 'email' ? c.email || '' : c.phone_number).toLowerCase()
                            const company = (c.company || '').toLowerCase()
                            const tags = Array.isArray(c.tags) ? c.tags.join(' ').toLowerCase() : ''
                            const search = contactSearchTerm.toLowerCase()
                            return name.includes(search) || targetField.includes(search) || company.includes(search) || tags.includes(search)
                          }).map(c => {
                            const isChecked = selectedContactIds.includes(c.id)
                            return (
                              <label
                                key={c.id}
                                className={`flex items-center gap-3 p-2.5 rounded-lg transition-all cursor-pointer select-none text-xs border ${
                                  isChecked
                                    ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                                    : 'hover:bg-[#f5f6f6] dark:hover:bg-[#1f2c34] border-transparent'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    setSelectedContactIds(prev => 
                                      prev.includes(c.id) 
                                        ? prev.filter(id => id !== c.id) 
                                        : [...prev, c.id]
                                    )
                                  }}
                                  className="rounded border-[#e9edef] text-[#00a884] focus:ring-[#00a884] cursor-pointer"
                                />
                                <div className="h-7 w-7 rounded-full bg-[#dfe5e7] dark:bg-slate-700 border border-[#e9edef] dark:border-slate-600 flex items-center justify-center font-bold text-[#54656f] dark:text-white text-[10px]">
                                  {`${c.first_name || 'C'}`.substring(0, 1).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-[#111b21] dark:text-white truncate">
                                      {c.first_name} {c.last_name || ''}
                                    </span>
                                    {c.company && (
                                      <span className="text-[10px] text-slate-400 font-normal truncate">
                                        • {c.company}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-[#667781] dark:text-[#8696a0] truncate font-mono">
                                    {channel === 'email' ? (c.email || 'No email registered') : c.phone_number}
                                  </div>
                                </div>
                                {Array.isArray(c.tags) && c.tags.length > 0 && (
                                  <div className="flex items-center gap-1 flex-wrap shrink-0">
                                    {c.tags.slice(0, 2).map((t: string) => (
                                      <span key={t} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] px-1.5 py-0.5 rounded font-semibold border border-slate-200 dark:border-slate-700">
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </label>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: Variable Mapping */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="p-3 bg-[#f0f2f5] border border-[#e9edef] rounded-xl">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">Template text structure</span>
                    <p className="text-xs font-medium text-[#111b21] dark:text-white mt-1 font-mono">{selectedTemplate?.body}</p>
                  </div>

                  <h4 className="text-xs font-bold text-[#111b21] dark:text-white">Map Excel Columns / Contact Attributes to Placeholders</h4>
                  
                  <div className="space-y-3">
                    {(channel === 'whatsapp' ? (selectedTemplate?.variables || []) : customVariables).map(v => (
                      <div key={v} className="space-y-3 bg-[#f8f9fa] dark:bg-[#111b21] p-3.5 rounded-xl border border-[#e9edef] dark:border-[#202d36] transition-all hover:shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="bg-[#00a884] text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded shadow-sm">
                              {"{{"}{v}{"}}"}
                            </span>
                            <span className="text-xs font-bold text-[#111b21] dark:text-white">
                              {v.startsWith('header_image') ? 'Header Image' : v.startsWith('header_video') ? 'Header Video' : v.startsWith('header_document_filename') ? 'Document Name' : v.startsWith('header_document') ? 'Header Document' : v.startsWith('header_text') ? 'Header Text' : v.startsWith('button_url') ? 'Dynamic Button URL' : v.startsWith('button_copy_code') ? 'Button Coupon/OTP Code' : `Variable ${v}`}
                            </span>
                          </div>

                          {/* Toggle mapping type */}
                          <div className="flex items-center self-end sm:self-auto bg-[#eae6df]/50 dark:bg-[#202d36] p-0.5 rounded-lg border border-[#e9edef] dark:border-[#303d46]">
                            <button
                              type="button"
                              onClick={() => {
                                setVariableMappingTypes(prev => ({ ...prev, [v]: 'dynamic' }))
                              }}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                                variableMappingTypes[v] !== 'static'
                                  ? 'bg-[#00a884] text-white shadow-sm'
                                  : 'text-[#667781] hover:text-[#111b21] dark:text-[#8696a0]'
                              }`}
                            >
                              Map Column
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVariableMappingTypes(prev => ({ ...prev, [v]: 'static' }))
                              }}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                                variableMappingTypes[v] === 'static'
                                  ? 'bg-[#00a884] text-white shadow-sm'
                                  : 'text-[#667781] hover:text-[#111b21] dark:text-[#8696a0]'
                              }`}
                            >
                              Static Value
                            </button>
                          </div>
                        </div>

                        {/* Input or Dropdown selector */}
                        {variableMappingTypes[v] === 'static' ? (
                          <input
                            type="text"
                            placeholder={
                              v.includes('image_url') || v.includes('video_url') || v.includes('document_url')
                                ? "Enter media public URL or Facebook Media ID (e.g. 1084170318116787)"
                                : v.includes('filename')
                                ? "Enter dynamic filename (e.g. report.pdf)"
                                : `Enter constant value for {{${v}}}`
                            }
                            value={staticVariableValues[v] || ''}
                            onChange={(e) => {
                              setStaticVariableValues(prev => ({ ...prev, [v]: e.target.value }))
                            }}
                            className="w-full px-3 py-2 bg-white dark:bg-[#222e35] border border-[#e9edef] dark:border-[#303d46] text-[#111b21] dark:text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] shadow-inner"
                          />
                        ) : (
                          <select
                            value={variableMappings[v] || ''}
                            onChange={(e) => {
                              setVariableMappings(prev => ({ ...prev, [v]: e.target.value }))
                            }}
                            className="w-full px-3 py-2 bg-white dark:bg-[#222e35] border border-[#e9edef] dark:border-[#303d46] text-[#111b21] dark:text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                          >
                            <option value="">-- Select Excel column / contact field --</option>
                            {audienceSource === 'excel' ? (
                              excelHeaders.map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))
                            ) : (
                              <>
                                <option value="first_name">Contact First Name</option>
                                <option value="last_name">Contact Last Name</option>
                                <option value="company">Contact Company</option>
                                <option value="email">Contact Email</option>
                                <option value="phone_number">Contact Phone</option>
                              </>
                            )}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 4: Preview & Launch Confirmation */}
              {wizardStep === 4 && (
                <div className="space-y-5">
                  <div className="p-4 bg-[#e7f7f4] border border-[#00a884]/20 rounded-xl flex items-start gap-3">
                    <CheckCircle size={18} className="text-[#008069] mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-bold text-xs text-[#008069]">Ready to Launch!</h4>
                      <p className="text-[10px] text-[#008069] mt-0.5 leading-relaxed">
                        Your campaign will send templates to <span className="font-bold">{
                          audienceSource === 'excel' ? excelData.length : selectedContactIds.length
                        } recipients</span> in the background. Operator console updates in real-time.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">First Message Preview</span>
                    {channel === 'email' ? (
                      <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm space-y-3">
                        <div className="space-y-1.5 border-b border-[#f0f2f5] pb-3 text-xs">
                          <div>
                            <span className="font-bold text-[#54656f] dark:text-[#8696a0]">From: </span>
                            <span className="text-[#111b21] dark:text-white font-mono">{sender || '(Configured Email Sender)'}</span>
                          </div>
                          <div>
                            <span className="font-bold text-[#54656f] dark:text-[#8696a0]">Subject: </span>
                            <span className="text-[#111b21] dark:text-white font-bold">{subject || '(No Subject)'}</span>
                          </div>
                        </div>
                        <div className="text-xs leading-relaxed text-[#111b21] dark:text-white font-sans py-2 min-h-[80px] overflow-y-auto max-h-[400px] border border-dashed border-[#e9edef] p-3 rounded-lg bg-gray-50/50">
                          {(() => {
                            const previewText = getPreviewMessage()
                            const hasHtml = /<[a-z][\s\S]*>/i.test(previewText)
                            const formattedPreview = hasHtml ? previewText : previewText.replace(/\n/g, '<br/>')
                            return (
                              <div dangerouslySetInnerHTML={{ __html: formattedPreview }} />
                            )
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#efeae2] p-4 rounded-xl border border-[#e9edef] relative overflow-hidden flex flex-col justify-end min-h-[220px] w-full">
                        {/* WhatsApp-style Bubble Container */}
                        <div className="bg-white dark:bg-[#1f2c34] rounded-lg border border-[#e9edef] dark:border-[#2a3942] text-[11px] max-w-[90%] sm:max-w-[285px] relative self-start shadow-sm leading-relaxed text-[#111b21] dark:text-white rounded-tl-none font-sans overflow-hidden flex flex-col">
                          
                          {/* 1. Header Rendering */}
                          {(() => {
                            const headerComp = selectedTemplate?.components?.find((c: any) => c.type === 'HEADER')
                            if (!headerComp) return null

                            if (headerComp.format === 'IMAGE') {
                              const sampleUrl = selectedTemplate?.sampleValues?.header_image_url || ''
                              return (
                                <div className="p-1 pb-0">
                                  {sampleUrl && sampleUrl.startsWith('http') ? (
                                    <img 
                                      src={sampleUrl} 
                                      alt="Header Template Image" 
                                      className="rounded-t-md max-h-36 w-full object-cover"
                                    />
                                  ) : (
                                    <div className="bg-slate-100 dark:bg-slate-800 rounded-t-md h-28 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1.5 border border-dashed border-slate-200 dark:border-slate-700">
                                      <FileSpreadsheet size={20} />
                                      <span className="text-[9px] font-medium">📷 Image Header (Approved Asset)</span>
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            if (headerComp.format === 'VIDEO') {
                              const sampleUrl = selectedTemplate?.sampleValues?.header_video_url || ''
                              return (
                                <div className="p-1 pb-0">
                                  {sampleUrl && sampleUrl.startsWith('http') ? (
                                    <video 
                                      src={sampleUrl} 
                                      className="rounded-t-md max-h-36 w-full object-cover bg-black"
                                      controls
                                    />
                                  ) : (
                                    <div className="bg-slate-100 dark:bg-slate-800 rounded-t-md h-28 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1.5 border border-dashed border-slate-200 dark:border-slate-700">
                                      <Play size={20} />
                                      <span className="text-[9px] font-medium">🎥 Video Header (Approved Asset)</span>
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            if (headerComp.format === 'DOCUMENT') {
                              const docFilename = selectedTemplate?.sampleValues?.header_document_filename || 'document.pdf'
                              return (
                                <div className="p-1.5 pb-0">
                                  <div className="bg-slate-100 dark:bg-slate-800/80 rounded p-2 flex items-center justify-between border border-slate-200/50 dark:border-slate-700/60">
                                    <div className="flex items-center gap-2 truncate">
                                      <FileText size={16} className="text-red-500 flex-shrink-0" />
                                      <span className="truncate max-w-[150px] text-[9px] font-bold text-slate-750 dark:text-slate-350">
                                        {docFilename}
                                      </span>
                                    </div>
                                    <Upload size={10} className="text-slate-400 rotate-180 flex-shrink-0" />
                                  </div>
                                </div>
                              )
                            }

                            if (headerComp.format === 'TEXT' && headerComp.text) {
                              let headerText = headerComp.text
                              const headerVarMatches = headerText.match(/\{\{[^\}]+\}\}/g)
                              if (headerVarMatches) {
                                const type = variableMappingTypes['header_text_1']
                                let val = ''
                                if (type === 'static') {
                                  val = staticVariableValues['header_text_1'] || selectedTemplate?.sampleValues?.['header_text_1'] || '[Header Text]'
                                } else {
                                  const mapping = variableMappings['header_text_1']
                                  val = mapping ? `[${mapping}]` : '[Header Text]'
                                }
                                headerText = headerText.replace(/\{\{[^\}]+\}\}/g, val)
                              }
                              return (
                                <div className="px-3 pt-3 font-bold text-xs text-slate-850 dark:text-slate-100 leading-tight">
                                  {headerText}
                                </div>
                              )
                            }

                            return null
                          })()}

                          {/* 2. Body Text Rendering */}
                          <div className="px-3 pt-2 pb-1 text-[11px] leading-relaxed">
                            <p className="whitespace-pre-wrap break-words">{getPreviewMessage()}</p>
                            
                            <div className="text-[8px] text-[#667781] dark:text-[#8696a0] text-right mt-1 font-semibold select-none">
                              10:00 AM
                            </div>
                          </div>

                          {/* 3. Buttons Rendering */}
                          {(() => {
                            const buttonsComp = selectedTemplate?.components?.find((c: any) => c.type === 'BUTTONS')
                            if (!buttonsComp || !Array.isArray(buttonsComp.buttons)) return null

                            return (
                              <div className="flex flex-col border-t border-[#f0f2f5] dark:border-slate-700/30">
                                {buttonsComp.buttons.map((btn: any, idx: number) => {
                                  let icon = null
                                  if (btn.type === 'URL') {
                                    icon = <ExternalLink size={10} className="text-[#008069] dark:text-emerald-400" />
                                  } else if (btn.type === 'PHONE_NUMBER') {
                                    icon = <Phone size={10} className="text-[#008069] dark:text-emerald-400" />
                                  } else if (btn.type === 'COPY_CODE') {
                                    icon = <Copy size={10} className="text-[#008069] dark:text-emerald-400" />
                                  }
                                  
                                  return (
                                    <div 
                                      key={idx} 
                                      className="py-2 px-3 text-center font-bold text-[10px] text-[#008069] dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-850/50 cursor-pointer flex items-center justify-center gap-1.5 border-b border-[#f0f2f5] dark:border-slate-700/30 last:border-b-0 transition-colors"
                                    >
                                      <span>{btn.text}</span>
                                      {icon}
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}

                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border border-[#e9edef] rounded-xl p-3.5 space-y-2.5 text-xs bg-[#f8f9fa]">
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Campaign Name:</span>
                      <span className="font-bold text-[#111b21] dark:text-white">{newCampaignName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Selected Template:</span>
                      <span className="font-bold text-[#111b21] dark:text-white">
                        {selectedTemplate ? selectedTemplate.name : 'Custom Message'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#667781] dark:text-[#8696a0]">Target Count:</span>
                      <span className="font-bold text-[#008069]">{
                        audienceSource === 'excel' ? excelData.length : selectedContactIds.length
                      } contacts</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-[#f0f2f5] border-t border-[#e9edef] px-5 py-4 flex justify-between items-center">
              {wizardStep > 1 ? (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="h-9 px-4 rounded-xl border border-[#e9edef] bg-white hover:bg-[#f8f9fa] text-xs font-bold text-[#54656f] dark:text-[#8696a0] flex items-center gap-1 transition-all cursor-pointer"
                >
                  <ArrowLeft size={14} />
                  <span>Back</span>
                </button>
              ) : (
                <div />
              )}

              {wizardStep < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="h-9 px-4 rounded-xl bg-[#00a884] hover:bg-[#008f72] text-xs font-bold text-white flex items-center gap-1 transition-all cursor-pointer"
                >
                  <span>Continue</span>
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLaunchCampaign}
                  disabled={isSubmitting}
                  className="h-9 px-5 rounded-xl bg-[#00a884] hover:bg-[#008f72] text-xs font-bold text-white flex items-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Launching...</span>
                    </>
                  ) : (
                    <>
                      <Megaphone size={14} />
                      <span>Launch Campaign</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
