import { Inbox } from '@/components/chat/inbox'
import { InstagramHome } from '@/components/instagram/instagram-parts'

/** Instagram: the Instagram DM inbox (same screen as Conversations, Instagram chats only). */
export default function InstagramInboxPage() {
  return <InstagramHome inbox={<Inbox channel="instagram" />} />
}
