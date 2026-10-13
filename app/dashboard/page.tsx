'use client'

import { CopyPhoneButton } from '@/components/ui/copy-phone-button'

import { useEffect, useMemo, useState, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { ConversationWithContact, User, Contact, Message } from '@/lib/types'
import { canAssign, canSeeAll, describeDenied, isReadOnly } from '@/lib/rbac'
import { 
  Search, Send, Phone, LogOut, Wifi, WifiOff, 
  Paperclip, File, FileText, X, ChevronDown, CheckCheck, Check, AlertCircle, Loader2, MessageCircle,
  Edit2, Download, ArrowLeft, ArrowUpDown, Bot, RefreshCw, Reply, Sparkles, ExternalLink, BookOpen, Pin, Clock, Ticket, Wand2, Briefcase, Smile, AlignLeft, SpellCheck, ShieldCheck
} from 'lucide-react'
import { AddContactDialog } from '@/components/add-contact-dialog'
import { authSessionManager } from '@/lib/auth-context'
import { useAlert } from '@/lib/dialog-context'
import { formatContactDisplayName, getContactAvatarInitials, isBsuid } from '@/lib/whatsapp-bsuid'
import { formatBadgeCount, formatWindowRemaining, getAvatarTone, getMessagePreview, getMessageText, getServiceWindow, parseReplyMarker, withReplyMarker } from '@/lib/chat-message-format'
import { MessageList } from '@/components/chat/message-list'
import { ConversationRow } from '@/components/chat/conversation-row'

function ConversationsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversationIdParam = searchParams.get('conversationId')
  const contactIdParam = searchParams.get('contactId')
  const alert = useAlert()

  const [conversations, setConversations] = useState<ConversationWithContact[]>([])
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)

  useEffect(() => {
    if (conversationIdParam) {
      setSelectedConversation(conversationIdParam)
    }
  }, [conversationIdParam])

  useEffect(() => {
    const event = new CustomEvent('active-conversation-changed', {
      detail: { hasActiveConversation: selectedConversation !== null }
    })
    window.dispatchEvent(event)
  }, [selectedConversation])

  useEffect(() => {
    const handleReset = () => {
      setSelectedConversation(null)
      if (window.history.pushState) {
        const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.pushState({path:newurl}, '', newurl);
      }
    }
    window.addEventListener('reset-active-chat', handleReset)
    return () => window.removeEventListener('reset-active-chat', handleReset)
  }, [])

  const [messages, setMessages] = useState<Message[]>([])
  const [messageText, setMessageText] = useState('')
  const [loading, setLoading] = useState(true)
  const [fetchingConvs, setFetchingConvs] = useState(false)
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('auth_user')
      if (stored) {
        try {
          return JSON.parse(stored)
        } catch (e) {
          return null
        }
      }
    }
    return null
  })
  
  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState('')
  const [unreadFilter, setUnreadFilter] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  // For sales_employee without see_all, restrict conversations to only their assigned ones
  const [userAssignedToFilter, setUserAssignedToFilter] = useState<string | null>(null)
  // Read-only accounts can read chats but not reply; the server refuses the send as well
  const readOnly = isReadOnly(user)
  const canAssignWork = canAssign(user)
  const [convPage, setConvPage] = useState(1)
  const [hasMoreConvs, setHasMoreConvs] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [pinnedConvs, setPinnedConvs] = useState<string[]>([])
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)

  useEffect(() => {
    if (user?.organization_id) {
      const stored = localStorage.getItem(`pinned_convs_${user.organization_id}`)
      if (stored) {
        try {
          setPinnedConvs(JSON.parse(stored))
        } catch (e) {
          setPinnedConvs([])
        }
      } else {
        setPinnedConvs([])
      }
    }
  }, [user])

  const pinnedRef = useRef<string[]>([])
  pinnedRef.current = pinnedConvs
  const organizationIdForPins = user?.organization_id
  const togglePinConversation = useCallback((convId: string) => {
    if (!organizationIdForPins) return
    const current = pinnedRef.current
    const next = current.includes(convId) ? current.filter((id) => id !== convId) : [...current, convId]
    setPinnedConvs(next)
    localStorage.setItem(`pinned_convs_${organizationIdForPins}`, JSON.stringify(next))
  }, [organizationIdForPins])
  
  // File Upload States
  const [uploading, setUploading] = useState(false)
  const [attachedFile, setAttachedFile] = useState<{ url: string; name: string; type: string } | null>(null)
  const [activeImageModal, setActiveImageModal] = useState<string | null>(null)

  const [contacts, setContacts] = useState<Contact[]>([])
  const [logoutLoading, setLogoutLoading] = useState(false)
  
  // Contact Rename States
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameFirst, setRenameFirst] = useState('')
  const [renameLast, setRenameLast] = useState('')
  const [renameCompany, setRenameCompany] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  
  // Reply To Message State
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [togglingAutoReply, setTogglingAutoReply] = useState(false)
  
  // AI Suggestions (RAG)
  type AiSuggestion = { text: string; article_title?: string | null; source_url?: string | null }
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [aiSuggestionsError, setAiSuggestionsError] = useState<string | null>(null)
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null)
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [windowTick, setWindowTick] = useState(0) // Forces re-render for 24h window timer
  const [currentTicket, setCurrentTicket] = useState<any | null>(null)
  const [showConvertModal, setShowConvertModal] = useState<any | null>(null)
  const [pipelineStages, setPipelineStages] = useState<any[]>([])
  const [teammates, setTeammates] = useState<any[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [leadForm, setLeadForm] = useState({
    title: '',
    value: '',
    stageId: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    assignedTo: '',
    resolveTicket: true
  })
  const fetchSuggestionsRef = useRef<any>(null)

  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
    enable_sms: true,
  })

  // Live Chat Template & Error States
  const [chatSendError, setChatSendError] = useState<string | null>(null)
  const [showLiveChatTemplateModal, setShowLiveChatTemplateModal] = useState(false)
  const [liveChatTemplates, setLiveChatTemplates] = useState<any[]>([])
  const [loadingLiveChatTemplates, setLoadingLiveChatTemplates] = useState(false)
  const [liveChatTemplateError, setLiveChatTemplateError] = useState<string | null>(null)
  const [selectedLiveChatTemplate, setSelectedLiveChatTemplate] = useState<any | null>(null)
  const [templateVarValues, setTemplateVarValues] = useState<Record<string, string>>({})
  const [sendingTemplate, setSendingTemplate] = useState(false)

  // Rephrase with AI States
  const [showRephraseDropdown, setShowRephraseDropdown] = useState(false)
  const [rephrasing, setRephrasing] = useState(false)
  const rephraseDropdownRef = useRef<HTMLDivElement>(null)

  const fetchLiveChatTemplates = async () => {
    if (!user?.organization_id) return
    setLoadingLiveChatTemplates(true)
    setLiveChatTemplateError(null)
    try {
      const res = await fetch(`/api/templates?organizationId=${user.organization_id}`)
      const data = await res.json()
      if (data.error) {
        setLiveChatTemplateError(data.error)
      }
      if (data.templates && Array.isArray(data.templates)) {
        setLiveChatTemplates(data.templates)
      }
    } catch (err: any) {
      console.error('[Dashboard] Error fetching live chat templates:', err)
      setLiveChatTemplateError(err.message || 'Failed to fetch templates')
    } finally {
      setLoadingLiveChatTemplates(false)
    }
  }

  const handleSelectLiveChatTemplate = (tplSid: string) => {
    const tpl = liveChatTemplates.find(t => t.sid === tplSid) || null
    setSelectedLiveChatTemplate(tpl)
    const initialVars: Record<string, string> = {}
    if (tpl?.variables) {
      tpl.variables.forEach((v: string) => {
        initialVars[v] = tpl.sampleValues?.[v] || ''
      })
    }
    setTemplateVarValues(initialVars)
  }

  const handleSendLiveChatTemplate = async () => {
    if (!selectedLiveChatTemplate || !selectedConversation || !user) return
    const selectedConv = conversations.find((c) => c.id === selectedConversation)
    if (!selectedConv?.contact) return

    setSendingTemplate(true)
    setChatSendError(null)

    let finalBody = selectedLiveChatTemplate.body || ''
    Object.entries(templateVarValues).forEach(([k, v]) => {
      finalBody = finalBody.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    })

    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      organization_id: user.organization_id,
      conversation_id: selectedConversation,
      sender_type: 'user',
      sender_id: null,
      body: finalBody,
      media_url: null,
      twilio_message_sid: null,
      read_at: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])

    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConversation,
          phoneNumber: selectedConv.contact.phone_number,
          templateSid: selectedLiveChatTemplate.sid,
          templateName: selectedLiveChatTemplate.whatsapp_template_name || selectedLiveChatTemplate.raw_name || selectedLiveChatTemplate.name,
          templateLanguage: selectedLiveChatTemplate.language || 'en',
          templateVariables: templateVarValues,
          templateMetaComponents: selectedLiveChatTemplate.components || null,
          message: finalBody,
          channel: 'whatsapp',
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success || data.twilioSent === false) {
        if (data.message) {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticMsg.id ? data.message : m))
          )
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
        }
        throw new Error(data.error || 'Failed to dispatch Meta WhatsApp template')
      }

      if (data.message) {
        setMessages((prev) => {
          const alreadyHasReal = prev.some((m) => m.id === data.message.id)
          if (alreadyHasReal) {
            return prev.filter((m) => m.id !== optimisticMsg.id)
          }
          return prev.map((m) => (m.id === optimisticMsg.id ? data.message : m))
        })
      }
      setShowLiveChatTemplateModal(false)
      setSelectedLiveChatTemplate(null)
    } catch (err: any) {
      console.error('[Dashboard] Send template error:', err)
      setChatSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSendingTemplate(false)
    }
  }
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedConvRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const conversationsRef = useRef<ConversationWithContact[]>([])
  const messagesRef = useRef<Message[]>([])
  const hasScrolledForConvRef = useRef(false)
  const lastScrollMsgIdRef = useRef<string | null>(null)

  // Whether the reader is at the newest message. New messages only pull the view down when they are.
  const nearBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [newWhileAway, setNewWhileAway] = useState(0)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  // What is typed, attached and quoted belongs to one conversation. It is kept per conversation
  // so that switching chats never carries a half-written message over to another customer.
  type ComposerDraft = { text: string; file: { url: string; name: string; type: string } | null; reply: Message | null }
  const draftsRef = useRef<Map<string, ComposerDraft>>(new Map())
  const composerRef = useRef<ComposerDraft>({ text: '', file: null, reply: null })
  composerRef.current = { text: messageText, file: attachedFile, reply: replyingTo }
  messagesRef.current = messages

  // Keep conversations ref in sync
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const searchTermRef = useRef(searchTerm)
  const unreadFilterRef = useRef(unreadFilter)
  const userAssignedToFilterRef = useRef(userAssignedToFilter)

  useEffect(() => {
    searchTermRef.current = searchTerm
    unreadFilterRef.current = unreadFilter
    userAssignedToFilterRef.current = userAssignedToFilter
  }, [searchTerm, unreadFilter, userAssignedToFilter])

  // Tick every 60s to keep the 24h free window timer accurate
  useEffect(() => {
    const timer = setInterval(() => setWindowTick(t => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Switching conversation: park the draft of the one being left, restore the one being opened,
  // and reset everything that only made sense for the previous chat.
  useEffect(() => {
    const previous = selectedConvRef.current
    if (previous && previous !== selectedConversation) {
      const draft = composerRef.current
      if (draft.text.trim() || draft.file || draft.reply) draftsRef.current.set(previous, draft)
      else draftsRef.current.delete(previous)
    }

    selectedConvRef.current = selectedConversation
    hasScrolledForConvRef.current = false
    lastScrollMsgIdRef.current = null
    nearBottomRef.current = true
    setShowJumpToLatest(false)
    setNewWhileAway(0)

    const restored = selectedConversation ? draftsRef.current.get(selectedConversation) : undefined
    setMessageText(restored?.text || '')
    setAttachedFile(restored?.file || null)
    setReplyingTo(restored?.reply || null)
    setChatSendError(null)
    setShowAiPanel(false)
    setShowRephraseDropdown(false)
  }, [selectedConversation])

  // Keep the composer as tall as its text, up to five lines (also after sending or restoring a draft)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [messageText, selectedConversation])

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = chatScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    nearBottomRef.current = true
    setShowJumpToLatest(false)
    setNewWhileAway(0)
  }, [])

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    nearBottomRef.current = nearBottom
    setShowJumpToLatest(!nearBottom)
    if (nearBottom) setNewWhileAway(0)
  }, [])

  // Photos and videos get their height after loading; keep the newest message in view while they do
  const handleMediaLoad = useCallback(() => {
    const el = chatScrollRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [])

  // Opening a chat jumps to the newest message. After that the view only follows new messages
  // when the reader is already at the bottom (or sent the message themselves); someone reading
  // older messages is told how many arrived instead of being pulled away.
  useEffect(() => {
    if (messages.length === 0) return
    const last = messages[messages.length - 1]
    const el = chatScrollRef.current

    if (!hasScrolledForConvRef.current) {
      if (el) el.scrollTop = el.scrollHeight
      hasScrolledForConvRef.current = true
      lastScrollMsgIdRef.current = last.id
      return
    }
    // Earlier messages were added at the top, or a delivery status changed
    if (last.id === lastScrollMsgIdRef.current) return
    lastScrollMsgIdRef.current = last.id

    if (last.sender_type === 'user' || nearBottomRef.current) {
      scrollToLatest('smooth')
    } else {
      setShowJumpToLatest(true)
      setNewWhileAway((count) => count + 1)
    }
  }, [messages, scrollToLatest])

  // ─── Data Fetching ───

  const fetchConversations = useCallback(async (
    orgId: string, 
    pageNum = 1, 
    searchVal = '', 
    unreadOnly = false,
    assignedTo?: string | null
  ): Promise<{ conversations: ConversationWithContact[]; count: number; hasMore: boolean }> => {
    let url = `/api/conversations?organizationId=${orgId}&page=${pageNum}&limit=12&search=${encodeURIComponent(searchVal)}&unread=${unreadOnly}`
    if (assignedTo) url += `&assignedTo=${encodeURIComponent(assignedTo)}`
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch conversations')
    return { 
      conversations: data.conversations || [], 
      count: data.count || 0,
      hasMore: data.hasMore || false 
    }
  }, [])

  const lastFetchedUnreadKeyRef = useRef('')

  const loadUnreadCount = useCallback(async (orgId: string, force = false) => {
    try {
      // Read from the ref so long-lived callers (the live subscription) never use an outdated profile.
      // The server limits assigned-only accounts to their own chats whatever is sent here.
      const assignedTo = userAssignedToFilterRef.current || ''
      const fetchKey = `${orgId}-${assignedTo}`
      if (!force && fetchKey === lastFetchedUnreadKeyRef.current) {
        return
      }
      if (!force) {
        lastFetchedUnreadKeyRef.current = fetchKey
      }
      const url = assignedTo 
        ? `/api/conversations?organizationId=${orgId}&unread=true&assignedTo=${assignedTo}&limit=1`
        : `/api/conversations?organizationId=${orgId}&unread=true&limit=1`
      const res = await fetch(url)
      const data = await res.json()
      if (res.ok && data.unreadMessagesCount !== undefined) {
        setUnreadCount(data.unreadMessagesCount)
      } else if (res.ok && data.count !== undefined) {
        setUnreadCount(data.count)
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching unread count:', err)
    }
  }, [])

  const fetchContacts = useCallback(async (orgId: string): Promise<Contact[]> => {
    const res = await fetch(`/api/contacts?organizationId=${orgId}&limit=100`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch contacts')
    return data.contacts || []
  }, [])

  const fetchMessages = useCallback(async (convId: string, before?: string): Promise<{ messages: Message[]; hasMore: boolean }> => {
    const url = before 
      ? `/api/messages?conversationId=${convId}&before=${encodeURIComponent(before)}`
      : `/api/messages?conversationId=${convId}`
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch messages')
    return {
      messages: data.messages || [],
      hasMore: !!data.hasMore
    }
  }, [])

  // ─── State Update Helpers ───

  const lastFetchedKeyRef = useRef('')

  // `append`: false replaces the list, true adds the next page, 'merge' folds the newest page into
  // the list already shown (used for live updates, so pages the reader loaded are not thrown away).
  const loadConversations = useCallback(async (
    orgId: string, 
    pageNum = 1, 
    append: boolean | 'merge' = false, 
    searchVal = '', 
    unreadOnly = false,
    assignedTo?: string | null,
    force = false
  ) => {
    const fetchKey = `${orgId}-${pageNum}-${append}-${searchVal}-${unreadOnly}-${assignedTo || ''}`
    if (!force && fetchKey === lastFetchedKeyRef.current) {
      return
    }
    if (!force) {
      lastFetchedKeyRef.current = fetchKey
    }

    try {
      if (pageNum > 1) {
        setLoadingMore(true)
      } else if (append !== 'merge') {
        setFetchingConvs(true)
      }
      const result = await fetchConversations(orgId, pageNum, searchVal, unreadOnly, assignedTo)

      // The search or filter changed while this request was in flight: its result is out of date
      if (searchVal !== searchTermRef.current || unreadOnly !== unreadFilterRef.current) return

      setConversations((prev) => {
        if (append === 'merge') {
          const fresh = new Map(result.conversations.map((c) => [c.id, c]))
          const kept = prev.filter((c) => !fresh.has(c.id))
          return [...result.conversations, ...kept]
        }
        if (append) {
          const combined = [...prev, ...result.conversations]
          const seen = new Set()
          return combined.filter(c => {
            if (seen.has(c.id)) return false
            seen.add(c.id)
            return true
          })
        }
        return result.conversations
      })
      if (append !== 'merge') {
        setHasMoreConvs(result.hasMore)
        setConvPage(pageNum)
      }
      
      setSelectedConversation((prev) => {
        let contactIdParam = null
        let conversationIdParam = null
        if (typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search)
          contactIdParam = urlParams.get('contactId')
          conversationIdParam = urlParams.get('conversationId')
        }

        if (conversationIdParam) {
          return conversationIdParam
        }
        if (contactIdParam) {
          const matched = result.conversations.find((c) => c.contact_id === contactIdParam)
          if (matched) return matched.id
        }

        return prev  // Don't auto-select — user must click to open a conversation
      })
      // Also load unread count
      loadUnreadCount(orgId, force)
    } catch (err) {
      console.error('[Dashboard] Error loading conversations:', err)
    } finally {
      setLoadingMore(false)
      setFetchingConvs(false)
    }
  }, [fetchConversations, loadUnreadCount])

  const loadContacts = useCallback(async (orgId: string) => {
    try {
      const data = await fetchContacts(orgId)
      setContacts(data)
    } catch (err) {
      console.error('[Dashboard] Error loading contacts:', err)
    }
  }, [fetchContacts])

  const loadMessages = useCallback(async (convId: string) => {
    // Never show the previous chat's messages under the new chat's name while this loads
    setMessages([])
    setHasMoreMessages(false)
    setMessagesError(null)
    setLoadingMessages(true)
    try {
      const { messages: msgs, hasMore } = await fetchMessages(convId)
      // Another chat was opened while this one was loading: drop the late answer
      if (selectedConvRef.current !== convId) return
      setMessages(msgs)
      setHasMoreMessages(hasMore)
    } catch (err) {
      console.error('[Dashboard] Error loading messages:', err)
      if (selectedConvRef.current === convId) {
        setMessagesError(err instanceof Error ? err.message : 'Messages could not be loaded.')
      }
    } finally {
      if (selectedConvRef.current === convId) setLoadingMessages(false)
    }
  }, [fetchMessages])

  const loadingOlderRef = useRef(false)
  const loadOlderMessages = useCallback(async () => {
    const convId = selectedConvRef.current
    const current = messagesRef.current
    if (!convId || current.length === 0 || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlderMessages(true)
    try {
      const { messages: olderMsgs, hasMore } = await fetchMessages(convId, current[0].created_at)
      if (selectedConvRef.current !== convId) return

      const chatContainer = chatScrollRef.current
      const previousScrollHeight = chatContainer?.scrollHeight || 0

      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...olderMsgs.filter((m) => !known.has(m.id)), ...prev]
      })
      setHasMoreMessages(hasMore)

      // Keep the message the reader was looking at in the same place
      requestAnimationFrame(() => {
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight - previousScrollHeight
      })
    } catch (err) {
      console.error('[Dashboard] Error loading older messages:', err)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlderMessages(false)
    }
  }, [fetchMessages])

  /** Reload the first page of the list with the search and filter currently applied. */
  const refreshConversationList = useCallback((mode: false | 'merge' = false) => {
    if (!user) return
    loadConversations(user.organization_id, 1, mode, searchTermRef.current, unreadFilterRef.current, userAssignedToFilterRef.current, true)
  }, [user, loadConversations])

  const reloadAll = useCallback(() => {
    if (!user) return
    refreshConversationList()
    loadContacts(user.organization_id)
  }, [user, refreshConversationList, loadContacts])

  // `force` skips the "already zero here" shortcut: for the chat that is open the local count is
  // always zero, while the stored one goes up with every message the customer sends.
  const organizationIdForUnread = user?.organization_id
  const clearUnreadCount = useCallback(async (convId: string, force = false) => {
    try {
      const conv = conversationsRef.current.find((c) => c.id === convId)
      if (!force && conv && conv.unread_count === 0) {
        return
      }

      // Optimistic local state update
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      )
      // Update database
      const { error } = await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', convId)
      if (error) {
        console.error('[Dashboard] Error resetting unread count in DB:', error)
      } else if (organizationIdForUnread) {
        loadUnreadCount(organizationIdForUnread, true)
      }
    } catch (err) {
      console.error('[Dashboard] Error resetting unread count:', err)
    }
  }, [organizationIdForUnread, loadUnreadCount])

  // Dynamically fetch selected conversation if it is not in the active conversations list
  // OR fetch/create conversation if contactId is in the URL
  useEffect(() => {
    if (!user) return
    const currentContactId = contactIdParam || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('contactId') : null)

    if (currentContactId) {
      // Check if current selectedConversation already belongs to this contact
      const currentSelectedConv = conversationsRef.current.find(c => c.id === selectedConversation)
      if (currentSelectedConv && currentSelectedConv.contact_id === currentContactId) {
        return
      }

      const fetchOrCreateByContact = async () => {
        try {
          const existingConv = conversationsRef.current.find(c => c.contact_id === currentContactId)
          if (existingConv) {
            setSelectedConversation(existingConv.id)
            return
          }
          
          const { data, error } = await supabase
            .from('conversations')
            .select(`
              id, organization_id, contact_id, lead_id, is_active, last_message_at, unread_count, assigned_to, created_at, updated_at,
              contact:contact_id (id, first_name, last_name, phone_number, whatsapp_number, email, company)
            `)
            .eq('contact_id', currentContactId)
            .eq('organization_id', user.organization_id)
            .maybeSingle()
            
          if (error && error.code !== 'PGRST116') throw error
          
          if (data) {
            const conv = {
              ...data,
              contact: Array.isArray(data.contact) ? data.contact[0] : data.contact
            } as ConversationWithContact
            setConversations(prev => {
              if (prev.some(c => c.id === conv.id)) return prev
              return [conv, ...prev]
            })
            setSelectedConversation(conv.id)
          } else {
            // Create new conversation
            const { data: newConv, error: createError } = await supabase
              .from('conversations')
              // Someone who only sees their own chats keeps the one they start
              .insert([{ organization_id: user.organization_id, contact_id: currentContactId, is_active: true, ...(canSeeAll(user) ? {} : { assigned_to: user.id }) }])
              .select(`
                id, organization_id, contact_id, lead_id, is_active, last_message_at, unread_count, assigned_to, created_at, updated_at,
                contact:contact_id (id, first_name, last_name, phone_number, whatsapp_number, email, company)
              `)
              .single()
              
            if (createError) throw createError
            if (newConv) {
              const conv = {
                ...newConv,
                contact: Array.isArray(newConv.contact) ? newConv.contact[0] : newConv.contact
              } as ConversationWithContact
              setConversations(prev => [conv, ...prev])
              setSelectedConversation(conv.id)
            }
          }
        } catch (err) {
          console.error('[Dashboard] Error fetching/creating conversation by contactId:', err)
        }
      }
      fetchOrCreateByContact()
    } else if (selectedConversation) {
      const exists = conversationsRef.current.some((c) => c.id === selectedConversation)
      if (!exists) {
        const fetchSingleConv = async () => {
          try {
            const { data, error } = await supabase
              .from('conversations')
              .select(`
                id,
                organization_id,
                contact_id,
                lead_id,
                is_active,
                last_message_at,
                unread_count,
                assigned_to,
                created_at,
                updated_at,
                contact:contact_id (
                  id,
                  first_name,
                  last_name,
                  phone_number,
                  whatsapp_number,
                  email,
                  company
                )
              `)
              .eq('id', selectedConversation)
              .single()

            if (error) throw error
            if (data) {
              const conv = {
                ...data,
                contact: Array.isArray(data.contact) ? data.contact[0] : data.contact
              } as ConversationWithContact

              setConversations((prev) => {
                if (prev.some((c) => c.id === conv.id)) return prev
                return [conv, ...prev]
              })
            }
          } catch (err) {
            console.error('[Dashboard] Error fetching selected conversation:', err)
          }
        }
        fetchSingleConv()
      }
    }
  }, [selectedConversation, user, contactIdParam])

  // ─── Initial Data Load ───

  useEffect(() => {
    async function init() {
      try {
        await restoreSupabaseSession()

        const isLoggedIn = authSessionManager.isLoggedIn()
        const authUser = authSessionManager.getUser()

        if (!isLoggedIn || !authUser) {
          // Layout handles auth redirect — just bail silently
          return
        }

        const userData = await ensureUserProfile(authUser.id, authUser.email || '')
        if (!userData) {
          console.error('[Dashboard] Failed to load user profile')
          return
        }

        setUser(userData)

        // ── Role-based conversation filtering ──────────────────────────────────
        // sales_employee without see_all can only see conversations assigned to them
        const seeAll = canSeeAll(userData)
        const assignedToFilter = seeAll ? null : userData.id
        setUserAssignedToFilter(assignedToFilter)

        // Fetch organization features
        const { data: orgData } = await supabase
          .from('organizations')
          .select('enable_ai, enable_email, enable_messages, enable_phone_calls, enable_sms')
          .eq('id', userData.organization_id)
          .maybeSingle()
        if (orgData) {
          setFeatures({
            enable_ai: orgData.enable_ai !== false,
            enable_email: orgData.enable_email !== false,
            enable_messages: orgData.enable_messages !== false,
            enable_phone_calls: orgData.enable_phone_calls !== false,
            enable_sms: orgData.enable_sms !== false,
          })
        }
        await Promise.all([
          loadConversations(userData.organization_id, 1, false, searchTerm, unreadFilter, seeAll ? null : userData.id),
          loadContacts(userData.organization_id),
        ])
      } catch (error) {
        console.error('[Dashboard] Init error:', error)
      } finally {
        setLoading(false)
      }
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Search & Filter Change Reloads ───

  useEffect(() => {
    if (!user) return
    const delayDebounceFn = setTimeout(() => {
      setConvPage(1)
      loadConversations(user.organization_id, 1, false, searchTerm, unreadFilter, userAssignedToFilter)
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [searchTerm, unreadFilter, user, loadConversations, userAssignedToFilter])

  // ─── Realtime Subscriptions ───

  useEffect(() => {
    if (!user?.organization_id) return

    const orgId = user.organization_id

    // Only this organization's rows: without the filter the browser is sent every tenant's changes
    const orgFilter = `organization_id=eq.${orgId}`

    // Several events often arrive together (a campaign, a busy hour); refresh the list once for all of them
    let listRefreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleListRefresh = () => {
      if (listRefreshTimer) return
      listRefreshTimer = setTimeout(() => {
        listRefreshTimer = null
        loadConversations(orgId, 1, 'merge', searchTermRef.current, unreadFilterRef.current, userAssignedToFilterRef.current, true)
      }, 1200)
    }

    const conversationsChannel = supabase
      .channel(`ws-conversations-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations', filter: orgFilter },
        () => {
          scheduleListRefresh()
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: orgFilter },
        (payload) => {
          const updated = payload.new as any
          setConversations((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? {
                    ...c,
                    unread_count: updated.id === selectedConvRef.current ? 0 : updated.unread_count,
                    last_message_at: updated.last_message_at,
                    assigned_to: updated.assigned_to,
                    auto_reply_enabled: updated.auto_reply_enabled,
                  }
                : c
            )
          )
          loadUnreadCount(orgId, true)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected')
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeStatus('disconnected')
      })

    const messagesChannel = supabase
      .channel(`ws-messages-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: orgFilter },
        (payload) => {
          const newMsg = payload.new as Message
          const isOpenChat = newMsg.conversation_id === selectedConvRef.current

          if (!conversationsRef.current.some((c) => c.id === newMsg.conversation_id)) {
            // A chat that is not in the list yet (new, or on a later page): fetch it
            scheduleListRefresh()
          } else {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === newMsg.conversation_id
                  ? {
                      ...c,
                      last_message_at: newMsg.created_at,
                      last_message: newMsg,
                      // Only a message from the customer is unread; our own replies are not
                      unread_count: isOpenChat ? 0 : c.unread_count + (newMsg.sender_type === 'contact' ? 1 : 0),
                    }
                  : c
              )
            )
          }

          if (isOpenChat) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev
              return [...prev, newMsg]
            })
            // The customer wrote while this chat is open: it has been read, so keep the stored count at zero
            if (newMsg.sender_type === 'contact') clearUnreadCount(newMsg.conversation_id, true)
          } else if (newMsg.sender_type === 'contact') {
            loadUnreadCount(orgId, true)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: orgFilter },
        (payload) => {
          const updatedMsg = payload.new as Message

          // 1. Live update active conversation message status (blue ticks)
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== updatedMsg.id) return m
              return {
                ...m,
                ...updatedMsg,
                // Crucial: preserve media_url if Realtime update payload omitted it (e.g. TOAST column or omitted payload)
                media_url: updatedMsg.media_url || m.media_url,
              }
            })
          )

          // 2. Live update conversation preview in sidebar
          setConversations((prev) =>
            prev.map((c) => {
              if (c.last_message?.id !== updatedMsg.id) return c
              return {
                ...c,
                last_message: {
                  ...c.last_message,
                  ...updatedMsg,
                  media_url: updatedMsg.media_url || c.last_message?.media_url || null,
                }
              }
            })
          )
        }
      )
      .subscribe()

    const contactsChannel = supabase
      .channel(`ws-contacts-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'contacts', filter: orgFilter },
        () => {
          loadContacts(orgId)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'contacts', filter: orgFilter },
        (payload) => {
          // A rename elsewhere (Contacts page, another teammate) shows up here straight away
          const updated = payload.new as any
          setConversations((prev) =>
            prev.map((c) => (c.contact?.id === updated.id ? { ...c, contact: { ...c.contact, ...updated } } : c))
          )
        }
      )
      .subscribe()

    return () => {
      if (listRefreshTimer) clearTimeout(listRefreshTimer)
      supabase.removeChannel(conversationsChannel)
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(contactsChannel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization_id])

  // ─── Load Messages ───

  const fetchSuggestions = useCallback(async (convId: string) => {
    setLoadingSuggestions(true)
    setAiSuggestions([])
    setAiSuggestionsError(null)
    setExpandedSuggestion(null)
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch suggestions')
      }
      // Handle both structured (new) and plain string (legacy) formats
      const raw = data.suggestions || []
      const mapped = raw.map((s: any) => {
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

  fetchSuggestionsRef.current = fetchSuggestions

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      setMessagesError(null)
      setAiSuggestions([])
      setAiSuggestionsError(null)
      setCurrentTicket(null)
      return
    }
    loadMessages(selectedConversation)
    clearUnreadCount(selectedConversation)
    // Clear suggestions when switching conversation
    setAiSuggestions([])
    setAiSuggestionsError(null)
    setCurrentTicket(null)

    let stale = false
    const fetchOpenTicket = async () => {
      try {
        const { data: tickets, error } = await supabase
          .from('tickets')
          .select('*')
          .eq('conversation_id', selectedConversation)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(1)

        // Ignore the answer if another chat was opened in the meantime
        if (!stale && !error && tickets && tickets.length > 0) {
          setCurrentTicket(tickets[0])
        }
      } catch (err) {
        console.error('Error fetching ticket:', err)
      }
    }
    fetchOpenTicket()
    return () => {
      stale = true
    }
  }, [selectedConversation, loadMessages, clearUnreadCount])

  // ─── Actions ───

  const handleLoadMore = () => {
    if (!user || loadingMore) return
    // The next page of the list as it is filtered now, not of the unfiltered inbox
    loadConversations(user.organization_id, convPage + 1, true, searchTerm, unreadFilter, userAssignedToFilter)
  }

  const toggleAutoReply = async (convId: string, currentVal: boolean) => {
    if (togglingAutoReply) return // Guard against rapid clicks
    setTogglingAutoReply(true)
    const newVal = !currentVal
    
    // Optimistic update of local conversations state
    setConversations((prev) => 
      prev.map((c) => c.id === convId ? { ...c, auto_reply_enabled: newVal } : c)
    )

    try {
      const { error } = await supabase
        .from('conversations')
        .update({ auto_reply_enabled: newVal })
        .eq('id', convId)

      if (error) throw error
    } catch (err) {
      console.error('[Dashboard] Failed to toggle auto-reply:', err)
      // Rollback on error
      setConversations((prev) => 
        prev.map((c) => c.id === convId ? { ...c, auto_reply_enabled: currentVal } : c)
      )
    } finally {
      setTogglingAutoReply(false)
    }
  }

  const handleResolveTicket = async (ticketId: string) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, status: 'resolved' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to resolve ticket')
      setCurrentTicket(null)
    } catch (err) {
      console.error('[Ticket Resolve] Error:', err)
      alert({ title: 'Error', message: err instanceof Error ? err.message : 'Failed to resolve ticket' })
    }
  }

  const openConvertModal = async (ticket: any) => {
    const orgId = user?.organization_id || ticket.organization_id
    setLeadForm({
      title: ticket.subject || 'New Lead',
      value: '',
      stageId: '',
      priority: 'medium',
      assignedTo: user?.id || '',
      resolveTicket: true
    })
    setShowConvertModal(ticket)
    
    try {
      if (orgId) {
        // Fetch stages
        const { data: stages } = await supabase
          .from('pipeline_stages')
          .select('*')
          .eq('organization_id', orgId)
          .order('order_index', { ascending: true })
        if (stages) {
          setPipelineStages(stages)
          if (stages.length > 0) {
            setLeadForm(prev => ({ ...prev, stageId: stages[0].id }))
          }
        }

        // Fetch teammates
        const res = await fetch(`/api/teammates?organizationId=${orgId}`)
        const data = await res.json()
        if (data.success) {
          setTeammates(data.teammates || [])
        }
      }
    } catch (err) {
      console.error('Error preparing lead conversion:', err)
    }
  }

  const handleConvertTicketToLead = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!showConvertModal || !user) return
    setModalLoading(true)
    try {
      // 1. Create lead record
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert([{
          organization_id: user.organization_id,
          contact_id: showConvertModal.contact_id,
          title: leadForm.title,
          description: `Converted from Ticket: ${showConvertModal.subject}`,
          pipeline_stage_id: leadForm.stageId || null,
          value: leadForm.value ? parseFloat(leadForm.value) : null,
          priority: leadForm.priority,
          status: 'active',
          source: 'whatsapp',
          assigned_to: canAssignWork ? (leadForm.assignedTo || null) : user.id,
          created_by: user.id,
          last_activity_at: new Date().toISOString()
        }])
        .select()
        .single()

      if (leadErr) throw leadErr

      // 2. Link conversation to lead
      if (lead) {
        const { error: convErr } = await supabase
          .from('conversations')
          .update({ lead_id: lead.id })
          .eq('id', showConvertModal.conversation_id)

        if (convErr) console.error('Error linking lead to conversation:', convErr)
      }

      // 3. Resolve ticket
      if (leadForm.resolveTicket) {
        await handleResolveTicket(showConvertModal.id)
      }

      setShowConvertModal(null)
    } catch (err: any) {
      console.error('Failed to convert ticket to lead:', err)
      alert({ title: 'Error', message: err.message || 'Failed to convert ticket to lead' })
    } finally {
      setModalLoading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to upload')

      setAttachedFile({
        url: data.url,
        name: file.name,
        type: file.type,
      })
    } catch (err) {
      console.error('[Upload] Error:', err)
      alert({ title: 'Upload Failed', message: 'File upload failed. Please try again.' })
    } finally {
      setUploading(false)
    }
  }

  async function handleSendMessage() {
    if ((!messageText.trim() && !attachedFile) || !selectedConversation || !user) return
    if (readOnly) {
      setChatSendError(describeDenied('records.write'))
      return
    }

    const convId = selectedConversation
    const selectedConv = conversations.find((c) => c.id === convId)
    if (!selectedConv?.contact) return

    setChatSendError(null)
    const text = messageText.trim()
    const media = attachedFile
    const reply = replyingTo

    setMessageText('')
    setAttachedFile(null)
    setReplyingTo(null)
    setAiSuggestions([])
    setShowAiPanel(false)
    draftsRef.current.delete(convId)

    // Optimistic update
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      organization_id: user.organization_id,
      conversation_id: convId,
      sender_type: 'user',
      sender_id: null,
      body: withReplyMarker(reply?.id, text),
      media_url: media ? media.url : null,
      twilio_message_sid: null,
      read_at: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])

    // Only touch what is on screen if this chat is still the one open when the answer arrives
    const stillOpen = () => selectedConvRef.current === convId

    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: convId,
          message: text,
          // The server quotes the original message on WhatsApp; the customer never sees a marker
          replyToMessageId: reply?.id || null,
          phoneNumber: selectedConv.contact.phone_number,
          mediaUrl: media ? media.url : null,
          channel: 'whatsapp',
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success || data.twilioSent === false) {
        if (stillOpen()) {
          setMessages((prev) =>
            data.message
              ? prev.map((m) => (m.id === optimisticMsg.id ? data.message : m))
              : prev.filter((m) => m.id !== optimisticMsg.id)
          )
        }
        throw new Error(data.error || 'Failed to dispatch message via WhatsApp')
      }

      if (data.message && stillOpen()) {
        setMessages((prev) => {
          const alreadyHasReal = prev.some((m) => m.id === data.message.id)
          if (alreadyHasReal) {
            return prev.filter((m) => m.id !== optimisticMsg.id)
          }
          return prev.map((m) => (m.id === optimisticMsg.id ? data.message : m))
        })
      }
    } catch (error: any) {
      console.error('[Dashboard] Send error:', error)
      const errMsg = error instanceof Error ? error.message : String(error)
      if (stillOpen()) {
        // Give the text back so nothing typed is lost
        setChatSendError(errMsg)
        setMessageText(text)
        setReplyingTo(reply)
        if (media) setAttachedFile(media)
      } else {
        // The reader moved on: keep it as that chat's draft instead of dropping it into the wrong one
        draftsRef.current.set(convId, { text, file: media, reply })
      }
    }
  }

  const handleReplyTo = useCallback((message: Message) => {
    setReplyingTo(message)
    textareaRef.current?.focus()
  }, [])

  /** Put a message that was not delivered back in the composer to edit and send again. */
  const handleRetryMessage = useCallback((message: Message) => {
    setMessageText(getMessageText(message))
    setChatSendError(null)
    textareaRef.current?.focus()
  }, [])

  const handleOpenImage = useCallback((url: string) => setActiveImageModal(url), [])
  const handleSelectConversation = useCallback((conversationId: string) => setSelectedConversation(conversationId), [])

  // ─── Rephrase with AI ───

  const handleRephrase = async (tone: string) => {
    if (!messageText.trim() || rephrasing) return
    setRephrasing(true)
    setShowRephraseDropdown(false)
    try {
      const res = await fetch('/api/ai/rephrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: messageText.trim(), tone })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to rephrase')
      if (data.rephrased) {
        setMessageText(data.rephrased)
      }
    } catch (err) {
      console.error('[Rephrase] Error:', err)
      // Say so instead of leaving the button looking like it did nothing
      setChatSendError('The message could not be rephrased. Your text is unchanged; try again.')
    } finally {
      setRephrasing(false)
    }
  }

  // Escape closes the photo viewer
  useEffect(() => {
    if (!activeImageModal) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveImageModal(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeImageModal])

  // Close rephrase dropdown on outside click
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

  async function handleLogout() {
    setLogoutLoading(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      await supabase.auth.signOut().catch(() => {})
    } catch (error) {
      console.error('[Dashboard] Logout error:', error)
    }
    authSessionManager.clearSession()
    window.location.href = '/login'
  }

  const handleRenameContact = async () => {
    if (!selectedContact) return
    setRenameLoading(true)
    setRenameError(null)

    try {
      const res = await fetch('/api/contacts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedContact.id,
          organizationId: user?.organization_id || selectedContact.organization_id,
          phone_number: selectedContact.phone_number,
          first_name: renameFirst,
          last_name: renameLast,
          company: renameCompany,
          email: selectedContact.email
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to rename contact')

      // Optimistic local state update
      setConversations((prev) =>
        prev.map((c) => {
          if (c.contact?.id === selectedContact.id) {
            return {
              ...c,
              contact: {
                ...c.contact,
                first_name: renameFirst,
                last_name: renameLast,
                company: renameCompany
              }
            }
          }
          return c
        })
      )

      setShowRenameModal(false)
      
      if (user) loadContacts(user.organization_id)
    } catch (err) {
      console.error('[Rename] Error:', err)
      setRenameError(err instanceof Error ? err.message : 'Failed to rename contact')
    } finally {
      setRenameLoading(false)
    }
  }

  const scrollToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-[#00a884]')
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-[#00a884]')
      }, 1500)
    }
  }, [])

  // ─── Sorting ───

  const pinnedSet = useMemo(() => new Set(pinnedConvs), [pinnedConvs])
  const sortedConversations = useMemo(() => [...conversations].sort((a, b) => {
    const aPinned = pinnedSet.has(a.id)
    const bPinned = pinnedSet.has(b.id)

    if (aPinned && !bPinned) return -1
    if (!aPinned && bPinned) return 1

    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return sortBy === 'newest' ? bTime - aTime : aTime - bTime
  }), [conversations, pinnedSet, sortBy])

  const selectedConvData = conversations.find((c) => c.id === selectedConversation)
  const selectedContact = selectedConvData?.contact
  const selectedContactName = formatContactDisplayName(selectedContact)

  // WhatsApp's 24-hour rule, worked out once and used by the header and the composer alike.
  // windowTick re-evaluates it every minute so the countdown and the cut-off stay current.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const serviceWindow = useMemo(() => getServiceWindow(messages), [messages, windowTick])
  // Until the history has loaded there is nothing to judge the window by, so nothing is blocked
  const windowClosed = !loadingMessages && !messagesError && serviceWindow.state !== 'open'
  const chatbotActive = selectedConvData?.auto_reply_enabled !== false && features.enable_ai
  const composerLocked = readOnly || windowClosed || chatbotActive

  // ─── Rendering ───

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-emerald-500" size={32} />
          <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold tracking-wider uppercase">Initializing workspace...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-[#efeae2] dark:bg-[#0b141a] flex overflow-hidden animate-in fade-in duration-300 relative font-sans text-slate-800 dark:text-slate-100">
       {/* Sidebar: Conversations List */}
      <div className={`w-full md:w-[350px] bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#2a3942] flex flex-col overflow-hidden transition-all duration-300 ${
        selectedConversation ? 'hidden md:flex' : 'flex'
      }`}>
        {/* Sidebar Header */}
        <div className="px-4 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between h-[60px] flex-shrink-0 select-none border-b border-[#e9edef] dark:border-[#2a3942]/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-[19px] font-bold tracking-tight text-[#111b21] dark:text-[#e9edef]">Chats</h2>
            {unreadCount > 0 && (
              <span
                className="bg-[#25d366] dark:bg-[#00a884] text-white dark:text-[#111b21] text-[11px] font-semibold tabular-nums h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center"
                title={`${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`}
              >
                {formatBadgeCount(unreadCount, 999)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <span
              className="flex items-center gap-1.5 text-[11px] font-medium text-[#667781] dark:text-[#8696a0]"
              title={realtimeStatus === 'connected' ? 'New messages appear as they arrive' : realtimeStatus === 'connecting' ? 'Connecting to live updates…' : 'Live updates are paused'}
            >
              <span className={`h-2 w-2 rounded-full ${realtimeStatus === 'connected' ? 'bg-emerald-500' : realtimeStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'}`} />
              <span>{realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting' : 'Offline'}</span>
            </span>
            {user && (
              <AddContactDialog
                organizationId={user.organization_id}
                onContactAdded={reloadAll}
              />
            )}
          </div>
        </div>

        {realtimeStatus === 'disconnected' && (
          <div role="status" className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/50 text-[12px] text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2 flex-shrink-0">
            <span className="flex items-center gap-1.5 min-w-0">
              <WifiOff size={13} className="shrink-0" />
              <span>Live updates are paused. New messages may not show.</span>
            </span>
            <button
              type="button"
              onClick={() => {
                refreshConversationList()
                if (selectedConversation) loadMessages(selectedConversation)
              }}
              className="shrink-0 inline-flex items-center gap-1 font-semibold underline underline-offset-2 cursor-pointer"
            >
              <RefreshCw size={11} />
              Refresh
            </button>
          </div>
        )}

        {/* Search & filters */}
        <div className="px-3 py-2 bg-white dark:bg-[#111b21] space-y-2 flex-shrink-0 border-b border-[#e9edef] dark:border-[#222d34]">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#667781] dark:text-[#8696a0] pointer-events-none" />
            <input
              type="text"
              inputMode="search"
              aria-label="Search chats"
              placeholder="Search name or number"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-10 pr-9 bg-[#f0f2f5] dark:bg-[#202c33] border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 text-[14px] placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-[#e9edef]"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-[#667781] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 select-none">
            <div className="flex items-center gap-1.5" role="group" aria-label="Filter chats">
              {[
                { unread: false, label: 'All' },
                { unread: true, label: 'Unread' },
              ].map((option) => {
                const active = unreadFilter === option.unread
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setUnreadFilter(option.unread)}
                    className={`h-7 px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                      active
                        ? 'bg-[#d9fdd3] dark:bg-[#0a332c] text-[#008069] dark:text-[#00a884]'
                        : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
                    }`}
                  >
                    {option.label}
                    {option.unread && unreadCount > 0 && (
                      <span className="tabular-nums text-[11px] font-semibold opacity-80">{formatBadgeCount(unreadCount, 999)}</span>
                    )}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setSortBy((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              title="Change the order of the list"
              className="h-7 px-2 rounded-lg inline-flex items-center gap-1 text-[12px] font-medium text-[#54656f] dark:text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] cursor-pointer"
            >
              <ArrowUpDown size={12} />
              {sortBy === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
          </div>
        </div>

        {/* Conversations list area */}
        <div className={`flex-1 overflow-y-auto bg-white dark:bg-[#111b21] transition-opacity ${fetchingConvs && sortedConversations.length > 0 ? 'opacity-60' : ''}`} aria-busy={fetchingConvs}>
          {fetchingConvs && sortedConversations.length === 0 ? (
            <div className="animate-pulse" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="w-full px-3 py-2.5 flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-slate-200 dark:bg-[#202c33] shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 bg-slate-200 dark:bg-[#202c33] rounded w-1/3" />
                    <div className="h-2.5 bg-slate-200 dark:bg-[#202c33] rounded w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="px-8 py-14 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-center text-[#8696a0] mb-3">
                {searchTerm ? <Search size={20} /> : <MessageCircle size={20} />}
              </div>
              {searchTerm ? (
                <>
                  <p className="text-[14px] font-medium text-[#111b21] dark:text-[#e9edef] break-words">No chats match “{searchTerm}”</p>
                  <p className="text-[13px] text-[#667781] dark:text-[#8696a0] mt-1">Try a different name or part of the phone number.</p>
                  <button type="button" onClick={() => setSearchTerm('')} className="mt-3 text-[13px] font-semibold text-[#008069] dark:text-[#00a884] hover:underline cursor-pointer">Clear search</button>
                </>
              ) : unreadFilter ? (
                <>
                  <p className="text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">You&apos;re all caught up</p>
                  <p className="text-[13px] text-[#667781] dark:text-[#8696a0] mt-1">There are no unread chats.</p>
                  <button type="button" onClick={() => setUnreadFilter(false)} className="mt-3 text-[13px] font-semibold text-[#008069] dark:text-[#00a884] hover:underline cursor-pointer">Show all chats</button>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">No chats yet</p>
                  <p className="text-[13px] text-[#667781] dark:text-[#8696a0] mt-1">
                    {userAssignedToFilter ? 'Chats assigned to you appear here.' : 'Messages from customers appear here. Add a contact to start one.'}
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {sortedConversations.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conversation={conv}
                  selected={selectedConversation === conv.id}
                  pinned={pinnedSet.has(conv.id)}
                  onSelect={handleSelectConversation}
                  onTogglePin={togglePinConversation}
                />
              ))}
              {hasMoreConvs && (
                <div className="p-3 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="h-8 px-4 rounded-full text-[13px] font-medium text-[#008069] dark:text-[#00a884] bg-[#f0f2f5] dark:bg-[#202c33] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-wait"
                  >
                    {loadingMore && <Loader2 size={12} className="animate-spin" />}
                    <span>{loadingMore ? 'Loading…' : 'Show more chats'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Chat Panel */}
      {selectedConversation && selectedContact ? (
          <div className={`flex-1 bg-slate-50 dark:bg-[#090d16] flex flex-col overflow-hidden relative transition-all duration-300 ${
          selectedConversation ? 'flex' : 'hidden md:flex'
        }`}>
          {/* Chat Header */}
          <div className="px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between h-[60px] flex-shrink-0 select-none z-10">
            <div className="flex items-center gap-3">
              {/* Back Button for mobile */}
              <button
                onClick={() => setSelectedConversation(null)}
                className="md:hidden p-1.5 hover:bg-slate-200 dark:hover:bg-[#2a3942] rounded-full text-[#667781] dark:text-slate-400 mr-1 flex items-center justify-center transition-colors"
                title="Back to inbox"
              >
                <ArrowLeft size={18} />
              </button>
              <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center font-semibold text-[13px] select-none ${getAvatarTone(selectedContact.id)}`}>
                {getContactAvatarInitials(selectedContact)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] leading-tight truncate">
                    {formatContactDisplayName(selectedContact)}
                  </h3>
                  <button
                    onClick={() => {
                      setRenameFirst(isBsuid(selectedContact.first_name) ? '' : (selectedContact.first_name || ''))
                      setRenameLast(selectedContact.last_name || '')
                      setRenameCompany(selectedContact.company || '')
                      setRenameError(null)
                      setShowRenameModal(true)
                    }}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-emerald-500 transition-colors shrink-0"
                    title="Rename Contact"
                  >
                    <Edit2 size={11} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    {isBsuid(selectedContact.phone_number || selectedContact.first_name) ? (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                        <ShieldCheck size={10} className="shrink-0" />
                        <span>Meta Phone Privacy (BSUID)</span>
                      </span>
                    ) : !(selectedContact.first_name && (selectedContact.first_name.startsWith('+') || selectedContact.first_name.match(/^\d+$/))) && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 leading-none truncate max-w-[120px] sm:max-w-none">
                        <Phone size={9} className="shrink-0" />
                        <span className="truncate">{selectedContact.phone_number}</span>
                      </p>
                    )}
                    {selectedContact.phone_number && (
                      <CopyPhoneButton phoneNumber={selectedContact.phone_number} iconSize={10} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700/60" title="Copy WhatsApp ID / Phone" />
                    )}
                  </div>
                  
                  {/* 24-hour reply window */}
                  {!loadingMessages && !messagesError && (
                    serviceWindow.state === 'open' ? (
                      <span
                        title="WhatsApp lets you reply freely for 24 hours after the customer's last message"
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                          serviceWindow.closingSoon
                            ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200/60 dark:border-amber-900/50'
                            : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-900/50'
                        }`}
                      >
                        <Clock size={10} />
                        {formatWindowRemaining(serviceWindow.remainingMs)} left to reply
                      </span>
                    ) : (
                      <span
                        title="More than 24 hours since the customer last wrote. Only an approved template can be sent until they reply."
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-200/60 dark:border-rose-900/50"
                      >
                        <Clock size={10} />
                        Template only
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Right Side Header Controls */}
            <div className="flex items-center gap-2 md:gap-4 shrink-0">
              {/* AI Suggestions Trigger */}
              {features.enable_ai && selectedConversation && (
                <button
                  onClick={() => {
                    setShowAiPanel(!showAiPanel)
                    if (!showAiPanel && aiSuggestions.length === 0 && selectedConversation) {
                      fetchSuggestions(selectedConversation)
                    }
                  }}
                  className={`px-2 py-1 md:px-3 md:py-1.5 rounded-xl text-[10px] font-black tracking-wider uppercase flex items-center gap-1.5 transition-all cursor-pointer ${
                    showAiPanel
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-500/10 hover:bg-indigo-500/20'
                  }`}
                >
                  <Sparkles size={10} className={loadingSuggestions ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">AI Suggestions</span>
                </button>
              )}

              {/* Ticket Controls */}
              {selectedConversation && currentTicket && (
                <div className="flex items-center gap-1.5 md:gap-2 border-l border-slate-200 dark:border-slate-800 pl-2 md:pl-4">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full select-none" title={`Ticket: ${currentTicket.subject}`}>
                    🎫 Open Ticket
                  </span>
                  <button
                    onClick={() => handleResolveTicket(currentTicket.id)}
                    className="px-2 py-1 text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded transition-all cursor-pointer"
                    title="Mark ticket as resolved"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => openConvertModal(currentTicket)}
                    className="px-2 py-1 text-[10px] font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded transition-all cursor-pointer"
                    title="Convert ticket to a sales lead"
                  >
                    Make Lead
                  </button>
                </div>
              )}

              {/* Auto-Reply Chatbot Toggle Override */}
              {selectedConversation && (
                <div className="flex items-center gap-1.5 md:gap-2 border-l border-slate-200 dark:border-slate-800 pl-2 md:pl-4">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 select-none hidden sm:inline">
                    Auto-Reply Chatbot
                  </span>
                  <button
                    onClick={() => {
                      const conv = conversations.find((c) => c.id === selectedConversation)
                      if (conv) {
                        toggleAutoReply(selectedConversation, conv.auto_reply_enabled !== false)
                      }
                    }}
                    disabled={togglingAutoReply}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-wait ${
                      conversations.find((c) => c.id === selectedConversation)?.auto_reply_enabled !== false
                        ? 'bg-emerald-500'
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                    title={
                      conversations.find((c) => c.id === selectedConversation)?.auto_reply_enabled !== false
                        ? 'AI chatbot will automatically reply to customer messages'
                        : 'Chatbot auto-reply is disabled for this contact'
                    }
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                        conversations.find((c) => c.id === selectedConversation)?.auto_reply_enabled !== false
                          ? 'translate-x-4'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>
          </div>



          {/* Floating AI Suggestions Popup */}
          {features.enable_ai && selectedConversation && showAiPanel && (
            <div className="absolute top-[106px] right-4 left-4 max-w-sm md:left-auto md:w-80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-20 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200 select-none">
              {/* Header Bar */}
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-950/20">
                <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-700 dark:text-indigo-400 shrink-0 mr-1 bg-indigo-500/10 dark:bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/20">
                  <Sparkles size={10} className="text-indigo-600 dark:text-indigo-400" />
                  <span>AI SUGGESTIONS</span>
                </div>

                {loadingSuggestions && (
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500">
                    <Loader2 size={10} className="animate-spin text-indigo-600" />
                  </div>
                )}

                {aiSuggestionsError && (
                  <span className="text-[10px] font-bold text-rose-500 py-1 truncate" title={aiSuggestionsError}>
                    ⚠️ Error
                  </span>
                )}

                {/* Refresh / Generate Button */}
                <button
                  onClick={() => selectedConversation && fetchSuggestions(selectedConversation)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-full transition-colors cursor-pointer shrink-0 ml-auto flex items-center justify-center"
                  title="Refresh Suggestions"
                >
                  <Sparkles size={11} className={loadingSuggestions ? 'animate-spin' : ''} />
                </button>

                {/* Close Button */}
                <button
                  onClick={() => setShowAiPanel(false)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-rose-600 rounded-full transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                  title="Close panel"
                >
                  <X size={11} />
                </button>
              </div>

              {/* Suggestions list */}
              {loadingSuggestions ? (
                <div className="p-6 flex flex-col items-center justify-center gap-2">
                  <Loader2 size={20} className="animate-spin text-indigo-500" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Analyzing chat...</span>
                </div>
              ) : aiSuggestionsError ? (
                <div className="p-6 text-center text-rose-500">
                  <p className="text-xs font-semibold">Failed to fetch suggestions</p>
                </div>
              ) : aiSuggestions.length === 0 ? (
                <div className="p-6 text-center text-slate-500 dark:text-slate-500">
                  <p className="text-xs font-semibold">No suggestions generated</p>
                  <button
                    onClick={() => selectedConversation && fetchSuggestions(selectedConversation)}
                    className="mt-2.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold shadow-xs transition-all cursor-pointer"
                  >
                    Generate Smart Replies
                  </button>
                </div>
              ) : (
                <div className="p-2.5 flex flex-col gap-1.5 max-h-60 overflow-y-auto">
                  {aiSuggestions.map((sug, i) => (
                    <div
                      key={i}
                      className="group relative bg-[#f8fafc]/50 dark:bg-slate-800 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/15 border border-slate-100 dark:border-slate-800 hover:border-indigo-500/30 rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.995] shadow-xs"
                      onClick={() => {
                        setMessageText(sug.text)
                        setShowAiPanel(false)
                      }}
                    >
                      <div className="px-2.5 py-2 flex items-start gap-2">
                        <div className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-indigo-500/10 flex items-center justify-center text-[9px] font-bold text-indigo-700 dark:text-indigo-400">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10.5px] leading-normal text-slate-700 dark:text-slate-200 font-medium">
                            {sug.text}
                          </p>
                          {sug.article_title && (
                            <div className="mt-1 flex items-center gap-1">
                              <BookOpen size={8} className="text-indigo-400 shrink-0" />
                              <span className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-400 truncate max-w-[150px]">
                                {sug.article_title}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat Messages. The wallpaper sits on the frame, which does not scroll, so it stays put behind the bubbles. */}
          <div className="flex-1 min-h-0 relative wa-chat-wallpaper">
            <div
              id="chat-messages-container"
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className="absolute inset-0 z-10 overflow-y-auto overflow-x-hidden px-3 sm:px-[5%] py-3"
            >
              {loadingMessages ? (
                <div className="flex flex-col space-y-5 pt-4 w-full opacity-70" aria-hidden="true">
                  <div className="flex justify-start w-full">
                    <div className="h-14 w-[65%] sm:w-[45%] bg-white/80 dark:bg-[#202c33] rounded-lg rounded-tl-none animate-pulse"></div>
                  </div>
                  <div className="flex justify-end w-full">
                    <div className="h-10 w-[55%] sm:w-[35%] bg-[#d9fdd3]/80 dark:bg-[#005c4b]/60 rounded-lg rounded-tr-none animate-pulse"></div>
                  </div>
                  <div className="flex justify-start w-full">
                    <div className="h-20 w-[70%] sm:w-[50%] bg-white/80 dark:bg-[#202c33] rounded-lg rounded-tl-none animate-pulse"></div>
                  </div>
                  <div className="flex justify-end w-full">
                    <div className="h-10 w-[60%] sm:w-[40%] bg-[#d9fdd3]/80 dark:bg-[#005c4b]/60 rounded-lg rounded-tr-none animate-pulse"></div>
                  </div>
                </div>
              ) : messagesError ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 select-none">
                  <div className="bg-white dark:bg-[#182229] rounded-xl shadow-sm px-5 py-4 max-w-xs">
                    <AlertCircle size={22} className="mx-auto text-rose-500" />
                    <p className="mt-2 text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">This chat could not be loaded</p>
                    <p className="mt-1 text-[12.5px] text-[#667781] dark:text-[#8696a0] break-words">{messagesError}</p>
                    <button
                      type="button"
                      onClick={() => selectedConversation && loadMessages(selectedConversation)}
                      className="mt-3 h-8 px-4 rounded-full bg-[#00a884] hover:bg-[#008069] text-white text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      Try again
                    </button>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full select-none">
                  <div className="bg-[#ffeecd] dark:bg-[#182229] text-[#54656f] dark:text-[#8696a0] text-[12.5px] leading-snug text-center rounded-lg px-4 py-2.5 max-w-xs shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                    No messages with {selectedContactName} yet. WhatsApp requires the first message to be an approved template.
                  </div>
                </div>
              ) : (
                <MessageList
                  messages={messages}
                  contactName={selectedContactName}
                  hasMore={hasMoreMessages}
                  loadingOlder={loadingOlderMessages}
                  onLoadOlder={loadOlderMessages}
                  onOpenImage={handleOpenImage}
                  onReply={composerLocked ? undefined : handleReplyTo}
                  onRetry={readOnly ? undefined : handleRetryMessage}
                  onJumpToMessage={scrollToMessage}
                  onMediaLoad={handleMediaLoad}
                />
              )}
              <div ref={messagesEndRef} className="h-px" />
            </div>

            {showJumpToLatest && messages.length > 0 && (
              <button
                type="button"
                onClick={() => scrollToLatest()}
                aria-label={newWhileAway > 0 ? `${newWhileAway} new ${newWhileAway === 1 ? 'message' : 'messages'}. Jump to latest` : 'Jump to latest message'}
                className="absolute right-4 bottom-4 z-20 h-10 w-10 rounded-full bg-white dark:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] shadow-[0_1px_3px_rgba(11,20,26,.26)] hover:bg-[#f5f6f6] dark:hover:bg-[#2a3942] flex items-center justify-center cursor-pointer animate-in fade-in zoom-in-95 duration-150"
              >
                <ChevronDown size={22} />
                {newWhileAway > 0 && (
                  <span className="absolute -top-1.5 -right-1 h-5 min-w-5 px-1 rounded-full bg-[#25d366] dark:bg-[#00a884] text-white dark:text-[#111b21] text-[11px] font-semibold tabular-nums flex items-center justify-center">
                    {formatBadgeCount(newWhileAway)}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Message being replied to */}
          {replyingTo && (
            <div className="px-3 sm:px-4 pt-2 bg-[#f0f2f5] dark:bg-[#202c33] z-10 flex-shrink-0">
              <div className="flex items-center gap-2 rounded-lg bg-white dark:bg-[#1f2c34] border-l-[3px] border-[#06cf9c] pl-3 pr-1.5 py-1.5 max-w-5xl mx-auto">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-[#008069] dark:text-[#06cf9c]">
                    Replying to {replyingTo.sender_type === 'user' ? 'your message' : selectedContactName}
                  </p>
                  <p className="text-[12.5px] text-[#54656f] dark:text-[#aebac1] truncate">{getMessagePreview(replyingTo) || 'Message'}</p>
                </div>
                <button
                  type="button"
                  aria-label="Cancel reply"
                  onClick={() => setReplyingTo(null)}
                  className="p-1.5 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] cursor-pointer shrink-0"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}

          {/* Attachment Preview Area */}
          {attachedFile && (
            <div className="p-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 z-10">
              <div className="flex items-center gap-3">
                {attachedFile.type.startsWith('image/') ? (
                  <img 
                    src={attachedFile.url} 
                    alt="Upload preview" 
                    className="h-10 w-10 object-cover rounded-lg border border-slate-200/50 dark:border-slate-700/60"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-500 border border-indigo-200/20">
                    <File size={18} />
                  </div>
                )}
                <div className="overflow-hidden">
                  <p className="text-[10px] font-bold truncate text-slate-800 dark:text-white max-w-[200px]">
                    {attachedFile.name}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">Attached media</p>
                </div>
              </div>
              <button 
                onClick={() => setAttachedFile(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Chat Input controls */}
          {(() => {
            const isChatbotActive = chatbotActive
            const isExpired = windowClosed

            return (
              <>
                {chatSendError && (
                  <div className="mx-4 mb-2 mt-1 px-3.5 py-2.5 rounded-xl border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 flex items-start justify-between gap-3 select-none z-10 animate-in fade-in duration-200 shadow-xs">
                    <div className="flex items-start gap-2 text-xs font-semibold text-rose-800 dark:text-rose-300 flex-1 min-w-0">
                      <AlertCircle size={15} className="flex-shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                      <span className="break-words whitespace-normal leading-normal w-full">{chatSendError}</span>
                    </div>
                    <button
                      onClick={() => setChatSendError(null)}
                      className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-200 text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {isExpired && (
                  <div className="mx-3 sm:mx-4 mb-2 mt-1 px-3 py-2.5 rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 z-10 flex-shrink-0">
                    <p className="text-[12.5px] leading-snug text-amber-900 dark:text-amber-200 flex-1">
                      {serviceWindow.state === 'none'
                        ? 'This customer has not written yet. WhatsApp only delivers an approved template as the first message.'
                        : 'It is more than 24 hours since this customer last wrote. WhatsApp only delivers an approved template until they reply.'}
                    </p>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          fetchLiveChatTemplates()
                          setShowLiveChatTemplateModal(true)
                        }}
                        className="h-8 px-3 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg text-[12.5px] font-semibold transition-colors flex items-center justify-center gap-1.5 flex-shrink-0 w-full sm:w-auto cursor-pointer"
                      >
                        <FileText size={13} />
                        <span>Send a template</span>
                      </button>
                    )}
                  </div>
                )}

                {isChatbotActive && !isExpired && (
                  <div className="mx-3 sm:mx-4 mb-2 mt-1 px-3 py-2.5 rounded-xl border bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 z-10 flex-shrink-0">
                    <p className="text-[12.5px] leading-snug text-indigo-900 dark:text-indigo-200 flex-1 flex items-start gap-1.5">
                      <Bot size={14} className="shrink-0 mt-px" />
                      <span>The chatbot is answering this customer. Take over to reply yourself; the bot stays off for this chat until you switch it back on.</span>
                    </p>
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={togglingAutoReply}
                        onClick={() => selectedConversation && toggleAutoReply(selectedConversation, true)}
                        className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-[12.5px] font-semibold transition-colors flex items-center justify-center gap-1.5 flex-shrink-0 w-full sm:w-auto cursor-pointer"
                      >
                        {togglingAutoReply && <Loader2 size={12} className="animate-spin" />}
                        <span>Take over</span>
                      </button>
                    )}
                  </div>
                )}
                
                <div className="py-2.5 px-3 sm:px-4 border-t border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#202c33] z-10 flex-shrink-0">
                  <div className="flex gap-1.5 items-end max-w-5xl mx-auto w-full">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      disabled={isExpired || isChatbotActive || readOnly}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || isExpired || isChatbotActive || readOnly}
                      aria-label="Attach a file"
                      className="hover:bg-[#e9edef] dark:hover:bg-[#374248] text-[#54656f] dark:text-[#8696a0] p-2 rounded-full transition-colors flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                      title={readOnly ? describeDenied('records.write') : isExpired ? 'Only a template can be sent right now' : isChatbotActive ? 'Take over from the chatbot to send files' : 'Attach a file'}
                    >
                      {uploading ? (
                        <Loader2 className="animate-spin text-[#667781]" size={18} />
                      ) : (
                        <Paperclip size={18} className="rotate-45" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        fetchLiveChatTemplates()
                        setShowLiveChatTemplateModal(true)
                      }}
                      disabled={readOnly}
                      aria-label="Send a template"
                      className="hover:bg-[#e9edef] dark:hover:bg-[#374248] text-[#54656f] dark:text-[#8696a0] p-2 rounded-full transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title={readOnly ? describeDenied('records.write') : 'Send an approved WhatsApp template'}
                    >
                      <FileText size={18} />
                    </button>
                    <textarea
                      ref={textareaRef}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter sends and Shift+Enter starts a new line, as in WhatsApp. On a phone keyboard
                        // Enter is the only way to make a new line, so there it never sends.
                        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                        if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return
                        e.preventDefault()
                        handleSendMessage()
                      }}
                      aria-label="Message"
                      placeholder={readOnly ? 'Your account is read-only' : isExpired ? 'Send a template to continue this chat' : isChatbotActive ? 'The chatbot is replying. Take over to type.' : attachedFile ? 'Add a caption' : 'Type a message'}
                      disabled={isExpired || isChatbotActive || readOnly}
                      title={readOnly ? describeDenied('records.write') : undefined}
                      rows={1}
                      className="flex-1 min-h-[40px] px-3 py-2 bg-white dark:bg-[#2a3942] border-none rounded-lg focus:outline-none focus:ring-0 text-[15px] leading-6 placeholder-[#8696a0] text-[#111b21] dark:text-[#e9edef] resize-none overflow-y-auto disabled:bg-[#f7f8f8] dark:disabled:bg-[#232e35] disabled:cursor-not-allowed"
                    />
                    
                    {/* Rephrase with AI */}
                    {messageText.trim() && !isExpired && !isChatbotActive && (
                      <div className="relative flex-shrink-0" ref={rephraseDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowRephraseDropdown(!showRephraseDropdown)}
                          disabled={rephrasing}
                          className={`flex items-center justify-center transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 ${
                            showRephraseDropdown
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 rounded-lg p-1.5'
                              : 'hover:bg-[#e9edef] dark:hover:bg-[#374248] text-[#667781] dark:text-[#8696a0] p-2 rounded-full border border-transparent'
                          }`}
                          title="Rephrase with AI"
                        >
                          {rephrasing ? (
                            <Loader2 size={18} className="animate-spin text-[#667781]" />
                          ) : (
                            <Wand2 size={18} />
                          )}
                          <span className="hidden md:inline ml-1 text-[11px] font-bold">Rephrase</span>
                        </button>

                        {/* Rephrase Dropdown */}
                        {showRephraseDropdown && (
                          <div className="absolute bottom-full right-0 mb-2 w-56 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] rounded-xl shadow-2xl z-30 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
                            <div className="py-1">
                              <button
                                onClick={() => handleRephrase('professional')}
                                className="w-full px-3.5 py-2.5 flex items-center gap-3 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors text-left cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center flex-shrink-0">
                                  <Briefcase size={13} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                  <p className="text-[12px] font-bold text-[#111b21] dark:text-[#e9edef]">Professional</p>
                                  <p className="text-[10px] text-[#667781] dark:text-[#8696a0]">Make it professional and polite</p>
                                </div>
                              </button>
                              <button
                                onClick={() => handleRephrase('friendly')}
                                className="w-full px-3.5 py-2.5 flex items-center gap-3 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors text-left cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-full bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0">
                                  <Smile size={13} className="text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                  <p className="text-[12px] font-bold text-[#111b21] dark:text-[#e9edef]">Friendly</p>
                                  <p className="text-[10px] text-[#667781] dark:text-[#8696a0]">Make it warm and friendly</p>
                                </div>
                              </button>
                              <button
                                onClick={() => handleRephrase('short')}
                                className="w-full px-3.5 py-2.5 flex items-center gap-3 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors text-left cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
                                  <AlignLeft size={13} className="text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                  <p className="text-[12px] font-bold text-[#111b21] dark:text-[#e9edef]">Short & Clear</p>
                                  <p className="text-[10px] text-[#667781] dark:text-[#8696a0]">Make it short and easy to understand</p>
                                </div>
                              </button>
                              <button
                                onClick={() => handleRephrase('grammar')}
                                className="w-full px-3.5 py-2.5 flex items-center gap-3 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors text-left cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-full bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center flex-shrink-0">
                                  <SpellCheck size={13} className="text-purple-600 dark:text-purple-400" />
                                </div>
                                <div>
                                  <p className="text-[12px] font-bold text-[#111b21] dark:text-[#e9edef]">Fix Grammar</p>
                                  <p className="text-[10px] text-[#667781] dark:text-[#8696a0]">Fix grammar and spelling</p>
                                </div>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      disabled={(!messageText.trim() && !attachedFile) || isExpired || isChatbotActive || readOnly || uploading}
                      aria-label="Send message"
                      title="Send"
                      className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#8696a0]/50 text-white h-10 w-10 rounded-full transition-colors flex items-center justify-center flex-shrink-0 active:scale-95 disabled:scale-100 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Send size={17} />
                    </button>
                  </div>
                  {!isExpired && !isChatbotActive && !readOnly && (
                    <p className="hidden md:block max-w-5xl mx-auto mt-1 pl-[88px] text-[11px] text-[#8696a0] select-none">
                      Enter to send · Shift + Enter for a new line · *bold* _italic_ ~strike~
                    </p>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      ) : selectedConversation && (loading || fetchingConvs) ? (
        <div className="flex-1 bg-[#f8f9fa] dark:bg-[#222e35] flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-8 border-l border-[#e9edef] dark:border-[#2a3942]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-[#00a884]" size={24} />
            <p className="text-xs text-[#667781] dark:text-[#8696a0] font-semibold tracking-wider uppercase">Loading Chat...</p>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 bg-[#f8f9fa] dark:bg-[#222e35] flex-col items-center justify-between p-12 border-l border-[#e9edef] dark:border-[#2a3942] relative select-none">
          <div /> {/* Spacer to center the content vertically */}
          <div className="max-w-md text-center space-y-6 relative z-10">
            <div className="mx-auto h-24 w-24 rounded-full bg-emerald-500/10 dark:bg-emerald-500/5 flex items-center justify-center text-emerald-500 border border-[#00a884]/20 shadow-xs">
              <MessageCircle size={44} className="text-[#00a884] dark:text-[#00e676]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-[#111b21] dark:text-[#e9edef] text-[28px] font-light tracking-tight">Your team inbox</h2>
              <p className="text-[14px] text-[#667781] dark:text-[#8696a0] leading-relaxed max-w-sm mx-auto font-normal">
                Choose a chat on the left to read and reply. New WhatsApp messages show up here as they arrive, for everyone on your team.
              </p>
            </div>
            <div className={`flex items-center justify-center gap-2 text-[12px] font-medium px-3 py-1 rounded-full w-max mx-auto border ${
              realtimeStatus === 'connected'
                ? 'text-[#008069] dark:text-[#00a884] bg-[#e7f8f2] dark:bg-[#0b3c2d]/40 border-[#00a884]/20'
                : 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-300/40'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${realtimeStatus === 'connected' ? 'bg-[#00a884]' : 'bg-amber-500 animate-pulse'}`} />
              <span>{realtimeStatus === 'connected' ? 'Live updates on' : realtimeStatus === 'connecting' ? 'Connecting to live updates…' : 'Live updates paused'}</span>
            </div>
          </div>
          <div className="text-[12px] text-[#8696a0]">
            Sent through the WhatsApp Business Platform
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {activeImageModal && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setActiveImageModal(null)}
          className="fixed inset-0 bg-[#070a10]/85 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img 
              src={activeImageModal} 
              alt="Preview" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl border border-slate-800"
            />
            <button 
              onClick={() => setActiveImageModal(null)}
              className="absolute -top-10 right-0 text-white hover:text-[#00e676] transition-colors flex items-center gap-1 font-bold text-xs"
            >
              <X size={16} />
              <span>Close</span>
            </button>
          </div>
        </div>
      )}

      {/* Rename Contact Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 text-[#111b21] dark:text-white">
            <div className="p-6 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white">Name Contact</h3>
              <button
                onClick={() => setShowRenameModal(false)}
                className="text-[#667781] dark:text-slate-400 hover:text-[#111b21] dark:hover:text-white transition-colors p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-lg"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">First Name</label>
                <input
                  type="text"
                  value={renameFirst}
                  onChange={(e) => setRenameFirst(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white"
                  placeholder="e.g. John"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Last Name</label>
                <input
                  type="text"
                  value={renameLast}
                  onChange={(e) => setRenameLast(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white"
                  placeholder="e.g. Smith"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Company</label>
                <input
                  type="text"
                  value={renameCompany}
                  onChange={(e) => setRenameCompany(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white"
                  placeholder="e.g. Acme Corp"
                />
              </div>

              {renameError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-3.5 py-2.5 rounded-xl text-xs font-medium">
                  {renameError}
                </div>
              )}
            </div>
            <div className="p-6 bg-[#f0f2f5] dark:bg-[#1c282f] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#667781] dark:text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameContact}
                disabled={renameLoading}
                className="bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/10"
              >
                {renameLoading && <Loader2 size={12} className="animate-spin" />}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert Ticket to Lead Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form onSubmit={handleConvertTicketToLead} className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 text-[#111b21] dark:text-white">
            <div className="p-6 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-1.5 font-bold">
                <Ticket size={16} className="text-[#00a884]" />
                Convert Ticket to Lead
              </h3>
              <button
                type="button"
                onClick={() => setShowConvertModal(null)}
                className="text-[#667781] dark:text-slate-400 hover:text-[#111b21] dark:hover:text-white transition-colors p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-lg"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Lead Title</label>
                <input
                  type="text"
                  required
                  value={leadForm.title}
                  onChange={(e) => setLeadForm({ ...leadForm, title: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white"
                  placeholder="e.g. Website Query - Goku"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Lead Value ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={leadForm.value}
                    onChange={(e) => setLeadForm({ ...leadForm, value: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white"
                    placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Priority</label>
                  <select
                    value={leadForm.priority}
                    onChange={(e) => setLeadForm({ ...leadForm, priority: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white cursor-pointer"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Pipeline Stage</label>
                <select
                  required
                  value={leadForm.stageId}
                  onChange={(e) => setLeadForm({ ...leadForm, stageId: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white cursor-pointer"
                >
                  {pipelineStages.length === 0 ? (
                    <option value="">No stages available</option>
                  ) : (
                    pipelineStages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider mb-1.5">Assign To</label>
                <select
                  value={canAssignWork ? leadForm.assignedTo : (user?.id || '')}
                  disabled={!canAssignWork}
                  title={canAssignWork ? undefined : 'Leads you create are assigned to you. Admins and managers can reassign them.'}
                  onChange={(e) => setLeadForm({ ...leadForm, assignedTo: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-xl outline-none text-xs font-semibold transition-all text-[#111b21] dark:text-white cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {teammates.map((member) => (
                    <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2 select-none">
                <input
                  type="checkbox"
                  id="resolveTicket"
                  checked={leadForm.resolveTicket}
                  onChange={(e) => setLeadForm({ ...leadForm, resolveTicket: e.target.checked })}
                  className="rounded border-[#e9edef] dark:border-[#2a3942] text-[#00a884] focus:ring-[#00a884] accent-[#00a884] cursor-pointer"
                />
                <label htmlFor="resolveTicket" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                  Mark this ticket as resolved automatically
                </label>
              </div>
            </div>
            <div className="p-6 bg-[#f0f2f5] dark:bg-[#1c282f] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConvertModal(null)}
                className="px-4 py-2 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#667781] dark:text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={modalLoading}
                className="bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/10"
              >
                {modalLoading && <Loader2 size={13} className="animate-spin" />}
                <span>Create Lead</span>
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Live Chat Template Selector Modal */}
      {showLiveChatTemplateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="text-[#00a884]" size={20} />
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base">Send Meta Approved Template</h3>
              </div>
              <button
                onClick={() => {
                  setShowLiveChatTemplateModal(false)
                  setSelectedLiveChatTemplate(null)
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Select Template</label>
                {loadingLiveChatTemplates ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
                    <Loader2 size={14} className="animate-spin text-[#00a884]" />
                    <span>Loading templates...</span>
                  </div>
                ) : (
                  <select
                    value={selectedLiveChatTemplate?.sid || ''}
                    onChange={(e) => handleSelectLiveChatTemplate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-[#202c33] border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                  >
                    <option value="">Choose a WhatsApp Template...</option>
                    {liveChatTemplates.map((t) => (
                      <option key={t.sid} value={t.sid}>
                        {t.name} ({t.category || 'UTILITY'})
                      </option>
                    ))}
                  </select>
                )}

                {liveChatTemplateError && (
                  <div className="mt-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/30 text-xs flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                      <AlertCircle size={13} className="shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
                      <span>WhatsApp API Credentials Issue</span>
                    </div>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-normal">
                      {liveChatTemplateError}
                    </p>
                    <a 
                      href="/dashboard/settings" 
                      className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline mt-0.5"
                    >
                      Go to Settings → Credentials to update token & IDs
                    </a>
                  </div>
                )}
              </div>

              {selectedLiveChatTemplate && (
                <div className="space-y-3 pt-2">
                  <div className="p-3.5 bg-slate-100/70 dark:bg-[#202c33]/70 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs">
                    <p className="font-semibold text-slate-500 dark:text-slate-400 mb-1">Body Preview:</p>
                    <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 font-normal leading-relaxed">{selectedLiveChatTemplate.body}</p>
                  </div>

                  {selectedLiveChatTemplate.variables && selectedLiveChatTemplate.variables.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Map Variable Values</p>
                      {selectedLiveChatTemplate.variables.map((vKey: string) => (
                        <div key={vKey} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-[#00a884] bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded border border-emerald-200/50 min-w-[70px] text-center">
                            {`{{${vKey}}}`}
                          </span>
                          <input
                            type="text"
                            value={templateVarValues[vKey] || ''}
                            onChange={(e) =>
                              setTemplateVarValues((prev) => ({ ...prev, [vKey]: e.target.value }))
                            }
                            placeholder={`Value for {{${vKey}}}`}
                            className="flex-1 px-3 py-1.5 bg-white dark:bg-[#2a3942] border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-[#182229] border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLiveChatTemplateModal(false)
                  setSelectedLiveChatTemplate(null)
                }}
                className="px-4 py-2 hover:bg-slate-200/60 dark:hover:bg-[#2a3942] text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendLiveChatTemplate}
                disabled={!selectedLiveChatTemplate || sendingTemplate}
                className="bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              >
                {sendingTemplate && <Loader2 size={13} className="animate-spin" />}
                <span>Send WhatsApp Template</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

}

export default function ConversationsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full w-full bg-[#f0f2f5] dark:bg-[#0b141a]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]"></div>
      </div>
    }>
      <ConversationsPageContent />
    </Suspense>
  )
}
