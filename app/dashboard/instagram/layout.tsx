import { InstagramShell } from '@/components/instagram/instagram-parts'

/** Every Instagram page shares the tab bar: Chats, Comments, Posts, Auto replies. */
export default function InstagramLayout({ children }: { children: React.ReactNode }) {
  return <InstagramShell>{children}</InstagramShell>
}
