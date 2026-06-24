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
  AlignRight
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
  body: string
  variables: string[]
  category: string
  language?: string
  isDbTemplate?: boolean
}

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  company: string | null
  email: string | null
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  
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

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  
  const [audienceSource, setAudienceSource] = useState<'db' | 'excel'>('excel')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelData, setExcelData] = useState<any[]>([])
  const [excelHeaders, setExcelHeaders] = useState<string[]>([])
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [contactSearchTerm, setContactSearchTerm] = useState('')
  
  // Mapping state: maps template placeholders "1", "2" to column names / attributes
  const [phoneColumn, setPhoneColumn] = useState('')
  const [variableMappings, setVariableMappings] = useState<Record<string, string>>({})
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

  const fetchTemplates = async (orgIdOverride?: string) => {
    const orgId = orgIdOverride || user?.organization_id
    if (!orgId) return
    try {
      const res = await fetch(`/api/templates?organizationId=${orgId}`)
      const data = await res.json()
      if (data.templates) {
        setTemplates(data.templates)
      }
    } catch (err) {
      console.error('Error fetching templates:', err)
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
    try {
      const res = await fetch(`/api/contacts?limit=100&organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        setContacts(data.contacts || [])
        setSelectedContactIds((data.contacts || []).map((c: any) => c.id))
      }
    } catch (err) {
      console.error('Error fetching contacts:', err)
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
        
        // Auto-select phone or email column if matching keywords found
        if (channel === 'email') {
          const emailKey = headers.find(h => 
            /email|mail|addr/i.test(h)
          ) || ''
          setPhoneColumn(emailKey)
        } else {
          const phoneKey = headers.find(h => 
            /phone|mobile|tel|contact|number|num/i.test(h)
          ) || ''
          setPhoneColumn(phoneKey)
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
      // Set default mappings based on either Meta templates or custom variables
      const variablesToMap = channel === 'whatsapp'
        ? (selectedTemplate?.variables || [])
        : customVariables;
      
      const initialMappings: Record<string, string> = {}
      variablesToMap.forEach(v => {
        initialMappings[v] = ''
      })
      setVariableMappings(initialMappings)
      setWizardStep(3)
    } else if (wizardStep === 3) {
      // Validate mapping completed
      const unmapped = Object.entries(variableMappings).filter(([_, val]) => !val)
      if (unmapped.length > 0) {
        setErrorMsg('Please map all template variables before proceeding.')
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
        Object.entries(variableMappings).forEach(([tplVar, colName]) => {
          variables[tplVar] = String(row[colName] || '')
        })
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
        Object.entries(variableMappings).forEach(([tplVar, attr]) => {
          // Map properties like first_name, last_name, company, email
          const key = attr as keyof Contact
          variables[tplVar] = String(c[key] || '')
        })
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
      }).filter(item => channel === 'email' ? (item.email && item.email.includes('@')) : true)
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
          templateName: selectedTemplate?.name || 'custom_message',
          templateBody: customMessageBody,
          templateSid: selectedTemplate?.sid || null,
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
      Object.entries(variableMappings).forEach(([tplVar, colName]) => {
        const firstVal = excelData[0][colName] || `[${colName}]`
        preview = preview.replace(new RegExp(`\\{\\{${tplVar}\\}\\}`, 'g'), String(firstVal))
      })
    } else if (audienceSource === 'db' && selectedContactIds.length > 0) {
      const selectedContacts = contacts.filter(c => selectedContactIds.includes(c.id))
      Object.entries(variableMappings).forEach(([tplVar, attr]) => {
        const firstVal = selectedContacts[0][attr as keyof Contact] || `[${attr}]`
        preview = preview.replace(new RegExp(`\\{\\{${tplVar}\\}\\}`, 'g'), String(firstVal))
      })
    } else {
      // Default fallback placeholders
      variablesToMap.forEach(v => {
        preview = preview.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), `[Value ${v}]`)
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

  return (
    <div className="h-full flex flex-col md:flex-row bg-[#eae6df] dark:bg-[#0b141a] select-none">
      {/* Sidebar List Section */}
      <div className="w-full md:w-[380px] bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#202d36] flex flex-col h-full flex-shrink-0">
        
        {/* Panel Header */}
        <div className="h-[59px] bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] flex items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-[#00a884]/10 flex items-center justify-center text-[#008069]">
              <Megaphone size={18} />
            </div>
            <h1 className="text-base font-bold text-[#111b21] dark:text-white">Bulk Campaigns</h1>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 hover:bg-[#e9edef] rounded-full text-[#54656f] dark:text-[#8696a0] transition-all cursor-pointer"
              title="Refresh campaigns"
            >
              <RefreshCw size={17} className={`${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={startNewCampaign}
              className="h-8 px-3 rounded-lg bg-[#00a884] hover:bg-[#008f72] text-white flex items-center gap-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Create</span>
            </button>
          </div>
        </div>

        {/* Overview metrics card */}
        <div className="p-4 bg-[#f8f9fa] dark:bg-[#0c1317] border-b border-[#e9edef] dark:border-[#202d36] grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm flex flex-col">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#667781] dark:text-[#8696a0]">Total Sent</span>
            <span className="text-xl font-bold text-[#111b21] dark:text-white mt-0.5">{totalSent}</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-[#e9edef] shadow-sm flex flex-col">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#667781] dark:text-[#8696a0]">Success Rate</span>
            <span className="text-xl font-bold text-[#008069] mt-0.5">{successRate}%</span>
          </div>
        </div>

        {/* Campaign List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f5f6f6] dark:divide-[#202d36]/50 min-h-0 bg-[#f8f9fa] dark:bg-[#0c1317]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#667781] dark:text-[#8696a0]">
              <Loader2 className="animate-spin text-[#00a884] mb-2" size={24} />
              <p className="text-xs">Loading campaign jobs...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center p-8 py-16 text-[#667781] dark:text-[#8696a0]">
              <Megaphone className="text-[#8696a0] mb-3" size={40} />
              <p className="font-semibold text-sm text-[#111b21] dark:text-white">No campaigns created yet</p>
              <p className="text-xs mt-1 max-w-[200px] leading-relaxed">Broadcast Meta templates to Excel sheets or database contacts bulkily.</p>
              <button 
                onClick={startNewCampaign}
                className="mt-4 px-4 py-2 bg-[#00a884] hover:bg-[#008f72] text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
              >
                Launch First Campaign
              </button>
            </div>
          ) : (
            campaigns.map((c) => {
              const isActive = selectedCampaign?.id === c.id
              const isProcessing = c.status === 'PROCESSING' || c.status === 'PENDING'
              
              const channelIcon = (() => {
                const chan = c.channel || 'whatsapp'
                if (chan === 'email') return <Mail size={12} className="text-blue-600" />
                if (chan === 'sms') return <MessageSquare size={12} className="text-amber-600" />
                return <Phone size={12} className="text-[#008069]" />
              })()

              const channelLabel = (() => {
                const chan = c.channel || 'whatsapp'
                if (chan === 'email') return 'Email'
                if (chan === 'sms') return 'SMS'
                return 'WhatsApp'
              })()

              const channelBadgeColor = (() => {
                const chan = c.channel || 'whatsapp'
                if (chan === 'email') return 'bg-blue-50 border-blue-100'
                if (chan === 'sms') return 'bg-amber-50 border-amber-100'
                return 'bg-[#e7f7f4] border-[#00a884]/20'
              })()
              
              return (
                <div 
                  key={c.id}
                  onClick={() => fetchCampaignDetails(c.id)}
                  className={`p-3.5 hover:bg-[#f5f6f6] dark:hover:bg-[#202d36]/50 transition-all cursor-pointer flex flex-col gap-1.5 ${
                    isActive ? 'bg-[#f0f2f5] dark:bg-[#202d36]' : ''
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-1 truncate max-w-[200px]">
                      <h3 className="font-bold text-sm text-[#111b21] dark:text-white truncate">{c.name}</h3>
                      <div className={`flex items-center gap-1 border self-start px-1.5 py-0.5 rounded-md ${channelBadgeColor}`}>
                        {channelIcon}
                        <span className="text-[9px] font-bold uppercase tracking-wider text-[#54656f] dark:text-[#8696a0]">{channelLabel}</span>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      c.status === 'COMPLETED' ? 'bg-[#e7f7f4] text-[#008069]' :
                      c.status === 'PROCESSING' ? 'bg-amber-50 text-amber-600 animate-pulse' :
                      c.status === 'FAILED' ? 'bg-red-50 text-red-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {c.status}
                    </span>
                  </div>

                  <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate">Template: <span className="font-medium text-[#54656f] dark:text-[#8696a0]">{c.template_name}</span></p>
                  
                  {/* Progress bar */}
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold">
                      <span>Progress: {c.sent_count + c.failed_count} / {c.total_contacts}</span>
                      {c.failed_count > 0 && <span className="text-red-500">{c.failed_count} failed</span>}
                    </div>
                    <div className="h-1.5 bg-[#e9edef] rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${c.status === 'FAILED' ? 'bg-red-500' : 'bg-[#00a884]'}`}
                        style={{ width: `${c.total_contacts > 0 ? ((c.sent_count + c.failed_count) / c.total_contacts) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-[#8696a0] mt-1">
                    <span>{new Date(c.created_at).toLocaleDateString()}</span>
                    <span>Sent: <span className="text-[#008069] font-bold">{c.sent_count}</span></span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="h-[52px] bg-[#f0f2f5] dark:bg-[#111b21] border-t border-[#e9edef] dark:border-[#202d36] flex items-center justify-between px-4 flex-shrink-0 select-none">
            <span className="text-[11px] font-bold text-[#667781] dark:text-[#8696a0]">
              Page {currentPage} of {totalPages} ({totalCampaignsCount})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => fetchCampaigns(currentPage - 1)}
                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-[#e9edef] bg-white hover:bg-[#f8f9fa] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => fetchCampaigns(currentPage + 1)}
                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-[#e9edef] bg-white hover:bg-[#f8f9fa] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
 
      {/* Main Details Panel */}
      <div className="flex-1 bg-[#f8f9fa] dark:bg-[#0c1317] flex flex-col h-full overflow-y-auto scrollbar-thin">
        {selectedCampaign ? (
          <div className="flex flex-col min-h-full">
            {/* Header Details */}
            <div className="bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] p-4 flex justify-between items-center flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-[#111b21] dark:text-white">{selectedCampaign.name}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs text-[#667781] dark:text-[#8696a0]">
                    Launched on {new Date(selectedCampaign.created_at).toLocaleString()}
                  </span>
                  <span className="text-xs text-[#8696a0]">•</span>
                  <span className="text-xs text-[#54656f] dark:text-[#8696a0] font-semibold">
                    Channel: <span className="text-[#111b21] dark:text-white font-bold uppercase">{selectedCampaign.channel || 'whatsapp'}</span>
                  </span>
                  {selectedCampaign.sender && (
                    <>
                      <span className="text-xs text-[#8696a0]">•</span>
                      <span className="text-xs text-[#54656f] dark:text-[#8696a0] font-semibold">
                        Sender: <span className="text-[#111b21] dark:text-white font-mono">{selectedCampaign.sender}</span>
                      </span>
                    </>
                  )}
                  {selectedCampaign.subject && (
                    <>
                      <span className="text-xs text-[#8696a0]">•</span>
                      <span className="text-xs text-[#54656f] dark:text-[#8696a0] font-semibold text-blue-600">
                        Subject: <span className="text-[#111b21] dark:text-white italic font-bold">"{selectedCampaign.subject}"</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                  selectedCampaign.status === 'COMPLETED' ? 'bg-[#e7f7f4] text-[#008069]' :
                  selectedCampaign.status === 'PROCESSING' ? 'bg-amber-50 text-amber-600' :
                  selectedCampaign.status === 'FAILED' ? 'bg-red-50 text-red-600' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {selectedCampaign.status}
                </span>
                <button
                  onClick={() => fetchCampaignDetails(selectedCampaign.id)}
                  className="p-2 hover:bg-[#e9edef] rounded-full text-[#54656f] dark:text-[#8696a0]"
                  title="Reload details"
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>

            {/* Campaign Summary & Metrics */}
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] flex-shrink-0">
              <div className="bg-[#f8f9fa] dark:bg-[#1f2c34] p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">Total Targets</div>
                <div className="text-2xl font-black text-[#111b21] dark:text-white mt-1">{selectedCampaign.total_contacts}</div>
              </div>
              <div className="bg-[#f8f9fa] p-3.5 rounded-xl border border-[#e9edef]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0] text-[#008069]">Successfully Sent</div>
                <div className="text-2xl font-black text-[#008069] mt-1">{selectedCampaign.sent_count}</div>
              </div>
              <div className="bg-[#f8f9fa] p-3.5 rounded-xl border border-[#e9edef]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0] text-red-500">Dispatch Failed</div>
                <div className="text-2xl font-black text-red-500 mt-1">{selectedCampaign.failed_count}</div>
              </div>
              <div className="bg-[#f8f9fa] p-3.5 rounded-xl border border-[#e9edef]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">Delivery Success</div>
                <div className="text-2xl font-black text-blue-600 mt-1">
                  {selectedCampaign.total_contacts > 0 
                    ? Math.round((selectedCampaign.sent_count / selectedCampaign.total_contacts) * 100) 
                    : 0}%
                </div>
              </div>
            </div>

            {/* Template Body Card */}
            <div className="p-4 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] flex-shrink-0">
              <div className="flex justify-between items-center max-w-2xl">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">Template body sent</span>
                {selectedCampaign.channel === 'email' && /<[a-z][\s\S]*>/i.test(selectedCampaign.template_body || '') && (
                  <div className="flex bg-[#f0f2f5] dark:bg-[#111b21] p-0.5 rounded-lg border border-[#e9edef] dark:border-[#2a3942]">
                    <button
                      type="button"
                      onClick={() => setDetailsPreviewMode('preview')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                        detailsPreviewMode === 'preview'
                          ? 'bg-white text-[#111b21] dark:text-white shadow-sm'
                          : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white'
                      }`}
                    >
                      Rendered Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailsPreviewMode('raw')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                        detailsPreviewMode === 'raw'
                          ? 'bg-white text-[#111b21] dark:text-white shadow-sm'
                          : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:text-white'
                      }`}
                    >
                      Raw Code
                    </button>
                  </div>
                )}
              </div>
              {selectedCampaign.channel === 'email' && /<[a-z][\s\S]*>/i.test(selectedCampaign.template_body || '') && detailsPreviewMode === 'preview' ? (
                <div className="mt-1.5 border border-[#e9edef] rounded-xl overflow-hidden bg-white max-w-2xl shadow-sm">
                  <iframe
                    srcDoc={selectedCampaign.template_body}
                    title="Email Template Preview"
                    className="w-full h-[400px] border-0"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : (
                <div className="mt-1.5 p-3 rounded-lg bg-[#f0f2f5] border border-[#e9edef] text-xs font-mono text-[#54656f] dark:text-[#8696a0] max-w-2xl whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                  {selectedCampaign.template_body}
                </div>
              )}
            </div>

            {/* Logs Table */}
            <div className="p-4 flex flex-col bg-[#f8f9fa] dark:bg-[#0c1317]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#667781] dark:text-[#8696a0] mb-2">Detailed Delivery Logs</h3>
              <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#202d36] rounded-xl overflow-x-auto shadow-sm">
                {isLoadingLogs ? (
                  <div className="flex flex-col items-center justify-center h-48 text-[#667781] dark:text-[#8696a0]">
                    <Loader2 className="animate-spin text-[#00a884] mb-2" />
                    <span className="text-xs">Loading logs...</span>
                  </div>
                ) : selectedCampaignLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-[#8696a0] text-xs">
                    No logs found. Campaign logs are generated as messages go out.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-[#f0f2f5] border-b border-[#e9edef] text-[#54656f] dark:text-[#8696a0] font-bold">
                      <tr>
                        <th className="p-3">Recipient</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Message SID / ID</th>
                        <th className="p-3">Mapped Variables</th>
                        <th className="p-3">Error / Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f5f6f6]">
                      {selectedCampaignLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#1f2c34] transition-all">
                          <td className="p-3 font-semibold text-[#111b21] dark:text-white">
                            {selectedCampaign.channel === 'email' 
                              ? (log.email_address || log.phone_number || '-') 
                              : (log.phone_number || log.email_address || '-')}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              log.status === 'SENT' ? 'bg-[#e7f7f4] text-[#008069]' :
                              log.status === 'FAILED' ? 'bg-red-50 text-red-600' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="p-3 text-[#54656f] dark:text-[#8696a0] font-mono select-text">{log.message_sid || '-'}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(log.variables_mapped).map(([k, v]) => (
                                <span key={k} className="bg-[#f0f2f5] dark:bg-[#2a3942] px-1.5 py-0.5 rounded text-[10px] border border-[#e9edef] dark:border-[#2a3942]">
                                  {k}: {v}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-red-500 max-w-[200px] truncate" title={log.error_message || ''}>
                            {log.error_message || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center p-8 text-[#667781] dark:text-[#8696a0]">
            <Megaphone size={60} className="text-[#8696a0] mb-4 opacity-50" />
            <h2 className="text-base font-bold text-[#111b21] dark:text-white">Broadcast Campaigns Summary</h2>
            <p className="text-xs mt-1 max-w-[360px] leading-relaxed">
              Select a campaign from the left column to view dynamic placeholders mapping, total recipient details, error codes, and live stats.
            </p>
          </div>
        )}
      </div>

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
                      {features.enable_messages && (
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
                      {features.enable_messages && features.enable_sms && (
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
                      {features.enable_email && (
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
                      {templates.map(t => (
                        <option key={t.sid} value={t.sid}>
                          {t.name} ({t.language || 'en'}) {t.isDbTemplate ? '✓' : ''}
                        </option>
                      ))}
                    </select>

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

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">
                              {channel === 'email' ? 'Map Email Address Column' : 'Map Phone Number Column'}
                            </label>
                            <select
                              value={phoneColumn}
                              onChange={(e) => setPhoneColumn(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                            >
                              <option value="">
                                {channel === 'email' ? '-- Choose recipient email header --' : '-- Choose recipient phone header --'}
                              </option>
                              {excelHeaders.map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Users size={16} className="text-[#00a884]" />
                          <span className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">
                            Broadcast to <span className="text-[#008069]">{selectedContactIds.length}</span> of {contacts.length} contacts
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedContactIds(contacts.map(c => c.id))}
                            className="text-[10px] font-extrabold text-[#008069] bg-[#e7f7f4] hover:bg-[#e7f7f4]/80 px-2 py-0.5 rounded transition-all cursor-pointer"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedContactIds([])}
                            className="text-[10px] font-extrabold text-rose-600 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded transition-all cursor-pointer"
                          >
                            None
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        placeholder={channel === 'email' ? "Search contacts by name or email..." : "Search contacts by name or phone..."}
                        value={contactSearchTerm}
                        onChange={(e) => setContactSearchTerm(e.target.value)}
                        className="w-full px-3 py-2 bg-[#f0f2f5] border border-[#e9edef] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-semibold text-[#111b21] dark:text-white"
                      />

                      <div className="max-h-48 overflow-y-auto border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-2 bg-white dark:bg-[#111b21] space-y-1 scrollbar-thin">
                        {contacts.filter(c => {
                          const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase()
                          const targetField = (channel === 'email' ? c.email || '' : c.phone_number).toLowerCase()
                          const search = contactSearchTerm.toLowerCase()
                          return name.includes(search) || targetField.includes(search)
                        }).length === 0 ? (
                          <div className="text-center py-4 text-[#8696a0] text-xs">No contacts match search</div>
                        ) : (
                          contacts.filter(c => {
                            const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase()
                            const targetField = (channel === 'email' ? c.email || '' : c.phone_number).toLowerCase()
                            const search = contactSearchTerm.toLowerCase()
                            return name.includes(search) || targetField.includes(search)
                          }).map(c => {
                            const isChecked = selectedContactIds.includes(c.id)
                            return (
                              <label
                                key={c.id}
                                className="flex items-center gap-3 p-2 hover:bg-[#f5f6f6] rounded-lg transition-all cursor-pointer select-none text-xs border border-transparent"
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
                                <div className="h-7 w-7 rounded-full bg-[#dfe5e7] border border-[#e9edef] flex items-center justify-center font-bold text-[#54656f] dark:text-[#8696a0] text-[10px]">
                                  {`${c.first_name || 'C'}`.substring(0, 1).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-bold text-[#111b21] dark:text-white truncate">
                                    {c.first_name} {c.last_name || ''}
                                  </div>
                                  <div className="text-[10px] text-[#667781] dark:text-[#8696a0] truncate">
                                    {channel === 'email' ? (c.email || 'No email registered') : c.phone_number}
                                  </div>
                                </div>
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
                      <div key={v} className="grid grid-cols-1 md:grid-cols-3 items-center gap-3 bg-[#f8f9fa] p-3 rounded-xl border border-[#e9edef]">
                        <div className="flex items-center gap-2">
                          <span className="bg-[#00a884] text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded">
                            {"{{"}{v}{"}}"}
                          </span>
                          <span className="text-xs font-bold text-[#54656f] dark:text-[#8696a0]">Placeholder {v}</span>
                        </div>
                        <span className="text-[10px] text-center text-[#8696a0] hidden md:block">maps to</span>
                        <select
                          value={variableMappings[v] || ''}
                          onChange={(e) => {
                            setVariableMappings(prev => ({ ...prev, [v]: e.target.value }))
                          }}
                          className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                        >
                          <option value="">-- Map to field --</option>
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
                      <div className="bg-[#efeae2] p-4 rounded-xl border border-[#e9edef] relative overflow-hidden flex flex-col justify-end">
                        <div className="bg-white/80 p-3 rounded-lg border border-[#e9edef] text-xs max-w-[85%] relative self-start shadow-sm leading-relaxed text-[#111b21] dark:text-white rounded-tl-none font-sans">
                          {getPreviewMessage()}
                          <div className="text-[9px] text-[#667781] dark:text-[#8696a0] text-right mt-1 font-semibold">
                            10:00 AM
                          </div>
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
