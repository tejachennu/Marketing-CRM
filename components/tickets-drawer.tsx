'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { 
  Ticket, X, Check, User, Clock, Search,
  MessageSquare, AlertCircle, Loader2, CheckCircle2 
} from 'lucide-react'

interface TicketItem {
  id: string
  subject: string
  status: string
  created_at: string
  conversation_id: string
  contact_id: string
  contacts?: {
    first_name: string | null
    last_name: string | null
    phone_number: string
  }
}

interface TicketsDrawerProps {
  isOpen: boolean
  onClose: () => void
  orgId: string | null
}

export function TicketsDrawer({ isOpen, onClose, orgId }: TicketsDrawerProps) {
  const router = useRouter()
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredTickets = tickets.filter(ticket => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return true
    
    const subjectMatch = ticket.subject.toLowerCase().includes(term)
    const nameMatch = ticket.contacts 
      ? [ticket.contacts.first_name, ticket.contacts.last_name, ticket.contacts.phone_number]
          .filter(Boolean)
          .some(field => field!.toLowerCase().includes(term))
      : false
      
    return subjectMatch || nameMatch
  })

  const fetchTickets = async () => {
    if (!orgId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tickets?organizationId=${orgId}`)
      const data = await res.json()
      if (data.success) {
        setTickets(data.tickets || [])
      }
    } catch (err) {
      console.error('Error fetching tickets:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && orgId) {
      fetchTickets()
    }
  }, [isOpen, orgId])

  // Supabase Realtime Subscription
  useEffect(() => {
    if (!orgId) return

    const channel = supabase
      .channel('tickets-realtime-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `organization_id=eq.${orgId}`
        },
        () => {
          fetchTickets()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId])

  const handleResolveTicket = async (e: React.MouseEvent, ticketId: string) => {
    e.stopPropagation()
    setResolvingId(ticketId)
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, status: 'resolved' })
      })
      const data = await res.json()
      if (data.success) {
        setTickets(prev => prev.filter(t => t.id !== ticketId))
      }
    } catch (err) {
      console.error('Error resolving ticket:', err)
    } finally {
      setResolvingId(null)
    }
  }

  const handleSelectTicket = (conversationId: string) => {
    router.push(`/dashboard?conversationId=${conversationId}`)
    onClose()
  }

  const formatRelativeTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) return 'Just now'
      if (diffMin < 60) return `${diffMin}m ago`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return `${diffHr}h ago`
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-950/20 dark:bg-slate-950/40 backdrop-blur-xs z-[100] transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-white/95 dark:bg-slate-900/95 border-l border-slate-100 dark:border-slate-800 backdrop-blur-md shadow-2xl z-[100] flex flex-col animate-in slide-in-from-right duration-300 select-none">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center animate-pulse">
              <Ticket size={16} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white leading-none">Support Tickets</h3>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-1 block">
                {tickets.length} Active Tickets
              </span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search Bar Input */}
        {tickets.length > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/20">
            <div className="relative">
              <input
                type="text"
                placeholder="Search tickets by subject or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-8 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 font-semibold shadow-xs transition-all"
              />
              <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tickets List */}
        <div className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4 space-y-3">
          {isLoading && tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <Loader2 size={24} className="animate-spin text-emerald-500 mb-2" />
              <span className="text-xs font-semibold animate-pulse">Loading active tickets...</span>
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-4">
              <div className="h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-3 animate-pulse">
                <CheckCircle2 size={24} />
              </div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1 animate-bounce">All Caught Up!</h4>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-[200px] leading-normal font-semibold">
                No active fallback tickets require support team attention.
              </p>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 dark:text-slate-500">
              <AlertCircle size={24} className="mb-2 text-slate-350 dark:text-slate-700" />
              <span className="text-[10px] font-bold">No matching tickets found</span>
            </div>
          ) : (
            filteredTickets.map((ticket) => {
              const contactName = ticket.contacts 
                ? [ticket.contacts.first_name, ticket.contacts.last_name].filter(Boolean).join(' ') || ticket.contacts.phone_number
                : 'Unknown Contact'

              return (
                <div
                  key={ticket.id}
                  onClick={() => handleSelectTicket(ticket.conversation_id)}
                  className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-emerald-500/30 dark:hover:border-emerald-500/20 hover:shadow-lg rounded-2xl p-4 transition-all duration-200 cursor-pointer group relative flex flex-col gap-3 active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      {/* Priority Action Badge */}
                      <div>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 tracking-wide uppercase">
                          AI Fallback
                        </span>
                      </div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white leading-normal group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {ticket.subject}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleResolveTicket(e, ticket.id)}
                      disabled={resolvingId === ticket.id}
                      title="Mark as Resolved"
                      className="flex-shrink-0 h-7 w-7 rounded-xl border border-slate-150 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 hover:text-emerald-600 hover:border-emerald-500/30 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95"
                    >
                      {resolvingId === ticket.id ? (
                        <Loader2 size={12} className="animate-spin text-emerald-500" />
                      ) : (
                        <Check size={14} />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 dark:text-slate-500 border-t border-slate-50 dark:border-slate-800/80 pt-2.5">
                    <div className="flex items-center gap-1.5">
                      <User size={10} className="text-slate-400" />
                      <span className="truncate max-w-[120px]">{contactName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={10} className="text-slate-400" />
                      <span>{formatRelativeTime(ticket.created_at)}</span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
