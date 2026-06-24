'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { ConversationWithContact, User, Contact, Message } from '@/lib/types'
import { 
  Search, Send, Phone, LogOut, Wifi, WifiOff, 
  Paperclip, File, X, ChevronDown, CheckCheck, Check, AlertCircle, Loader2, MessageCircle,
  Edit2, Download, ArrowLeft, Reply, Sparkles, ExternalLink, BookOpen
} from 'lucide-react'
import { AddContactDialog } from '@/components/add-contact-dialog'
import { authSessionManager } from '@/lib/auth-context'

export default function ConversationsPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationWithContact[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageText, setMessageText] = useState('')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  
  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState('')
  const [unreadFilter, setUnreadFilter] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const [convPage, setConvPage] = useState(1)
  const [hasMoreConvs, setHasMoreConvs] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  
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

  // Tick every 60s to keep the 24h free window timer accurate
  useEffect(() => {
    const timer = setInterval(() => setWindowTick(t => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Keep ref in sync for use in callbacks
  useEffect(() => {
    selectedConvRef.current = selectedConversation
  }, [selectedConversation])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Data Fetching ───

  const fetchConversations = useCallback(async (
    orgId: string, 
    pageNum = 1, 
    searchVal = '', 
    unreadOnly = false
  ): Promise<{ conversations: ConversationWithContact[]; count: number; hasMore: boolean }> => {
    const res = await fetch(`/api/conversations?organizationId=${orgId}&page=${pageNum}&limit=12&search=${encodeURIComponent(searchVal)}&unread=${unreadOnly}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch conversations')
    return { 
      conversations: data.conversations || [], 
      count: data.count || 0,
      hasMore: data.hasMore || false 
    }
  }, [])

  const fetchContacts = useCallback(async (orgId: string): Promise<Contact[]> => {
    const res = await fetch(`/api/contacts?organizationId=${orgId}&limit=100`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch contacts')
    return data.contacts || []
  }, [])

  const fetchMessages = useCallback(async (convId: string): Promise<Message[]> => {
    const res = await fetch(`/api/messages?conversationId=${convId}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch messages')
    return data.messages || []
  }, [])

  // ─── State Update Helpers ───

  const loadConversations = useCallback(async (
    orgId: string, 
    pageNum = 1, 
    append = false, 
    searchVal = searchTerm, 
    unreadOnly = unreadFilter
  ) => {
    try {
      if (pageNum > 1) setLoadingMore(true)
      const result = await fetchConversations(orgId, pageNum, searchVal, unreadOnly)
      
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

        if (prev && (append || result.conversations.some((c) => c.id === prev))) return prev
        return !append && result.conversations.length > 0 ? result.conversations[0].id : prev
      })
    } catch (err) {
      console.error('[Dashboard] Error loading conversations:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [fetchConversations, searchTerm, unreadFilter])

  const loadContacts = useCallback(async (orgId: string) => {
    try {
      const data = await fetchContacts(orgId)
      setContacts(data)
    } catch (err) {
      console.error('[Dashboard] Error loading contacts:', err)
    }
  }, [fetchContacts])

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const data = await fetchMessages(convId)
      setMessages(data)
    } catch (err) {
      console.error('[Dashboard] Error loading messages:', err)
    }
  }, [fetchMessages])

  const reloadAll = useCallback(() => {
    if (!user) return
    setConvPage(1)
    loadConversations(user.organization_id, 1, false)
    loadContacts(user.organization_id)
  }, [user, loadConversations, loadContacts])

  const clearUnreadCount = useCallback(async (convId: string) => {
    try {
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
      }
    } catch (err) {
      console.error('[Dashboard] Error resetting unread count:', err)
    }
  }, [])

  // ─── Initial Data Load ───

  useEffect(() => {
    async function init() {
      try {
        await restoreSupabaseSession()

        const isLoggedIn = authSessionManager.isLoggedIn()
        const authUser = authSessionManager.getUser()

        if (!isLoggedIn || !authUser) {
          router.push('/login')
          return
        }

        const userData = await ensureUserProfile(authUser.id, authUser.email || '')
        if (!userData) {
          console.error('[Dashboard] Failed to load user profile')
          return
        }

        setUser(userData)

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
          loadConversations(userData.organization_id, 1, false),
          loadContacts(userData.organization_id),
        ])
      } catch (error) {
        console.error('[Dashboard] Init error:', error)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [router, loadConversations, loadContacts])

  // ─── Search & Filter Change Reloads ───

  useEffect(() => {
    if (!user) return
    const delayDebounceFn = setTimeout(() => {
      setConvPage(1)
      loadConversations(user.organization_id, 1, false, searchTerm, unreadFilter)
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [searchTerm, unreadFilter, user, loadConversations])

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
          await loadConversations(orgId, 1, false)
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
              loadConversations(orgId, 1, false)
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
  }, [user, loadConversations, loadContacts])

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
      alert('File upload failed. Please try again.')
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
      authSessionManager.clearSession()
      router.push('/login')
    } catch (error) {
      console.error('[Dashboard] Logout error:', error)
    } finally {
      setLogoutLoading(false)
    }
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
    const parts = url.split('/')
    const lastPart = parts[parts.length - 1] || 'download'
    const [name, hash] = lastPart.split('#')
    if (hash && hash.startsWith('media.')) {
      const ext = hash.split('.').pop()
      return `${name}.${ext}`
    }
    return name
  }

  const getMediaType = (url: string | null): 'image' | 'video' | 'audio' | 'document' | null => {
    if (!url) return null
    const ext = url.split('.').pop()?.toLowerCase() || ''
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image'
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'amr'].includes(ext)) return 'audio'
    return 'document'
  }

  // ─── Sorting ───

  const sortedConversations = [...conversations].sort((a, b) => {
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return sortBy === 'newest' ? bTime - aTime : aTime - bTime
  })

  const selectedConvData = conversations.find((c) => c.id === selectedConversation)
  const selectedContact = selectedConvData?.contact

  // ─── Rendering ───

  if (loading) {
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
            <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200/30 dark:border-slate-700/30">
              <button
                onClick={() => setUnreadFilter(false)}
                className={`px-3 py-1.5 rounded-lg text-[11px] transition-all font-semibold ${
                  !unreadFilter 
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setUnreadFilter(true)}
                className={`px-3 py-1.5 rounded-lg text-[11px] transition-all font-semibold ${
                  unreadFilter 
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Unread
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
          {sortedConversations.length === 0 ? (
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
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv.id)}
                  className={`w-full p-3 text-left flex items-center gap-3 rounded-xl transition-all duration-200 border relative ${
                    isSelected
                      ? 'bg-slate-100/80 dark:bg-slate-800/70 border-slate-200/50 dark:border-slate-700/50 shadow-xs'
                      : 'bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800/30 border-transparent'
                  }`}
                >
                  {/* Left Accent Indicator inside selected item */}
                  {isSelected && (
                    <div className="absolute left-1 top-3.5 bottom-3.5 w-[3px] bg-gradient-to-b from-emerald-500 to-teal-400 rounded-full" />
                  )}

                  {/* Avatar with status indicator */}
                  <div className="relative flex-shrink-0">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-700/80 flex items-center justify-center font-bold text-slate-500 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50 text-xs select-none shadow-xs">
                      {contactName.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-[#111b21] rounded-full shadow-sm" />
                  </div>

                  {/* Conv metadata */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-xs text-slate-850 dark:text-slate-100 truncate">
                        {contactName}
                      </p>
                      {conv.last_message_at && (
                        <p className={`text-[9px] font-bold ${conv.unread_count > 0 ? 'text-emerald-550 dark:text-emerald-400' : 'text-slate-450 dark:text-slate-500'}`}>
                          {new Date(conv.last_message_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </p>
                      )}
                    </div>
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
                  
                  {conv.unread_count > 0 && (
                    <span className="flex-shrink-0 bg-gradient-to-tr from-emerald-500 to-teal-500 text-white text-[9px] font-black rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center shadow-sm shadow-emerald-500/25">
                      {conv.unread_count}
                    </span>
                  )}
                </button>
              )
            })
          )}

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
      </div>

      {/* Main Chat Panel */}
      {selectedContact ? (
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
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white leading-tight">
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
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-emerald-500 transition-colors"
                    title="Rename Contact"
                  >
                    <Edit2 size={11} />
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 mt-0.5 leading-none">
                  <Phone size={9} />
                  {selectedContact.phone_number}
                </p>
              </div>
            </div>

            {/* Auto-Reply Chatbot Toggle Override */}
            {selectedConversation && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 select-none">
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

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 wa-chat-wallpaper z-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 text-xs font-medium space-y-2 select-none relative z-10">
                <MessageCircle size={32} className="text-slate-355" />
                <p>No messages yet. Send a message to start!</p>
              </div>
            ) : (
              messages.map((msg) => {
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
                      className={`max-w-[65%] rounded-2xl px-4 py-2.5 shadow-xs border transition-all duration-200 relative text-xs leading-relaxed ${
                        isUser
                          ? 'bg-gradient-to-br from-emerald-600 to-teal-500 border-emerald-500/25 text-white shadow-emerald-500/10 rounded-tr-none'
                          : 'bg-white/95 dark:bg-slate-805 border-slate-100 dark:border-slate-800/80 text-slate-800 dark:text-slate-100 rounded-tl-none shadow-slate-200/50 dark:shadow-none'
                      }`}
                    >
                      {/* Reply quote preview block */}
                      {isReply && (
                        <div 
                          onClick={() => repliedMsg && scrollToMessage(replyId)}
                          className={`mb-2 p-2 rounded-lg border-l-4 text-[10px] cursor-pointer transition-colors text-left ${
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
                        <div className="mb-2 max-w-full relative group">
                          {mediaType === 'image' && (
                            <div className="relative rounded-xl overflow-hidden border border-slate-200/10 dark:border-slate-800/10">
                              <img
                                src={getDisplayUrl(msg.media_url)}
                                alt="Attached Image"
                                className="max-h-60 object-cover cursor-pointer hover:opacity-90 transition-opacity"
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
                            <div className="relative rounded-xl overflow-hidden border border-slate-200/10 dark:border-slate-800/10">
                              <video
                                src={getDisplayUrl(msg.media_url)}
                                controls
                                className="max-h-60 object-cover w-full"
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
                      {displayBody && <p className="text-xs font-normal break-words whitespace-pre-wrap leading-relaxed">{displayBody}</p>}
                      
                      {/* Message Footer (Time & Status) */}
                      <div className={`flex items-center justify-end gap-1 mt-1.5 text-[9px] select-none ${
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
              })
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

          {/* AI Suggested Replies (RAG) */}
          {features.enable_ai && selectedConversation && (
            <div className="border-t border-slate-100 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md select-none z-10">
              {!showAiPanel ? (
                /* Collapsed State Bar */
                <div 
                  onClick={() => {
                    setShowAiPanel(true)
                    if (aiSuggestions.length === 0) {
                      fetchSuggestions(selectedConversation)
                    }
                  }}
                  className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors duration-200"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-650 dark:text-indigo-400">
                    <Sparkles size={12} className="text-indigo-500 animate-pulse" />
                    <span>SHOW AI SUGGESTIONS</span>
                  </div>
                  <span className="text-[9px] uppercase font-bold text-slate-400 dark:text-slate-500 opacity-80 hover:opacity-100 transition-opacity">
                    Click to expand
                  </span>
                </div>
              ) : (
                /* Expanded State Panel */
                <>
                  {/* Header Bar */}
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-150 dark:border-slate-800/50">
                    <div className="flex items-center gap-1.5 text-[9px] font-black text-indigo-600 dark:text-indigo-400 shrink-0 mr-1 bg-indigo-500/10 dark:bg-indigo-500/15 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
                      <Sparkles size={11} className="text-indigo-550 dark:text-indigo-400" />
                      <span>AI SUGGESTIONS</span>
                    </div>

                    {loadingSuggestions && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-550 py-1">
                        <Loader2 size={11} className="animate-spin text-indigo-550" />
                        <span>Analyzing knowledge base...</span>
                      </div>
                    )}

                    {aiSuggestionsError && (
                      <span className="text-[10px] font-bold text-rose-500 py-1 truncate max-w-md" title={aiSuggestionsError}>
                        ⚠️ {aiSuggestionsError}
                      </span>
                    )}

                    {/* Refresh / Generate Button */}
                    <button
                      onClick={() => fetchSuggestions(selectedConversation)}
                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-550 dark:hover:text-indigo-400 rounded-full transition-colors cursor-pointer shrink-0 ml-auto flex items-center justify-center"
                      title={aiSuggestions.length > 0 ? 'Refresh Suggestions' : 'Generate Smart Replies'}
                    >
                      <Sparkles size={12} className={loadingSuggestions ? 'animate-spin' : ''} />
                    </button>

                    {/* Close / Dismiss Button */}
                    <button
                      onClick={() => setShowAiPanel(false)}
                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-500 rounded-full transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                      title="Close suggestions"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Suggestion Cards */}
                  {!loadingSuggestions && aiSuggestions.length > 0 && (
                    <div className="px-4 py-3 flex flex-col gap-2 max-h-60 overflow-y-auto">
                      {aiSuggestions.map((sug, i) => (
                        <div
                          key={i}
                          className="group relative bg-white/90 dark:bg-slate-850/90 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/15 border border-slate-150 dark:border-slate-800 hover:border-indigo-500/30 dark:hover:border-indigo-500/30 rounded-xl transition-all duration-200 cursor-pointer active:scale-[0.995] shadow-xs hover:shadow-md"
                          onClick={() => setMessageText(sug.text)}
                        >
                          {/* Main suggestion text */}
                          <div className="px-3.5 py-2.5 flex items-start gap-2.5">
                            <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-indigo-550/10 dark:bg-indigo-500/15 flex items-center justify-center text-[10px] font-bold text-indigo-650 dark:text-indigo-400 border border-indigo-500/10">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] leading-relaxed text-slate-700 dark:text-slate-200 font-medium">
                                {sug.text}
                              </p>
                              {/* Source article badge */}
                              {sug.article_title && (
                                <div className="mt-2 flex items-center gap-1.5">
                                  <BookOpen size={9} className="text-indigo-500 shrink-0" />
                                  <span className="text-[9px] font-semibold text-indigo-650 dark:text-indigo-400 truncate">
                                    {sug.article_title}
                                  </span>
                                  {sug.source_url && (
                                    <a
                                      href={sug.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="shrink-0 flex items-center gap-0.5 text-[8.5px] text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 font-medium underline decoration-dotted"
                                    >
                                      <ExternalLink size={8} />
                                      Source
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Use this reply arrow */}
                            <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Send size={12} className="text-indigo-500" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty state: Generate button */}
                  {!loadingSuggestions && aiSuggestions.length === 0 && !aiSuggestionsError && (
                    <div className="px-4 pb-3 pt-1">
                      <button
                        onClick={() => fetchSuggestions(selectedConversation)}
                        className="px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 border border-slate-200/60 dark:border-slate-750 rounded-xl text-[10px] font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer shadow-xs transition-all flex items-center gap-1.5 active:scale-[0.98]"
                      >
                        <Sparkles size={11} />
                        <span>Generate Smart Replies</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* WhatsApp 24h Free Window Status Banner */}
          {(() => {
            // Reference windowTick to force re-render every 60s
            void windowTick
            // Find the last inbound message from customer (sender_type === 'contact')
            const lastInbound = [...messages]
              .reverse()
              .find(m => m.sender_type === 'contact')

            if (!lastInbound) return null

            const lastInboundTime = new Date(lastInbound.created_at).getTime()
            const now = Date.now()
            const windowMs = 24 * 60 * 60 * 1000 // 24 hours
            const elapsed = now - lastInboundTime
            const remaining = windowMs - elapsed
            const isOpen = remaining > 0
            const hoursLeft = Math.floor(remaining / (60 * 60 * 1000))
            const minutesLeft = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
            const isClosingSoon = isOpen && remaining < 4 * 60 * 60 * 1000 // < 4 hours

            // Colors based on status
            const bgColor = !isOpen
              ? 'bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/35'
              : isClosingSoon
                ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/35'
                : 'bg-emerald-50 dark:bg-emerald-950/15 border-emerald-200/60 dark:border-emerald-900/35'
            const textColor = !isOpen
              ? 'text-red-650 dark:text-red-400'
              : isClosingSoon
                ? 'text-amber-650 dark:text-amber-455'
                : 'text-emerald-650 dark:text-emerald-400'
            const subTextColor = !isOpen
              ? 'text-red-500/80 dark:text-red-400/60'
              : isClosingSoon
                ? 'text-amber-500/80 dark:text-amber-400/60'
                : 'text-emerald-555/80 dark:text-emerald-400/60'

            return (
              <div className={`mx-4 mb-2 mt-2 px-3 py-2 rounded-xl border backdrop-blur-sm shadow-xs ${bgColor} flex items-center justify-between gap-2 select-none z-10`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-bold ${textColor} truncate`}>
                    {!isOpen
                      ? '⛔ Free window expired — Template messages only'
                      : isClosingSoon
                        ? `⏳ Window closing soon — ${hoursLeft}h ${minutesLeft}m left`
                        : `✅ Free window open — ${hoursLeft}h ${minutesLeft}m remaining`
                    }
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-[9px] font-semibold ${subTextColor} hidden sm:inline`}>
                    {!isOpen
                      ? 'Only approved templates can be sent'
                      : 'Free-form replies are enabled'
                    }
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Chat Input controls */}
          {(() => {
            const isWhatsApp = selectedContact?.phone_number?.startsWith('whatsapp:') || selectedContact?.whatsapp_number?.startsWith('whatsapp:')
            const isSmsDisabled = !isWhatsApp && !features.enable_sms
            
            return (
              <>
                {isSmsDisabled && (
                  <div className="mx-4 mb-2 mt-1 px-3 py-2 rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40 flex items-center gap-2 select-none z-10">
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      ⚠️ SMS Gateway is currently disabled. Please enable it in Settings to message this contact.
                    </span>
                  </div>
                )}
                
                <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/85 backdrop-blur-md z-10">
                  <div className="flex gap-3 items-center max-w-5xl mx-auto w-full">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      disabled={isSmsDisabled}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || isSmsDisabled}
                      className="hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                      title="Attach Media"
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
                      placeholder={isSmsDisabled ? "SMS sending is disabled" : attachedFile ? "Add a caption..." : "Type a message..."}
                      disabled={isSmsDisabled}
                      className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 shadow-inner font-medium disabled:opacity-50 transition-all duration-200"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={(!messageText.trim() && !attachedFile) || isSmsDisabled}
                      className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
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
