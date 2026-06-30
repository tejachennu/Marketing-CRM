'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { ConversationWithContact, User, Contact, Message } from '@/lib/types'
import { canSeeAll } from '@/lib/rbac'
import { 
  Search, Send, Phone, LogOut, Wifi, WifiOff, 
  Paperclip, File, X, ChevronDown, CheckCheck, Check, AlertCircle, Loader2, MessageCircle,
  Edit2, Download, ArrowLeft, Reply, Sparkles, ExternalLink, BookOpen, Pin, Clock
} from 'lucide-react'
import { AddContactDialog } from '@/components/add-contact-dialog'
import { authSessionManager } from '@/lib/auth-context'
import { useAlert } from '@/lib/dialog-context'

function ConversationsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversationIdParam = searchParams.get('conversationId')
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

  const togglePinConversation = (convId: string) => {
    if (!user?.organization_id) return
    const current = [...pinnedConvs]
    const index = current.indexOf(convId)
    if (index > -1) {
      current.splice(index, 1)
    } else {
      current.push(convId)
    }
    setPinnedConvs(current)
    localStorage.setItem(`pinned_convs_${user.organization_id}`, JSON.stringify(current))
  }
  
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
  
  // AI Suggestions (RAG)
  type AiSuggestion = { text: string; article_title?: string | null; source_url?: string | null }
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [aiSuggestionsError, setAiSuggestionsError] = useState<string | null>(null)
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null)
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [windowTick, setWindowTick] = useState(0) // Forces re-render for 24h window timer
  const fetchSuggestionsRef = useRef<any>(null)

  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
    enable_sms: true,
  })
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedConvRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const conversationsRef = useRef<ConversationWithContact[]>([])
  const hasScrolledForConvRef = useRef(false)
  const lastScrollMsgIdRef = useRef<string | null>(null)

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

  // Keep ref in sync for use in callbacks and reset scroll tracking when switching conversation
  useEffect(() => {
    selectedConvRef.current = selectedConversation
    hasScrolledForConvRef.current = false
    lastScrollMsgIdRef.current = null
  }, [selectedConversation])

  // Auto-scroll to bottom intelligently (instant on load, smooth on new messages, none on pagination)
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsgId = messages[messages.length - 1]?.id || null
      
      if (!hasScrolledForConvRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
        hasScrolledForConvRef.current = true
        lastScrollMsgIdRef.current = lastMsgId
      } else if (lastMsgId !== lastScrollMsgIdRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        lastScrollMsgIdRef.current = lastMsgId
      }
    }
  }, [messages])

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
      const seeAll = user ? canSeeAll(user) : true
      const assignedTo = seeAll ? '' : (user?.id || '')
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
  }, [user])

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

  const loadConversations = useCallback(async (
    orgId: string, 
    pageNum = 1, 
    append = false, 
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
      } else {
        setFetchingConvs(true)
      }
      const result = await fetchConversations(orgId, pageNum, searchVal, unreadOnly, assignedTo)
      
      setConversations((prev) => {
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
      setHasMoreConvs(result.hasMore)
      
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
    setLoadingMessages(true)
    try {
      const { messages: msgs, hasMore } = await fetchMessages(convId)
      setMessages(msgs)
      setHasMoreMessages(hasMore)
    } catch (err) {
      console.error('[Dashboard] Error loading messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }, [fetchMessages])

  const loadOlderMessages = async () => {
    if (!selectedConversation || messages.length === 0 || loadingOlderMessages) return
    setLoadingOlderMessages(true)
    try {
      const oldestMessage = messages[0]
      const { messages: olderMsgs, hasMore } = await fetchMessages(selectedConversation, oldestMessage.created_at)
      
      const chatContainer = document.getElementById('chat-messages-container')
      const previousScrollHeight = chatContainer?.scrollHeight || 0
      
      setMessages((prev) => [...olderMsgs, ...prev])
      setHasMoreMessages(hasMore)
      
      setTimeout(() => {
        if (chatContainer) {
          const currentScrollHeight = chatContainer.scrollHeight
          chatContainer.scrollTop = currentScrollHeight - previousScrollHeight
        }
      }, 0)
    } catch (err) {
      console.error('[Dashboard] Error loading older messages:', err)
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  const reloadAll = useCallback(() => {
    if (!user) return
    setConvPage(1)
    loadConversations(user.organization_id, 1, false)
    loadContacts(user.organization_id)
  }, [user, loadConversations, loadContacts])

  const clearUnreadCount = useCallback(async (convId: string) => {
    try {
      const conv = conversationsRef.current.find((c) => c.id === convId)
      if (conv && conv.unread_count === 0) {
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
      } else {
        if (user?.organization_id) {
          loadUnreadCount(user.organization_id, true)
        }
      }
    } catch (err) {
      console.error('[Dashboard] Error resetting unread count:', err)
    }
  }, [user, loadUnreadCount])

  // Dynamically fetch selected conversation if it is not in the active conversations list
  // OR fetch/create conversation if contactId is in the URL and no conversation is selected
  useEffect(() => {
    if (!user) return
    const urlParams = new URLSearchParams(window.location.search)
    const contactIdParam = urlParams.get('contactId')

    if (selectedConversation) {
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
    } else if (contactIdParam && !window.sessionStorage.getItem(`conv_tried_${contactIdParam}`)) {
      const fetchOrCreateByContact = async () => {
        try {
          window.sessionStorage.setItem(`conv_tried_${contactIdParam}`, 'true')
          const existingConv = conversationsRef.current.find(c => c.contact_id === contactIdParam)
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
            .eq('contact_id', contactIdParam)
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
              .insert([{ organization_id: user.organization_id, contact_id: contactIdParam, is_active: true }])
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
    }
  }, [selectedConversation, user])

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
    if (!user) return

    const orgId = user.organization_id

    const conversationsChannel = supabase
      .channel(`ws-conversations-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        async (payload) => {
          console.log('[WS] New conversation:', payload.new)
          await loadConversations(orgId, 1, false, searchTermRef.current, unreadFilterRef.current, userAssignedToFilterRef.current, true)
          await loadContacts(orgId)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        async (payload) => {
          console.log('[WS] Conversation updated:', payload.new)
          const updated = payload.new as any
          setConversations((prev) => {
            const newList = prev.map((c) =>
              c.id === updated.id
                ? { 
                    ...c, 
                    unread_count: updated.id === selectedConvRef.current ? 0 : updated.unread_count, 
                    last_message_at: updated.last_message_at 
                  }
                : c
            )
            return newList
          })
          loadUnreadCount(orgId, true)
        }
      )
      .subscribe((status) => {
        console.log('[WS] Conversations channel:', status)
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected')
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setRealtimeStatus('disconnected')
      })

    const messagesChannel = supabase
      .channel(`ws-messages-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as Message
          console.log('[WS] New message:', newMsg.id, 'in conv:', newMsg.conversation_id)

          // Live update the last message and timestamp in the conversation item
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === newMsg.conversation_id)
            if (!exists) {
              // If conversation doesn't exist in our list yet, reload to fetch it
              loadConversations(orgId, 1, false, searchTermRef.current, unreadFilterRef.current, userAssignedToFilterRef.current, true)
              return prev
            }
            return prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_at: newMsg.created_at,
                    last_message: newMsg,
                    unread_count: newMsg.conversation_id === selectedConvRef.current ? 0 : (c.unread_count + 1)
                  }
                : c
            )
          })

          if (newMsg.conversation_id === selectedConvRef.current) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev
              return [...prev, newMsg]
            })
            // Reset unread count for the active conversation
            clearUnreadCount(selectedConvRef.current)
          } else {
            loadUnreadCount(orgId, true)
          }
        }
      )
      .subscribe((status) => {
        console.log('[WS] Messages channel:', status)
      })

    const contactsChannel = supabase
      .channel(`ws-contacts-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'contacts' },
        async (payload) => {
          console.log('[WS] New contact:', payload.new)
          await loadContacts(orgId)
        }
      )
      .subscribe((status) => {
        console.log('[WS] Contacts channel:', status)
      })

    return () => {
      supabase.removeChannel(conversationsChannel)
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(contactsChannel)
    }
  }, [user])

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
      setAiSuggestions([])
      setAiSuggestionsError(null)
      return
    }
    loadMessages(selectedConversation)
    clearUnreadCount(selectedConversation)
    // Clear suggestions when switching conversation
    setAiSuggestions([])
    setAiSuggestionsError(null)
  }, [selectedConversation, loadMessages, clearUnreadCount])

  // ─── Actions ───

  const handleLoadMore = () => {
    if (!user || loadingMore) return
    const nextPage = convPage + 1
    setConvPage(nextPage)
    loadConversations(user.organization_id, nextPage, true)
  }

  const toggleAutoReply = async (convId: string, currentVal: boolean) => {
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

    const selectedConv = conversations.find((c) => c.id === selectedConversation)
    if (!selectedConv?.contact) return

    let text = messageText.trim()
    const media = attachedFile
    const currentReply = replyingTo
    
    if (currentReply) {
      text = `[reply:${currentReply.id}]${text}`
      setReplyingTo(null)
    }
    
    setMessageText('')
    setAttachedFile(null)
    setAiSuggestions([])
    setShowAiPanel(false)

    // Optimistic update
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      organization_id: user.organization_id,
      conversation_id: selectedConversation,
      sender_type: 'user',
      sender_id: null,
      body: text,
      media_url: media ? media.url : null,
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
          message: text,
          phoneNumber: selectedConv.contact.phone_number,
          mediaUrl: media ? media.url : null,
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send message')

      if (data.message) {
        setMessages((prev) => {
          const alreadyHasReal = prev.some((m) => m.id === data.message.id)
          if (alreadyHasReal) {
            return prev.filter((m) => m.id !== optimisticMsg.id)
          }
          return prev.map((m) => (m.id === optimisticMsg.id ? data.message : m))
        })
      }
    } catch (error) {
      console.error('[Dashboard] Send error:', error)
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
      if (text.startsWith('[reply:')) {
        const match = text.match(/^\[reply:([^\]]+)\](.*)$/)
        if (match) {
          setMessageText(match[2])
          const oldReply = messages.find(m => m.id === match[1])
          if (oldReply) setReplyingTo(oldReply)
        }
      } else {
        setMessageText(text)
      }
      if (media) setAttachedFile(media)
    }
  }

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
      
      if (user) {
        loadConversations(user.organization_id, 1, false)
        loadContacts(user.organization_id)
      }
    } catch (err) {
      console.error('[Rename] Error:', err)
      setRenameError(err instanceof Error ? err.message : 'Failed to rename contact')
    } finally {
      setRenameLoading(false)
    }
  }

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-emerald-500/10')
      setTimeout(() => {
        el.classList.remove('bg-emerald-500/10')
      }, 1500)
    }
  }

  const getDisplayUrl = (url: string | null): string => {
    if (!url) return ''
    if (url.startsWith('https://api.twilio.com')) {
      return `/api/media/proxy?url=${encodeURIComponent(url)}`
    }
    return url
  }

  const getDownloadName = (url: string | null): string => {
    if (!url) return 'download'
    const cleanUrl = url.split('?')[0].split('#')[0]
    const parts = cleanUrl.split('/')
    const lastPart = parts[parts.length - 1] || 'download'
    return decodeURIComponent(lastPart)
  }

  const getMediaType = (url: string | null): 'image' | 'video' | 'audio' | 'document' | null => {
    if (!url) return null
    const cleanUrl = url.split('?')[0].split('#')[0]
    const ext = cleanUrl.split('.').pop()?.toLowerCase() || ''
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image'
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'amr'].includes(ext)) return 'audio'
    return 'document'
  }

  // ─── Sorting ───

  const sortedConversations = [...conversations].sort((a, b) => {
    const aPinned = pinnedConvs.includes(a.id)
    const bPinned = pinnedConvs.includes(b.id)
    
    if (aPinned && !bPinned) return -1
    if (!aPinned && bPinned) return 1
    
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return sortBy === 'newest' ? bTime - aTime : aTime - bTime
  })

  const selectedConvData = conversations.find((c) => c.id === selectedConversation)
  const selectedContact = selectedConvData?.contact

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
    <div className="h-full w-full bg-slate-100 dark:bg-slate-950 flex overflow-hidden animate-in fade-in duration-300 relative font-sans text-slate-800 dark:text-slate-100">
      {/* Sidebar: Conversations List */}
      <div className={`w-full md:w-[350px] bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-r border-slate-200/50 dark:border-slate-800/50 flex flex-col overflow-hidden transition-all duration-300 ${
        selectedConversation ? 'hidden md:flex' : 'flex'
      }`}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-150 dark:border-slate-800/80 space-y-4 bg-white/40 dark:bg-slate-900/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">Inbox</h2>
              {unreadCount > 0 && (
                <span className="bg-[#ef4444] text-white text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white dark:border-slate-900 shadow-sm animate-pulse select-none">
                  {unreadCount}
                </span>
              )}
              <span className="flex items-center" title={`Realtime: ${realtimeStatus}`}>
                {realtimeStatus === 'connected' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {user && (
                <AddContactDialog
                  organizationId={user.organization_id}
                  onContactAdded={reloadAll}
                />
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="relative group">
            <Search size={14} className="absolute left-3 top-3 text-slate-400 dark:text-slate-500 group-focus-within:text-emerald-500 transition-colors" />
            <input
              type="text"
              placeholder="Search or start new chat"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 text-xs font-medium placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100 shadow-inner transition-all duration-200"
            />
          </div>

          {/* Filters and Sort */}
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUnreadFilter(false)}
                className={`px-3 py-1 rounded-full text-[11px] transition-all font-semibold cursor-pointer ${
                  !unreadFilter 
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold' 
                    : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/80'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setUnreadFilter(true)}
                className={`px-3 py-1 rounded-full text-[11px] transition-all font-semibold flex items-center gap-1.5 cursor-pointer ${
                  unreadFilter 
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold' 
                    : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/80'
                }`}
              >
                <span>Unread</span>
                {unreadCount > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[9px] font-bold transition-all ${
                    unreadFilter 
                      ? 'bg-emerald-550 dark:bg-emerald-500 text-white' 
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>
            <button
              onClick={() => setSortBy((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5 rounded-xl border border-slate-200/35 dark:border-slate-700/35 transition-all duration-200 font-semibold"
            >
              <span>{sortBy === 'newest' ? 'Newest' : 'Oldest'}</span>
              <ChevronDown size={12} className={`transition-transform duration-250 ${sortBy === 'oldest' ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Conversations list area */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-white/30 dark:bg-slate-900/30">
          {fetchingConvs ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="w-full p-3 flex items-center gap-3 rounded-xl border border-transparent animate-pulse">
                  <div className="h-10 w-10 rounded-xl bg-slate-200 dark:bg-slate-800 shrink-0" />
                  <div className="flex-1 space-y-2.5 py-1">
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-1/2" />
                    <div className="h-2.5 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-medium space-y-2">
              <p>No conversations found.</p>
              <p className="text-[10px] text-slate-400">New WhatsApp contacts appear here.</p>
            </div>
          ) : (
            sortedConversations.map((conv) => {
              const contactName = conv.contact
                ? `${conv.contact.first_name || 'Unknown'} ${conv.contact.last_name || ''}`.trim()
                : 'Unknown Contact'
              const isSelected = selectedConversation === conv.id

              return (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv.id)}
                  className={`w-full p-3 text-left flex items-center gap-3 rounded-xl transition-all duration-200 border relative cursor-pointer group/item ${
                    isSelected
                      ? 'bg-slate-100/80 dark:bg-slate-800/70 border-slate-200/50 dark:border-slate-700/50 shadow-xs'
                      : 'bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800/30 border-transparent'
                  }`}
                >
                  {/* Left Accent Indicator inside selected item */}
                  {isSelected && (
                    <div className="absolute left-1 top-3.5 bottom-3.5 w-[3px] bg-gradient-to-b from-emerald-500 to-teal-400 rounded-full" />
                  )}

                  {/* Avatar */}
                  <div className="relative flex-shrink-0 select-none">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-700/80 flex items-center justify-center font-bold text-slate-500 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50 text-xs shadow-xs">
                      {contactName.substring(0, 2).toUpperCase()}
                    </div>
                  </div>

                  {/* Conv metadata */}
                  <div className="flex-1 min-w-0 pr-2 select-none">
                    <p className="font-bold text-xs text-slate-855 dark:text-slate-100 truncate">
                      {contactName}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] text-slate-450 dark:text-slate-500 mt-1 font-medium min-w-0">
                      {conv.last_message ? (
                        <>
                          {conv.last_message.sender_type === 'user' && (() => {
                            const status = conv.last_message.status
                            if (status === 'failed' || status === 'undelivered') {
                              return (
                                <span title={conv.last_message.error_message || 'Failed'} className="flex-shrink-0">
                                  <AlertCircle size={12} className="text-rose-500" />
                                </span>
                              )
                            }
                            if (status === 'read' || conv.last_message.read_at) {
                              return <CheckCheck size={13} className="text-sky-400 flex-shrink-0" />
                            }
                            if (status === 'delivered') {
                              return <CheckCheck size={13} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                            }
                            return <Check size={13} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                          })()}
                          <span className="truncate">
                            {conv.last_message.body ? (
                              conv.last_message.body.startsWith('[reply:') ? (
                                conv.last_message.body.replace(/^\[reply:[^\]]+\]/, '')
                              ) : (
                                conv.last_message.body
                              )
                            ) : conv.last_message.media_url ? (
                              /\.(jpeg|jpg|gif|png|webp)/i.test(conv.last_message.media_url) ? '📷 Photo' : '📄 Document'
                            ) : ''}
                          </span>
                        </>
                      ) : (
                        <span className="truncate">{conv.contact?.phone_number}</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Right side column for Time, Pinned, Unread count */}
                  <div className="flex flex-col items-end justify-between h-9 select-none flex-shrink-0 min-w-[50px] relative">
                    {conv.last_message_at && (
                      <p className={`text-[9px] font-bold ${conv.unread_count > 0 ? 'text-emerald-550 dark:text-emerald-400' : 'text-slate-450 dark:text-slate-500'}`}>
                        {new Date(conv.last_message_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-1.5 mt-1 justify-end w-full">
                      {/* Pinned Icon (always visible if pinned) */}
                      {pinnedConvs.includes(conv.id) && (
                        <span className="text-emerald-600 dark:text-emerald-400" title="Pinned">
                          <Pin size={10} className="fill-current" />
                        </span>
                      )}
                      
                      {/* Unread count badge */}
                      {conv.unread_count > 0 && (
                        <span className="bg-gradient-to-tr from-emerald-500 to-teal-500 text-white text-[9px] font-black rounded-full h-4.5 min-w-[18px] px-1 flex items-center justify-center shadow-xs">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>

                    {/* Hover Pin/Unpin Action Button */}
                    <div className="absolute right-0 bottom-0 opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 bg-white/90 dark:bg-slate-900/90 rounded-md shadow-xs flex items-center">
                      {pinnedConvs.includes(conv.id) ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePinConversation(conv.id)
                          }}
                          title="Unpin Chat"
                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-550 rounded-md cursor-pointer transition-colors"
                        >
                          <Pin size={12} className="fill-current text-rose-500" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePinConversation(conv.id)
                          }}
                          title="Pin Chat"
                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-600 rounded-md cursor-pointer transition-colors"
                        >
                          <Pin size={12} className="rotate-45" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

          {/* Load More Button */}
          {hasMoreConvs && (
            <div className="p-3 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 font-bold px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all inline-flex items-center gap-1.5 border border-slate-200/50 dark:border-slate-700/50 bg-white dark:bg-slate-850 shadow-xs active:scale-[0.98]"
              >
                {loadingMore && <Loader2 size={12} className="animate-spin" />}
                <span>{loadingMore ? 'Loading...' : 'Load More'}</span>
              </button>
            </div>
          )}
        </div>

      {/* Main Chat Panel */}
      {selectedConversation ? (
        selectedContact ? (
          <div className={`flex-1 bg-slate-50 dark:bg-[#090d16] flex flex-col overflow-hidden relative transition-all duration-300 ${
          selectedConversation ? 'flex' : 'hidden md:flex'
        }`}>
          {/* Chat Header */}
          <div className="p-4 bg-white/75 dark:bg-slate-900/75 backdrop-blur-md border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between h-[64px] flex-shrink-0 select-none z-10">
            <div className="flex items-center gap-3">
              {/* Back Button for mobile */}
              <button
                onClick={() => setSelectedConversation(null)}
                className="md:hidden p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-550 dark:text-slate-400 mr-1 flex items-center justify-center transition-colors"
                title="Back to inbox"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-700/80 border border-slate-200/50 dark:border-slate-700/50 flex items-center justify-center font-bold text-slate-500 dark:text-slate-300 text-xs shadow-xs select-none">
                {selectedContact.first_name ? selectedContact.first_name.substring(0, 2).toUpperCase() : 'CO'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white leading-tight truncate">
                    {selectedContact.first_name || 'Unknown'} {selectedContact.last_name || ''}
                  </h3>
                  <button
                    onClick={() => {
                      setRenameFirst(selectedContact.first_name || '')
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
                  {!(selectedContact.first_name && (selectedContact.first_name.startsWith('+') || selectedContact.first_name.match(/^\d+$/))) && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 leading-none truncate max-w-[120px] sm:max-w-none">
                      <Phone size={9} className="shrink-0" />
                      <span className="truncate">{selectedContact.phone_number}</span>
                    </p>
                  )}
                  
                  {/* Status Indicator inside header */}
                  {(() => {
                    void windowTick
                    const lastInbound = [...messages]
                      .reverse()
                      .find(m => m.sender_type === 'contact')

                    if (!lastInbound) return <span className="text-[9px] font-bold text-slate-400 dark:text-slate-550 border border-slate-200 dark:border-slate-800 px-1.5 rounded-sm">NO ACTIVE WINDOW</span>

                    const lastInboundTime = new Date(lastInbound.created_at).getTime()
                    const now = Date.now()
                    const windowMs = 24 * 60 * 60 * 1000
                    const elapsed = now - lastInboundTime
                    const remaining = windowMs - elapsed
                    const isOpen = remaining > 0
                    const hoursLeft = Math.floor(remaining / (60 * 60 * 1000))
                    const minutesLeft = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
                    const isClosingSoon = isOpen && remaining < 4 * 60 * 60 * 1000

                    return (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-wide border shrink-0 ${
                        !isOpen
                          ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-650 dark:text-rose-455 border-rose-200/40'
                          : isClosingSoon
                            ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-650 dark:text-amber-450 border-amber-200/40'
                            : 'bg-emerald-50 dark:bg-emerald-950/15 text-emerald-650 dark:text-emerald-400 border-emerald-250/30'
                      }`}>
                        <span className={`w-1 h-1 rounded-full ${!isOpen ? 'bg-rose-500' : isClosingSoon ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                        <span>
                          {!isOpen
                            ? 'Expired'
                            : isClosingSoon
                              ? `${hoursLeft}h ${minutesLeft}m left`
                              : `${hoursLeft}h ${minutesLeft}m left`
                          }
                        </span>
                      </span>
                    )
                  })()}
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
                      : 'bg-indigo-500/10 text-indigo-650 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-500/10 hover:bg-indigo-550/20'
                  }`}
                >
                  <Sparkles size={10} className={loadingSuggestions ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">AI Suggestions</span>
                </button>
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
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
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
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-150 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-950/20">
                <div className="flex items-center gap-1.5 text-[8.5px] font-black text-indigo-650 dark:text-indigo-400 shrink-0 mr-1 bg-indigo-500/10 dark:bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/20">
                  <Sparkles size={10} className="text-indigo-550 dark:text-indigo-400" />
                  <span>AI SUGGESTIONS</span>
                </div>

                {loadingSuggestions && (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400 dark:text-slate-550">
                    <Loader2 size={10} className="animate-spin text-indigo-550" />
                  </div>
                )}

                {aiSuggestionsError && (
                  <span className="text-[9px] font-bold text-rose-500 py-1 truncate" title={aiSuggestionsError}>
                    ⚠️ Error
                  </span>
                )}

                {/* Refresh / Generate Button */}
                <button
                  onClick={() => selectedConversation && fetchSuggestions(selectedConversation)}
                  className="p-1 hover:bg-slate-150 dark:hover:bg-slate-800 text-slate-450 hover:text-indigo-550 dark:hover:text-indigo-400 rounded-full transition-colors cursor-pointer shrink-0 ml-auto flex items-center justify-center"
                  title="Refresh Suggestions"
                >
                  <Sparkles size={11} className={loadingSuggestions ? 'animate-spin' : ''} />
                </button>

                {/* Close Button */}
                <button
                  onClick={() => setShowAiPanel(false)}
                  className="p-1 hover:bg-slate-150 dark:hover:bg-slate-800 text-slate-450 hover:text-rose-550 rounded-full transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                  title="Close panel"
                >
                  <X size={11} />
                </button>
              </div>

              {/* Suggestions list */}
              {loadingSuggestions ? (
                <div className="p-6 flex flex-col items-center justify-center gap-2">
                  <Loader2 size={20} className="animate-spin text-indigo-500" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Analyzing chat...</span>
                </div>
              ) : aiSuggestionsError ? (
                <div className="p-6 text-center text-rose-500">
                  <p className="text-xs font-semibold">Failed to fetch suggestions</p>
                </div>
              ) : aiSuggestions.length === 0 ? (
                <div className="p-6 text-center text-slate-450 dark:text-slate-500">
                  <p className="text-xs font-semibold">No suggestions generated</p>
                  <button
                    onClick={() => selectedConversation && fetchSuggestions(selectedConversation)}
                    className="mt-2.5 px-2.5 py-1.5 bg-indigo-650 hover:bg-indigo-750 text-white rounded-lg text-[9px] font-bold shadow-xs transition-all cursor-pointer"
                  >
                    Generate Smart Replies
                  </button>
                </div>
              ) : (
                <div className="p-2.5 flex flex-col gap-1.5 max-h-60 overflow-y-auto">
                  {aiSuggestions.map((sug, i) => (
                    <div
                      key={i}
                      className="group relative bg-[#f8fafc]/50 dark:bg-slate-850 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/15 border border-slate-100 dark:border-slate-800 hover:border-indigo-500/30 rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.995] shadow-xs"
                      onClick={() => {
                        setMessageText(sug.text)
                        setShowAiPanel(false)
                      }}
                    >
                      <div className="px-2.5 py-2 flex items-start gap-2">
                        <div className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-indigo-500/10 flex items-center justify-center text-[9px] font-bold text-indigo-650 dark:text-indigo-400">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10.5px] leading-normal text-slate-700 dark:text-slate-200 font-medium">
                            {sug.text}
                          </p>
                          {sug.article_title && (
                            <div className="mt-1 flex items-center gap-1">
                              <BookOpen size={8} className="text-indigo-400 shrink-0" />
                              <span className="text-[8px] font-semibold text-indigo-650 dark:text-indigo-405 truncate max-w-[150px]">
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

          {/* Chat Messages */}
          <div id="chat-messages-container" className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 wa-chat-wallpaper z-0">
            {loadingMessages ? (
              <div className="flex flex-col space-y-6 pt-4 relative z-10 w-full max-w-3xl mx-auto opacity-70">
                <div className="flex justify-start w-full">
                  <div className="h-16 w-[65%] sm:w-[45%] bg-slate-200 dark:bg-slate-800 rounded-2xl rounded-tl-none animate-pulse"></div>
                </div>
                <div className="flex justify-end w-full">
                  <div className="h-12 w-[55%] sm:w-[35%] bg-emerald-500/20 dark:bg-emerald-900/40 rounded-2xl rounded-tr-none animate-pulse"></div>
                </div>
                <div className="flex justify-start w-full">
                  <div className="h-24 w-[70%] sm:w-[50%] bg-slate-200 dark:bg-slate-800 rounded-2xl rounded-tl-none animate-pulse"></div>
                </div>
                <div className="flex justify-end w-full">
                  <div className="h-12 w-[60%] sm:w-[40%] bg-emerald-500/20 dark:bg-emerald-900/40 rounded-2xl rounded-tr-none animate-pulse"></div>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 text-xs font-medium space-y-2 select-none relative z-10">
                <MessageCircle size={32} className="text-slate-355" />
                <p>No messages yet. Send a message to start!</p>
              </div>
            ) : (
              <>
                {/* Load Previous Messages Button */}
                {hasMoreMessages && (
                  <div className="flex justify-center pb-4 select-none">
                    <button
                      onClick={loadOlderMessages}
                      disabled={loadingOlderMessages}
                      className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 rounded-full border border-slate-200/50 dark:border-slate-800/80 shadow-xs hover:shadow-md transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
                    >
                      {loadingOlderMessages ? (
                        <Loader2 size={11} className="animate-spin text-emerald-500" />
                      ) : (
                        <Clock size={11} />
                      )}
                      <span>{loadingOlderMessages ? 'Loading older messages...' : 'Load Previous Messages'}</span>
                    </button>
                  </div>
                )}
                {messages.map((msg) => {
                const isUser = msg.sender_type === 'user'
                const mediaType = getMediaType(msg.media_url)
                
                let isReply = false
                let replyId = ''
                let displayBody = msg.body
                
                if (msg.body && msg.body.startsWith('[reply:')) {
                  const match = msg.body.match(/^\[reply:([^\]]+)\](.*)$/)
                  if (match) {
                    isReply = true
                    replyId = match[1]
                    displayBody = match[2]
                  }
                }
                
                const repliedMsg = isReply ? messages.find(m => m.id === replyId) : null

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-200 group relative mb-1.5`}
                  >
                    {/* Hover Reply Button */}
                    <button
                      onClick={() => setReplyingTo(msg)}
                      className={`absolute top-1/2 -translate-y-1/2 p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200/50 dark:border-slate-700/60 rounded-full shadow-sm text-slate-400 hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity z-10 ${
                        isUser ? 'left-[-35px]' : 'right-[-35px]'
                      }`}
                      title="Reply"
                    >
                      <Reply size={12} />
                    </button>

                    <div
                      id={`msg-${msg.id}`}
                      className={`max-w-[70%] sm:max-w-[450px] rounded-2xl border transition-all duration-200 relative text-xs leading-relaxed overflow-hidden ${
                        (mediaType === 'image' || mediaType === 'video')
                          ? (displayBody ? 'p-1 pb-2' : 'p-1')
                          : 'px-4 py-2.5'
                      } ${
                        isUser
                          ? 'bg-gradient-to-br from-emerald-600 to-teal-500 border-emerald-500/25 text-white shadow-emerald-500/10 rounded-tr-none'
                          : 'bg-wa-bubble-in border-wa-border text-wa-text-primary rounded-tl-none shadow-sm dark:shadow-none'
                      }`}
                    >
                      {/* Reply quote preview block */}
                      {isReply && (
                        <div 
                          onClick={() => repliedMsg && scrollToMessage(replyId)}
                          className={`mb-2 p-2 rounded-lg border-l-4 text-[10px] cursor-pointer transition-colors text-left ${
                            (mediaType === 'image' || mediaType === 'video') ? 'mx-2 mt-2' : ''
                          } ${
                            isUser
                              ? 'bg-white/15 border-l-white/60 text-white/90'
                              : 'bg-slate-50 dark:bg-slate-900 border-l-slate-400 dark:border-l-slate-650 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <p className="font-bold mb-0.5 text-slate-900 dark:text-white">
                            {repliedMsg 
                              ? (repliedMsg.sender_type === 'user' ? 'You' : (selectedContact?.first_name || 'Contact'))
                              : 'Message'
                            }
                          </p>
                          <p className="line-clamp-2 italic">
                            {repliedMsg 
                              ? (repliedMsg.body 
                                  ? (repliedMsg.body.startsWith('[reply:') 
                                      ? repliedMsg.body.replace(/^\[reply:[^\]]+\]/, '') 
                                      : repliedMsg.body)
                                  : (repliedMsg.media_url 
                                      ? (getMediaType(repliedMsg.media_url) === 'image' ? '📷 Photo'
                                          : getMediaType(repliedMsg.media_url) === 'video' ? '🎥 Video'
                                          : getMediaType(repliedMsg.media_url) === 'audio' ? '🎵 Voice note'
                                          : '📄 Document')
                                      : 'Media Attachment'
                                    )
                                )
                              : 'Quoted message not found'
                            }
                          </p>
                        </div>
                      )}

                      {/* Media Renderers */}
                      {msg.media_url && (
                        <div className={`max-w-full relative group ${displayBody ? 'mb-1' : ''}`}>
                          {mediaType === 'image' && (
                            <div className="relative rounded-xl overflow-hidden border border-slate-200/10 dark:border-slate-800/10 w-full bg-slate-100 dark:bg-slate-900">
                              <img
                                src={getDisplayUrl(msg.media_url)}
                                alt="Attached Image"
                                className="max-h-80 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                onClick={() => setActiveImageModal(getDisplayUrl(msg.media_url))}
                              />
                              <a
                                href={getDisplayUrl(msg.media_url)}
                                download={getDownloadName(msg.media_url)}
                                className={`absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md ${
                                  isUser
                                    ? 'bg-black/45 hover:bg-black/60 text-white'
                                    : 'bg-white/95 hover:bg-slate-100 dark:bg-slate-800/95 dark:hover:bg-slate-700 text-slate-800 dark:text-white border border-slate-200/50 dark:border-transparent'
                                }`}
                                title="Download Image"
                              >
                                <Download size={13} />
                              </a>
                            </div>
                          )}
                          {mediaType === 'video' && (
                            <div className="relative rounded-xl overflow-hidden border border-slate-200/10 dark:border-slate-800/10 w-full bg-slate-100 dark:bg-slate-900">
                              <video
                                src={getDisplayUrl(msg.media_url)}
                                controls
                                className="max-h-80 object-cover w-full"
                              />
                              <a
                                href={getDisplayUrl(msg.media_url)}
                                download={getDownloadName(msg.media_url)}
                                className={`absolute top-2 right-12 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md ${
                                  isUser
                                    ? 'bg-black/45 hover:bg-black/60 text-white'
                                    : 'bg-white/95 hover:bg-slate-100 dark:bg-slate-800/95 dark:hover:bg-slate-700 text-slate-800 dark:text-white border border-slate-200/50 dark:border-transparent'
                                }`}
                                title="Download Video"
                              >
                                <Download size={13} />
                              </a>
                            </div>
                          )}
                          {mediaType === 'audio' && (
                            <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-slate-900/55 p-1.5 rounded-xl border border-slate-200/15 dark:border-slate-800/15">
                              <audio
                                src={getDisplayUrl(msg.media_url)}
                                controls
                                className="w-56 h-8 rounded-lg outline-none"
                              />
                              <a
                                href={getDisplayUrl(msg.media_url)}
                                download={getDownloadName(msg.media_url)}
                                className={`p-1.5 rounded-lg flex items-center justify-center transition-colors ${
                                  isUser
                                    ? 'hover:bg-black/10 text-white/95'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400'
                                }`}
                                title="Download Audio"
                              >
                                <Download size={13} />
                              </a>
                            </div>
                          )}
                          {mediaType === 'document' && (
                            <a
                              href={getDisplayUrl(msg.media_url)}
                              download={getDownloadName(msg.media_url)}
                              className={`flex items-center justify-between gap-3 p-3 rounded-xl text-[11px] font-bold border transition-all duration-200 ${
                                isUser
                                  ? 'bg-black/15 hover:bg-black/25 border-white/10 text-white'
                                  : 'bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-850 border-slate-150 dark:border-slate-800/80 text-slate-700 dark:text-slate-250'
                              }`}
                              title="Click to Download"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <File size={16} className="flex-shrink-0" />
                                <span className="truncate max-w-[150px]">
                                  {getDownloadName(msg.media_url)}
                                </span>
                              </div>
                              <Download size={13} className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0" />
                            </a>
                          )}
                        </div>
                      )}

                      {/* Text Body */}
                      {displayBody && (
                        <p className={`text-xs font-normal break-words whitespace-pre-wrap leading-relaxed ${
                          (mediaType === 'image' || mediaType === 'video') ? 'px-3 pt-2 pb-0.5' : ''
                        }`}>
                          {displayBody}
                        </p>
                      )}
                      
                      {/* Message Footer (Time & Status) */}
                      <div className={`flex items-center justify-end gap-1 mt-1.5 text-[9px] select-none ${
                        (mediaType === 'image' || mediaType === 'video') ? 'px-3 pb-0.5' : ''
                      } ${
                        isUser ? 'text-white/70' : 'text-slate-400 dark:text-slate-500'
                      }`}>
                        <span>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </span>
                        {isUser && (() => {
                          if (msg.status === 'failed' || msg.status === 'undelivered') {
                            return (
                              <div className="relative group/tooltip flex items-center">
                                <AlertCircle 
                                  size={12} 
                                  className="text-rose-450 ml-0.5 flex-shrink-0 cursor-help"
                                />
                                {msg.error_message && (
                                  <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover/tooltip:block bg-red-650 text-white text-[10px] p-2 rounded shadow-md z-30 whitespace-normal min-w-[200px] max-w-[280px] break-words pointer-events-none text-left">
                                    {msg.error_message}
                                  </div>
                                )}
                              </div>
                            )
                          }
                          if (msg.status === 'read' || msg.read_at) {
                            return <CheckCheck size={13} className="text-sky-300 dark:text-sky-300 ml-0.5 flex-shrink-0" />
                          }
                          if (msg.status === 'delivered') {
                            return <CheckCheck size={13} className="text-white/60 ml-0.5 flex-shrink-0" />
                          }
                          return <Check size={13} className="text-white/60 ml-0.5 flex-shrink-0" />
                        })()}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

          {/* Reply Preview Area */}
          {replyingTo && (
            <div className="p-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-t border-slate-150 dark:border-slate-850 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 border-l-4 border-l-emerald-500 z-10">
              <div className="overflow-hidden text-left">
                <p className="text-[10px] font-bold text-emerald-500">
                  Replying to {replyingTo.sender_type === 'user' ? 'yourself' : (selectedContact?.first_name || 'Contact')}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[500px] italic">
                  {replyingTo.body 
                    ? (replyingTo.body.startsWith('[reply:') 
                        ? replyingTo.body.replace(/^\[reply:[^\]]+\]/, '') 
                        : replyingTo.body)
                    : (replyingTo.media_url 
                        ? (getMediaType(replyingTo.media_url) === 'image' ? '📷 Photo'
                            : getMediaType(replyingTo.media_url) === 'video' ? '🎥 Video'
                            : getMediaType(replyingTo.media_url) === 'audio' ? '🎵 Voice note'
                            : '📄 Document')
                        : 'Media Attachment'
                      )
                  }
                </p>
              </div>
              <button 
                onClick={() => setReplyingTo(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Attachment Preview Area */}
          {attachedFile && (
            <div className="p-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-t border-slate-150 dark:border-slate-850 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 z-10">
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
                  <p className="text-[9px] text-slate-400 dark:text-slate-500">Attached media</p>
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
            const isWhatsApp = selectedContact?.phone_number?.startsWith('whatsapp:') || selectedContact?.whatsapp_number?.startsWith('whatsapp:')
            const isSmsDisabled = !isWhatsApp && !features.enable_sms
            
            const lastInbound = [...messages]
              .reverse()
              .find(m => m.sender_type === 'contact')
            
            let isExpired = false
            if (lastInbound) {
              const lastInboundTime = new Date(lastInbound.created_at).getTime()
              const now = Date.now()
              const windowMs = 24 * 60 * 60 * 1000
              const elapsed = now - lastInboundTime
              const remaining = windowMs - elapsed
              isExpired = remaining <= 0
            }
            
            return (
              <>
                {isSmsDisabled && (
                  <div className="mx-4 mb-2 mt-1 px-3 py-2 rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40 flex items-center gap-2 select-none z-10">
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      ⚠️ SMS Gateway is currently disabled. Please enable it in Settings to message this contact.
                    </span>
                  </div>
                )}
                
                {isExpired && !isSmsDisabled && (
                  <div className="mx-4 mb-2 mt-1 px-3 py-2 rounded-xl border bg-rose-50 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-900/40 flex items-center gap-2 select-none z-10 animate-in fade-in duration-200">
                    <span className="text-[10px] font-bold text-rose-700 dark:text-rose-455">
                      ⚠️ The 24-hour WhatsApp support window has expired. You cannot send free-form messages until the user replies.
                    </span>
                  </div>
                )}
                
                <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/85 backdrop-blur-md z-10 flex-shrink-0">
                  <div className="flex gap-3 items-center max-w-5xl mx-auto w-full">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      disabled={isSmsDisabled || isExpired}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || isSmsDisabled || isExpired}
                      className="hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                      title={isExpired ? "Support window expired" : "Attach Media"}
                    >
                      {uploading ? (
                        <Loader2 className="animate-spin text-slate-400" size={18} />
                      ) : (
                        <Paperclip size={18} className="rotate-45" />
                      )}
                    </button>
                    <input
                      type="text"
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                      placeholder={isSmsDisabled ? "SMS sending is disabled" : isExpired ? "WhatsApp support window is expired" : attachedFile ? "Add a caption..." : "Type a message..."}
                      disabled={isSmsDisabled || isExpired}
                              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 shadow-inner font-medium disabled:opacity-50 transition-all duration-200"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={(!messageText.trim() && !attachedFile) || isSmsDisabled || isExpired}
                      className="bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      ) : (
        <div className="flex-1 bg-slate-50 dark:bg-[#090d16] flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-8 border-l border-slate-100 dark:border-slate-800/80">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-emerald-500" size={24} />
            <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold tracking-wider uppercase">Loading Chat...</p>
          </div>
        </div>
      ) ) : (
        <div className="hidden md:flex flex-1 bg-slate-50 dark:bg-[#090d16] flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-8 border-l border-slate-100 dark:border-slate-800/80 relative">
          {/* Decorative background glow blobs */}
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-emerald-500/5 dark:bg-emerald-500/3 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/5 dark:bg-blue-500/2 rounded-full blur-3xl pointer-events-none" />

          <div className="max-w-md text-center space-y-5 relative z-10">
            <div className="mx-auto h-20 w-20 rounded-2xl bg-white dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-300 border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-200/50 dark:shadow-none animate-bounce duration-1000">
              <MessageCircle size={36} className="text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-slate-800 dark:text-white text-xl font-extrabold tracking-tight">WhatsApp CRM</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed max-w-sm mx-auto font-medium">
                Send and receive messages on your WhatsApp and SMS numbers. A unified dashboard designed for sales, support, and marketing automation.
              </p>
            </div>
            <div className="pt-4 flex items-center justify-center gap-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-3 py-1 rounded-full w-max mx-auto border border-emerald-500/10">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
              <span>Realtime Gateway Active</span>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {activeImageModal && (
        <div 
          onClick={() => setActiveImageModal(null)}
          className="fixed inset-0 bg-[#070a10]/80 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
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
