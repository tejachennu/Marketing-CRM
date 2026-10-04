'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, Search, MessageSquare, Terminal, Settings, Info,
  CheckCircle2, AlertTriangle, HelpCircle, ArrowRight, Loader2, Play,
  Plus, Trash2, RotateCcw, ExternalLink, Edit3, Check, X,
  MessageCircle, Microscope, ChevronRight, Clock, Send, Eraser, Menu
} from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'

// ===========================
// Types
// ===========================
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
  isRiseTicket?: boolean
  matchedFaqs?: number
  condensedQuery?: string
  isError?: boolean
}

interface PlaygroundSession {
  id: string
  title: string
  messages?: ChatMessage[]
  created_at: string
  updated_at: string
}

interface FAQMatch {
  title: string
  content: string
  similarity?: number
}

interface PlaygroundResult {
  query: string
  expandedQuery?: string
  matchedSynonyms?: { alias: string; canonical: string }[]
  retrievalMode: 'vector' | 'keyword' | 'hybrid' | 'none'
  vectorResults: { id: string; title: string; content: string; similarity: number }[]
  vectorError: string | null
  keywordResults: { title: string; content: string }[]
  selectedFaqs: FAQMatch[]
  systemPrompt: string
  gptReply: string
  isRiseTicket: boolean
  callError: string | null
}

const PRESET_QUERIES = [
  'Can I apply for PR extension without valid passport?',
  'Do I need to send my original Indian passport for Passport renewal?',
  'I don\'t have landing paper. What should I do?',
  'How do I submit a Passport Surrender application?',
  'What happens if I write a generic greeting like Hello?'
]

// ===========================
// Authenticated Fetch Helper
// Guarantees Bearer token is attached in all contexts (popup, reload, etc.)
// ===========================
async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    await restoreSupabaseSession()
  } catch {
    // Continue even if restore throws
  }

  let token = authSessionManager.getSession()?.access_token
  if (!token) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      token = session?.access_token
    } catch {
      // Continue without token
    }
  }

  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(url, { ...init, headers })
}

// ===========================
// Chat Mode Component
// ===========================
function ChatMode({ orgId, isStandalone }: { orgId: string | null; isStandalone?: boolean }) {
  const [sessions, setSessions] = useState<PlaygroundSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [showSidebar, setShowSidebar] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { 
    scrollToBottom() 
  }, [messages, sending, scrollToBottom])

  // Load sessions on mount or when orgId changes
  useEffect(() => {
    loadSessions()
  }, [orgId])

  async function loadSessions() {
    setLoadingSessions(true)
    setErrorMessage(null)
    try {
      const res = await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'list_sessions', organizationId: orgId })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || `Failed to load sessions (${res.status})`)
      }

      if (data.sessions) {
        setSessions(data.sessions)
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const targetSessionId = urlParams?.get('sessionId')

        if (targetSessionId) {
          await loadSession(targetSessionId)
        } else if (data.sessions.length > 0 && !activeSessionId) {
          await loadSession(data.sessions[0].id)
        }
      }
    } catch (err: any) {
      console.error('Failed to load sessions:', err)
      setErrorMessage(err.message || 'Failed to load sessions')
    } finally {
      setLoadingSessions(false)
    }
  }

  async function loadSession(sessionId: string) {
    try {
      const res = await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_session', sessionId, organizationId: orgId })
      })
      const data = await res.json()
      if (data.session) {
        setActiveSessionId(sessionId)
        setMessages(data.session.messages || [])
        // On mobile, close sidebar when a session is chosen
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          setShowSidebar(false)
        }
      }
    } catch (err) {
      console.error('Failed to load session:', err)
    }
  }

  async function createNewChat() {
    // If the active session is already empty, just focus and don't create duplicate
    if (activeSessionId && messages.length === 0) {
      inputRef.current?.focus()
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setShowSidebar(false)
      }
      return
    }

    try {
      const res = await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'create_session', organizationId: orgId })
      })
      const data = await res.json()
      if (data.session) {
        setSessions(prev => [data.session, ...prev])
        setActiveSessionId(data.session.id)
        setMessages([])
        inputRef.current?.focus()
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          setShowSidebar(false)
        }
      }
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_session', sessionId, organizationId: orgId })
      })

      const remaining = sessions.filter(s => s.id !== sessionId)
      setSessions(remaining)

      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          loadSession(remaining[0].id)
        } else {
          setActiveSessionId(null)
          setMessages([])
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  async function clearChat() {
    if (!activeSessionId) return
    if (!confirm('Are you sure you want to clear all messages in this conversation?')) return

    try {
      await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'clear_session', sessionId: activeSessionId, organizationId: orgId })
      })
      setMessages([])
      setSessions(prev => prev.map(s =>
        s.id === activeSessionId ? { ...s, messages: [] } : s
      ))
    } catch (err) {
      console.error('Failed to clear chat:', err)
    }
  }

  async function renameSession(sessionId: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed) {
      setEditingSessionId(null)
      return
    }

    try {
      await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'rename_session', sessionId, title: trimmed, organizationId: orgId })
      })
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, title: trimmed } : s
      ))
      setEditingSessionId(null)
    } catch (err) {
      console.error('Failed to rename session:', err)
    }
  }

  async function sendMessage(textToSend?: string) {
    const userMessage = (textToSend !== undefined ? textToSend : input).trim()
    if (!userMessage || sending) return

    setInput('')
    setSending(true)

    // Current session snapshot
    const targetSessionId = activeSessionId || 'new'

    // Optimistic update
    const tempUserMsg: ChatMessage = { role: 'user', content: userMessage, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      const res = await authFetch('/api/ai/playground-chat', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send_message',
          sessionId: targetSessionId,
          message: userMessage,
          chatHistory: messages,
          organizationId: orgId
        })
      })

      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.error || `Server responded with ${res.status}`)
      }

      // If a new session was created on the fly
      if (data.sessionId && data.sessionId !== activeSessionId) {
        setActiveSessionId(data.sessionId)
        const newSessionItem: PlaygroundSession = {
          id: data.sessionId,
          title: data.title || userMessage,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        setSessions(prev => [newSessionItem, ...prev.filter(s => s.id !== data.sessionId)])
      } else if (data.title && activeSessionId) {
        // Update title in sessions list if auto-titled
        setSessions(prev => prev.map(s =>
          s.id === activeSessionId ? { ...s, title: data.title } : s
        ))
      }

      const botMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply || 'No response generated.',
        timestamp: new Date().toISOString(),
        isRiseTicket: data.isRiseTicket,
        matchedFaqs: data.matchedFaqs?.length || 0,
        condensedQuery: data.condensedQuery || undefined
      }

      setMessages(prev => [...prev, botMsg])

    } catch (err: any) {
      console.error('Failed to send message:', err)
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `⚠️ Error: ${err.message || 'Failed to communicate with AI service. Please check your OpenAI API key in Settings.'}`,
        timestamp: new Date().toISOString(),
        isError: true
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function openInNewWindow() {
    const url = `/dashboard/playground?mode=chat&standalone=true${activeSessionId ? `&sessionId=${activeSessionId}` : ''}`
    window.open(url, 'PlaygroundChat', 'width=1020,height=780,scrollbars=yes,resizable=yes')
  }

  function formatTime(ts?: string) {
    if (!ts) return ''
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function formatDate(ts: string) {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="flex h-full w-full bg-white dark:bg-[#111b21] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden relative">
      {/* Sidebar: absolute on small screens when open, relative on desktop */}
      <div className={`
        ${showSidebar ? 'flex' : 'hidden'} 
        md:flex flex-col w-full md:w-72 border-r border-slate-100 dark:border-slate-800 
        bg-slate-50/70 dark:bg-[#0b141a] z-20 
        ${showSidebar && 'absolute inset-0 md:relative'}
      `}>
        {/* Sidebar Header */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-[#0b141a]">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Chat Sessions</h3>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.2 rounded-full font-semibold">
              {sessions.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!isStandalone && (
              <button
                onClick={openInNewWindow}
                title="Open in new window"
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                <ExternalLink size={13} />
              </button>
            )}
            <button
              onClick={createNewChat}
              title="New Chat"
              className="flex items-center gap-1 px-2 py-1 bg-[#00a884] hover:bg-[#008069] rounded-lg transition-colors text-white text-[11px] font-bold cursor-pointer shadow-xs"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
            {/* Mobile close button */}
            <button
              onClick={() => setShowSidebar(false)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 md:hidden cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {loadingSessions ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
              <Loader2 size={20} className="animate-spin text-[#00a884]" />
              <span className="text-xs">Loading sessions...</span>
            </div>
          ) : errorMessage ? (
            <div className="p-4 text-center">
              <AlertTriangle size={24} className="mx-auto text-amber-500 mb-2" />
              <p className="text-xs text-slate-600 dark:text-slate-400">{errorMessage}</p>
              <button
                onClick={loadSessions}
                className="mt-3 text-xs text-[#00a884] hover:underline font-semibold"
              >
                Retry
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-16 px-4">
              <MessageCircle size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">No chat sessions yet</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Start a conversation to test your chatbot</p>
              <button 
                onClick={createNewChat} 
                className="mt-4 px-3 py-1.5 bg-[#00a884]/10 hover:bg-[#00a884]/20 text-[#00a884] rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                + Start New Chat
              </button>
            </div>
          ) : (
            <div className="py-1">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-l-2 transition-all ${
                    activeSessionId === session.id
                      ? 'bg-[#00a884]/10 dark:bg-[#00a884]/10 border-l-[#00a884] text-slate-900 dark:text-slate-100 font-semibold'
                      : 'border-l-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400'
                  }`}
                  onClick={() => loadSession(session.id)}
                >
                  <MessageSquare size={14} className={`flex-shrink-0 ${activeSessionId === session.id ? 'text-[#00a884]' : 'opacity-60'}`} />
                  <div className="flex-1 min-w-0">
                    {editingSessionId === session.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') renameSession(session.id, editTitle)
                            if (e.key === 'Escape') setEditingSessionId(null)
                          }}
                          className="text-[11px] bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 w-full focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                          onClick={e => e.stopPropagation()}
                        />
                        <button onClick={e => { e.stopPropagation(); renameSession(session.id, editTitle) }} className="text-[#00a884] p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><Check size={12} /></button>
                        <button onClick={e => { e.stopPropagation(); setEditingSessionId(null) }} className="text-slate-400 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={12} /></button>
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] truncate leading-tight">{session.title}</p>
                        <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(session.updated_at)}</p>
                      </>
                    )}
                  </div>
                  {editingSessionId !== session.id && (
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setEditingSessionId(session.id); setEditTitle(session.title) }}
                        title="Rename"
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); if (confirm('Delete this chat session?')) deleteSession(session.id) }}
                        title="Delete"
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-950/30 rounded text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#111b21] h-full">
        {/* Chat Header */}
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-[#1f2c34] flex-shrink-0 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 md:hidden cursor-pointer"
              title="Toggle sessions list"
            >
              <Menu size={16} />
            </button>
            <div className="h-8 w-8 bg-[#00a884]/10 rounded-full flex items-center justify-center text-[#00a884] flex-shrink-0">
              <MessageCircle size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                {sessions.find(s => s.id === activeSessionId)?.title || (activeSessionId ? 'Active Chat' : 'New Conversation')}
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                Multi-turn conversation with knowledge base retrieval
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {activeSessionId && messages.length > 0 && (
              <button
                onClick={clearChat}
                title="Clear conversation messages"
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-red-50 dark:bg-slate-800 dark:hover:bg-red-950/30 text-slate-600 hover:text-red-600 dark:text-slate-300 dark:hover:text-red-400 rounded-lg transition-colors text-[11px] font-semibold cursor-pointer"
              >
                <Eraser size={12} />
                <span>Clear Chat</span>
              </button>
            )}
            {!isStandalone && (
              <button
                onClick={openInNewWindow}
                title="Open playground in dedicated window"
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Message Thread */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'300\' height=\'300\' viewBox=\'0 0 300 300\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23667781\' fill-opacity=\'0.04\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'3\'/%3E%3Ccircle cx=\'75\' cy=\'50\' r=\'2\'/%3E%3Ccircle cx=\'150\' cy=\'25\' r=\'2.5\'/%3E%3Ccircle cx=\'225\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'125\' r=\'3\'/%3E%3Ccircle cx=\'175\' cy=\'150\' r=\'2\'/%3E%3Ccircle cx=\'275\' cy=\'175\' r=\'2.5\'/%3E%3Ccircle cx=\'100\' cy=\'200\' r=\'2\'/%3E%3Ccircle cx=\'250\' cy=\'250\' r=\'3\'/%3E%3Ccircle cx=\'50\' cy=\'275\' r=\'2\'/%3E%3C/g%3E%3C/svg%3E")',
            backgroundColor: 'rgba(238, 235, 228, 0.3)',
          }}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="h-14 w-14 bg-[#00a884]/10 dark:bg-[#00a884]/10 rounded-full flex items-center justify-center mb-3">
                <MessageCircle size={28} className="text-[#00a884]" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Interactive AI Playground</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
                Test your automated customer chatbot with full multi-turn context. The AI remembers previous messages, searches your FAQs with synonyms, and determines whether to answer or escalate.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                {PRESET_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(q)}
                    className="text-left p-3 bg-white dark:bg-[#1f2c34] rounded-xl border border-slate-200/80 dark:border-slate-700/80 hover:border-[#00a884] dark:hover:border-[#00a884] text-slate-700 dark:text-slate-300 hover:text-[#00a884] dark:hover:text-[#00a884] transition-all text-[11px] font-medium leading-snug shadow-2xs group cursor-pointer"
                  >
                    <span className="line-clamp-2">{q}</span>
                    <div className="mt-1.5 flex items-center gap-1 text-[9px] text-[#00a884] opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                      <span>Send prompt</span>
                      <ArrowRight size={10} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] md:max-w-[75%] relative group px-3.5 py-2.5 rounded-xl shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-none'
                      : msg.isError
                        ? 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 rounded-tl-none'
                        : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-tl-none'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <div className="flex items-center justify-end gap-1.5 mt-1.5 pt-0.5 border-t border-black/5 dark:border-white/5">
                      {msg.condensedQuery && (
                        <span 
                          className="text-[9px] bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 px-1.5 py-0.2 rounded font-medium cursor-help" 
                          title={`Context Query: "${msg.condensedQuery}"`}
                        >
                          🔍 rewritten
                        </span>
                      )}
                      {msg.isRiseTicket && (
                        <span className="text-[9px] bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 px-1.5 py-0.2 rounded font-semibold">
                          🎟️ escalate
                        </span>
                      )}
                      {msg.matchedFaqs !== undefined && msg.matchedFaqs > 0 && (
                        <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.2 rounded font-medium">
                          {msg.matchedFaqs} FAQ{msg.matchedFaqs > 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="text-[9px] text-slate-400 dark:text-slate-500">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Bot typing bubble */}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-[#202c33] px-4 py-3 rounded-xl rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)] flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-[#00a884] rounded-full animate-bounce [animation-delay:0ms]" />
                    <div className="w-2 h-2 bg-[#00a884] rounded-full animate-bounce [animation-delay:150ms]" />
                    <div className="w-2 h-2 bg-[#00a884] rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1f2c34] flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Type message to test chatbot... (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="flex-1 px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-[#2a3942] rounded-xl border border-slate-200 dark:border-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#00a884] resize-none leading-relaxed max-h-28"
              style={{ minHeight: '40px' }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 h-10 w-10 flex items-center justify-center bg-[#00a884] hover:bg-[#008069] disabled:opacity-40 rounded-xl text-white transition-colors cursor-pointer shadow-xs"
              title="Send message"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ===========================
// Diagnostic Mode Component (deep single-query inspector)
// ===========================
function DiagnosticMode({ orgId }: { orgId: string | null }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [result, setResult] = useState<PlaygroundResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedVectorIndex, setExpandedVectorIndex] = useState<number | null>(null)
  const [expandedKeywordIndex, setExpandedKeywordIndex] = useState<number | null>(null)

  useEffect(() => {
    async function loadOrg() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .maybeSingle()

          const targetOrg = orgId || profile?.organization_id
          if (targetOrg) {
            const { data: org } = await supabase
              .from('organizations')
              .select('name')
              .eq('id', targetOrg)
              .maybeSingle()
            if (org) setOrgName(org.name)
          }
        }
      } catch (err) {
        console.error('Failed to load organization settings:', err)
      }
    }
    loadOrg()
  }, [orgId])

  const handleTest = async (testQuery: string) => {
    if (!testQuery.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setExpandedVectorIndex(null)
    setExpandedKeywordIndex(null)

    try {
      const res = await authFetch('/api/ai/copilot', {
        method: 'POST',
        body: JSON.stringify({ query: testQuery.trim(), playground: true, organizationId: orgId })
      })

      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        if (!res.ok) throw new Error(`Server error (${res.status}): ${res.statusText || 'Unknown Error'}`)
        throw new Error('Failed to parse server response as JSON')
      }

      if (!res.ok) throw new Error(data?.error || 'Failed to fetch diagnostic results')
      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Something went wrong while testing.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Left panel: Test Input */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Run Test Query</h3>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Type customer message:</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Can I apply for PR extension?"
              rows={3}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#2a3942] rounded-lg border border-slate-200 dark:border-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none leading-relaxed"
            />
          </div>
          <button
            onClick={() => handleTest(query)}
            disabled={loading || !query.trim()}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            {loading ? (<><Loader2 size={14} className="animate-spin" /><span>Searching...</span></>) : (<><Play size={12} fill="white" /><span>Run Diagnostic Test</span></>)}
          </button>
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-lg text-[11px] text-red-600 dark:text-red-400 leading-relaxed flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Presets */}
        <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-3">
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Common Test Scenarios</h3>
          <div className="flex flex-col gap-1.5">
            {PRESET_QUERIES.map((q, i) => (
              <button
                key={i}
                onClick={() => { setQuery(q); handleTest(q); }}
                disabled={loading}
                className="w-full text-left p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg text-[11px] text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800/40 hover:border-slate-200 hover:text-emerald-500 dark:hover:text-emerald-400 transition-all font-medium truncate cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: Diagnostics & Results */}
      <div className="lg:col-span-2 space-y-5 overflow-y-auto">
        {!result && !loading && (
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-12 text-center flex flex-col items-center justify-center space-y-3 min-h-[400px]">
            <div className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500">
              <Terminal size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Awaiting Test Execution</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                Enter a query on the left to see semantic vector similarity, keyword hits, synonym expansion, and prompt construction.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-12 text-center flex flex-col items-center justify-center space-y-4 min-h-[400px]">
            <Loader2 size={32} className="animate-spin text-[#00a884]" />
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Evaluating Knowledge Retrieval</h3>
              <p className="text-xs text-slate-400 mt-1">Expanding synonyms, computing embeddings, and querying vector space...</p>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* Stage 1: Query Expansion */}
            <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/10 text-[#00a884] flex items-center justify-center text-[10px]">1</span>
                  Query Expansion & Synonym Mapping
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  result.matchedSynonyms && result.matchedSynonyms.length > 0
                    ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}>
                  {result.matchedSynonyms?.length || 0} matched
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold block mb-1">Raw User Input:</span>
                  <p className="p-2.5 bg-slate-50 dark:bg-[#111b21] rounded-lg text-slate-700 dark:text-slate-300 font-mono text-[11px]">{result.query}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold block mb-1">Expanded Vector Query:</span>
                  <p className="p-2.5 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg text-emerald-800 dark:text-emerald-300 font-mono text-[11px]">{result.expandedQuery || result.query}</p>
                </div>
              </div>
            </div>

            {/* Stage 2: FAQ Matches */}
            <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/10 text-[#00a884] flex items-center justify-center text-[10px]">2</span>
                  Vector Matches (match_faqs RPC)
                </span>
                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full font-bold">
                  {result.vectorResults?.length || 0} found
                </span>
              </div>
              <div className="space-y-2">
                {result.vectorResults && result.vectorResults.length > 0 ? (
                  result.vectorResults.map((faq, i) => (
                    <div key={i} className="p-3 bg-slate-50 dark:bg-[#111b21] rounded-xl text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-200">{faq.title}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          faq.similarity >= 0.65 ? 'bg-emerald-100 dark:bg-emerald-950/50 text-[#00a884]' : 'bg-amber-100 dark:bg-amber-950/50 text-amber-600'
                        }`}>
                          {(faq.similarity * 100).toFixed(1)}% match
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{faq.content}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 italic py-2">No vector matches above threshold.</p>
                )}
              </div>
            </div>

            {/* Stage 3: Chatbot Generation Output */}
            <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/10 text-[#00a884] flex items-center justify-center text-[10px]">3</span>
                  Simulated Chatbot Response
                </span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                  result.isRiseTicket
                    ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                    : 'bg-emerald-100 dark:bg-emerald-950/40 text-[#00a884]'
                }`}>
                  {result.isRiseTicket ? '🎟️ Ticket Escalation' : '✅ Direct FAQ Reply'}
                </span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-[#111b21] rounded-xl text-xs space-y-2 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-800 dark:text-slate-100 font-medium leading-relaxed whitespace-pre-wrap">
                  {result.gptReply || 'No reply generated'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===========================
// Main Playground Page
// ===========================
export default function PlaygroundPage() {
  const [mode, setMode] = useState<'chat' | 'diagnostic'>('chat')
  const [isStandalone, setIsStandalone] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')

  useEffect(() => {
    // Check URL params for mode and standalone window
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const urlMode = params.get('mode')
      if (urlMode === 'diagnostic') setMode('diagnostic')
      if (params.get('standalone') === 'true' || params.get('standalone') === '1' || params.get('popup') === 'true') {
        setIsStandalone(true)
      }
    }

    async function loadOrg() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .maybeSingle()

          if (profile?.organization_id) {
            setOrgId(profile.organization_id)
            const { data: org } = await supabase
              .from('organizations')
              .select('name')
              .eq('id', profile.organization_id)
              .maybeSingle()
            if (org) setOrgName(org.name)
          }
        }
      } catch (err) {
        console.error('Failed to load organization:', err)
      }
    }
    loadOrg()
  }, [])

  // If running in standalone popup window, render full-viewport distraction-free interface
  if (isStandalone) {
    return (
      <div className="h-full w-full overflow-hidden bg-slate-50 dark:bg-[#0b141a] p-2 sm:p-3 font-sans flex flex-col">
        {/* Compact Header for Standalone Window */}
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#1f2c34] px-4 py-2.5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-xs mb-2 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 bg-emerald-500/10 rounded-full flex items-center justify-center text-[#00a884]">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-slate-800 dark:text-slate-100">AI Playground</h1>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00a884]/10 text-[#00a884]">
                  Popup Window
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {orgName || 'Your organization'} • Contextual multi-turn chat
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-[#2a3942] rounded-xl p-0.5">
            <button
              onClick={() => setMode('chat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                mode === 'chat'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#00a884] shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <MessageCircle size={12} />
              Chat Mode
            </button>
            <button
              onClick={() => setMode('diagnostic')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                mode === 'diagnostic'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#00a884] shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Microscope size={12} />
              Diagnostic
            </button>
          </div>
        </div>

        {/* Content area filling remainder of screen */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === 'chat' ? (
            <ChatMode orgId={orgId} isStandalone={true} />
          ) : (
            <div className="h-full overflow-y-auto pr-1">
              <DiagnosticMode orgId={orgId} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 sm:p-6 lg:p-8 font-sans overflow-hidden bg-slate-50 dark:bg-[#0b141a]">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#1f2c34] p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs flex-shrink-0 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-emerald-500/10 rounded-full flex items-center justify-center text-[#00a884]">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800 dark:text-slate-100">AI Playground</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Test and debug automated chatbot for <span className="font-semibold text-[#00a884]">{orgName || 'your organization'}</span>
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center bg-slate-100 dark:bg-[#2a3942] rounded-xl p-0.5 self-start md:self-auto">
          <button
            onClick={() => setMode('chat')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              mode === 'chat'
                ? 'bg-white dark:bg-[#1f2c34] text-[#00a884] shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <MessageCircle size={14} />
            Chat Mode
          </button>
          <button
            onClick={() => setMode('diagnostic')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              mode === 'diagnostic'
                ? 'bg-white dark:bg-[#1f2c34] text-[#00a884] shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Microscope size={14} />
            Diagnostic Mode
          </button>
        </div>
      </div>

      {/* Mode Content - takes remaining height with no double scrollbars */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'chat' ? (
          <ChatMode orgId={orgId} />
        ) : (
          <div className="h-full overflow-y-auto pr-1">
            <DiagnosticMode orgId={orgId} />
          </div>
        )}
      </div>
    </div>
  )
}
