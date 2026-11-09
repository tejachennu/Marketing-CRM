'use client'

/** Shared pieces for the Sales Pipeline screens: the data they pass around and small UI bits. */

import { AlarmClock, Flame, MessageCircle, Phone, Snowflake, Sun } from 'lucide-react'
import { FOLLOW_UP_LABEL, followUpState, formatMoney, PRIORITY_LABEL, type FollowUpState, type Priority } from '@/lib/pipeline/rules'

export interface Stage { id: string; name: string; position: number; open?: number }
export interface TeamMember { id: string; full_name: string | null; email: string | null; role: string | null }
export interface Me { id: string | null; seeAll: boolean; canAssign: boolean; readOnly: boolean; canManage: boolean }
export interface DealContact { id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null; company: string | null }
export interface Deal {
  id: string
  title: string | null
  value: number | string | null
  status: 'active' | 'won' | 'lost' | 'on_hold'
  priority: Priority | null
  source: string | null
  pipeline_stage_id: string | null
  assigned_to: string | null
  contact_id: string | null
  contact: DealContact | null
  description: string | null
  notes: string | null
  product_service: string | null
  expected_close_date: string | null
  next_follow_up_at: string | null
  last_activity_at: string | null
  won_lost_reason: string | null
  won_at: string | null
  lost_at: string | null
  created_at: string
  updated_at: string | null
}
export interface HistoryItem { id: string; type: string; content: string | null; created_at: string; by: string }

export interface PipelineData {
  orgId: string
  stages: Stage[]
  team: TeamMember[]
  currency: string
  me: Me
}

export const money = (value: number | string | null | undefined, currency: string, short = false) => formatMoney(value, currency, short)
export const personName = (team: TeamMember[], id: string | null | undefined) => {
  if (!id) return 'No owner'
  const member = team.find((m) => m.id === id)
  return member?.full_name || member?.email || 'Former teammate'
}

const FOLLOW_TONE: Record<FollowUpState, string> = {
  overdue: 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300',
  today: 'bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300',
  tomorrow: 'bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300',
  later: 'bg-[#f4f6fa] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300',
  none: 'bg-[#f4f6fa] text-[#8a94a8] dark:bg-slate-800 dark:text-slate-400',
}

/** When to follow up, in India time: "Overdue · 7 Nov", "Today 4:30 pm", "Tomorrow 10:30 am", "Fri 14 Nov". */
export function followUpText(at: string | null | undefined, now = Date.now()) {
  const state = followUpState(at, now)
  if (state === 'none' || !at) return FOLLOW_UP_LABEL.none
  const time = new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  const day = new Date(at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  if (state === 'overdue') return `Overdue · ${day}`
  if (state === 'today') return `Today ${time}`
  if (state === 'tomorrow') return `Tomorrow ${time}`
  return day
}

export function FollowUpBadge({ at, compact }: { at: string | null | undefined; compact?: boolean }) {
  const state = followUpState(at)
  if (compact && state === 'none') return null
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[12px] font-semibold whitespace-nowrap ${FOLLOW_TONE[state]}`}>
      <AlarmClock size={12} className="shrink-0" /> {followUpText(at)}
    </span>
  )
}

const PRIORITY_ICON = { high: Flame, medium: Sun, low: Snowflake }

export function PriorityTag({ priority }: { priority: Priority | null | undefined }) {
  if (!priority) return null
  const Icon = PRIORITY_ICON[priority]
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-semibold whitespace-nowrap ${priority === 'high' ? 'text-[#0E1B3D] dark:text-white' : 'text-[#6B7894] dark:text-slate-400'}`}>
      <Icon size={12} className="shrink-0" /> {PRIORITY_LABEL[priority]}
    </span>
  )
}

/** The contact's number for WhatsApp links: digits only, with the country code. */
export const waNumber = (contact: DealContact | null) => String(contact?.whatsapp || contact?.phone || '').replace(/\D/g, '')

/** WhatsApp and call buttons for a deal's contact. The chat opens in the inbox when there is one. */
export function ContactActions({ contact, conversationId, size = 'md' }: { contact: DealContact | null; conversationId?: string | null; size?: 'sm' | 'md' }) {
  const number = waNumber(contact)
  if (!number) return null
  const box = size === 'sm' ? 'h-9 w-9' : 'h-10 px-3.5 gap-2'
  const label = size !== 'sm'
  const base = `inline-flex items-center justify-center ${box} rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-100 text-[14px] font-semibold hover:bg-[#f4f6fa] dark:hover:bg-slate-800 transition-colors`
  return (
    <>
      <a href={conversationId ? `/dashboard?conversationId=${conversationId}` : `https://wa.me/${number}`} target={conversationId ? undefined : '_blank'} rel="noreferrer"
        onClick={(event) => event.stopPropagation()} className={base} aria-label={`WhatsApp ${contact?.name || ''}`.trim()}>
        <MessageCircle size={16} />{label && 'WhatsApp'}
      </a>
      <a href={`tel:+${number}`} onClick={(event) => event.stopPropagation()} className={base} aria-label={`Call ${contact?.name || ''}`.trim()}>
        <Phone size={16} />{label && 'Call'}
      </a>
    </>
  )
}

export const selectInput = 'h-10 w-full px-3 pr-8 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[14.5px] text-[#0E1B3D] dark:text-white focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15 cursor-pointer'

export const timeAgo = (at: string | null | undefined, now = Date.now()) => {
  if (!at) return '—'
  const minutes = Math.round((now - Date.parse(at)) / 60_000)
  if (!Number.isFinite(minutes)) return '—'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days} d ago`
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

/** A short date for lists: "9 Nov", or "9 Nov 2025" in another year. */
export const shortDate = (at: string | null | undefined) => {
  if (!at) return '—'
  const date = new Date(at.length === 10 ? `${at}T00:00:00+05:30` : at)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'Asia/Kolkata' })
}

export function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto h-14 w-14 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#4a5672] dark:text-slate-300 flex items-center justify-center">{icon}</span>
      <h2 className="mt-4 text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">{title}</h2>
      <p className="mt-1 text-[15px] text-[#4a5672] dark:text-slate-400 max-w-md mx-auto">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
