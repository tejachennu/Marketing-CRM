'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, Search, MessageSquare, Terminal, Settings, Info,
  CheckCircle2, AlertTriangle, HelpCircle, ArrowRight, Loader2, Play,
  Plus, Trash2, RotateCcw, ExternalLink, Edit3, Check, X,
  MessageCircle, Microscope, ChevronRight, Clock, Send, Eraser
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

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
}

interface PlaygroundSession {
  id: string
  title: string
  messages: ChatMessage[]
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  // Load sessions on mount
  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    setLoadingSessions(true)
    try {
      const res = await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_sessions' })
      })
      const data = await res.json()
      if (data.sessions) {
        setSessions(data.sessions)
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const targetSessionId = urlParams?.get('sessionId')
        if (targetSessionId && data.sessions.some((s: any) => s.id === targetSessionId)) {
          loadSession(targetSessionId)
        } else if (data.sessions.length > 0 && !activeSessionId) {
          loadSession(data.sessions[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      setLoadingSessions(false)
    }
  }

  async function loadSession(sessionId: string) {
    try {
      const res = await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_session', sessionId })
      })
      const data = await res.json()
      if (data.session) {
        setActiveSessionId(sessionId)
        setMessages(data.session.messages || [])
      }
    } catch (err) {
      console.error('Failed to load session:', err)
    }
  }

  async function createNewChat() {
    try {
      const res = await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_session' })
      })
      const data = await res.json()
      if (data.session) {
        setSessions(prev => [data.session, ...prev])
        setActiveSessionId(data.session.id)
        setMessages([])
        inputRef.current?.focus()
      }
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_session', sessionId })
      })
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  async function clearChat() {
    if (!activeSessionId) return
    try {
      await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_session', sessionId: activeSessionId })
      })
      setMessages([])
      // Update session in sidebar
      setSessions(prev => prev.map(s =>
        s.id === activeSessionId ? { ...s, messages: [] } : s
      ))
    } catch (err) {
      console.error('Failed to clear chat:', err)
    }
  }

  async function renameSession(sessionId: string, title: string) {
    try {
      await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename_session', sessionId, title })
      })
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, title } : s
      ))
      setEditingSessionId(null)
    } catch (err) {
      console.error('Failed to rename session:', err)
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return

    // Auto-create session if none selected
    let sessionId = activeSessionId
    if (!sessionId) {
      try {
        const res = await fetch('/api/ai/playground-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create_session' })
        })
        const data = await res.json()
        if (data.session) {
          setSessions(prev => [data.session, ...prev])
          sessionId = data.session.id
          setActiveSessionId(sessionId)
        }
      } catch (err) {
        console.error('Failed to auto-create session:', err)
        return
      }
    }

    const userMessage = input.trim()
    setInput('')
    setSending(true)

    // Optimistic update
    const tempUserMsg: ChatMessage = { role: 'user', content: userMessage, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      const res = await fetch('/api/ai/playground-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_message',
          sessionId,
          message: userMessage,
          chatHistory: messages
        })
      })

      const data = await res.json()
      if (data.reply) {
        const botMsg: ChatMessage = {
          role: 'assistant',
          content: data.reply,
          timestamp: new Date().toISOString(),
          isRiseTicket: data.isRiseTicket,
          matchedFaqs: data.matchedFaqs?.length || 0,
          condensedQuery: data.condensedQuery || undefined
        }
        setMessages(prev => [...prev, botMsg])

        // Update session title in sidebar if first message
        if (messages.length === 0) {
          setSessions(prev => prev.map(s =>
            s.id === sessionId ? { ...s, title: userMessage.length > 50 ? userMessage.substring(0, 47) + '...' : userMessage } : s
          ))
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function openInNewWindow() {
    const url = `/dashboard/playground?mode=chat&standalone=true${activeSessionId ? `&sessionId=${activeSessionId}` : ''}`
    window.open(url, 'PlaygroundChat', 'width=1000,height=750,scrollbars=yes,resizable=yes')
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
    <div className={`flex ${isStandalone ? 'h-full' : 'h-[calc(100vh-220px)] min-h-[500px]'} bg-white dark:bg-[#111b21] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden`}>
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-72 border-r border-slate-100 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-[#0b141a]">
          {/* Sidebar Header */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Chat Sessions</h3>
            <div className="flex items-center gap-1">
              {!isStandalone && (
                <button
                  onClick={openInNewWindow}
                  title="Open in new window"
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                >
                  <ExternalLink size={13} />
                </button>
              )}
              <button
                onClick={createNewChat}
                title="New chat"
                className="p-1.5 bg-[#00a884] hover:bg-[#008069] rounded-lg transition-colors text-white"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto">
            {loadingSessions ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={18} className="animate-spin text-slate-400" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageCircle size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-xs text-slate-400 dark:text-slate-500">No chat sessions yet.</p>
                <button onClick={createNewChat} className="mt-3 text-[11px] text-[#00a884] hover:underline font-semibold">
                  Start a new chat
                </button>
              </div>
            ) : (
              <div className="py-1">
                {sessions.map(session => (
                  <div
                    key={session.id}
                    className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-l-2 transition-all ${
                      activeSessionId === session.id
                        ? 'bg-[#00a884]/10 dark:bg-[#00a884]/5 border-l-[#00a884] text-slate-900 dark:text-slate-100'
                        : 'border-l-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400'
                    }`}
                    onClick={() => loadSession(session.id)}
                  >
                    <MessageSquare size={13} className="flex-shrink-0 opacity-60" />
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
                          <button onClick={e => { e.stopPropagation(); renameSession(session.id, editTitle) }} className="text-[#00a884]"><Check size={12} /></button>
                          <button onClick={e => { e.stopPropagation(); setEditingSessionId(null) }} className="text-slate-400"><X size={12} /></button>
                        </div>
                      ) : (
                        <>
                          <p className="text-[11px] font-medium truncate">{session.title}</p>
                          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(session.updated_at)}</p>
                        </>
                      )}
                    </div>
                    {editingSessionId !== session.id && (
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); setEditingSessionId(session.id); setEditTitle(session.title) }}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          <Edit3 size={10} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); if (confirm('Delete this chat session?')) deleteSession(session.id) }}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-950/30 rounded text-slate-400 hover:text-red-500"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-[#1f2c34]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 lg:hidden"
            >
              <ChevronRight size={14} className={showSidebar ? 'rotate-180' : ''} />
            </button>
            <div className="h-8 w-8 bg-[#00a884]/10 rounded-full flex items-center justify-center text-[#00a884]">
              <MessageCircle size={15} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {sessions.find(s => s.id === activeSessionId)?.title || 'Chatbot Playground'}
              </h3>
              <p className="text-[9px] text-slate-400 dark:text-slate-500">Test chatbot responses with conversation context</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {activeSessionId && messages.length > 0 && (
              <button
                onClick={clearChat}
                title="Clear chat messages"
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-red-50 dark:bg-slate-800 dark:hover:bg-red-950/30 text-slate-600 hover:text-red-600 dark:text-slate-300 dark:hover:text-red-400 rounded-lg transition-colors text-[11px] font-semibold"
              >
                <Eraser size={12} />
                Clear Chat
              </button>
            )}
            {!isStandalone && (
              <button
                onClick={openInNewWindow}
                title="Open in new window"
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <ExternalLink size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'300\' height=\'300\' viewBox=\'0 0 300 300\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23667781\' fill-opacity=\'0.04\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'3\'/%3E%3Ccircle cx=\'75\' cy=\'50\' r=\'2\'/%3E%3Ccircle cx=\'150\' cy=\'25\' r=\'2.5\'/%3E%3Ccircle cx=\'225\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'125\' r=\'3\'/%3E%3Ccircle cx=\'175\' cy=\'150\' r=\'2\'/%3E%3Ccircle cx=\'275\' cy=\'175\' r=\'2.5\'/%3E%3Ccircle cx=\'100\' cy=\'200\' r=\'2\'/%3E%3Ccircle cx=\'250\' cy=\'250\' r=\'3\'/%3E%3Ccircle cx=\'50\' cy=\'275\' r=\'2\'/%3E%3C/g%3E%3C/svg%3E")',
            backgroundColor: 'rgba(238, 235, 228, 0.3)',
          }}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="h-16 w-16 bg-[#00a884]/10 dark:bg-[#00a884]/5 rounded-full flex items-center justify-center mb-4">
                <MessageCircle size={30} className="text-[#00a884]" />
              </div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Start a conversation</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                Type a message below to test your chatbot. The AI will use your knowledge base to respond, just like it would with real customers.
              </p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md">
                {PRESET_QUERIES.slice(0, 4).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(q); inputRef.current?.focus() }}
                    className="text-left p-2.5 bg-white dark:bg-[#1f2c34] rounded-xl border border-slate-200 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-400 hover:border-[#00a884] hover:text-[#00a884] dark:hover:text-[#00a884] transition-colors font-medium leading-relaxed"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] relative group ${
                    msg.role === 'user'
                      ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef]'
                      : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef]'
                  } px-3 py-2 rounded-lg ${
                    msg.role === 'user' ? 'rounded-tr-none' : 'rounded-tl-none'
                  } shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-xs leading-relaxed`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <div className="flex items-center justify-end gap-1.5 mt-1">
                      {msg.condensedQuery && (
                        <span className="text-[8px] text-purple-500 dark:text-purple-400 font-medium" title={`Search query: ${msg.condensedQuery}`}>
                          🔍 contextual
                        </span>
                      )}
                      {msg.isRiseTicket && (
                        <span className="text-[8px] text-red-500 font-medium">🎟️ escalate</span>
                      )}
                      {msg.matchedFaqs !== undefined && msg.matchedFaqs > 0 && (
                        <span className="text-[8px] text-emerald-600 dark:text-emerald-400 font-medium">{msg.matchedFaqs} FAQ{msg.matchedFaqs > 1 ? 's' : ''}</span>
                      )}
                      <span className="text-[8px] text-slate-400">{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-[#202c33] px-4 py-3 rounded-lg rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Bar */}
        <div className="px-3 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1f2c34]">
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
              placeholder="Type a message to test..."
              rows={1}
              className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-[#2a3942] rounded-lg border border-slate-200 dark:border-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#00a884] resize-none leading-relaxed max-h-24"
              style={{ minHeight: '36px' }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 h-9 w-9 flex items-center justify-center bg-[#00a884] hover:bg-[#008069] disabled:opacity-40 rounded-full text-white transition-colors"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ===========================
// Diagnostic Mode Component (existing playground)
// ===========================
function DiagnosticMode() {
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

          if (profile?.organization_id) {
            const { data: org } = await supabase
              .from('organizations')
              .select('name')
              .eq('id', profile.organization_id)
              .maybeSingle()
            if (org) setOrgName(org.name)
          }
        }
      } catch (err) {
        console.error('Failed to load organization settings:', err)
      }
    }
    loadOrg()
  }, [])

  const handleTest = async (testQuery: string) => {
    if (!testQuery.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setExpandedVectorIndex(null)
    setExpandedKeywordIndex(null)

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: testQuery.trim(), playground: true })
      })

      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch (err) {
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left panel: Test Input */}
      <div className="lg:col-span-1 space-y-5">
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
                className="w-full text-left p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg text-[11px] text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800/40 hover:border-slate-200 hover:text-emerald-500 dark:hover:text-emerald-400 transition-all font-medium truncate"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: Diagnostics & Results */}
      <div className="lg:col-span-2 space-y-6">
        {!result && !loading && (
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-12 text-center flex flex-col items-center justify-center space-y-3 min-h-[400px]">
            <div className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500">
              <Terminal size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Awaiting Test Executions</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mx-auto">
                Type a question or select a preset query on the left to see how similarity search matches and how the chatbot replies.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-12 text-center flex flex-col items-center justify-center space-y-4 min-h-[400px]">
            <Loader2 size={36} className="animate-spin text-[#00a884]" />
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Searching Knowledge Base</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mx-auto">
                Searching match options, validating synonyms, and generating chatbot reply...
              </p>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* 1. Retrieval Summary */}
            <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Search size={14} className="text-[#00a884]" /> AI Search Diagnostics
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  result.retrievalMode === 'hybrid' ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400'
                  : result.retrievalMode === 'vector' ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                  : result.retrievalMode === 'keyword' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                  : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                }`}>
                  Mode: {result.retrievalMode === 'hybrid' ? '🧬 Smart Matching' : result.retrievalMode === 'vector' ? '⚡ Semantic Matching' : result.retrievalMode === 'keyword' ? '🔍 Direct Word Matching' : '❌ No Matched FAQs'}
                </span>
              </div>

              {result.matchedSynonyms && result.matchedSynonyms.length > 0 && (
                <div className="mx-5 mt-4 p-3 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-xl border border-emerald-500/20 text-[10px] text-slate-700 dark:text-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-[9px]">🔍 Synonym Search Active</p>
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span>Original Message:</span> <span className="font-semibold text-slate-800 dark:text-slate-100 italic">&quot;{result.query}&quot;</span>
                      <span>➔</span>
                      <span>Searched With Synonyms:</span> <span className="font-semibold text-emerald-700 dark:text-emerald-300">&quot;{result.expandedQuery}&quot;</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">Synonym Mapping:</span>
                    {result.matchedSynonyms.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-500/30">
                        {s.alias} ➔ {s.canonical}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Vector Results */}
                <div className="space-y-2 bg-slate-50 dark:bg-[#2a3942]/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800/40">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">1. Semantic Matches (Meaning-Based)</p>
                  {result.vectorError ? (
                    <p className="text-[10px] text-red-500">{result.vectorError}</p>
                  ) : result.vectorResults.length === 0 ? (
                    <p className="text-[10px] text-slate-400">0 articles matched above similarity threshold</p>
                  ) : (
                    <div className="space-y-1.5">
                      {result.vectorResults.map((r, i) => (
                        <div key={i} className="flex flex-col text-[10px] text-slate-700 dark:text-slate-300 bg-white dark:bg-[#1f2c34] rounded border border-slate-100 dark:border-slate-850 overflow-hidden">
                          <button onClick={() => setExpandedVectorIndex(expandedVectorIndex === i ? null : i)} className="flex justify-between items-center w-full p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors focus:outline-none">
                            <span className="truncate pr-2 font-medium">{r.title}</span>
                            <span className="font-bold text-emerald-500 flex-shrink-0 flex items-center gap-1.5">
                              {(r.similarity * 100).toFixed(0)}%
                              <span className="text-slate-400 text-[8px]">{expandedVectorIndex === i ? '▲' : '▼'}</span>
                            </span>
                          </button>
                          {expandedVectorIndex === i && (
                            <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 space-y-1.5 text-slate-600 dark:text-slate-400">
                              <div className="space-y-0.5">
                                <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Title</p>
                                <p className="font-medium text-slate-800 dark:text-slate-200">{r.title}</p>
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Answer</p>
                                <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">{r.content || '(No content stored)'}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Keyword Results */}
                <div className="space-y-2 bg-slate-50 dark:bg-[#2a3942]/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800/40">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">2. Direct Word Matches (Fallback)</p>
                  {result.keywordResults.length === 0 ? (
                    <p className="text-[10px] text-slate-400">0 articles matched in direct word lookup</p>
                  ) : (
                    <div className="space-y-1.5">
                      {result.keywordResults.map((r, i) => (
                        <div key={i} className="flex flex-col text-[10px] text-slate-700 dark:text-slate-300 bg-white dark:bg-[#1f2c34] rounded border border-slate-100 dark:border-slate-850 overflow-hidden">
                          <button onClick={() => setExpandedKeywordIndex(expandedKeywordIndex === i ? null : i)} className="flex justify-between items-center w-full p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors focus:outline-none">
                            <span className="truncate pr-2 font-medium">{r.title}</span>
                            <span className="text-blue-500 font-bold flex-shrink-0 flex items-center gap-1.5">
                              Direct Match
                              <span className="text-slate-400 text-[8px]">{expandedKeywordIndex === i ? '▲' : '▼'}</span>
                            </span>
                          </button>
                          {expandedKeywordIndex === i && (
                            <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 space-y-1.5 text-slate-600 dark:text-slate-400">
                              <div className="space-y-0.5">
                                <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Title</p>
                                <p className="font-medium text-slate-800 dark:text-slate-200">{r.title}</p>
                              </div>
                              <div className="space-y-0.5">
                                <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Answer</p>
                                <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">{r.content || '(No content stored)'}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Matched FAQ Articles */}
            <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Info size={14} className="text-blue-500" /> Matched FAQs Sent to Chatbot
                </h3>
              </div>
              <div className="p-5 space-y-4 max-h-[300px] overflow-y-auto leading-relaxed">
                {result.selectedFaqs.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500 italic">No FAQ articles matching this question were found in the database.</p>
                ) : (
                  result.selectedFaqs.map((faq, i) => (
                    <div key={i} className="space-y-1.5 p-3.5 bg-slate-50 dark:bg-[#202c33]/50 rounded-xl border border-slate-100 dark:border-slate-800/40">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Q: {faq.title}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{faq.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 3. Chatbot Response */}
            <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-indigo-500" /> Chatbot Response Preview
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  result.isRiseTicket ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                }`}>
                  🎟️ Escalate to Team: {result.isRiseTicket ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="p-5 space-y-4">
                <div className="bg-[#efeae2] dark:bg-[#0b141a] p-4 rounded-xl border border-slate-200 dark:border-slate-800/40 min-h-[120px] flex flex-col justify-end space-y-3"
                  style={{
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'300\' height=\'300\' viewBox=\'0 0 300 300\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23667781\' fill-opacity=\'0.04\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'3\'/%3E%3Ccircle cx=\'75\' cy=\'50\' r=\'2\'/%3E%3Ccircle cx=\'150\' cy=\'25\' r=\'2.5\'/%3E%3Ccircle cx=\'225\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'125\' r=\'3\'/%3E%3Ccircle cx=\'175\' cy=\'150\' r=\'2\'/%3E%3Ccircle cx=\'275\' cy=\'175\' r=\'2.5\'/%3E%3Ccircle cx=\'100\' cy=\'200\' r=\'2\'/%3E%3Ccircle cx=\'250\' cy=\'250\' r=\'3\'/%3E%3Ccircle cx=\'50\' cy=\'275\' r=\'2\'/%3E%3Ccircle cx=\'200\' cy=\'100\' r=\'2\'/%3E%3C/g%3E%3C/svg%3E")',
                  }}>
                  <div className="flex justify-end">
                    <div className="max-w-[70%] bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] px-3.5 py-2 rounded-lg rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-xs leading-relaxed">
                      {result.query}
                    </div>
                  </div>
                  <div className="flex justify-start animate-in fade-in duration-500">
                    <div className="max-w-[70%] bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] px-3.5 py-2 rounded-lg rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-xs leading-relaxed">
                      {result.gptReply || <span className="italic text-slate-400">No reply generated.</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. System Prompt */}
            <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal size={14} className="text-slate-500" /> Compiled System Prompt sent to GPT-4o-mini
                </h3>
              </div>
              <div className="p-5">
                <pre className="p-4 bg-slate-900 text-slate-300 rounded-xl overflow-x-auto text-[10px] leading-relaxed font-mono whitespace-pre-wrap max-h-[300px]">
                  {result.systemPrompt}
                </pre>
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
      <div className="h-screen w-full overflow-hidden bg-slate-50 dark:bg-[#0b141a] p-2 sm:p-3 font-sans flex flex-col">
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
                  Standalone Window
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
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
              <DiagnosticMode />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-8 bg-slate-50 dark:bg-[#0b141a] p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#1f2c34] p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-emerald-500/10 rounded-full flex items-center justify-center text-[#00a884]">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">AI Playground</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Test and debug chatbot for <span className="font-semibold text-[#00a884]">{orgName || 'your organization'}</span>
              </p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center bg-slate-100 dark:bg-[#2a3942] rounded-xl p-0.5">
            <button
              onClick={() => setMode('chat')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-all ${
                mode === 'chat'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#00a884] shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <MessageCircle size={13} />
              Chat Mode
            </button>
            <button
              onClick={() => setMode('diagnostic')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-all ${
                mode === 'diagnostic'
                  ? 'bg-white dark:bg-[#1f2c34] text-[#00a884] shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Microscope size={13} />
              Diagnostic Mode
            </button>
          </div>
        </div>

        {/* Mode Content */}
        {mode === 'chat' ? (
          <ChatMode orgId={orgId} />
        ) : (
          <DiagnosticMode />
        )}

      </div>
    </div>
  )
}
