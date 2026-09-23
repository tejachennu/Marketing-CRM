'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import {
  ArrowLeft,
  MessageSquare,
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Clock,
  Search,
  FileSpreadsheet,
  RefreshCw,
  User,
  Phone,
  Mail,
  Loader2,
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Sparkles,
  Wand2,
  AlertTriangle,
  BookOpen,
  FileText,
  X,
  Megaphone,
  CheckCircle2,
  CheckCircle,
  TrendingUp,
  Inbox,
  Users,
  Smartphone,
  ShieldCheck,
  Eye,
  Filter
} from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'

interface WhatsAppTemplate {
  sid: string
  name: string
  raw_name?: string
  whatsapp_template_name?: string
  category?: string
  language?: string
  status?: string
  body?: string
  variables?: string[]
  sampleValues?: Record<string, string>
  components?: any
}

interface AiSuggestion {
  text: string
  article_title?: string | null
  source_url?: string | null
}

interface RecipientChat {
  log_id: string
  phone_number: string | null
  email_address: string | null
  dispatch_status: string
  error_message: string | null
  variables_mapped: Record<string, any> | null
  dispatched_at: string
  contact_id: string | null
  first_name: string | null
  last_name: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_company: string | null
  conversation_id: string | null
  unread_count: number
  last_message_at: string | null
  is_active: boolean
  has_replied: boolean
  needs_reply: boolean
  last_message: {
    id: string
    body: string
    media_url?: string | null
    sender_type: 'user' | 'contact'
    created_at: string
  } | null
}

interface MessageItem {
  id: string
  conversation_id: string
  sender_type: 'user' | 'contact'
  body: string
  media_url?: string | null
  status?: string | null
  created_at: string
}

interface CampaignDetail {
  id: string
  organization_id?: string
  name: string
  template_name: string
  template_body: string
  status: string
  channel?: string
  sender?: string
  subject?: string
  total_contacts: number
  sent_count: number
  failed_count: number
  active_chats_count: number
  unread_chats_count: number
  reply_rate: number
  created_at: string
}

export default function CampaignFullTabPage() {
  const params = useParams()
  const router = useRouter()
  const campaignId = params?.id as string

  // State
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [recipients, setRecipients] = useState<RecipientChat[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<'chats' | 'overview'>('chats')

  // Chat Selection & Messaging
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientChat | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [inputMessage, setInputMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [showCampaignContext, setShowCampaignContext] = useState(false)
  const [copiedPhone, setCopiedPhone] = useState(false)

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('')
  const [recipientFilter, setRecipientFilter] = useState<'replied' | 'needs_reply' | 'all'>('replied')

  // 24h Meta Window Timer Tick
  const [windowTick, setWindowTick] = useState(0)

  // Templates
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null)
  const [templateVarValues, setTemplateVarValues] = useState<Record<string, string>>({})
  const [isSendingTemplate, setIsSendingTemplate] = useState(false)

  // AI Suggestions (Copilot Smart Replies)
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [aiSuggestionsError, setAiSuggestionsError] = useState<string | null>(null)
  const [showAiPanel, setShowAiPanel] = useState(false)

  // AI Rephrase
  const [showRephraseDropdown, setShowRephraseDropdown] = useState(false)
  const [isRephrasing, setIsRephrasing] = useState(false)
  const rephraseDropdownRef = useRef<HTMLDivElement>(null)

  // Mobile Chat Responsive View ('list' shows conversation list, 'chat' shows active thread on mobile)
  const [mobileChatView, setMobileChatView] = useState<'list' | 'chat'>('list')

  // Overview Tab & Audit Controls
  const [auditSearchQuery, setAuditSearchQuery] = useState('')
  const [auditStatusFilter, setAuditStatusFilter] = useState<'all' | 'delivered' | 'read' | 'failed' | 'replied'>('all')
  const [auditPage, setAuditPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(20)
  const [previewWithSampleData, setPreviewWithSampleData] = useState(true)
  const [copiedTemplateText, setCopiedTemplateText] = useState(false)

  // Reset audit table page when search query or filter changes
  useEffect(() => {
    setAuditPage(1)
  }, [auditSearchQuery, auditStatusFilter, auditPageSize])

  // Sample recipient for template preview
  const sampleRecipient = useMemo(() => {
    return recipients.find((r) => r.variables_mapped && Object.keys(r.variables_mapped).length > 0) || recipients[0] || null
  }, [recipients])

  // Extract detected variables from template body
  const detectedVariables = useMemo(() => {
    if (!campaign?.template_body) return []
    const matches = campaign.template_body.match(/\{\{([^}]+)\}\}/g) || []
    return Array.from(new Set(matches.map((m) => m.replace(/[{}]/g, '').trim())))
  }, [campaign?.template_body])

  // Simulated WhatsApp body with or without sample values
  const simulatedBody = useMemo(() => {
    if (!campaign?.template_body) return ''
    if (!previewWithSampleData || !sampleRecipient?.variables_mapped) return campaign.template_body

    let text = campaign.template_body
    Object.entries(sampleRecipient.variables_mapped).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    })
    return text
  }, [campaign?.template_body, previewWithSampleData, sampleRecipient])

  const handleCopyTemplate = () => {
    if (!campaign?.template_body) return
    navigator.clipboard.writeText(campaign.template_body)
    setCopiedTemplateText(true)
    setTimeout(() => setCopiedTemplateText(false), 2000)
  }

  // Delivery breakdown stats
  const logDeliveredCount = useMemo(() => {
    return recipients.filter((r) => {
      const s = (r.dispatch_status || '').toUpperCase()
      return s === 'DELIVERED' || s === 'READ'
    }).length
  }, [recipients])

  const logReadCount = useMemo(() => {
    return recipients.filter((r) => (r.dispatch_status || '').toUpperCase() === 'READ').length
  }, [recipients])

  const logFailedCount = useMemo(() => {
    return recipients.filter((r) => (r.dispatch_status || '').toUpperCase() === 'FAILED').length
  }, [recipients])

  // Filtered recipients for the audit table
  const filteredAuditRecipients = useMemo(() => {
    return recipients.filter((rec) => {
      const q = auditSearchQuery.toLowerCase().trim()
      const mappedValuesStr = rec.variables_mapped
        ? Object.values(rec.variables_mapped).map((v) => String(v).toLowerCase()).join(' ')
        : ''
      const matchesSearch =
        !q ||
        (rec.first_name && rec.first_name.toLowerCase().includes(q)) ||
        (rec.last_name && rec.last_name.toLowerCase().includes(q)) ||
        (rec.phone_number && rec.phone_number.toLowerCase().includes(q)) ||
        (rec.email_address && rec.email_address.toLowerCase().includes(q)) ||
        mappedValuesStr.includes(q)

      if (!matchesSearch) return false

      const status = (rec.dispatch_status || '').toUpperCase()
      if (auditStatusFilter === 'delivered') return status === 'DELIVERED' || status === 'READ'
      if (auditStatusFilter === 'read') return status === 'READ'
      if (auditStatusFilter === 'failed') return status === 'FAILED'
      if (auditStatusFilter === 'replied') return Boolean(rec.has_replied)

      return true
    })
  }, [recipients, auditSearchQuery, auditStatusFilter])

  // Paginated recipient slice for audit table
  const totalAuditPages = Math.max(1, Math.ceil(filteredAuditRecipients.length / auditPageSize))
  const paginatedAuditRecipients = useMemo(() => {
    const startIndex = (auditPage - 1) * auditPageSize
    return filteredAuditRecipients.slice(startIndex, startIndex + auditPageSize)
  }, [filteredAuditRecipients, auditPage, auditPageSize])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedRecipientRef = useRef<RecipientChat | null>(null)

  useEffect(() => {
    selectedRecipientRef.current = selectedRecipient
  }, [selectedRecipient])

  // Deduplicated messages list to prevent any duplicate rendering
  const displayedMessages = useMemo(() => {
    const seenIds = new Set<string>()
    const result: MessageItem[] = []

    for (const msg of messages) {
      if (seenIds.has(msg.id)) continue

      // If this is a temporary optimistic message and a real message with the same body and sender already exists, skip the temp one
      if (
        msg.id.startsWith('temp-') &&
        messages.some(
          (other) =>
            !other.id.startsWith('temp-') &&
            other.sender_type === msg.sender_type &&
            other.body.trim() === msg.body.trim()
        )
      ) {
        continue
      }

      seenIds.add(msg.id)
      result.push(msg)
    }

    return result
  }, [messages])

  // Scroll to bottom of message stream
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // Load Campaign and Recipients data
  const loadCampaignData = useCallback(async (showLoader = true) => {
    if (!campaignId) return
    if (showLoader) setIsLoading(true)
    else setIsRefreshing(true)

    try {
      await restoreSupabaseSession()
      const res = await fetch(`/api/campaigns?id=${campaignId}`)
      const data = await res.json()

      if (data.success && data.campaign) {
        setCampaign(data.campaign)
        setLogs(data.logs || [])
        const recipientList: RecipientChat[] = data.conversations || []
        setRecipients(recipientList)

        // If no recipient is selected yet, pre-select the first replied recipient
        if (!selectedRecipientRef.current && recipientList.length > 0) {
          const firstReplied = recipientList.find((r) => r.has_replied) || recipientList[0]
          setSelectedRecipient(firstReplied)
          if (!recipientList.some((r) => r.has_replied)) {
            setRecipientFilter('all')
          }
        }
      } else {
        console.error('Failed to load campaign data:', data.error)
      }
    } catch (err) {
      console.error('Error fetching campaign details:', err)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [campaignId])

  useEffect(() => {
    loadCampaignData()
  }, [loadCampaignData])

  // Load messages for the selected recipient conversation
  const loadMessages = useCallback(async (convId: string) => {
    setIsLoadingMessages(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/messages?conversationId=${convId}&limit=100`)
      const data = await res.json()
      if (data.success && data.messages) {
        // Backend returns messages descending by created_at; sort ascending for timeline
        const sorted = [...data.messages].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        setMessages(sorted)
        setTimeout(() => scrollToBottom('auto'), 50)
      }
    } catch (err) {
      console.error('Error loading messages:', err)
    } finally {
      setIsLoadingMessages(false)
    }
  }, [])

  // When recipient selection changes, load their conversation
  useEffect(() => {
    if (selectedRecipient?.conversation_id) {
      loadMessages(selectedRecipient.conversation_id)

      // Mark conversation as read
      if (selectedRecipient.unread_count > 0) {
        supabase
          .from('conversations')
          .update({ unread_count: 0 })
          .eq('id', selectedRecipient.conversation_id)
          .then(() => {
            setRecipients((prev) =>
              prev.map((r) =>
                r.conversation_id === selectedRecipient.conversation_id
                  ? { ...r, unread_count: 0, needs_reply: false }
                  : r
              )
            )
          })
      }
    } else {
      setMessages([])
    }

    // Reset AI state on recipient change
    setShowAiPanel(false)
    setAiSuggestions([])
    setAiSuggestionsError(null)
    setShowRephraseDropdown(false)
  }, [selectedRecipient, loadMessages])

  // Tick every 30s to keep Meta 24h window countdown live
  useEffect(() => {
    const timer = setInterval(() => setWindowTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  // Calculate Meta 24-hour customer service window status
  const lastInboundMessage = useMemo(() => {
    void windowTick
    return [...messages].reverse().find((m) => m.sender_type === 'contact')
  }, [messages, windowTick])

  const metaWindowStatus = useMemo(() => {
    void windowTick
    if (!lastInboundMessage) {
      return {
        isOpen: false,
        isClosingSoon: false,
        remainingMs: 0,
        text: 'No Active Window',
        hasInbound: false,
      }
    }

    const lastInboundTime = new Date(lastInboundMessage.created_at).getTime()
    const windowMs = 24 * 60 * 60 * 1000
    const elapsed = Date.now() - lastInboundTime
    const remainingMs = windowMs - elapsed
    const isOpen = remainingMs > 0
    const hoursLeft = Math.floor(remainingMs / (60 * 60 * 1000))
    const minutesLeft = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))
    const isClosingSoon = isOpen && remainingMs < 4 * 60 * 60 * 1000

    return {
      isOpen,
      isClosingSoon,
      remainingMs,
      hoursLeft,
      minutesLeft,
      text: isOpen ? `${hoursLeft}h ${minutesLeft}m left` : 'Window Expired',
      hasInbound: true,
    }
  }, [lastInboundMessage, windowTick])

  // Fetch Meta-approved WhatsApp templates
  const fetchTemplates = useCallback(async () => {
    const user = authSessionManager.getUser() as any
    const orgId = campaign?.organization_id || user?.organization_id || user?.user_metadata?.organization_id
    if (!orgId) return
    setLoadingTemplates(true)
    setTemplateError(null)
    try {
      const res = await fetch(`/api/templates?organizationId=${orgId}`)
      const data = await res.json()
      if (data.error) setTemplateError(data.error)
      if (data.templates && Array.isArray(data.templates)) {
        setTemplates(data.templates)
      }
    } catch (err: any) {
      console.error('Error fetching templates:', err)
      setTemplateError(err.message || 'Failed to fetch templates')
    } finally {
      setLoadingTemplates(false)
    }
  }, [campaign?.organization_id])

  // Select template & pre-fill variables
  const handleSelectTemplate = (tplSid: string) => {
    const tpl = templates.find((t) => t.sid === tplSid) || null
    setSelectedTemplate(tpl)
    const initialVars: Record<string, string> = {}
    if (tpl?.variables) {
      tpl.variables.forEach((v) => {
        if (v.toLowerCase() === 'name' || v === '1') {
          initialVars[v] = selectedRecipient?.first_name || ''
        } else {
          initialVars[v] = tpl.sampleValues?.[v] || ''
        }
      })
    }
    setTemplateVarValues(initialVars)
  }

  // Send WhatsApp Template
  const handleSendTemplate = async () => {
    if (!selectedTemplate || !selectedRecipient || !selectedRecipient.conversation_id || isSendingTemplate) {
      return
    }

    const targetPhone = selectedRecipient.contact_phone || selectedRecipient.phone_number || ''
    setIsSendingTemplate(true)
    setSendError(null)

    let finalBody = selectedTemplate.body || ''
    Object.entries(templateVarValues).forEach(([k, v]) => {
      finalBody = finalBody.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    })

    const tempId = `temp-${Date.now()}`
    const optimisticMsg: MessageItem = {
      id: tempId,
      conversation_id: selectedRecipient.conversation_id,
      sender_type: 'user',
      body: finalBody,
      status: 'sending',
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticMsg])
    setTimeout(() => scrollToBottom('smooth'), 30)

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedRecipient.conversation_id,
          phoneNumber: targetPhone,
          templateSid: selectedTemplate.sid,
          templateName:
            selectedTemplate.whatsapp_template_name ||
            selectedTemplate.raw_name ||
            selectedTemplate.name,
          templateLanguage: selectedTemplate.language || 'en',
          templateVariables: templateVarValues,
          templateMetaComponents: selectedTemplate.components || null,
          message: finalBody,
          channel: campaign?.channel || 'whatsapp',
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        if (data.message) {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)))
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== tempId))
        }
        throw new Error(data.error || 'Failed to dispatch Meta WhatsApp template')
      }

      if (data.message) {
        setMessages((prev) => {
          const alreadyHasReal = prev.some((m) => m.id === data.message.id)
          if (alreadyHasReal) return prev.filter((m) => m.id !== tempId)
          return prev.map((m) => (m.id === tempId ? data.message : m))
        })
      } else {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m)))
      }

      // Update recipient's last message in the left list
      setRecipients((prev) =>
        prev.map((r) =>
          r.conversation_id === selectedRecipient.conversation_id
            ? {
                ...r,
                needs_reply: false,
                last_message_at: new Date().toISOString(),
                last_message: {
                  id: data.message?.id || tempId,
                  body: finalBody,
                  sender_type: 'user',
                  created_at: new Date().toISOString(),
                },
              }
            : r
        )
      )

      setShowTemplateModal(false)
      setSelectedTemplate(null)
    } catch (err: any) {
      console.error('Error sending template:', err)
      setSendError(err.message || 'Failed to send template')
    } finally {
      setIsSendingTemplate(false)
    }
  }

  // Fetch AI Smart Reply Suggestions (Copilot)
  const fetchSuggestions = useCallback(async (convId: string) => {
    setLoadingSuggestions(true)
    setAiSuggestions([])
    setAiSuggestionsError(null)
    setShowAiPanel(true)
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch suggestions')
      const raw = data.suggestions || []
      const mapped: AiSuggestion[] = raw.map((s: any) => {
        if (typeof s === 'string') return { text: s, article_title: null, source_url: null }
        return { text: s.text || '', article_title: s.article_title || null, source_url: s.source_url || null }
      })
      setAiSuggestions(mapped)
    } catch (err: any) {
      console.error('[Copilot] Error loading suggestions:', err)
      setAiSuggestionsError(err.message || 'Error loading suggestions')
    } finally {
      setLoadingSuggestions(false)
    }
  }, [])

  // Handle AI Rephrase (Tone rewrite)
  const handleRephrase = async (tone: string) => {
    if (!inputMessage.trim() || isRephrasing) return
    setIsRephrasing(true)
    setShowRephraseDropdown(false)
    try {
      const res = await fetch('/api/ai/rephrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputMessage, tone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to rephrase message')
      if (data.rephrased) {
        setInputMessage(data.rephrased)
        textareaRef.current?.focus()
      }
    } catch (err: any) {
      console.error('[Rephrase] Error:', err)
      setSendError(err.message || 'Failed to rephrase message')
    } finally {
      setIsRephrasing(false)
    }
  }

  // Close Rephrase dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rephraseDropdownRef.current && !rephraseDropdownRef.current.contains(e.target as Node)) {
        setShowRephraseDropdown(false)
      }
    }
    if (showRephraseDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showRephraseDropdown])

  // Real-time message subscription for incoming replies
  useEffect(() => {
    if (!campaignId) return

    const channel = supabase
      .channel(`campaign-tab-messages-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const newMsg = payload.new as MessageItem
          const currentSelected = selectedRecipientRef.current

          // If new message is for the currently open conversation, append or replace matching temp message
          if (currentSelected?.conversation_id === newMsg.conversation_id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev

              // If it's a message sent by user, check if there's a matching optimistic message to replace
              if (newMsg.sender_type === 'user') {
                const tempIndex = prev.findIndex(
                  (m) => m.id.startsWith('temp-') && m.body.trim() === newMsg.body.trim()
                )
                if (tempIndex !== -1) {
                  const updated = [...prev]
                  updated[tempIndex] = newMsg
                  return updated
                }
              }

              return [...prev, newMsg]
            })
            setTimeout(() => scrollToBottom('smooth'), 50)
          }

          // Update recipient item in the left list
          setRecipients((prev) =>
            prev.map((r) => {
              if (r.conversation_id === newMsg.conversation_id) {
                const isFromContact = newMsg.sender_type === 'contact'
                const isCurrentlySelected = currentSelected?.conversation_id === newMsg.conversation_id
                return {
                  ...r,
                  has_replied: isFromContact ? true : r.has_replied,
                  needs_reply: isFromContact && !isCurrentlySelected,
                  unread_count: isFromContact && !isCurrentlySelected ? r.unread_count + 1 : 0,
                  last_message_at: newMsg.created_at,
                  last_message: {
                    id: newMsg.id,
                    body: newMsg.body,
                    media_url: newMsg.media_url,
                    sender_type: newMsg.sender_type,
                    created_at: newMsg.created_at,
                  },
                }
              }
              return r
            })
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  // Handle Sending Message
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedRecipient || !selectedRecipient.conversation_id || isSending) {
      return
    }

    const text = inputMessage.trim()
    const targetPhone =
      selectedRecipient.contact_phone ||
      selectedRecipient.phone_number ||
      ''

    setSendError(null)
    setInputMessage('')
    setIsSending(true)

    // Optimistic message item
    const tempId = `temp-${Date.now()}`
    const optimisticMsg: MessageItem = {
      id: tempId,
      conversation_id: selectedRecipient.conversation_id,
      sender_type: 'user',
      body: text,
      status: 'sending',
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticMsg])
    setTimeout(() => scrollToBottom('smooth'), 30)

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedRecipient.conversation_id,
          message: text,
          phoneNumber: targetPhone,
          channel: campaign?.channel || 'whatsapp',
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch message')
      }

      if (data.message) {
        setMessages((prev) => {
          // Check if realtime already added this real message to prevent duplicate!
          const alreadyHasReal = prev.some((m) => m.id === data.message.id)
          if (alreadyHasReal) {
            return prev.filter((m) => m.id !== tempId)
          }
          return prev.map((m) => (m.id === tempId ? data.message : m))
        })
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m))
        )
      }

      // Update recipient's last message in the left list
      setRecipients((prev) =>
        prev.map((r) =>
          r.conversation_id === selectedRecipient.conversation_id
            ? {
                ...r,
                needs_reply: false,
                last_message_at: new Date().toISOString(),
                last_message: {
                  id: data.message?.id || tempId,
                  body: text,
                  sender_type: 'user',
                  created_at: new Date().toISOString(),
                },
              }
            : r
        )
      )
    } catch (err: any) {
      console.error('Error sending message:', err)
      setSendError(err.message || 'Failed to send reply. Please try again.')
      // Mark temporary message as failed
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
      )
    } finally {
      setIsSending(false)
      textareaRef.current?.focus()
    }
  }

  // Handle textarea enter-key send
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Progressive render limit for live chats list
  const [chatListLimit, setChatListLimit] = useState(30)

  useEffect(() => {
    setChatListLimit(30)
  }, [searchQuery, recipientFilter])

  // Filtered Recipients List
  const filteredRecipients = useMemo(() => {
    return recipients.filter((r) => {
      // 1. Filter by category
      if (recipientFilter === 'replied' && !r.has_replied) return false
      if (recipientFilter === 'needs_reply' && !r.needs_reply) return false

      // 2. Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const fullName = `${r.first_name || ''} ${r.last_name || ''}`.toLowerCase()
        const phone = (r.contact_phone || r.phone_number || '').toLowerCase()
        const email = (r.contact_email || r.email_address || '').toLowerCase()
        const lastMsg = (r.last_message?.body || '').toLowerCase()
        const mappedValues = r.variables_mapped
          ? Object.values(r.variables_mapped).map((v) => String(v).toLowerCase()).join(' ')
          : ''
        return (
          fullName.includes(q) ||
          phone.includes(q) ||
          email.includes(q) ||
          lastMsg.includes(q) ||
          mappedValues.includes(q)
        )
      }

      return true
    })
  }, [recipients, recipientFilter, searchQuery])

  // Progressive slice of recipients for buttery-smooth rendering
  const visibleRecipients = useMemo(() => {
    return filteredRecipients.slice(0, chatListLimit)
  }, [filteredRecipients, chatListLimit])

  // Aggregate Stats
  const activeChatsCount = useMemo(() => {
    return recipients.filter((r) => r.has_replied).length
  }, [recipients])

  const unreadChatsCount = useMemo(() => {
    return recipients.filter((r) => r.needs_reply).length
  }, [recipients])

  // Excel Export of Logs
  const handleExportLogs = () => {
    if (!campaign || logs.length === 0) return
    const reportData = logs.map((log) => {
      const variables = Object.entries(log.variables_mapped || {})
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')

      return {
        Recipient:
          campaign.channel === 'email'
            ? log.email_address || log.phone_number || '-'
            : log.phone_number || log.email_address || '-',
        Status: log.status,
        'Message SID / ID': log.message_sid || '-',
        'Variables Mapped': variables,
        'Error / Details': log.error_message || '-',
        'Sent At': new Date(log.created_at).toLocaleString(),
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(reportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Delivery Logs')
    const fileName = `${campaign.name.toLowerCase().replace(/\s+/g, '_')}_logs.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  // Copy phone number
  const copyPhoneNumber = (phone: string) => {
    navigator.clipboard.writeText(phone)
    setCopiedPhone(true)
    setTimeout(() => setCopiedPhone(false), 2000)
  }

  // Construct recipient specific template body
  const recipientDispatchedText = useMemo(() => {
    if (!campaign || !selectedRecipient) return ''
    let text = campaign.template_body || ''
    if (selectedRecipient.variables_mapped) {
      Object.entries(selectedRecipient.variables_mapped).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
      })
    }
    return text
  }, [campaign, selectedRecipient])

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-[#f0f2f5] dark:bg-[#0c1317]">
        <div className="flex flex-col items-center p-8 bg-white dark:bg-[#1f2c34] rounded-2xl shadow-sm border border-[#e9edef] dark:border-[#2a3942]">
          <Loader2 className="animate-spin text-[#00a884] mb-3" size={32} />
          <h2 className="text-sm font-bold text-[#111b21] dark:text-white">
            Opening Campaign Workspace...
          </h2>
          <p className="text-xs text-[#8696a0] mt-1">
            Loading conversations, logs, and live replies
          </p>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-[#f0f2f5] dark:bg-[#0c1317] p-6">
        <div className="max-w-md w-full text-center bg-white dark:bg-[#1f2c34] p-8 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm">
          <AlertCircle className="mx-auto text-rose-500 mb-3" size={36} />
          <h2 className="text-base font-bold text-[#111b21] dark:text-white">
            Campaign Not Found
          </h2>
          <p className="text-xs text-[#8696a0] mt-1 mb-6">
            The requested campaign does not exist or you do not have permission to view it.
          </p>
          <button
            onClick={() => router.push('/dashboard/campaigns')}
            className="px-4 py-2 bg-[#008069] text-white rounded-xl text-xs font-bold hover:bg-[#00705b] transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
          >
            <ArrowLeft size={14} />
            <span>Return to Campaigns</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f0f2f5] dark:bg-[#0c1317] overflow-hidden select-none">
      {/* ── TOP HEADER BAR (RESPONSIVE FOR MOBILE & DESKTOP) ── */}
      <header className="bg-white dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-3.5 sm:px-6 py-2 sm:py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 flex-shrink-0 z-20 shadow-2xs">
        {/* Row 1: Back + Title + Status + Mobile Refresh Button */}
        <div className="flex items-center justify-between sm:justify-start gap-2.5 min-w-0 w-full sm:w-auto">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => router.push('/dashboard/campaigns')}
              className="p-1.5 sm:p-2 -ml-1 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold shrink-0"
              title="Back to Campaigns"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Campaigns</span>
            </button>

            <div className="h-5 w-[1px] bg-[#e9edef] dark:bg-[#2a3942] hidden sm:block" />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-sm md:text-base font-extrabold text-[#111b21] dark:text-white truncate max-w-[160px] xs:max-w-[220px] sm:max-w-xs md:max-w-md">
                  {campaign.name}
                </h1>
                <span className={`text-[9px] sm:text-[9.5px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0 ${
                  campaign.status === 'COMPLETED' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/60' :
                  campaign.status === 'PROCESSING' || campaign.status === 'PENDING' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60 animate-pulse' :
                  campaign.status === 'SCHEDULED' ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60' :
                  campaign.status === 'STOPPED' || campaign.status === 'CANCELLED' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/60' :
                  campaign.status === 'FAILED' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 border-red-200' :
                  'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200'
                }`}>
                  {campaign.status}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-[10px] text-[#8696a0] font-medium mt-0.5 truncate">
                <span className="capitalize">{campaign.channel || 'whatsapp'}</span>
                <span>•</span>
                <span>Template: <strong className="text-[#54656f] dark:text-slate-300">{campaign.template_name}</strong></span>
                <span>•</span>
                <span>{new Date(campaign.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>

          {/* Quick Refresh on mobile */}
          <button
            onClick={() => loadCampaignData(false)}
            disabled={isRefreshing}
            className="sm:hidden p-1.5 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer disabled:opacity-50 shrink-0"
            title="Refresh campaign data"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-[#00a884]' : ''} />
          </button>
        </div>

        {/* Tab Switcher & Desktop Quick Actions */}
        <div className="flex items-center justify-between sm:justify-end gap-2 md:gap-3 shrink-0 w-full sm:w-auto">
          {/* Active Chats Live Indication Mark (desktop only) */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <MessageSquare size={13} className="text-[#008069] dark:text-emerald-400" />
            <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
              {activeChatsCount} Active {activeChatsCount === 1 ? 'Chat' : 'Chats'}
            </span>
            {unreadChatsCount > 0 && (
              <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full ml-0.5 animate-bounce">
                {unreadChatsCount} need reply
              </span>
            )}
          </div>

          {/* Tab Switcher (full-width segmented on mobile) */}
          <div className="flex items-center bg-[#f0f2f5] dark:bg-[#121b22] p-0.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942] w-full sm:w-auto">
            <button
              onClick={() => {
                setActiveTab('chats')
                setMobileChatView('list')
              }}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'chats'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white shadow-xs'
                  : 'text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
              }`}
            >
              <MessageSquare size={13} className="text-[#008069] dark:text-emerald-400" />
              <span>Live Chats</span>
              {activeChatsCount > 0 && (
                <span className="bg-[#008069] text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                  {activeChatsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white shadow-xs'
                  : 'text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
              }`}
            >
              <TrendingUp size={13} className="text-indigo-600 dark:text-indigo-400" />
              <span>Overview & Logs</span>
            </button>
          </div>

          {/* Quick Actions (desktop) */}
          <button
            onClick={() => loadCampaignData(false)}
            disabled={isRefreshing}
            className="hidden sm:flex p-2 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer disabled:opacity-50"
            title="Refresh campaign data"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-[#00a884]' : ''} />
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      {activeTab === 'chats' ? (
        <div className="flex-1 flex overflow-hidden relative">
          {/* ── LEFT PANE: RECIPIENT REPLIES LIST ── */}
          <aside
            className={`${
              mobileChatView === 'list' ? 'flex' : 'hidden'
            } md:flex w-full md:w-[360px] lg:w-[400px] flex-shrink-0 bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#2a3942] flex-col h-full z-10`}
          >
            {/* Search & Filter Header */}
            <div className="p-3 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#2a3942] space-y-2.5">
              {/* Search Bar */}
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]"
                />
                <input
                  type="text"
                  placeholder="Search contact or reply..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-[#f0f2f5] dark:bg-[#202d36] rounded-xl text-xs text-[#111b21] dark:text-white placeholder-[#8696a0] border border-transparent focus:border-[#00a884] focus:outline-hidden transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-white cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                <button
                  onClick={() => setRecipientFilter('replied')}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1 ${
                    recipientFilter === 'replied'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-[#f0f2f5] dark:bg-[#202d36] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef]'
                  }`}
                >
                  <MessageSquare size={10} className="fill-current" />
                  <span>Replied ({activeChatsCount})</span>
                </button>

                <button
                  onClick={() => setRecipientFilter('needs_reply')}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1 ${
                    recipientFilter === 'needs_reply'
                      ? 'bg-rose-500 text-white shadow-xs'
                      : 'bg-[#f0f2f5] dark:bg-[#202d36] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef]'
                  }`}
                >
                  <span>Needs Reply</span>
                  {unreadChatsCount > 0 && (
                    <span className="bg-white text-rose-600 text-[8px] font-black px-1.5 py-0.2 rounded-full">
                      {unreadChatsCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setRecipientFilter('all')}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer shrink-0 ${
                    recipientFilter === 'all'
                      ? 'bg-[#111b21] dark:bg-white text-white dark:text-[#111b21] shadow-xs'
                      : 'bg-[#f0f2f5] dark:bg-[#202d36] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef]'
                  }`}
                >
                  All Dispatched ({recipients.length})
                </button>
              </div>
            </div>

            {/* Recipient Cards List */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#f0f2f5] dark:divide-[#202d36]/60 scrollbar-thin">
              {filteredRecipients.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-[#8696a0]">
                  <Inbox size={32} className="mb-2 opacity-50" />
                  <p className="text-xs font-bold text-[#111b21] dark:text-white">
                    No recipients match filter
                  </p>
                  <p className="text-[10px] mt-1">
                    {recipientFilter === 'replied'
                      ? 'No customer has replied to this campaign yet.'
                      : 'Try switching filters to view all dispatched contacts.'}
                  </p>
                  {recipientFilter !== 'all' && (
                    <button
                      onClick={() => setRecipientFilter('all')}
                      className="mt-3 px-3 py-1 bg-[#f0f2f5] dark:bg-[#202d36] hover:bg-[#e9edef] text-[#111b21] dark:text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                      View All Recipients
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {visibleRecipients.map((rec, index) => {
                    const isSelected = selectedRecipient?.conversation_id === rec.conversation_id
                    const displayName =
                      rec.first_name || rec.last_name
                        ? `${rec.first_name || ''} ${rec.last_name || ''}`.trim()
                        : rec.contact_phone || rec.phone_number || 'Campaign Recipient'
                    const displayPhone = rec.contact_phone || rec.phone_number || '-'

                    return (
                      <div
                        key={rec.log_id || `${rec.phone_number}-${index}`}
                        onClick={() => {
                          setSelectedRecipient(rec)
                          setMobileChatView('chat')
                        }}
                        className={`p-3 transition-all cursor-pointer flex items-start gap-3 relative group ${
                          isSelected
                            ? 'bg-[#f0f2f5] dark:bg-[#2a3942]/60 border-l-4 border-l-[#008069]'
                            : 'hover:bg-[#f8f9fa] dark:hover:bg-[#1a252d]'
                        }`}
                      >
                        {/* Avatar */}
                        <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-[#008069] to-[#00a884] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                          {displayName.charAt(0).toUpperCase()}
                        </div>

                        {/* Recipient Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <h4 className="text-xs font-bold text-[#111b21] dark:text-white truncate">
                              {displayName}
                            </h4>
                            <span className="text-[9px] text-[#8696a0] shrink-0 font-medium">
                              {rec.last_message_at
                                ? new Date(rec.last_message_at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : new Date(rec.dispatched_at).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] text-[#8696a0] font-mono mt-0.5">
                            <span>{displayPhone}</span>
                            {rec.dispatch_status && (
                              <span
                                className={`text-[8px] font-black px-1.5 py-0.2 rounded border uppercase ${
                                  rec.dispatch_status === 'DELIVERED'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 border-emerald-200/50'
                                    : rec.dispatch_status === 'READ'
                                    ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 border-blue-200/50'
                                    : rec.dispatch_status === 'FAILED'
                                    ? 'bg-red-50 text-red-600 border-red-200/50'
                                    : 'bg-slate-50 text-slate-500 border-slate-200/50'
                                }`}
                              >
                                {rec.dispatch_status}
                              </span>
                            )}
                          </div>

                          {/* Last Message Snippet */}
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <p className="text-[11px] text-[#54656f] dark:text-[#8696a0] truncate flex items-center gap-1 font-normal">
                              {rec.last_message ? (
                                <>
                                  {rec.last_message.sender_type === 'user' ? (
                                    <CheckCheck size={12} className="text-[#53bdeb] shrink-0" />
                                  ) : (
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                  )}
                                  <span className="truncate">{rec.last_message.body}</span>
                                </>
                              ) : (
                                <span className="italic text-[#8696a0]/70 truncate">
                                  Dispatched campaign message
                                </span>
                              )}
                            </p>

                            {/* Unread badge & Replied Badge */}
                            <div className="flex items-center gap-1 shrink-0">
                              {rec.has_replied && (
                                <span className="text-[8px] font-extrabold px-1.5 py-0.2 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                                  Replied
                                </span>
                              )}
                              {rec.unread_count > 0 && (
                                <span className="bg-rose-500 text-white text-[9px] font-black h-4 min-w-4 px-1 rounded-full flex items-center justify-center shadow-xs">
                                  {rec.unread_count}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Load More Chats Button */}
                  {filteredRecipients.length > visibleRecipients.length && (
                    <div className="p-3 text-center bg-white dark:bg-[#111b21] border-t border-[#f0f2f5] dark:border-[#202d36]/60 sticky bottom-0 z-10 shadow-xs">
                      <button
                        onClick={() => setChatListLimit((prev) => prev + 30)}
                        className="w-full py-2 px-3 text-xs font-bold text-[#008069] dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-xl transition-all cursor-pointer shadow-2xs"
                      >
                        Load More Chats ({filteredRecipients.length - visibleRecipients.length} remaining)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* ── RIGHT PANE: INTERACTIVE CHAT WORKSPACE ── */}
          <main
            className={`${
              mobileChatView === 'chat' ? 'flex' : 'hidden'
            } md:flex flex-1 flex-col h-full bg-[#efeae2] dark:bg-[#0b141a] relative overflow-hidden`}
          >
            {selectedRecipient ? (
              <>
                {/* Chat Header */}
                <div className="bg-white dark:bg-[#202d36] px-3 sm:px-4 py-2.5 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between z-10 shadow-2xs">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    {/* Mobile Back Button to return to list */}
                    <button
                      onClick={() => setMobileChatView('list')}
                      className="md:hidden p-1.5 -ml-1 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] rounded-lg transition-all cursor-pointer shrink-0"
                      title="Back to conversation list"
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-[#008069] to-[#00a884] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                      {(selectedRecipient.first_name || selectedRecipient.phone_number || 'C')
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs md:text-sm font-bold text-[#111b21] dark:text-white truncate">
                          {selectedRecipient.first_name || selectedRecipient.last_name
                            ? `${selectedRecipient.first_name || ''} ${selectedRecipient.last_name || ''}`.trim()
                            : selectedRecipient.contact_phone || selectedRecipient.phone_number}
                        </h3>
                        {selectedRecipient.has_replied && (
                          <span className="text-[8px] font-black px-1.5 py-0.2 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                            Active Reply
                          </span>
                        )}

                        {/* Meta 24-Hour Free Service Window Badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-wide border shrink-0 ${
                            !metaWindowStatus.hasInbound
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                              : !metaWindowStatus.isOpen
                              ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-650 dark:text-rose-400 border-rose-200/60'
                              : metaWindowStatus.isClosingSoon
                              ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200/60'
                              : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200/60'
                          }`}
                          title={
                            metaWindowStatus.isOpen
                              ? `WhatsApp 24-hour service window is active (${metaWindowStatus.hoursLeft}h ${metaWindowStatus.minutesLeft}m left)`
                              : metaWindowStatus.hasInbound
                              ? 'WhatsApp 24-hour customer service window expired. Free-form messages will be rejected by Meta.'
                              : 'No customer reply received yet. Customer care window is not active.'
                          }
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              !metaWindowStatus.hasInbound
                                ? 'bg-slate-400'
                                : !metaWindowStatus.isOpen
                                ? 'bg-rose-500'
                                : metaWindowStatus.isClosingSoon
                                ? 'bg-amber-500 animate-pulse'
                                : 'bg-emerald-500 animate-pulse'
                            }`}
                          />
                          <span>{metaWindowStatus.text}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#8696a0] font-mono mt-0.5">
                        <span>
                          {selectedRecipient.contact_phone || selectedRecipient.phone_number}
                        </span>
                        <button
                          onClick={() =>
                            copyPhoneNumber(
                              selectedRecipient.contact_phone || selectedRecipient.phone_number || ''
                            )
                          }
                          className="hover:text-[#111b21] dark:hover:text-white cursor-pointer"
                          title="Copy phone"
                        >
                          {copiedPhone ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                        </button>
                        <span>•</span>
                        <span className="uppercase text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                          {selectedRecipient.dispatch_status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Header Actions */}
                  <div className="flex items-center gap-1.5 md:gap-2">
                    {/* AI Suggestions Trigger */}
                    <button
                      onClick={() => {
                        if (showAiPanel) {
                          setShowAiPanel(false)
                        } else if (selectedRecipient?.conversation_id) {
                          fetchSuggestions(selectedRecipient.conversation_id)
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border shadow-2xs ${
                        showAiPanel
                          ? 'bg-indigo-600 text-white border-indigo-700 shadow-xs'
                          : 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                      }`}
                      title="Generate AI smart suggestions based on chat context"
                    >
                      <Sparkles size={12} className={loadingSuggestions ? 'animate-spin' : ''} />
                      <span className="hidden sm:inline">AI Suggestions</span>
                    </button>

                    {/* Templates Trigger */}
                    <button
                      onClick={() => {
                        fetchTemplates()
                        setShowTemplateModal(true)
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border bg-emerald-50 dark:bg-emerald-950/30 text-[#008069] dark:text-emerald-400 border-[#00a884]/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 shadow-2xs"
                      title="Send Meta-approved WhatsApp template"
                    >
                      <FileText size={12} />
                      <span className="hidden sm:inline">Templates</span>
                    </button>

                    {/* View Dispatched Campaign Message Context Button */}
                    <button
                      onClick={() => setShowCampaignContext((prev) => !prev)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                        showCampaignContext
                          ? 'bg-[#e7f7f4] dark:bg-emerald-950/30 text-[#008069] dark:text-emerald-400 border-[#00a884]/30'
                          : 'bg-white dark:bg-[#111b21] text-[#54656f] dark:text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#202d36] border-[#e9edef] dark:border-[#2a3942]'
                      }`}
                      title={showCampaignContext ? 'Hide campaign message' : 'View dispatched campaign message'}
                    >
                      <FileText size={12} className={showCampaignContext ? 'text-[#008069]' : ''} />
                      <span className="hidden md:inline">{showCampaignContext ? 'Hide Campaign Message' : 'View Campaign Message'}</span>
                      {showCampaignContext ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>
                </div>

                {/* Pinned Campaign Message Context Banner (Collapsible, closed by default) */}
                {showCampaignContext && recipientDispatchedText && (
                  <div className="bg-emerald-50/95 dark:bg-[#1f2c34]/95 border-b border-emerald-200 dark:border-[#2a3942] p-3 px-4 shadow-xs text-xs backdrop-blur-xs flex-shrink-0 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#008069] dark:text-emerald-400 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Megaphone size={12} />
                        <span>DISPATCHED CAMPAIGN MESSAGE • {new Date(selectedRecipient.dispatched_at).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[#8696a0] uppercase text-[9px]">
                          STATUS: {selectedRecipient.dispatch_status}
                        </span>
                        <button
                          onClick={() => setShowCampaignContext(false)}
                          className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-md text-[#8696a0] hover:text-[#111b21] dark:hover:text-white cursor-pointer transition-colors"
                          title="Close banner"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="p-2.5 bg-white dark:bg-[#111b21] rounded-lg border border-emerald-100 dark:border-emerald-900/40 text-[11.5px] leading-relaxed text-[#111b21] dark:text-slate-200 font-sans whitespace-pre-wrap shadow-2xs max-h-24 overflow-y-auto scrollbar-thin">
                      {recipientDispatchedText}
                    </div>
                  </div>
                )}

                {/* Messages Stream Area */}
                <div
                  className="flex-1 overflow-y-auto p-4 space-y-2.5 scrollbar-thin bg-repeat"
                  style={{
                    backgroundImage: `radial-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 0)`,
                    backgroundSize: '24px 24px',
                  }}
                >
                  {isLoadingMessages ? (
                    <div className="flex flex-col items-center justify-center h-48 text-[#8696a0]">
                      <Loader2 className="animate-spin text-[#00a884] mb-2" size={24} />
                      <span className="text-xs">Loading message history...</span>
                    </div>
                  ) : displayedMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center text-[#8696a0]">
                      <div className="bg-white/80 dark:bg-[#1f2c34]/80 p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] max-w-sm">
                        <CheckCircle2 size={24} className="mx-auto text-emerald-500 mb-2" />
                        <p className="text-xs font-bold text-[#111b21] dark:text-white">
                          Campaign message was dispatched
                        </p>
                        <p className="text-[10px] mt-1">
                          No customer reply received yet. You can send a follow-up message below at any time!
                        </p>
                      </div>
                    </div>
                  ) : (
                    displayedMessages.map((msg) => {
                      const isUser = msg.sender_type === 'user'
                      const isTemp = msg.id.startsWith('temp-')

                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[85%] md:max-w-[70%] rounded-xl px-3 py-2 text-xs leading-relaxed shadow-xs relative group ${
                              isUser
                                ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-white rounded-tr-none'
                                : 'bg-white dark:bg-[#202d36] text-[#111b21] dark:text-white rounded-tl-none border border-slate-100 dark:border-transparent'
                            }`}
                          >
                            {/* Message Media */}
                            {msg.media_url && (
                              <div className="mb-1.5 rounded-lg overflow-hidden border border-black/10">
                                {msg.media_url.match(/\.(jpeg|jpg|gif|png|webp)/i) ? (
                                  <img
                                    src={msg.media_url}
                                    alt="attachment"
                                    className="max-h-56 w-auto object-cover rounded-md"
                                  />
                                ) : (
                                  <a
                                    href={msg.media_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 p-2 bg-black/5 dark:bg-white/5 rounded text-xs font-bold hover:underline"
                                  >
                                    <Paperclip size={13} />
                                    <span>Download Attachment</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {/* Message Body */}
                            <p className="whitespace-pre-wrap break-words">{msg.body}</p>

                            {/* Timestamp & Status */}
                            <div className="flex items-center justify-end gap-1 mt-1 text-[8.5px] text-[#8696a0]">
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {isUser && (
                                <span>
                                  {isTemp || msg.status === 'sending' ? (
                                    <Clock size={10} className="animate-pulse" />
                                  ) : msg.status === 'failed' ? (
                                    <AlertCircle size={10} className="text-red-500" />
                                  ) : (
                                    <CheckCheck size={11} className="text-[#53bdeb]" />
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Send Error Alert */}
                {sendError && (
                  <div className="px-4 py-2 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900/50 flex items-center justify-between text-xs text-red-600 dark:text-red-400">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>{sendError}</span>
                    </div>
                    <button
                      onClick={() => setSendError(null)}
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 rounded cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {/* Floating AI Suggestions Popup */}
                {selectedRecipient && showAiPanel && (
                  <div className="mx-4 mb-2 bg-white/95 dark:bg-[#111b21]/95 backdrop-blur-md border border-indigo-200 dark:border-indigo-900/50 rounded-2xl shadow-xl z-20 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-200 select-none">
                    {/* Header Bar */}
                    <div className="px-3.5 py-2 flex items-center justify-between border-b border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20">
                      <div className="flex items-center gap-1.5 text-[9px] font-black text-indigo-700 dark:text-indigo-400 uppercase tracking-wider bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                        <Sparkles size={10} className="text-indigo-600 dark:text-indigo-400" />
                        <span>AI Smart Suggestions</span>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Refresh */}
                        <button
                          onClick={() => selectedRecipient.conversation_id && fetchSuggestions(selectedRecipient.conversation_id)}
                          className="p-1 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-slate-400 hover:text-indigo-600 rounded-full transition-colors cursor-pointer"
                          title="Regenerate suggestions"
                        >
                          <RefreshCw size={11} className={loadingSuggestions ? 'animate-spin' : ''} />
                        </button>
                        {/* Close */}
                        <button
                          onClick={() => setShowAiPanel(false)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-500 rounded-full transition-colors cursor-pointer"
                          title="Close"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Suggestions list */}
                    {loadingSuggestions ? (
                      <div className="p-5 flex flex-col items-center justify-center gap-2">
                        <Loader2 size={18} className="animate-spin text-indigo-600" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Analyzing conversation context...
                        </span>
                      </div>
                    ) : aiSuggestionsError ? (
                      <div className="p-4 text-center">
                        <p className="text-xs font-semibold text-rose-500">{aiSuggestionsError}</p>
                        <button
                          onClick={() => selectedRecipient.conversation_id && fetchSuggestions(selectedRecipient.conversation_id)}
                          className="mt-2 px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                        >
                          Try Again
                        </button>
                      </div>
                    ) : aiSuggestions.length === 0 ? (
                      <div className="p-4 text-center text-slate-400">
                        <p className="text-xs font-semibold">No suggestions generated yet</p>
                        <button
                          onClick={() => selectedRecipient.conversation_id && fetchSuggestions(selectedRecipient.conversation_id)}
                          className="mt-2 px-3 py-1 bg-indigo-600 text-white rounded-lg text-[10px] font-bold shadow-xs cursor-pointer"
                        >
                          Generate Smart Replies
                        </button>
                      </div>
                    ) : (
                      <div className="p-2.5 flex flex-col gap-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                        {aiSuggestions.map((sug, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              setInputMessage(sug.text)
                              setShowAiPanel(false)
                              textareaRef.current?.focus()
                            }}
                            className="group p-2.5 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 border border-slate-200/70 dark:border-slate-700/60 hover:border-indigo-400/50 rounded-xl transition-all cursor-pointer flex items-start gap-2 text-left"
                            title="Click to insert into reply"
                          >
                            <span className="shrink-0 w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[9px] font-extrabold flex items-center justify-center mt-0.5">
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11.5px] leading-relaxed text-[#111b21] dark:text-slate-200 font-medium">
                                {sug.text}
                              </p>
                              {sug.article_title && (
                                <div className="mt-1 flex items-center gap-1 text-[8.5px] text-indigo-600 dark:text-indigo-400 font-semibold truncate">
                                  <BookOpen size={9} />
                                  <span className="truncate">{sug.article_title}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Meta 24-hour Free Customer Window Alert Banner */}
                {!metaWindowStatus.isOpen && (
                  <div className="mx-4 mb-2 mt-1 px-3.5 py-2.5 rounded-xl border bg-rose-50 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 select-none z-10 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <AlertCircle size={15} className="text-rose-600 shrink-0" />
                      <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 leading-normal">
                        {metaWindowStatus.hasInbound
                          ? '⚠️ The 24-hour WhatsApp support window has expired. Meta will reject free-form messages until customer replies.'
                          : '⚠️ 24-hour customer service window is not active. Meta policy requires using an approved WhatsApp template.'}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        fetchTemplates()
                        setShowTemplateModal(true)
                      }}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 shadow-xs cursor-pointer w-full sm:w-auto"
                    >
                      <FileText size={12} />
                      <span>Send Approved Template</span>
                    </button>
                  </div>
                )}

                {/* Message Input Composer */}
                <div className="bg-white dark:bg-[#202d36] border-t border-[#e9edef] dark:border-[#2a3942] p-3 px-4 flex items-end gap-2 z-10">
                  {/* Rephrase with AI */}
                  <div className="relative flex-shrink-0" ref={rephraseDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowRephraseDropdown(!showRephraseDropdown)}
                      disabled={!inputMessage.trim() || isRephrasing}
                      className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        showRephraseDropdown
                          ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800 shadow-2xs'
                          : 'bg-[#f0f2f5] dark:bg-[#2a3942] hover:bg-purple-50 dark:hover:bg-purple-950/30 text-purple-600 dark:text-purple-400 border-transparent hover:border-purple-200 dark:hover:border-purple-800'
                      }`}
                      title="Rephrase message with AI"
                    >
                      {isRephrasing ? (
                        <Loader2 size={14} className="animate-spin text-purple-600" />
                      ) : (
                        <Wand2 size={14} className="text-purple-600 dark:text-purple-400" />
                      )}
                      <span className="hidden md:inline text-[11px] font-bold">Rephrase</span>
                    </button>

                    {/* Rephrase Dropdown */}
                    {showRephraseDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-48 bg-white dark:bg-[#111b21] rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 py-1.5 z-30 animate-in fade-in zoom-in-95 duration-150">
                        <div className="px-3 py-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                          Rephrase Tone
                        </div>
                        <button
                          onClick={() => handleRephrase('professional')}
                          className="w-full text-left px-3 py-1.5 hover:bg-purple-50 dark:hover:bg-purple-950/20 text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <span>👔 Professional</span>
                        </button>
                        <button
                          onClick={() => handleRephrase('friendly')}
                          className="w-full text-left px-3 py-1.5 hover:bg-purple-50 dark:hover:bg-purple-950/20 text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <span>😊 Friendly</span>
                        </button>
                        <button
                          onClick={() => handleRephrase('short')}
                          className="w-full text-left px-3 py-1.5 hover:bg-purple-50 dark:hover:bg-purple-950/20 text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <span>⚡ Short & Crisp</span>
                        </button>
                        <button
                          onClick={() => handleRephrase('grammar')}
                          className="w-full text-left px-3 py-1.5 hover:bg-purple-50 dark:hover:bg-purple-950/20 text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <span>✨ Fix Grammar</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Send Template Trigger Button */}
                  <button
                    type="button"
                    onClick={() => {
                      fetchTemplates()
                      setShowTemplateModal(true)
                    }}
                    className="p-2 rounded-xl border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800 bg-[#f0f2f5] dark:bg-[#2a3942] hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-[#008069] dark:text-emerald-400 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                    title="Send Meta-approved WhatsApp Template"
                  >
                    <FileText size={14} />
                    <span className="hidden md:inline text-[11px] font-bold">Template</span>
                  </button>

                  {/* Textarea Input */}
                  <div className="flex-1 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-2xl border border-transparent focus-within:border-[#00a884] focus-within:bg-white dark:focus-within:bg-[#111b21] transition-all flex items-end px-3 py-1.5">
                    <textarea
                      ref={textareaRef}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        metaWindowStatus.isOpen
                          ? `Reply to ${selectedRecipient.first_name || 'contact'} on WhatsApp (Press Enter to send)...`
                          : `Customer window closed. Type here or send an approved template...`
                      }
                      rows={1}
                      className="w-full bg-transparent text-xs text-[#111b21] dark:text-white placeholder-[#8696a0] focus:outline-hidden resize-none max-h-24 scrollbar-thin py-1"
                    />
                  </div>

                  {/* Send Button */}
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || isSending}
                    className="h-9 w-9 rounded-full bg-[#008069] hover:bg-[#00705b] text-white flex items-center justify-center cursor-pointer transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    title="Send WhatsApp Reply (Enter)"
                  >
                    {isSending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Send size={15} className="translate-x-[1px]" />
                    )}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#8696a0]">
                <div className="p-6 bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm max-w-sm">
                  <MessageSquare size={36} className="mx-auto text-[#008069] mb-3 opacity-60" />
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white">
                    Select a Campaign Recipient
                  </h3>
                  <p className="text-xs text-[#8696a0] mt-1">
                    Choose any recipient from the left list to review their campaign message and reply directly in real time.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      ) : (
        /* ── OVERVIEW & DELIVERY LOGS TAB ── */
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin">
          {/* Top KPI Metrics Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 md:gap-4">
            {/* Targets */}
            <div className="bg-white dark:bg-[#1f2c34] p-4.5 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-indigo-300 dark:hover:border-indigo-800 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Total Targets
                </span>
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Users size={15} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-[#111b21] dark:text-white tracking-tight">
                  {campaign.total_contacts}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <span>Target contact pool</span>
                </div>
              </div>
            </div>

            {/* Dispatched Sent */}
            <div className="bg-white dark:bg-[#1f2c34] p-4.5 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-emerald-300 dark:hover:border-emerald-800 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Dispatched Sent
                </span>
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-[#008069] dark:text-emerald-400">
                  <Send size={15} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-[#008069] dark:text-emerald-400 tracking-tight">
                  {campaign.sent_count}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 font-medium mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>
                    {campaign.total_contacts > 0
                      ? `${Math.round((campaign.sent_count / campaign.total_contacts) * 100)}% successful dispatch`
                      : '0% dispatch'}
                  </span>
                </div>
              </div>
            </div>

            {/* Delivery Failed */}
            <div className="bg-white dark:bg-[#1f2c34] p-4.5 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-rose-300 dark:hover:border-rose-800 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  Failed
                </span>
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                  <AlertCircle size={15} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
                  {campaign.failed_count}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-rose-600/80 dark:text-rose-400 font-medium mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${campaign.failed_count > 0 ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  <span>
                    {campaign.failed_count === 0
                      ? '0% bounce rate'
                      : `${((campaign.failed_count / (campaign.total_contacts || 1)) * 100).toFixed(1)}% bounce rate`}
                  </span>
                </div>
              </div>
            </div>

            {/* Active Replies */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/20 p-4.5 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex flex-col justify-between relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                  Active Replies
                </span>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 tracking-tight flex items-baseline gap-2">
                  <span>{activeChatsCount}</span>
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                    ({campaign.reply_rate || 0}% rate)
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-300 font-medium mt-1">
                  <MessageSquare size={11} />
                  <span>Interactive customer chats</span>
                </div>
              </div>
            </div>

            {/* Need Reply */}
            <div className="bg-white dark:bg-[#1f2c34] p-4.5 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-amber-300 dark:hover:border-amber-800 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Need Reply
                </span>
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                  <Clock size={15} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
                  {unreadChatsCount}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-amber-600/90 dark:text-amber-400 font-medium mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${unreadChatsCount > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                  <span>{unreadChatsCount === 0 ? 'All messages answered' : `${unreadChatsCount} awaiting response`}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── 2-COLUMN TEMPLATE & CAMPAIGN INTELLIGENCE SHOWCASE ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Authentic WhatsApp Smartphone Simulator Preview */}
            <div className="lg:col-span-6 bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-[#00a884]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#111b21] dark:text-white">
                      WhatsApp Live Simulation
                    </span>
                  </div>

                  {/* Toggle Preview with Real Sample Data vs Raw Tags */}
                  <div className="flex items-center gap-1.5 bg-[#f0f2f5] dark:bg-[#121b22] p-1 rounded-xl border border-[#e9edef] dark:border-[#2a3942]">
                    <button
                      onClick={() => setPreviewWithSampleData(true)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
                        previewWithSampleData
                          ? 'bg-white dark:bg-[#1f2c34] text-[#008069] dark:text-emerald-400 shadow-2xs'
                          : 'text-[#54656f] dark:text-[#8696a0]'
                      }`}
                      title="Preview template with real contact values"
                    >
                      Sample Values
                    </button>
                    <button
                      onClick={() => setPreviewWithSampleData(false)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
                        !previewWithSampleData
                          ? 'bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white shadow-2xs'
                          : 'text-[#54656f] dark:text-[#8696a0]'
                      }`}
                      title="Show raw template placeholders like {{name}}"
                    >
                      Raw Tags
                    </button>
                  </div>
                </div>

                {/* Smartphone Shell */}
                <div className="rounded-2xl border border-slate-200 dark:border-[#2a3942] overflow-hidden shadow-md max-w-md mx-auto">
                  {/* Phone Mockup Status Bar */}
                  <div className="bg-[#005c4b] text-white/90 text-[10px] px-4 py-1 flex items-center justify-between font-mono select-none">
                    <span>9:41</span>
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span>5G</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* WhatsApp Header Simulation */}
                  <div className="bg-[#008069] text-white px-3.5 py-2.5 flex items-center justify-between select-none">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs shrink-0 text-white">
                        {campaign.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold truncate max-w-[150px]">
                            {sampleRecipient?.first_name || 'MNR Outreach'}
                          </span>
                          <CheckCircle2 size={11} className="text-emerald-300 shrink-0 fill-emerald-300 text-white" />
                        </div>
                        <span className="text-[9px] text-white/80 block leading-tight">
                          Official WhatsApp Business Account
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90">
                      <Phone size={13} />
                      <Mail size={13} />
                    </div>
                  </div>

                  {/* WhatsApp Chat Body Simulation */}
                  <div
                    className="p-4 space-y-3 min-h-[260px] max-h-[340px] overflow-y-auto scrollbar-thin bg-[#efeae2] dark:bg-[#0b141a]"
                    style={{
                      backgroundImage: `radial-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 0)`,
                      backgroundSize: '24px 24px',
                    }}
                  >
                    {/* Date Badge */}
                    <div className="text-center">
                      <span className="bg-white/85 dark:bg-[#1f2c34]/90 text-[9px] font-bold text-[#54656f] dark:text-[#8696a0] px-2.5 py-0.5 rounded-md shadow-2xs uppercase">
                        Today
                      </span>
                    </div>

                    {/* Security Pill */}
                    <div className="p-2 bg-[#ffeecd] dark:bg-amber-950/40 rounded-lg text-center text-[9px] text-amber-900 dark:text-amber-300 font-medium leading-tight flex items-center justify-center gap-1 shadow-2xs">
                      <ShieldCheck size={11} className="shrink-0" />
                      <span>Messages and calls are end-to-end encrypted.</span>
                    </div>

                    {/* Outbound Message Bubble */}
                    <div className="flex justify-end">
                      <div className="bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-white rounded-xl rounded-tr-none px-3.5 py-2.5 shadow-xs max-w-[95%] text-xs leading-relaxed relative font-sans">
                        <p className="whitespace-pre-wrap break-words">{simulatedBody}</p>
                        <div className="flex items-center justify-end gap-1 mt-1 text-[8.5px] text-[#54656f] dark:text-[#8696a0] select-none">
                          <span>11:51 AM</span>
                          <CheckCheck size={12} className="text-[#53bdeb]" />
                        </div>
                      </div>
                    </div>

                    {/* Simulated Quick Action Reply Buttons if mentioned */}
                    {simulatedBody.includes('YES') || simulatedBody.includes('DONE') ? (
                      <div className="space-y-1 pt-1 max-w-[95%] ml-auto">
                        <div className="bg-white dark:bg-[#1f2c34] text-[#00a884] dark:text-emerald-400 font-bold text-[11px] py-2 rounded-xl text-center shadow-xs border border-emerald-100 dark:border-emerald-950/40 cursor-default">
                          YES, CONFIRM
                        </div>
                        <div className="bg-white dark:bg-[#1f2c34] text-slate-600 dark:text-slate-300 font-medium text-[11px] py-1.5 rounded-xl text-center shadow-xs border border-slate-100 dark:border-slate-800 cursor-default">
                          NOT INTERESTED
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Bottom Simulator Bar */}
              <div className="mt-4 pt-3 border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between text-xs text-[#8696a0]">
                <div className="flex items-center gap-1.5">
                  <CheckCircle size={12} className="text-[#00a884]" />
                  <span>Meta WhatsApp Cloud Template compliant</span>
                </div>
                <button
                  onClick={handleCopyTemplate}
                  className="px-2.5 py-1 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#111b21] dark:text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copiedTemplateText ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  <span>{copiedTemplateText ? 'Copied' : 'Copy Text'}</span>
                </button>
              </div>
            </div>

            {/* Right Column: Template Specifications, Variables & Delivery Funnel */}
            <div className="lg:col-span-6 space-y-5 flex flex-col justify-between">
              {/* Template Metadata Specifications Card */}
              <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-[#00a884]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#111b21] dark:text-white">
                      Template Specification
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    APPROVED & ACTIVE
                  </span>
                </div>

                {/* Specs List */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-[#f8f9fa] dark:bg-[#202d36] rounded-xl border border-[#e9edef] dark:border-slate-700/60">
                    <span className="text-[10px] uppercase font-bold text-[#8696a0] block mb-0.5">Template Name</span>
                    <span className="font-mono font-bold text-[#111b21] dark:text-white truncate block">
                      {campaign.template_name || 'whatsapp_broadcast'}
                    </span>
                  </div>
                  <div className="p-3 bg-[#f8f9fa] dark:bg-[#202d36] rounded-xl border border-[#e9edef] dark:border-slate-700/60">
                    <span className="text-[10px] uppercase font-bold text-[#8696a0] block mb-0.5">Category & Channel</span>
                    <div className="flex items-center gap-1.5 font-bold text-[#111b21] dark:text-white">
                      <span className="px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[9px]">UTILITY</span>
                      <span className="capitalize">{campaign.channel || 'whatsapp'}</span>
                    </div>
                  </div>
                  <div className="p-3 bg-[#f8f9fa] dark:bg-[#202d36] rounded-xl border border-[#e9edef] dark:border-slate-700/60">
                    <span className="text-[10px] uppercase font-bold text-[#8696a0] block mb-0.5">Dispatched At (IST)</span>
                    <span className="font-bold text-[#111b21] dark:text-white">
                      {new Date(campaign.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <div className="p-3 bg-[#f8f9fa] dark:bg-[#202d36] rounded-xl border border-[#e9edef] dark:border-slate-700/60">
                    <span className="text-[10px] uppercase font-bold text-[#8696a0] block mb-0.5">Dispatched By</span>
                    <span className="font-bold text-[#111b21] dark:text-white truncate block">
                      {campaign.sender || 'Marketing CRM Cloud'}
                    </span>
                  </div>
                </div>

                {/* Detected Dynamic Variables */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10.5px] uppercase font-extrabold text-slate-500 dark:text-slate-400 tracking-wider">
                      Detected Variables ({detectedVariables.length})
                    </span>
                    <span className="text-[9.5px] text-[#8696a0]">Mapped per recipient</span>
                  </div>
                  {detectedVariables.length === 0 ? (
                    <p className="text-xs text-[#8696a0] italic">No dynamic parameters in this template body.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {detectedVariables.map((v) => {
                        const sampleVal = sampleRecipient?.variables_mapped?.[v]
                        return (
                          <div
                            key={v}
                            className="inline-flex items-center gap-1.5 bg-[#f0f2f5] dark:bg-[#202d36] border border-[#e9edef] dark:border-slate-700 px-2.5 py-1 rounded-lg text-xs"
                          >
                            <span className="font-mono text-[#008069] dark:text-emerald-400 font-bold text-[10px]">
                              {`{{${v}}}`}
                            </span>
                            {sampleVal && (
                              <>
                                <span className="text-slate-300 dark:text-slate-600 text-[10px]">→</span>
                                <span className="text-[#111b21] dark:text-slate-200 font-medium text-[10.5px] truncate max-w-[120px]">
                                  {String(sampleVal)}
                                </span>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery Funnel & Quick Jump Card */}
              <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#111b21] dark:text-white">
                    Delivery & Engagement Funnel
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {campaign.total_contacts > 0 ? Math.round((campaign.sent_count / campaign.total_contacts) * 100) : 0}% Complete
                  </span>
                </div>

                {/* Progress Visual Bar */}
                <div className="w-full bg-[#f0f2f5] dark:bg-[#202d36] h-3 rounded-full overflow-hidden flex shadow-inner">
                  <div
                    style={{
                      width: `${campaign.total_contacts > 0 ? (campaign.sent_count / campaign.total_contacts) * 100 : 0}%`,
                    }}
                    className="bg-[#00a884] h-full transition-all duration-500"
                    title={`Sent: ${campaign.sent_count}`}
                  />
                  <div
                    style={{
                      width: `${campaign.total_contacts > 0 ? (campaign.failed_count / campaign.total_contacts) * 100 : 0}%`,
                    }}
                    className="bg-rose-500 h-full transition-all duration-500"
                    title={`Failed: ${campaign.failed_count}`}
                  />
                </div>

                {/* Breakdown Legend */}
                <div className="grid grid-cols-4 gap-2 pt-1 text-center">
                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-[#202d36]">
                    <span className="text-[9px] uppercase font-bold text-[#8696a0] block">Targets</span>
                    <span className="text-xs font-extrabold text-[#111b21] dark:text-white">{campaign.total_contacts}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20">
                    <span className="text-[9px] uppercase font-bold text-[#008069] dark:text-emerald-400 block">Sent</span>
                    <span className="text-xs font-extrabold text-[#008069] dark:text-emerald-400">{campaign.sent_count}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-blue-50/70 dark:bg-blue-950/20">
                    <span className="text-[9px] uppercase font-bold text-blue-600 dark:text-blue-400 block">Read / Deliv</span>
                    <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">{logDeliveredCount}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-teal-50/70 dark:bg-teal-950/20">
                    <span className="text-[9px] uppercase font-bold text-teal-700 dark:text-teal-300 block">Replies</span>
                    <span className="text-xs font-extrabold text-teal-700 dark:text-teal-300">{activeChatsCount}</span>
                  </div>
                </div>

                {/* Quick Action Buttons */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
                  <button
                    onClick={() => setActiveTab('chats')}
                    className="w-full sm:flex-1 py-2.5 px-4 bg-[#008069] hover:bg-[#00705b] text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageSquare size={14} />
                    <span>Open Live Chat Workspace ({activeChatsCount})</span>
                  </button>
                  {logs.length > 0 && (
                    <button
                      onClick={handleExportLogs}
                      className="w-full sm:w-auto py-2.5 px-4 bg-white dark:bg-[#202d36] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] text-[#111b21] dark:text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <FileSpreadsheet size={14} className="text-[#00a884]" />
                      <span>Download Excel Report</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── RECIPIENT AUDIT & DISPATCH LOGS TABLE ── */}
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] p-5 md:p-6 shadow-xs flex flex-col">
            {/* Audit Table Controls Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs md:text-sm font-extrabold uppercase tracking-wide text-[#111b21] dark:text-white">
                  Recipient Dispatch Audit ({filteredAuditRecipients.length} of {recipients.length})
                </span>
              </div>

              {/* Table Search & Status Filters */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search Bar */}
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                  <input
                    type="text"
                    placeholder="Search name, phone, email..."
                    value={auditSearchQuery}
                    onChange={(e) => setAuditSearchQuery(e.target.value)}
                    className="pl-8 pr-7 py-1.5 bg-[#f0f2f5] dark:bg-[#202d36] rounded-xl text-xs text-[#111b21] dark:text-white placeholder-[#8696a0] border border-transparent focus:border-[#00a884] focus:outline-hidden transition-all w-48 sm:w-56"
                  />
                  {auditSearchQuery && (
                    <button
                      onClick={() => setAuditSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-white cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 bg-[#f0f2f5] dark:bg-[#121b22] p-1 rounded-xl border border-[#e9edef] dark:border-[#2a3942] overflow-x-auto scrollbar-none">
                  <button
                    onClick={() => setAuditStatusFilter('all')}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer shrink-0 ${
                      auditStatusFilter === 'all'
                        ? 'bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white shadow-2xs'
                        : 'text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                    }`}
                  >
                    All ({recipients.length})
                  </button>
                  <button
                    onClick={() => setAuditStatusFilter('replied')}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer shrink-0 ${
                      auditStatusFilter === 'replied'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                    }`}
                  >
                    Replied ({activeChatsCount})
                  </button>
                  <button
                    onClick={() => setAuditStatusFilter('delivered')}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer shrink-0 ${
                      auditStatusFilter === 'delivered'
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                    }`}
                  >
                    Delivered ({logDeliveredCount})
                  </button>
                  {logReadCount > 0 && (
                    <button
                      onClick={() => setAuditStatusFilter('read')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer shrink-0 ${
                        auditStatusFilter === 'read'
                          ? 'bg-sky-600 text-white shadow-2xs'
                          : 'text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                      }`}
                    >
                      Read ({logReadCount})
                    </button>
                  )}
                  {(campaign.failed_count > 0 || logFailedCount > 0) && (
                    <button
                      onClick={() => setAuditStatusFilter('failed')}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer shrink-0 ${
                        auditStatusFilter === 'failed'
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : 'text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
                      }`}
                    >
                      Failed ({campaign.failed_count || logFailedCount})
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Table Container */}
            <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto max-h-[440px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#f8f9fa] dark:bg-[#202d36] border-b border-[#e9edef] dark:border-[#2a3942] text-[#667781] dark:text-[#8696a0] font-bold sticky top-0 z-10 select-none">
                      <th className="p-3.5 font-bold">Recipient</th>
                      <th className="p-3.5 font-bold">Delivery Status</th>
                      <th className="p-3.5 font-bold">Replied</th>
                      <th className="p-3.5 font-bold">Mapped Variables</th>
                      <th className="p-3.5 font-bold">Dispatched (IST)</th>
                      <th className="p-3.5 font-bold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f5f6f6] dark:divide-[#2a3942]/65 bg-white dark:bg-[#1f2c34]">
                    {paginatedAuditRecipients.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-[#8696a0]">
                          <Inbox size={28} className="mx-auto mb-2 opacity-50" />
                          <p className="font-bold text-xs">No recipients found</p>
                          <p className="text-[10.5px] mt-0.5">Try clearing filters or search keywords</p>
                        </td>
                      </tr>
                    ) : (
                      paginatedAuditRecipients.map((rec, idx) => (
                        <tr
                          key={rec.log_id || `${rec.phone_number}-${idx}`}
                          className="hover:bg-[#f8f9fa]/70 dark:hover:bg-[#2a3942]/30 transition-colors"
                        >
                          {/* Recipient info with initial avatar */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-[#008069] to-[#00a884] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                                {(rec.first_name || rec.phone_number || 'C').charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-[#111b21] dark:text-white truncate max-w-[160px]">
                                  {rec.first_name || rec.last_name
                                    ? `${rec.first_name || ''} ${rec.last_name || ''}`.trim()
                                    : rec.phone_number || rec.email_address || '-'}
                                </div>
                                <div className="text-[10px] text-[#8696a0] font-mono flex items-center gap-1.5 mt-0.5">
                                  <span>{rec.phone_number || rec.email_address}</span>
                                  <button
                                    onClick={() => copyPhoneNumber(rec.phone_number || '')}
                                    className="hover:text-[#111b21] dark:hover:text-white cursor-pointer"
                                    title="Copy phone"
                                  >
                                    <Copy size={10} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Status Badge */}
                          <td className="p-3.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-extrabold text-[9px] uppercase tracking-wide border shadow-2xs ${
                                (rec.dispatch_status || '').toUpperCase() === 'READ'
                                  ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-650 dark:text-blue-400 border-blue-200/60'
                                  : (rec.dispatch_status || '').toUpperCase() === 'DELIVERED'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200/60'
                                  : (rec.dispatch_status || '').toUpperCase() === 'SENT'
                                  ? 'bg-[#e7f7f4] text-[#008069] dark:bg-emerald-950/20 dark:text-emerald-300 border-[#00a884]/20'
                                  : 'bg-rose-50 dark:bg-rose-950/30 text-rose-650 dark:text-rose-400 border-rose-200/60'
                              }`}
                            >
                              {(rec.dispatch_status || '').toUpperCase() === 'READ' || (rec.dispatch_status || '').toUpperCase() === 'DELIVERED' ? (
                                <CheckCheck size={11} className={(rec.dispatch_status || '').toUpperCase() === 'READ' ? 'text-blue-500' : 'text-emerald-500'} />
                              ) : (rec.dispatch_status || '').toUpperCase() === 'SENT' ? (
                                <Check size={11} />
                              ) : (
                                <AlertCircle size={11} />
                              )}
                              <span>{rec.dispatch_status}</span>
                            </span>
                            {rec.error_message && (
                              <div className="text-[9px] text-rose-500 font-medium mt-1 truncate max-w-[150px]" title={rec.error_message}>
                                {rec.error_message}
                              </div>
                            )}
                          </td>

                          {/* Replied Indicator */}
                          <td className="p-3.5">
                            {rec.has_replied ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Replied</span>
                              </span>
                            ) : (
                              <span className="text-[#8696a0] text-xs font-mono">-</span>
                            )}
                          </td>

                          {/* Variables Mapped */}
                          <td className="p-3.5">
                            <div className="flex flex-wrap gap-1 max-w-[240px]">
                              {Object.entries(rec.variables_mapped || {}).length === 0 ? (
                                <span className="text-[10px] text-[#8696a0] italic">None</span>
                              ) : (
                                Object.entries(rec.variables_mapped || {}).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="bg-[#f0f2f5] dark:bg-[#202d36] px-2 py-0.5 rounded-md text-[9px] border border-[#e9edef] dark:border-slate-700 text-[#54656f] dark:text-[#8696a0] font-mono"
                                  >
                                    <strong className="text-[#111b21] dark:text-white">{k}:</strong> {String(v)}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>

                          {/* Dispatched Date */}
                          <td className="p-3.5 text-[11px] text-[#8696a0] whitespace-nowrap font-medium">
                            {new Date(rec.dispatched_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </td>

                          {/* Action: Open Chat */}
                          <td className="p-3.5 text-right">
                            <button
                              onClick={() => {
                                setSelectedRecipient(rec)
                                setActiveTab('chats')
                                setMobileChatView('chat')
                              }}
                              className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-[#008069] dark:text-emerald-300 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 border border-emerald-200/60 dark:border-emerald-800/60 shadow-2xs hover:shadow-xs"
                            >
                              <MessageSquare size={12} />
                              <span>Chat</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Table Pagination Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-3.5 border-t border-[#e9edef] dark:border-[#2a3942] text-xs text-[#54656f] dark:text-[#8696a0]">
              {/* Left: Showing items count & page size selector */}
              <div className="flex items-center gap-3">
                <span>
                  Showing{' '}
                  <strong className="text-[#111b21] dark:text-white font-bold">
                    {filteredAuditRecipients.length === 0 ? 0 : (auditPage - 1) * auditPageSize + 1}
                  </strong>{' '}
                  to{' '}
                  <strong className="text-[#111b21] dark:text-white font-bold">
                    {Math.min(filteredAuditRecipients.length, auditPage * auditPageSize)}
                  </strong>{' '}
                  of{' '}
                  <strong className="text-[#111b21] dark:text-white font-bold">
                    {filteredAuditRecipients.length}
                  </strong>{' '}
                  recipients
                </span>

                <div className="flex items-center gap-1.5 pl-3 border-l border-[#e9edef] dark:border-[#2a3942]">
                  <span className="text-[11px]">Show:</span>
                  <select
                    value={auditPageSize}
                    onChange={(e) => {
                      setAuditPageSize(Number(e.target.value))
                      setAuditPage(1)
                    }}
                    className="bg-[#f0f2f5] dark:bg-[#202d36] text-[#111b21] dark:text-white rounded-lg px-2 py-1 text-xs border border-transparent focus:border-[#00a884] focus:outline-hidden font-bold cursor-pointer"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>

              {/* Right: Page Navigation Buttons */}
              {totalAuditPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    disabled={auditPage === 1}
                    className="px-2.5 py-1.5 rounded-lg border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold text-xs flex items-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <ChevronLeft size={13} />
                    <span>Previous</span>
                  </button>

                  {/* Page numbers with smart windowing */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalAuditPages }, (_, i) => i + 1)
                      .filter((p) => {
                        return p === 1 || p === totalAuditPages || Math.abs(p - auditPage) <= 1
                      })
                      .map((p, idx, arr) => {
                        const prev = arr[idx - 1]
                        const showEllipsis = prev && p - prev > 1
                        return (
                          <span key={p} className="flex items-center gap-1">
                            {showEllipsis && <span className="px-1 text-[#8696a0]">...</span>}
                            <button
                              onClick={() => setAuditPage(p)}
                              className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center ${
                                auditPage === p
                                  ? 'bg-[#008069] text-white shadow-2xs'
                                  : 'border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                              }`}
                            >
                              {p}
                            </button>
                          </span>
                        )
                      })}
                  </div>

                  <button
                    onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                    disabled={auditPage === totalAuditPages}
                    className="px-2.5 py-1.5 rounded-lg border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold text-xs flex items-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <span>Next</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── META-APPROVED WHATSAPP TEMPLATE MODAL ── */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 px-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="text-[#008069] dark:text-emerald-400" size={18} />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Send Meta Approved Template
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowTemplateModal(false)
                  setSelectedTemplate(null)
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto scrollbar-thin">
              {/* Template Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Select WhatsApp Template
                </label>
                {loadingTemplates ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
                    <Loader2 size={14} className="animate-spin text-[#008069]" />
                    <span>Loading Meta templates...</span>
                  </div>
                ) : (
                  <select
                    value={selectedTemplate?.sid || ''}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-[#202d36] border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#00a884] text-[#111b21] dark:text-white cursor-pointer"
                  >
                    <option value="">Choose a WhatsApp Template...</option>
                    {templates.map((t) => (
                      <option key={t.sid} value={t.sid}>
                        {t.name} ({t.category || 'UTILITY'})
                      </option>
                    ))}
                  </select>
                )}

                {templateError && (
                  <div className="mt-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40 text-xs flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                      <AlertCircle size={13} className="shrink-0 text-amber-600" />
                      <span>WhatsApp Credentials Issue</span>
                    </div>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                      {templateError}
                    </p>
                    <a
                      href="/dashboard/settings"
                      className="text-[10px] font-bold text-emerald-600 hover:underline mt-0.5"
                    >
                      Go to Settings → Credentials to verify WhatsApp Cloud API Token
                    </a>
                  </div>
                )}
              </div>

              {/* Selected Template Preview & Variables */}
              {selectedTemplate && (
                <div className="space-y-3 pt-1">
                  <div className="p-3.5 bg-slate-50 dark:bg-[#202d36]/70 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs">
                    <p className="font-semibold text-slate-500 dark:text-slate-400 mb-1 text-[10.5px]">
                      Template Body Preview:
                    </p>
                    <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 font-normal leading-relaxed text-xs">
                      {selectedTemplate.body}
                    </p>
                  </div>

                  {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Map Variable Values
                      </p>
                      {selectedTemplate.variables.map((vKey: string) => (
                        <div key={vKey} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-[#008069] bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded border border-emerald-200/50 min-w-[70px] text-center font-bold">
                            {`{{${vKey}}}`}
                          </span>
                          <input
                            type="text"
                            value={templateVarValues[vKey] || ''}
                            onChange={(e) =>
                              setTemplateVarValues((prev) => ({ ...prev, [vKey]: e.target.value }))
                            }
                            placeholder={`Value for {{${vKey}}}`}
                            className="flex-1 px-3 py-1.5 bg-white dark:bg-[#202d36] border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-[#111b21] dark:text-white"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 px-5 bg-slate-50 dark:bg-[#182229] border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTemplateModal(false)
                  setSelectedTemplate(null)
                }}
                className="px-4 py-2 hover:bg-slate-200/60 dark:hover:bg-[#2a3942] text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendTemplate}
                disabled={!selectedTemplate || isSendingTemplate}
                className="bg-[#008069] hover:bg-[#00705b] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              >
                {isSendingTemplate ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Sending Template...</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>Send WhatsApp Template</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
