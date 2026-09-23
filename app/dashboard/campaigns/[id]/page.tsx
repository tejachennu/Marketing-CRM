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
  Copy,
  ExternalLink,
  Sparkles,
  FileText,
  X,
  Megaphone,
  CheckCircle2,
  TrendingUp,
  Inbox
} from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'

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
  const [copiedPhone, setCopiedPhone] = useState(false)

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('')
  const [recipientFilter, setRecipientFilter] = useState<'replied' | 'needs_reply' | 'all'>('replied')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedRecipientRef = useRef<RecipientChat | null>(null)

  useEffect(() => {
    selectedRecipientRef.current = selectedRecipient
  }, [selectedRecipient])

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
        // Strictly deduplicate by id
        const uniqueMap = new Map<string, MessageItem>()
        sorted.forEach((m: MessageItem) => {
          if (m && m.id && (m.body?.trim() || m.media_url)) {
            uniqueMap.set(m.id, m)
          }
        })
        setMessages(Array.from(uniqueMap.values()))
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
  }, [selectedRecipient, loadMessages])

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

          // If new message is for the currently open conversation, append it cleanly
          if (currentSelected?.conversation_id === newMsg.conversation_id) {
            setMessages((prev) => {
              // 1. If already exists by id, ignore
              if (prev.some((m) => m.id === newMsg.id)) return prev

              // 2. If it is an outbound message from user, check if an optimistic temp message with same body exists
              if (newMsg.sender_type === 'user') {
                const tempIndex = prev.findIndex(
                  (m) =>
                    m.id.startsWith('temp-') &&
                    m.body?.trim() === newMsg.body?.trim()
                )
                if (tempIndex !== -1) {
                  // Replace the optimistic message directly!
                  const copy = [...prev]
                  copy[tempIndex] = newMsg
                  return copy
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
          const alreadyHasReal = prev.some((m) => m.id === data.message.id)
          if (alreadyHasReal) {
            // Realtime already added it! Drop the temporary optimistic message
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

  // Deduplicate and filter display messages to avoid duplicate bubbles from optimistic updates or realtime races
  const displayMessages = useMemo(() => {
    const seenIds = new Set<string>()
    const result: MessageItem[] = []

    for (const msg of messages) {
      // Skip completely empty messages
      if (!msg.body?.trim() && !msg.media_url) continue

      // Drop temp optimistic message if a confirmed message with the same body already exists
      if (msg.id.startsWith('temp-')) {
        const hasRealMessage = messages.some(
          (other) => !other.id.startsWith('temp-') && other.body?.trim() === msg.body?.trim()
        )
        if (hasRealMessage) continue
      }

      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id)
        result.push(msg)
      }
    }

    return result
  }, [messages])

  // Handle textarea enter-key send
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

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
        return (
          fullName.includes(q) ||
          phone.includes(q) ||
          email.includes(q) ||
          lastMsg.includes(q)
        )
      }

      return true
    })
  }, [recipients, recipientFilter, searchQuery])

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
      {/* ── TOP HEADER BAR ── */}
      <header className="bg-white dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-4 md:px-6 py-2.5 flex items-center justify-between flex-shrink-0 z-20 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push('/dashboard/campaigns')}
            className="p-2 -ml-1 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold"
            title="Back to Campaigns"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Campaigns</span>
          </button>

          <div className="h-5 w-[1px] bg-[#e9edef] dark:bg-[#2a3942] hidden sm:block" />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm md:text-base font-extrabold text-[#111b21] dark:text-white truncate">
                {campaign.name}
              </h1>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 shrink-0">
                {campaign.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#8696a0] font-medium mt-0.5 truncate">
              <span className="capitalize">{campaign.channel || 'whatsapp'}</span>
              <span>•</span>
              <span>Template: <strong className="text-[#54656f] dark:text-slate-300">{campaign.template_name}</strong></span>
              <span>•</span>
              <span>{new Date(campaign.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>

        {/* Header Right: Active Chats Badge & Tab Buttons */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {/* Active Chats Live Indication Mark */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
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

          {/* Tab Switcher */}
          <div className="flex items-center bg-[#f0f2f5] dark:bg-[#121b22] p-0.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942]">
            <button
              onClick={() => setActiveTab('chats')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white shadow-xs'
                  : 'text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
              }`}
            >
              <TrendingUp size={13} className="text-indigo-600 dark:text-indigo-400" />
              <span>Overview & Logs</span>
            </button>
          </div>

          {/* Quick Actions */}
          <button
            onClick={() => loadCampaignData(false)}
            disabled={isRefreshing}
            className="p-2 text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer disabled:opacity-50"
            title="Refresh campaign data"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-[#00a884]' : ''} />
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      {activeTab === 'chats' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* ── LEFT PANE: RECIPIENT REPLIES LIST ── */}
          <aside className="w-full md:w-[360px] lg:w-[400px] flex-shrink-0 bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#2a3942] flex flex-col h-full z-10">
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
                filteredRecipients.map((rec) => {
                  const isSelected = selectedRecipient?.conversation_id === rec.conversation_id
                  const displayName =
                    rec.first_name || rec.last_name
                      ? `${rec.first_name || ''} ${rec.last_name || ''}`.trim()
                      : rec.contact_phone || rec.phone_number || 'Campaign Recipient'
                  const displayPhone = rec.contact_phone || rec.phone_number || '-'

                  return (
                    <div
                      key={rec.log_id}
                      onClick={() => setSelectedRecipient(rec)}
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
                })
              )}
            </div>
          </aside>

          {/* ── RIGHT PANE: INTERACTIVE CHAT WORKSPACE ── */}
          <main className="flex-1 flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a] relative overflow-hidden">
            {selectedRecipient ? (
              <>
                {/* Chat Header */}
                <div className="bg-white dark:bg-[#202d36] px-4 py-2.5 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between z-10 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-[#008069] to-[#00a884] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                      {(selectedRecipient.first_name || selectedRecipient.phone_number || 'C')
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
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

                </div>

                {/* Dispatched Campaign Message Banner - Always Shown Cleanly */}
                {recipientDispatchedText && (
                  <div className="bg-emerald-50/95 dark:bg-[#1f2c34]/95 border-b border-emerald-200/80 dark:border-[#2a3942] p-3.5 px-4 shadow-2xs text-xs flex-shrink-0 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#008069] dark:text-emerald-400 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Megaphone size={13} className="text-[#008069] dark:text-emerald-400" />
                        <span className="font-extrabold uppercase tracking-wide">
                          DISPATCHED CAMPAIGN MESSAGE • {new Date(selectedRecipient.dispatched_at).toLocaleString()}
                        </span>
                      </div>
                      <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 uppercase">
                        STATUS: {selectedRecipient.dispatch_status}
                      </span>
                    </div>
                    <div className="p-3 bg-white dark:bg-[#111b21] rounded-xl border border-emerald-100 dark:border-emerald-900/40 text-xs leading-relaxed text-[#111b21] dark:text-slate-100 font-sans whitespace-pre-wrap shadow-2xs">
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
                  ) : displayMessages.length === 0 ? (
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
                    displayMessages.map((msg) => {
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

                {/* Message Input Composer */}
                <div className="bg-white dark:bg-[#202d36] border-t border-[#e9edef] dark:border-[#2a3942] p-3 px-4 flex items-end gap-2.5 z-10">
                  <div className="flex-1 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-2xl border border-transparent focus-within:border-[#00a884] focus-within:bg-white dark:focus-within:bg-[#111b21] transition-all flex items-end px-3 py-1.5">
                    <textarea
                      ref={textareaRef}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Reply to ${selectedRecipient.first_name || 'contact'} on WhatsApp (Press Enter to send)...`}
                      rows={1}
                      className="w-full bg-transparent text-xs text-[#111b21] dark:text-white placeholder-[#8696a0] focus:outline-hidden resize-none max-h-24 scrollbar-thin py-1"
                    />
                  </div>

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
          {/* Metrics Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
            <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
              <span className="text-[10px] font-black uppercase text-[#8696a0]">Targets</span>
              <div className="text-xl font-extrabold text-[#111b21] dark:text-white mt-1">
                {campaign.total_contacts}
              </div>
            </div>

            <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
              <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                Dispatched Sent
              </span>
              <div className="text-xl font-extrabold text-[#008069] dark:text-emerald-400 mt-1">
                {campaign.sent_count}
              </div>
            </div>

            <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
              <span className="text-[10px] font-black uppercase text-rose-500">Failed</span>
              <div className="text-xl font-extrabold text-rose-500 mt-1">
                {campaign.failed_count}
              </div>
            </div>

            {/* Active Chats Live Stat Card */}
            <div className="bg-emerald-50/80 dark:bg-emerald-950/30 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-emerald-800 dark:text-emerald-300">
                  Active Replies
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="text-xl font-extrabold text-emerald-900 dark:text-emerald-200 mt-1 flex items-baseline gap-2">
                <span>{activeChatsCount}</span>
                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                  ({campaign.reply_rate || 0}% rate)
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-[#1f2c34] p-4 rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-xs">
              <span className="text-[10px] font-black uppercase text-amber-500">Need Reply</span>
              <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-1">
                {unreadChatsCount}
              </div>
            </div>
          </div>

          {/* Template Content Preview */}
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] p-5 shadow-xs">
            <div className="flex items-center gap-2 text-xs font-bold text-[#667781] dark:text-[#8696a0] mb-3">
              <FileText size={15} className="text-[#00a884]" />
              <span>MESSAGE TEMPLATE CONTENT</span>
            </div>
            <div className="bg-[#efeae2] dark:bg-[#0b141a]/60 p-4 rounded-xl border border-emerald-100 dark:border-emerald-950/20 max-w-xl">
              <div className="bg-white dark:bg-[#1f2c34] rounded-lg p-3.5 text-xs leading-relaxed text-[#111b21] dark:text-white shadow-xs rounded-tl-none font-sans whitespace-pre-wrap">
                {campaign.template_body}
              </div>
            </div>
          </div>

          {/* Detailed Delivery Logs Table */}
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] p-5 shadow-xs flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-xs font-bold text-[#667781] dark:text-[#8696a0]">
                <span>DELIVERY LOGS & DISPATCH AUDIT ({logs.length})</span>
              </div>
              {logs.length > 0 && (
                <button
                  onClick={handleExportLogs}
                  className="px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 text-xs font-bold text-[#008069] dark:text-emerald-400 flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                >
                  <FileSpreadsheet size={13} />
                  <span>Download Excel Report</span>
                </button>
              )}
            </div>

            <div className="border border-[#e9edef] dark:border-[#2a3942] rounded-xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto max-h-96 overflow-y-auto scrollbar-thin">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#f8f9fa] dark:bg-[#202d36] border-b border-[#e9edef] dark:border-[#2a3942] text-[#667781] dark:text-[#8696a0] font-bold sticky top-0 z-10">
                      <th className="p-3 font-bold">Recipient</th>
                      <th className="p-3 font-bold">Status</th>
                      <th className="p-3 font-bold">Replied</th>
                      <th className="p-3 font-bold">Variables</th>
                      <th className="p-3 font-bold">Sent At</th>
                      <th className="p-3 font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f5f6f6] dark:divide-[#2a3942]/65 bg-white dark:bg-[#1f2c34]">
                    {recipients.map((rec) => (
                      <tr
                        key={rec.log_id}
                        className="hover:bg-[#f8f9fa]/50 dark:hover:bg-[#2a3942]/20"
                      >
                        <td className="p-3 font-bold text-[#111b21] dark:text-white truncate max-w-[160px]">
                          {rec.first_name || rec.last_name
                            ? `${rec.first_name || ''} ${rec.last_name || ''}`.trim()
                            : rec.phone_number || rec.email_address || '-'}
                          <div className="text-[10px] text-[#8696a0] font-mono font-normal">
                            {rec.phone_number || rec.email_address}
                          </div>
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-black text-[9px] border ${
                              rec.dispatch_status === 'READ'
                                ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 border-blue-200/50'
                                : rec.dispatch_status === 'DELIVERED'
                                ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border-emerald-200/50'
                                : rec.dispatch_status === 'SENT'
                                ? 'bg-[#e7f7f4] text-[#008069] border-[#00a884]/20'
                                : 'bg-red-50 text-red-600 border-red-200/50'
                            }`}
                          >
                            {rec.dispatch_status}
                          </span>
                        </td>
                        <td className="p-3">
                          {rec.has_replied ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                              <Check size={10} />
                              <span>Yes</span>
                            </span>
                          ) : (
                            <span className="text-[#8696a0] text-[10px]">No</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {Object.entries(rec.variables_mapped || {}).map(([k, v]) => (
                              <span
                                key={k}
                                className="bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[8px] border border-slate-100 dark:border-slate-700 text-[#54656f] dark:text-[#8696a0] font-mono"
                              >
                                {k}:{String(v)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-[10px] text-[#8696a0]">
                          {new Date(rec.dispatched_at).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => {
                              setSelectedRecipient(rec)
                              setActiveTab('chats')
                            }}
                            className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 text-[#008069] dark:text-emerald-300 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <MessageSquare size={11} />
                            <span>Chat</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
