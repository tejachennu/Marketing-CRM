'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, X, Send, Loader2, ChevronDown, ChevronUp, RefreshCw,
  TrendingUp, AlertTriangle, Clock, Ticket, MessageCircle, Zap,
  Bot, User, Trash2
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'

interface AssistantDrawerProps {
  isOpen: boolean
  onClose: () => void
  orgId: string
  orgName: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolsUsed?: string[]
  isLoading?: boolean
}

interface InsightCard {
  id: string
  type: 'warning' | 'success' | 'info' | 'urgent'
  icon: string
  title: string
  description: string
  metric?: number
  action?: string
}

const INSIGHT_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  urgent: { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/40', text: 'text-red-700 dark:text-red-400', icon: 'text-red-500' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800/40', text: 'text-amber-700 dark:text-amber-400', icon: 'text-amber-500' },
  success: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/40', text: 'text-emerald-700 dark:text-emerald-400', icon: 'text-emerald-500' },
  info: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800/40', text: 'text-blue-700 dark:text-blue-400', icon: 'text-blue-500' },
}

function getSuggestionChips(currentPage?: string): string[] {
  const base = currentPage?.replace('/dashboard', '') || ''
  switch (true) {
    case base === '' || base === '/':
      return ['Unread conversations', 'Today\'s summary', 'Draft a reply']
    case base.startsWith('/leads'):
      return ['Pipeline summary', 'Leads going cold', 'Top deals this month']
    case base.startsWith('/tickets'):
      return ['Overdue tickets', 'Ticket resolution stats', 'Unassigned tickets']
    case base.startsWith('/campaigns'):
      return ['Last campaign results', 'Best send time', 'Audience size']
    case base.startsWith('/contacts'):
      return ['Total contacts', 'New contacts this week', 'Contacts by company']
    default:
      return ['Daily briefing', 'Today\'s summary', 'How can you help?']
  }
}

export function AssistantDrawer({
  isOpen,
  onClose,
  orgId,
  orgName
}: AssistantDrawerProps) {
  const currentPage = usePathname()
  const searchParams = useSearchParams()
  const selectedConversationId = searchParams?.get('conversationId')

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [insights, setInsights] = useState<InsightCard[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [showInsights, setShowInsights] = useState(true)
  const [hasGreeted, setHasGreeted] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Load insights when drawer opens
  useEffect(() => {
    if (isOpen && orgId) {
      loadInsights()
    }
  }, [isOpen, orgId])

  // Add welcome message on first open
  useEffect(() => {
    if (isOpen && !hasGreeted && messages.length === 0) {
      const hour = new Date().getHours()
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `${greeting}! 👋 I'm your **CRM Copilot**. I can help you with:\n\n• 📊 **Query your data** — "How many leads did we close this week?"\n• ⚡ **Take actions** — "Create a ticket for Gokul's issue"\n• 📈 **Get insights** — "Show me my pipeline summary"\n• ✍️ **Draft messages** — "Draft a follow-up for the last conversation"\n\nWhat would you like to know?`,
        timestamp: new Date(),
      }])
      setHasGreeted(true)
    }
  }, [isOpen, hasGreeted, messages.length])

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  const loadInsights = async () => {
    if (!orgId) return
    setInsightsLoading(true)
    try {
      const res = await fetch(`/api/ai/insights?organizationId=${orgId}`)
      if (res.ok) {
        const data = await res.json()
        setInsights(data.insights || [])
      }
    } catch (err) {
      console.error('[CRM Copilot] Failed to load insights:', err)
    } finally {
      setInsightsLoading(false)
    }
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }

    const loadingMessage: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    }

    setMessages(prev => [...prev, userMessage, loadingMessage])
    setInput('')
    setIsTyping(true)

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    try {
      // Build conversation history for context (last 10 messages)
      const history = [...messages, userMessage]
        .filter(m => !m.isLoading)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          conversationHistory: history,
          context: {
            currentPage,
            selectedConversationId,
          }
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to get response')
      }

      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.reply || 'I wasn\'t able to process that request. Could you try rephrasing?',
        timestamp: new Date(),
        toolsUsed: data.toolsUsed,
      }

      setMessages(prev => prev.filter(m => !m.isLoading).concat(aiMessage))
    } catch (err: any) {
      console.error('[CRM Copilot] Error:', err)
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ ${err.message || 'Something went wrong. Please try again.'}`,
        timestamp: new Date(),
      }
      setMessages(prev => prev.filter(m => !m.isLoading).concat(errorMessage))
    } finally {
      setIsTyping(false)
    }
  }, [messages, isTyping, currentPage, selectedConversationId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const clearChat = () => {
    setMessages([])
    setHasGreeted(false)
  }

  const chips = getSuggestionChips(currentPage)

  if (!isOpen) return null

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[360px] sm:w-[390px] h-[520px] sm:h-[560px] bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300 font-sans">
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#008069] dark:bg-[#005c4b] border-b border-[#00a884]/20 select-none flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center">
            <Bot size={16} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-[13px] font-semibold text-white leading-none">CRM Copilot</h3>
              <span className="text-[8.5px] font-bold text-white bg-white/20 px-1 py-0.5 rounded uppercase tracking-wider scale-90 leading-none">Beta</span>
            </div>
            <p className="text-[10px] text-white/70 font-medium mt-0.5">{orgName || 'AI Assistant'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="p-1.5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors"
            title="Clear chat"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-[#efeae2] dark:bg-[#0b141a] scroll-smooth"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'300\' height=\'300\' viewBox=\'0 0 300 300\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23667781\' fill-opacity=\'0.04\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'3\'/%3E%3Ccircle cx=\'75\' cy=\'50\' r=\'2\'/%3E%3Ccircle cx=\'150\' cy=\'25\' r=\'2.5\'/%3E%3Ccircle cx=\'225\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'125\' r=\'3\'/%3E%3Ccircle cx=\'175\' cy=\'150\' r=\'2\'/%3E%3Ccircle cx=\'275\' cy=\'175\' r=\'2.5\'/%3E%3Ccircle cx=\'100\' cy=\'200\' r=\'2\'/%3E%3Ccircle cx=\'250\' cy=\'250\' r=\'3\'/%3E%3Ccircle cx=\'50\' cy=\'275\' r=\'2\'/%3E%3Ccircle cx=\'200\' cy=\'100\' r=\'2\'/%3E%3C/g%3E%3C/svg%3E")',
        }}
      >
        {/* Proactive Insight Cards */}
        {insights.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#667781] dark:text-[#8696a0] uppercase tracking-wider hover:text-[#00a884] transition-colors w-full cursor-pointer" onClick={() => setShowInsights(!showInsights)}>
              <Zap size={10} className="text-[#00a884]" />
              <span>{insights.length} Insight{insights.length > 1 ? 's' : ''}</span>
              {showInsights ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              <button
                onClick={(e) => { e.stopPropagation(); loadInsights() }}
                className="ml-auto p-0.5 hover:bg-white/50 dark:hover:bg-white/10 rounded transition-colors"
                title="Refresh insights"
              >
                <RefreshCw size={10} className={insightsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            
            {showInsights && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                {insights.slice(0, 4).map((insight) => {
                  const colors = INSIGHT_COLORS[insight.type] || INSIGHT_COLORS.info
                  return (
                    <button
                      key={insight.id}
                      onClick={() => sendMessage(insight.action || insight.title)}
                      className={`w-full text-left p-2.5 rounded-lg border ${colors.bg} ${colors.border} transition-all hover:shadow-sm cursor-pointer group`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5 flex-shrink-0">{insight.icon}</span>
                        <div className="min-w-0">
                          <p className={`text-[11px] font-bold ${colors.text} leading-tight`}>{insight.title}</p>
                          <p className="text-[10px] text-[#667781] dark:text-[#8696a0] mt-0.5 leading-snug line-clamp-2">{insight.description}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Chat Messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${
                msg.role === 'user'
                  ? 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none text-[#111b21] dark:text-[#e9edef]'
                  : 'bg-white dark:bg-[#202c33] rounded-tl-none text-[#111b21] dark:text-[#e9edef]'
              }`}
            >
              {msg.isLoading ? (
                <div className="flex items-center gap-2 py-1">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-[#667781] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#667781] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#667781] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0]">Thinking...</span>
                </div>
              ) : (
                <>
                  <div className="text-[13px] leading-[18px] whitespace-pre-wrap break-words">
                    {/* Simple rendering logic */}
                    {msg.content.split('\n').map((line, i) => {
                      let rendered = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      
                      const isBullet = line.match(/^[\s]*[•\-\*]\s/)
                      if (isBullet) {
                        rendered = rendered.replace(/^[\s]*[•\-\*]\s/, '')
                        return (
                          <div key={i} className="flex gap-1.5 ml-1 my-0.5">
                            <span className="text-[#00a884] font-bold flex-shrink-0">•</span>
                            <span dangerouslySetInnerHTML={{ __html: rendered }} />
                          </div>
                        )
                      }
                      
                      const isNumbered = line.match(/^(\d+)\.\s/)
                      if (isNumbered) {
                        rendered = rendered.replace(/^\d+\.\s/, '')
                        return (
                          <div key={i} className="flex gap-1.5 ml-1 my-0.5">
                            <span className="text-[#00a884] font-bold flex-shrink-0 text-[11px]">{isNumbered[1]}.</span>
                            <span dangerouslySetInnerHTML={{ __html: rendered }} />
                          </div>
                        )
                      }
                      
                      if (!line.trim()) return <div key={i} className="h-2" />
                      return <div key={i} dangerouslySetInnerHTML={{ __html: rendered }} />
                    })}
                  </div>
                  {/* Footer */}
                  <div className="flex items-center justify-end gap-1.5 mt-1 select-none">
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <span className="text-[9px] text-[#00a884] dark:text-[#00e676] font-semibold bg-[#00a884]/10 px-1.5 py-0.5 rounded-full">
                        ⚡ {msg.toolsUsed.length} tool{msg.toolsUsed.length > 1 ? 's' : ''} used
                      </span>
                    )}
                    <span className="text-[10px] text-[#667781] dark:text-[#8696a0]">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Context-Aware Suggestion Chips */}
      {messages.length <= 2 && (
        <div className="px-3 py-2 bg-white dark:bg-[#111b21] border-t border-[#e9edef] dark:border-[#2a3942]/60 flex gap-1.5 overflow-x-auto scrollbar-none flex-shrink-0">
          {chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => sendMessage(chip)}
              disabled={isTyping}
              className="px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap border border-[#00a884]/30 text-[#00a884] dark:text-[#00e676] hover:bg-[#00a884]/10 transition-colors flex-shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="px-3 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-[#2a3942] flex items-end gap-2 flex-shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px'
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about your CRM..."
          disabled={isTyping}
          rows={1}
          className="flex-1 px-3 py-2 bg-white dark:bg-[#2a3942] rounded-lg border-none text-[13px] text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] focus:outline-none focus:ring-0 resize-none overflow-y-auto max-h-20 leading-relaxed disabled:opacity-50 shadow-xs"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isTyping}
          className="p-2 bg-[#00a884] hover:bg-[#008069] disabled:opacity-40 text-white rounded-full transition-colors flex items-center justify-center flex-shrink-0 shadow-sm disabled:cursor-not-allowed cursor-pointer"
        >
          {isTyping ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
    </div>
  )
}
