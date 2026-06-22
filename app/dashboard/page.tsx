'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { ConversationWithContact, User, Contact, Message } from '@/lib/types'
import { 
  Search, Send, Phone, LogOut, Wifi, WifiOff, 
  Paperclip, File, X, ChevronDown, CheckCheck, Loader2, MessageCircle,
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
  const fetchSuggestionsRef = useRef<any>(null)

  const [features, setFeatures] = useState({
    enable_ai: true,
    enable_email: true,
    enable_messages: true,
    enable_phone_calls: true,
  })
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedConvRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
          .select('enable_ai, enable_email, enable_messages, enable_phone_calls')
          .eq('id', userData.organization_id)
          .maybeSingle()
        if (orgData) {
          setFeatures({
            enable_ai: orgData.enable_ai !== false,
            enable_email: orgData.enable_email !== false,
            enable_messages: orgData.enable_messages !== false,
            enable_phone_calls: orgData.enable_phone_calls !== false,
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
          <Loader2 className="animate-spin text-emerald-500" size={36} />
          <p className="text-sm text-slate-500 font-medium">Initializing workspace...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-[#efeae2] dark:bg-[#0b141a] flex overflow-hidden animate-in fade-in duration-300 relative font-sans text-[#111b21] dark:text-white">
      {/* Sidebar: Conversations List */}
      <div className={`w-full md:w-[350px] bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#202d36] flex flex-col overflow-hidden transition-all duration-300 ${
        selectedConversation ? 'hidden md:flex' : 'flex'
      }`}>
        {/* Sidebar Header */}
        <div className="p-3 border-b border-[#e9edef] dark:border-[#202d36] space-y-3 bg-[#f0f2f5] dark:bg-[#111b21]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#111b21] dark:text-white">Inbox</h2>
              <span className="flex items-center" title={`Realtime: ${realtimeStatus}`}>
                {realtimeStatus === 'connected' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
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
          <div className="relative">
            <Search size={15} className="absolute left-3 top-3 text-[#667781] dark:text-[#8696a0]" />
            <input
              type="text"
              placeholder="Search or start new chat"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] border border-transparent rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] text-xs font-semibold placeholder-[#667781] dark:placeholder-[#8696a0] text-[#111b21] dark:text-white transition-all"
            />
          </div>

          {/* Filters and Sort */}
          <div className="flex items-center justify-between text-xs font-bold text-[#667781] dark:text-[#8696a0]">
            <div className="flex gap-2">
              <button
                onClick={() => setUnreadFilter(false)}
                className={`px-3 py-1 rounded-full text-[11px] transition-all font-bold ${
                  !unreadFilter 
                    ? 'bg-[#e7f7f4] dark:bg-[#002a22] text-[#008069] dark:text-[#00e676]' 
                    : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0] hover:bg-[#dfe5e7] dark:hover:bg-[#2a3942]'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setUnreadFilter(true)}
                className={`px-3 py-1 rounded-full text-[11px] transition-all font-bold ${
                  unreadFilter 
                    ? 'bg-[#e7f7f4] dark:bg-[#002a22] text-[#008069] dark:text-[#00e676]' 
                    : 'bg-[#f0f2f5] dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0] hover:bg-[#dfe5e7] dark:hover:bg-[#2a3942]'
                }`}
              >
                Unread
              </button>
            </div>
            <button
              onClick={() => setSortBy((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              className="flex items-center gap-1 bg-[#f0f2f5] dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0] hover:bg-[#dfe5e7] dark:hover:bg-[#2a3942] px-2.5 py-1 rounded-full transition-all"
            >
              <span>{sortBy === 'newest' ? 'Newest' : 'Oldest'}</span>
              <ChevronDown size={12} className={sortBy === 'oldest' ? 'rotate-180' : ''} />
            </button>
          </div>
        </div>

        {/* Conversations list area */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#e9edef] dark:divide-[#202d36]/50 bg-white dark:bg-[#111b21]">
          {sortedConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-medium space-y-2">
              <p>No conversations found.</p>
              <p className="text-[10px] text-slate-600">New WhatsApp contacts appear here.</p>
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
                  className={`w-full p-3 text-left flex items-center gap-3 transition-all border-b border-[#e9edef] dark:border-[#202d36]/40 ${
                    isSelected
                      ? 'bg-[#f0f2f5] dark:bg-[#2a3942] border-l-4 border-l-[#00a884]'
                      : 'bg-white dark:bg-[#111b21] hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]/50'
                  }`}
                >
                  {/* Outlined Avatar with green indicator */}
                  <div className="relative flex-shrink-0">
                    <div className="h-11 w-11 rounded-full bg-[#dfe5e7] dark:bg-[#202c33] flex items-center justify-center font-bold text-[#667781] dark:text-[#8696a0] border border-[#e9edef] dark:border-[#2a3942] text-xs select-none">
                      {contactName.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="absolute bottom-0 right-0 h-3 w-3 bg-[#00a884] border-2 border-white dark:border-[#111b21] rounded-full" />
                  </div>

                  {/* Conv metadata */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-[13px] text-[#111b21] dark:text-white truncate">
                        {contactName}
                      </p>
                      {conv.last_message_at && (
                        <p className={`text-[10px] font-bold ${conv.unread_count > 0 ? 'text-[#008069] dark:text-[#00e676]' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                          {new Date(conv.last_message_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-[#667781] dark:text-[#8696a0] mt-0.5 font-medium min-w-0">
                      {conv.last_message ? (
                        <>
                          {conv.last_message.sender_type === 'user' && (
                            <CheckCheck 
                              size={15} 
                              className={`flex-shrink-0 ${
                                conv.last_message.read_at ? 'text-[#53bdeb]' : 'text-[#667781] dark:text-[#8696a0]'
                              }`} 
                            />
                          )}
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
                    <span className="flex-shrink-0 bg-[#00a884] text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center shadow-sm">
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
                className="text-xs text-[#008069] dark:text-[#00e676] hover:text-[#00a884] font-bold px-4 py-2 hover:bg-[#e9edef] dark:hover:bg-[#202c33] rounded-lg transition-all inline-flex items-center gap-1.5"
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
        <div className={`flex-1 bg-[#efeae2] dark:bg-[#0b141a] flex flex-col overflow-hidden relative transition-all duration-300 ${
          selectedConversation ? 'flex' : 'hidden md:flex'
        }`}>
          {/* Chat Header */}
          <div className="p-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between h-[59px] flex-shrink-0 select-none">
            <div className="flex items-center gap-3">
              {/* Back Button for mobile */}
              <button
                onClick={() => setSelectedConversation(null)}
                className="md:hidden p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-lg text-[#667781] dark:text-[#8696a0] mr-1 flex items-center justify-center transition-colors"
                title="Back to inbox"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="h-10 w-10 rounded-full bg-[#dfe5e7] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] flex items-center justify-center font-bold text-[#667781] dark:text-[#8696a0] text-sm">
                {selectedContact.first_name ? selectedContact.first_name.substring(0, 2).toUpperCase() : 'CO'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-bold text-[#111b21] dark:text-white leading-tight">
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
                    className="p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-lg text-[#667781] dark:text-[#8696a0] hover:text-[#00a884] transition-colors"
                    title="Rename Contact"
                  >
                    <Edit2 size={12} />
                  </button>
                </div>
                <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-semibold flex items-center gap-1 mt-0.5 leading-none">
                  <Phone size={10} />
                  {selectedContact.phone_number}
                </p>
              </div>
            </div>

            {/* Auto-Reply Chatbot Toggle Override */}
            {selectedConversation && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] select-none">
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
                      ? 'bg-[#00a884]'
                      : 'bg-[#2a3942] dark:bg-slate-700'
                  }`}
                  title={
                    conversations.find((c) => c.id === selectedConversation)?.auto_reply_enabled !== false
                      ? 'AI chatbot will automatically reply to customer messages'
                      : 'Chatbot auto-reply is disabled for this contact'
                  }
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
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
          <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-[#efeae2] dark:bg-[#0b141a] wa-chat-wallpaper">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs font-medium space-y-1">
                <MessageCircle size={28} className="text-slate-600" />
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
                      className={`absolute top-1/2 -translate-y-1/2 p-1.5 bg-white dark:bg-[#1f2c34] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-full shadow-sm text-[#667781] dark:text-[#8696a0] hover:text-[#00a884] opacity-0 group-hover:opacity-100 transition-opacity z-10 ${
                        isUser ? 'left-[-35px]' : 'right-[-35px]'
                      }`}
                      title="Reply"
                    >
                      <Reply size={12} />
                    </button>

                    <div
                      id={`msg-${msg.id}`}
                      className={`max-w-[65%] rounded-lg px-3 py-1.5 shadow-sm border transition-all duration-200 relative text-[13px] leading-snug ${
                        isUser
                          ? 'bg-[#d9fdd3] dark:bg-[#005c4b] border-[#d9fdd3] dark:border-[#005c4b] text-[#111b21] dark:text-white rounded-tr-none'
                          : 'bg-white dark:bg-[#202c33] border-white dark:border-[#202c33] text-[#111b21] dark:text-white rounded-tl-none'
                      }`}
                    >
                      {/* Reply quote preview block */}
                      {isReply && (
                        <div 
                          onClick={() => repliedMsg && scrollToMessage(replyId)}
                          className={`mb-1.5 p-1.5 rounded-lg border-l-4 text-[10px] cursor-pointer transition-colors text-left ${
                            isUser
                              ? 'bg-[#c7f1be] dark:bg-[#004d40] border-l-[#00a884] text-slate-700 dark:text-slate-300'
                              : 'bg-[#f0f2f5] dark:bg-[#1f2c34] border-l-[#8696a0] text-slate-600 dark:text-[#8696a0]'
                          }`}
                        >
                          <p className="font-bold mb-0.5 text-[#111b21] dark:text-white">
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
                            <div className="relative rounded-xl overflow-hidden border border-slate-700/10">
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
                                    ? 'bg-[#004d40]/80 hover:bg-[#005c4b]/90 text-white'
                                    : 'bg-white/90 hover:bg-[#f0f2f5]/90 dark:bg-[#1f2c34]/90 dark:hover:bg-[#202c33]/90 text-[#111b21] dark:text-white border border-[#e9edef] dark:border-transparent'
                                }`}
                                title="Download Image"
                              >
                                <Download size={14} />
                              </a>
                            </div>
                          )}
                          {mediaType === 'video' && (
                            <div className="relative rounded-xl overflow-hidden border border-slate-700/10">
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
                                    ? 'bg-[#004d40]/80 hover:bg-[#005c4b]/90 text-white'
                                    : 'bg-white/90 hover:bg-[#f0f2f5]/90 dark:bg-[#1f2c34]/90 dark:hover:bg-[#202c33]/90 text-[#111b21] dark:text-white border border-[#e9edef] dark:border-transparent'
                                }`}
                                title="Download Video"
                              >
                                <Download size={14} />
                              </a>
                            </div>
                          )}
                          {mediaType === 'audio' && (
                            <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-[#1f2c34]/50 p-1.5 rounded-xl">
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
                                    ? 'hover:bg-[#004d40] text-[#00e676]'
                                    : 'hover:bg-[#e9edef] dark:hover:bg-[#202c33] text-[#667781] dark:text-[#8696a0]'
                                }`}
                                title="Download Audio"
                              >
                                <Download size={14} />
                              </a>
                            </div>
                          )}
                          {mediaType === 'document' && (
                            <a
                              href={getDisplayUrl(msg.media_url)}
                              download={getDownloadName(msg.media_url)}
                              className={`flex items-center justify-between gap-3 p-3 rounded-xl text-xs font-bold border transition-colors ${
                                isUser
                                  ? 'bg-[#004d40] hover:bg-[#004d40]/80 border-[#00a884]/20 text-white'
                                  : 'bg-[#f0f2f5] dark:bg-[#1f2c34] hover:bg-[#e9edef] dark:hover:bg-[#202c33] border-[#e9edef] dark:border-[#2a3942] text-[#111b21] dark:text-white'
                              }`}
                              title="Click to Download"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <File size={16} className="flex-shrink-0" />
                                <span className="truncate max-w-[150px]">
                                  {getDownloadName(msg.media_url)}
                                </span>
                              </div>
                              <Download size={14} className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0" />
                            </a>
                          )}
                        </div>
                      )}

                      {/* Text Body */}
                      {displayBody && <p className="text-[13px] font-normal break-words whitespace-pre-wrap leading-snug">{displayBody}</p>}
                      
                      {/* Message Footer (Time & Status) */}
                      <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-[#667781] dark:text-[#8696a0] select-none">
                        <span>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </span>
                        {isUser && <CheckCheck size={14} className="text-[#53bdeb] ml-0.5 flex-shrink-0" />}
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
            <div className="p-3 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 border-l-4 border-l-[#00a884]">
              <div className="overflow-hidden text-left">
                <p className="text-[10px] font-bold text-[#00e676]">
                  Replying to {replyingTo.sender_type === 'user' ? 'yourself' : (selectedContact?.first_name || 'Contact')}
                </p>
                <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate max-w-[500px] italic">
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
                className="p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-full transition-colors text-[#667781] dark:text-slate-400 hover:text-[#111b21] dark:hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Attachment Preview Area */}
          {attachedFile && (
            <div className="p-3 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-3">
                {attachedFile.type.startsWith('image/') ? (
                  <img 
                    src={attachedFile.url} 
                    alt="Upload preview" 
                    className="h-10 w-10 object-cover rounded-lg border border-slate-700"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-indigo-955 flex items-center justify-center text-indigo-400 border border-indigo-900">
                    <File size={18} />
                  </div>
                )}
                <div className="overflow-hidden">
                  <p className="text-[10px] font-bold truncate text-[#111b21] dark:text-white max-w-[200px]">
                    {attachedFile.name}
                  </p>
                  <p className="text-[9px] text-[#667781] dark:text-[#8696a0]">Attached media</p>
                </div>
              </div>
              <button 
                onClick={() => setAttachedFile(null)}
                className="p-1 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] rounded-full transition-colors text-[#667781] dark:text-slate-400 hover:text-[#111b21] dark:hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* AI Suggested Replies (RAG) */}
          {features.enable_ai && selectedConversation && (
            <div className="border-t border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#202c33] select-none">
              {!showAiPanel ? (
                /* Collapsed State Bar */
                <div 
                  onClick={() => {
                    setShowAiPanel(true)
                    if (aiSuggestions.length === 0) {
                      fetchSuggestions(selectedConversation)
                    }
                  }}
                  className="px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#e9edef] dark:hover:bg-[#2a3942] transition-colors"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-black text-[#008069] dark:text-[#00e676]">
                    <Sparkles size={11} className="text-[#008069] dark:text-[#00e676]" />
                    <span>SHOW AI SUGGESTIONS</span>
                  </div>
                  <span className="text-[9px] uppercase font-bold text-[#667781] dark:text-[#8696a0] opacity-75 hover:opacity-100 transition-opacity">
                    Click to expand
                  </span>
                </div>
              ) : (
                /* Expanded State Panel */
                <>
                  {/* Header Bar */}
                  <div className="px-3 pt-2 pb-1 flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-[#008069] dark:text-[#00e676] shrink-0 mr-1 bg-[#e7f7f4] dark:bg-[#002a22] px-2 py-0.5 rounded-md border border-[#00a884]/15">
                      <Sparkles size={11} className="text-[#008069] dark:text-[#00e676]" />
                      <span>AI SUGGESTIONS</span>
                    </div>

                    {loadingSuggestions && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#667781] dark:text-[#8696a0] py-1">
                        <Loader2 size={11} className="animate-spin text-[#00a884]" />
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
                      className="p-1.5 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] hover:text-[#00a884] dark:hover:text-[#00e676] rounded-full transition-colors cursor-pointer shrink-0 ml-auto flex items-center justify-center"
                      title={aiSuggestions.length > 0 ? 'Refresh Suggestions' : 'Generate Smart Replies'}
                    >
                      <Sparkles size={12} className={loadingSuggestions ? 'animate-spin' : ''} />
                    </button>

                    {/* Close / Dismiss Button */}
                    <button
                      onClick={() => setShowAiPanel(false)}
                      className="p-1.5 hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] hover:text-rose-500 rounded-full transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                      title="Close suggestions"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Suggestion Cards */}
                  {!loadingSuggestions && aiSuggestions.length > 0 && (
                    <div className="px-3 pb-2 flex flex-col gap-1.5">
                      {aiSuggestions.map((sug, i) => (
                        <div
                          key={i}
                          className="group relative bg-white dark:bg-[#1f2c34] hover:bg-[#f5f6f6] dark:hover:bg-[#26353d] border border-[#e9edef] dark:border-[#2a3942] hover:border-[#00a884]/30 rounded-lg transition-all cursor-pointer active:scale-[0.995] shadow-sm hover:shadow"
                          onClick={() => setMessageText(sug.text)}
                        >
                          {/* Main suggestion text */}
                          <div className="px-3 py-2 flex items-start gap-2">
                            <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-[#e7f7f4] dark:bg-[#002a22] flex items-center justify-center text-[10px] font-bold text-[#008069] dark:text-[#00e676]">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11.5px] leading-relaxed text-[#111b21] dark:text-slate-200 font-medium">
                                {sug.text}
                              </p>
                              {/* Source article badge */}
                              {sug.article_title && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <BookOpen size={10} className="text-[#00a884] shrink-0" />
                                  <span className="text-[9.5px] font-semibold text-[#008069] dark:text-[#00e676] truncate">
                                    {sug.article_title}
                                  </span>
                                  {sug.source_url && (
                                    <a
                                      href={sug.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="shrink-0 flex items-center gap-0.5 text-[9px] text-[#667781] dark:text-[#8696a0] hover:text-[#00a884] dark:hover:text-[#00e676] font-medium underline decoration-dotted"
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
                              <Send size={12} className="text-[#00a884]" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty state: Generate button */}
                  {!loadingSuggestions && aiSuggestions.length === 0 && !aiSuggestionsError && (
                    <div className="px-3 pb-2">
                      <button
                        onClick={() => fetchSuggestions(selectedConversation)}
                        className="px-3 py-1.5 bg-white dark:bg-[#1f2c34] hover:bg-[#f5f6f6] dark:hover:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-lg text-[10px] font-bold text-[#008069] dark:text-[#00e676] cursor-pointer shadow-sm transition-all flex items-center gap-1.5 active:scale-[0.98]"
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

          {/* Chat Input controls */}
          <div className="p-3 border-t border-[#e9edef] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#202c33]">
            <div className="flex gap-2.5 items-center">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] p-2 rounded-lg transition-colors flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                title="Attach Media"
              >
                {uploading ? (
                  <Loader2 className="animate-spin text-[#8696a0]" size={20} />
                ) : (
                  <Paperclip size={20} className="rotate-45 text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white" />
                )}
              </button>
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                placeholder={attachedFile ? "Add a caption..." : "Type a message..."}
                className="flex-1 px-4 py-2.5 bg-white dark:bg-[#2a3942] border border-[#e9edef] dark:border-transparent rounded-lg focus:outline-none text-[13px] text-[#111b21] dark:text-white placeholder-[#667781] dark:placeholder-[#8696a0] shadow-sm font-medium"
              />
              <button
                onClick={handleSendMessage}
                disabled={!messageText.trim() && !attachedFile}
                className="bg-[#00a884] hover:bg-[#008069] text-white p-2.5 rounded-full transition-colors flex items-center justify-center flex-shrink-0 shadow-sm disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 bg-[#f8f9fa] dark:bg-[#0c1317] flex-col items-center justify-center text-[#667781] dark:text-[#8696a0] p-8 border-l border-[#e9edef] dark:border-[#202d36]">
          <div className="max-w-md text-center space-y-4">
            <div className="mx-auto h-24 w-24 rounded-full bg-[#f0f2f5] dark:bg-[#111b21] flex items-center justify-center text-[#667781] dark:text-[#8696a0] border border-[#e9edef] dark:border-[#202d36]">
              <MessageCircle size={48} />
            </div>
            <h2 className="text-[#111b21] dark:text-white text-lg font-normal">WhatsApp CRM</h2>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] leading-relaxed">
              Send and receive messages on your WhatsApp and SMS numbers. Style-synchronized to mirror WhatsApp Web exactly.
            </p>
            <div className="pt-4 flex items-center justify-center gap-1.5 text-[10px] text-[#667781] dark:text-[#8696a0]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00a884] animate-pulse" />
              <span>Realtime Connected</span>
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
