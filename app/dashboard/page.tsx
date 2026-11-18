import { Inbox } from '@/components/chat/inbox'

/** Conversations: the team's WhatsApp inbox (Instagram DMs have their own inbox under Instagram). */
export default function ConversationsPage() {
  return <Inbox channel="whatsapp" />
}
