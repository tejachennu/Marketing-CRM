import { formatChatDayLabel } from '@/lib/chat-dates'

/** Centered date pill shown above the first message of each day, as in WhatsApp. */
export function ChatDateSeparator({ date }: { date: string | number | Date }) {
  const label = formatChatDayLabel(date)
  if (!label) return null

  return (
    <div className="relative flex justify-center py-1 select-none" role="separator" aria-label={label}>
      <span className="px-3 py-1.5 rounded-lg bg-white/95 dark:bg-[#182229] text-[12px] leading-none font-medium text-[#54656f] dark:text-[#8696a0] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
        {label}
      </span>
    </div>
  )
}
