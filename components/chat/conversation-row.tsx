'use client'

import { memo } from 'react'
import { AlertCircle, Check, CheckCheck, Pin } from 'lucide-react'
import type { ConversationWithContact } from '@/lib/types'
import { formatChatListTimestamp } from '@/lib/chat-dates'
import { formatBadgeCount, getAvatarTone, getMessagePreview } from '@/lib/chat-message-format'
import { formatContactDisplayName, getContactAvatarInitials } from '@/lib/whatsapp-bsuid'

interface ConversationRowProps {
  conversation: ConversationWithContact
  selected: boolean
  pinned: boolean
  onSelect: (conversationId: string) => void
  onTogglePin: (conversationId: string) => void
}

/** One chat in the inbox list. Memoized so a new message only re-renders the row it belongs to. */
export const ConversationRow = memo(function ConversationRow({ conversation, selected, pinned, onSelect, onTogglePin }: ConversationRowProps) {
  const name = formatContactDisplayName(conversation.contact)
  const last = conversation.last_message
  const unread = conversation.unread_count > 0
  const preview = last ? getMessagePreview(last) : conversation.contact?.phone_number || ''

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(conversation.id)
        }
      }}
      className={`w-full pl-3 pr-3 py-2.5 text-left flex items-center gap-3 relative cursor-pointer transition-colors duration-100 group/item outline-none focus-visible:bg-[#f5f6f6] dark:focus-visible:bg-[#202c33] ${
        selected ? 'bg-[#f0f2f5] dark:bg-[#2a3942]' : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]'
      }`}
    >
      <div className={`h-12 w-12 rounded-full flex items-center justify-center font-semibold text-[15px] shrink-0 select-none ${getAvatarTone(conversation.contact?.id || conversation.id)}`}>
        {getContactAvatarInitials(conversation.contact)}
      </div>

      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center border-b border-[#e9edef] dark:border-[#222d34] -mb-2.5 pb-2.5 group-last/item:border-b-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-[15px] truncate text-[#111b21] dark:text-[#e9edef] ${unread ? 'font-semibold' : 'font-medium'}`}>{name}</p>
          {conversation.last_message_at && (
            <span className={`text-[11.5px] whitespace-nowrap shrink-0 ${unread ? 'text-[#1fa855] dark:text-[#00a884] font-semibold' : 'text-[#667781] dark:text-[#8696a0]'}`}>
              {formatChatListTimestamp(conversation.last_message_at)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className={`flex items-center gap-1 min-w-0 text-[13px] ${unread ? 'text-[#111b21] dark:text-[#d1d7db] font-medium' : 'text-[#667781] dark:text-[#8696a0]'}`}>
            {last?.sender_type === 'user' && (
              last.status === 'failed' || last.status === 'undelivered' ? (
                <AlertCircle size={13} className="text-rose-500 shrink-0" aria-label="Not delivered" />
              ) : last.status === 'read' || last.read_at ? (
                <CheckCheck size={14} className="text-[#53bdeb] shrink-0" aria-label="Read" />
              ) : last.status === 'delivered' ? (
                <CheckCheck size={14} className="text-[#8696a0] shrink-0" aria-label="Delivered" />
              ) : (
                <Check size={14} className="text-[#8696a0] shrink-0" aria-label="Sent" />
              )
            )}
            <span className="truncate">{preview}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onTogglePin(conversation.id)
              }}
              title={pinned ? 'Unpin chat' : 'Pin chat to the top'}
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
              aria-pressed={pinned}
              className={`p-0.5 rounded cursor-pointer transition-opacity text-[#8696a0] hover:text-[#008069] dark:hover:text-[#00a884] ${
                pinned ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100'
              }`}
            >
              <Pin size={13} className={`rotate-45 ${pinned ? 'fill-current' : ''}`} />
            </button>
            {unread && (
              <span className="bg-[#25d366] dark:bg-[#00a884] text-white dark:text-[#111b21] text-[11px] font-semibold tabular-nums rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center" aria-label={`${conversation.unread_count} unread`}>
                {formatBadgeCount(conversation.unread_count)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
