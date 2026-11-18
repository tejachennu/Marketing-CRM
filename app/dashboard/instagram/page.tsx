import { Inbox } from '@/components/chat/inbox'

/** Instagram → Chats: the same inbox as Conversations, with Instagram chats only. */
export default function InstagramChatsPage() {
  return <Inbox channel="instagram" />
}
