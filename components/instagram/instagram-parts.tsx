'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Check, Clock, LayoutGrid, EyeOff, Eye, ImagePlus, Camera as Instagram, Loader2, MessageCircle, MessageSquare, Plus, RefreshCw, Reply, Send, Settings as SettingsIcon, Sparkles, Trash2, Unlink, Zap } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import { loadMetaSdk } from '@/lib/meta-sdk'
import { DEFAULT_AUTOMATION, checkCaption, type IgAutomation } from '@/lib/instagram/rules'
import { cardClass, hintClass, inputClass, labelClass, primaryButton as commerceButton, secondaryButton, textareaClass } from '@/components/commerce/ui'

// The Commerce screens' main button is WhatsApp green; Instagram uses the product's one blue
const primaryButton = commerceButton.replace('bg-[#008069] hover:bg-[#006d59]', 'bg-[#008069] hover:bg-[#006d5b]')

// Disconnect needs attention: red words on white, the one place red is used here
const disconnectButton = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl border border-[#f3caca] bg-white dark:bg-transparent text-[#b91c1c] text-xs font-bold hover:bg-[#fdf0f0] disabled:opacity-50'

interface Account { igUserId: string; username: string | null; name: string | null; picture: string | null; subscribed: boolean; lastError: string | null; slowDownMinutes?: number }
interface Comment { id: string; comment_id: string; parent_id: string | null; media_id: string | null; from_username: string | null; text: string; hidden: boolean; reply_text: string | null; replied_at: string | null; private_reply_at: string | null; created_at: string; media_type: string | null; auto_replied?: boolean; post: { image: string; link: string; caption: string } | null }
interface Post { id: string; type: string; image: string; link: string; caption: string; at: string }
interface Checks { webhook: boolean | null; messages: boolean | null }
interface Summary { unreadChats: number; openComments: number }

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}
const TONES = ['bg-[#eef1f6] text-[#0E1B3D]', 'bg-[#e1f3ec] text-[#008069]', 'bg-[#e3e8f2] text-[#4a5672]']
const tone = (name: string) => TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]
const initial = (name: string) => (name.replace('@', '').trim()[0] || 'I').toUpperCase()
const autoOn = (a: IgAutomation | null) => Boolean(a && (a.dmAi || a.commentAi || a.rules.length || a.everyComment.on || a.hideWords.length))

const DM_STEPS = 'In the Instagram app: Profile → ☰ → Settings and activity → Messages and story replies → Message controls → Connected tools → turn on "Allow access to messages".'

const DISCONNECT_ASK = 'Disconnect Instagram from WAMA CRM?\n\nNew DMs and comments stop coming in, and auto replies stop. Chats already here stay. You can connect again any time.'

/** Disconnects the workspace's Instagram. Returns an error in plain words, or null when it worked. */
async function disconnectInstagram(orgId: string): Promise<string | null> {
  const res = await fetch(`/api/instagram?organizationId=${orgId}`, { method: 'DELETE' }).catch(() => null)
  if (!res) return 'Could not reach WAMA CRM. Check the internet and try again.'
  if (res.ok) return null
  const d = await res.json().catch(() => ({}))
  return d.error || 'Instagram could not be disconnected. Try again.'
}

/** Who is looking and which workspace (the same lookup every dashboard screen does). */
function useViewer() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<RoleSubject>(null)
  useEffect(() => {
    void (async () => {
      await restoreSupabaseSession()
      const user = authSessionManager.getUser()
      if (!user?.id) return
      const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only').eq('id', user.id).maybeSingle()
      if (!profile?.organization_id) return
      setViewer({ id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only })
      setOrgId(profile.organization_id)
    })()
  }, [])
  return { orgId, viewer }
}

/**
 * Settings → Instagram: connect / disconnect the business's Instagram, what is still to do on Meta's side,
 * and Auto replies. Chats live in the Instagram inbox; comments and posts on their own page.
 */
export function InstagramSettings() {
  const { orgId, viewer } = useViewer()
  const [account, setAccount] = useState<Account | null>(null)
  const [login, setLogin] = useState<{ appId: string; configId: string } | null>(null)
  const [checks, setChecks] = useState<Checks | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [automation, setAutomation] = useState<IgAutomation | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const loadAccount = useCallback(async (organizationId: string) => {
    const res = await fetch(`/api/instagram?organizationId=${organizationId}&checks=1`)
    const data = await res.json().catch(() => ({}))
    setAccount(data.account || null)
    setLogin(data.login || null)
    setChecks(data.checks || null)
    setSummary(data.summary || null)
    setAutomation(data.automation || null)
    setLoaded(true)
  }, [])
  useEffect(() => { if (orgId) void loadAccount(orgId) }, [orgId, loadAccount])

  const canManage = can(viewer, 'settings.manage')
  const say = (ok: boolean, text: string) => setMessage({ ok, text })

  async function connect() {
    if (!orgId || !login?.appId || !login.configId) { say(false, 'Instagram login is not set up on this server yet (NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID).'); return }
    if (window.location.protocol !== 'https:') { say(false, 'Meta opens its login window only on https pages.'); return }
    setBusy('connect')
    try {
      const FB = await loadMetaSdk(login.appId)
      FB.login((response: any) => {
        const code = response?.authResponse?.code
        if (!code) { setBusy(null); say(false, 'The Instagram login was closed before it finished.'); return }
        fetch('/api/instagram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, code }) })
          .then(async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || 'Could not connect.'); say(true, `@${d.account?.username || 'Instagram'} is connected.`); await loadAccount(orgId) })
          .catch((e) => say(false, e.message))
          .finally(() => setBusy(null))
      }, { config_id: login.configId, response_type: 'code', override_default_response_type: true })
    } catch (e: any) {
      setBusy(null)
      say(false, e.message)
    }
  }

  async function disconnect() {
    if (!orgId || !window.confirm(DISCONNECT_ASK)) return
    setBusy('disconnect')
    const error = await disconnectInstagram(orgId)
    setBusy(null)
    if (error) { say(false, error); return }
    say(true, `@${account?.username || 'Instagram'} is disconnected. Chats already here stay.`)
    setAccount(null)
  }

  async function resubscribe() {
    if (!orgId) return
    setBusy('resubscribe')
    const res = await fetch('/api/instagram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, action: 'resubscribe' }) })
    const d = await res.json().catch(() => ({}))
    if (d.account) setAccount(d.account)
    say(Boolean(d.success), d.success ? 'Instagram will send DMs and comments here.' : d.account?.lastError || 'Instagram did not accept it. Try connecting again.')
    setBusy(null)
  }

  const slow = account?.slowDownMinutes || 0
  return (
    <div className="space-y-4 sm:space-y-5">
      {message && (
        <p role="status" className={`p-3 rounded-xl text-sm flex gap-2 ${message.ok ? 'bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
          {message.ok ? <Check size={16} className="shrink-0 mt-0.5 text-[#008069]" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />} {message.text}
        </p>
      )}

      {!loaded ? (
        <div className={`${cardClass} py-12 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
      ) : !account ? (
        <section className={`${cardClass} p-5 sm:p-6 space-y-3`}>
          <div className="flex items-center gap-3">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#0E1B3D] flex items-center justify-center text-white"><Instagram size={20} /></span>
            <h2 className="text-base font-bold">Connect your Instagram professional account</h2>
          </div>
          <ul className="text-sm text-[#4a5672] dark:text-slate-300 list-disc pl-5 space-y-1">
            <li>DMs arrive in their own Instagram inbox, with AI replies from your knowledge base.</li>
            <li>See and answer comments on your posts and reels, by hand or automatically.</li>
            <li>Show your latest posts on your online store, and post product photos from WAMA CRM.</li>
          </ul>
          <p className={hintClass}>You log in with Facebook or Instagram and pick your business and Instagram account. Your Instagram must be a Business or Creator account.</p>
          {canManage ? (
            <button type="button" onClick={connect} disabled={busy !== null} className={primaryButton}>{busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={14} />} Connect Instagram</button>
          ) : <p className={hintClass}>Ask an admin of your workspace to connect Instagram.</p>}
        </section>
      ) : (
        <>
          <section className={`${cardClass} p-4 sm:p-5 flex flex-wrap items-center gap-3`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {account.picture ? <img src={account.picture} alt="" className="h-12 w-12 rounded-full object-cover border border-[#e3e8f2]" /> : <span className="h-12 w-12 rounded-full bg-[#eef1f6] flex items-center justify-center"><Instagram size={20} /></span>}
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate">@{account.username || 'instagram'}</p>
              {account.lastError ? <p className="text-xs text-[#b91c1c]">{account.lastError}</p>
                : slow ? <p className="text-xs text-[#6B7894] flex items-center gap-1"><Clock size={12} className="shrink-0" /> Instagram asked us to slow down. Checking again in about {slow} min.</p>
                : <p className="text-xs text-[#6B7894] flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#008069]" /> Connected</p>}
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {(!account.subscribed || account.lastError) && <button type="button" onClick={resubscribe} disabled={busy !== null} className={secondaryButton}><RefreshCw size={13} /> Try again</button>}
                {account.lastError?.includes('connecting again') && <button type="button" onClick={connect} disabled={busy !== null} className={secondaryButton}><Instagram size={13} /> Connect again</button>}
                <button type="button" onClick={disconnect} disabled={busy !== null} className={disconnectButton}>{busy === 'disconnect' ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />} Disconnect</button>
              </div>
            )}
          </section>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Tile label="Unread messages" value={String(summary?.unreadChats ?? 0)} icon={MessageSquare} href="/dashboard/instagram" />
            <Tile label="Comments waiting" value={String(summary?.openComments ?? 0)} icon={MessageCircle} href="/dashboard/instagram/comments" />
            <Tile label="Auto replies" value={autoOn(automation) ? 'On' : 'Off'} icon={Zap} href="#instagram-auto" />
          </div>

          {canManage && checks && (checks.webhook === false || checks.messages === false) && <SetupChecklist checks={checks} />}

          {orgId && (
            <div id="instagram-auto" className="space-y-3 scroll-mt-20">
              <h2 className="text-base font-bold flex items-center gap-2"><Zap size={17} className="text-[#008069]" /> Auto replies</h2>
              <AutoRepliesPanel orgId={orgId} initial={automation || DEFAULT_AUTOMATION} canEdit={can(viewer, 'automation.manage')} onSaved={setAutomation} />
            </div>
          )}

          {canManage && (
            <section className={`${cardClass} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold">Disconnect Instagram</h2>
                <p className={hintClass}>New DMs and comments stop coming in, and auto replies stop. Chats already here stay. You can connect again any time.</p>
              </div>
              <button type="button" onClick={disconnect} disabled={busy !== null} className={`${disconnectButton} self-start sm:self-auto`}>{busy === 'disconnect' ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />} Disconnect @{account.username || 'instagram'}</button>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** Instagram → Comments and posts (chats are in the Instagram inbox). */
// ── The Instagram section: one tab bar over Chats, Comments, Posts and Auto replies ──────────────

interface Shell { orgId: string; viewer: RoleSubject; account: Account; summary: Summary | null; automation: IgAutomation | null; setAutomation: (a: IgAutomation) => void; refresh: () => void }
const ShellContext = createContext<Shell | null>(null)
const useShell = () => useContext(ShellContext)

const TABS = [
  { href: '/dashboard/instagram', label: 'Chats', icon: MessageSquare, count: (s: Summary | null) => s?.unreadChats || 0 },
  { href: '/dashboard/instagram/comments', label: 'Comments', icon: MessageCircle, count: (s: Summary | null) => s?.openComments || 0 },
  { href: '/dashboard/instagram/posts', label: 'Posts', icon: LayoutGrid, count: () => 0 },
  { href: '/dashboard/instagram/auto-replies', label: 'Auto replies', icon: Zap, count: () => 0 },
]

/**
 * Wraps every Instagram page (app/dashboard/instagram/layout.tsx): checks Instagram is connected (else a way
 * to connect), then the tab bar with counts, the account and Settings. On phones the bar steps aside while
 * a chat is open, like the main bottom bar.
 */
export function InstagramShell({ children }: { children: React.ReactNode }) {
  const { orgId, viewer } = useViewer()
  const pathname = usePathname()
  const [state, setState] = useState<'loading' | 'connected' | 'none'>('loading')
  const [account, setAccount] = useState<Account | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [automation, setAutomation] = useState<IgAutomation | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  const refresh = useCallback(() => {
    if (!orgId) return
    void fetch(`/api/instagram?organizationId=${orgId}`).then((r) => r.json()).then((d) => {
      setAccount(d.account || null)
      setSummary(d.summary || null)
      setAutomation(d.automation || null)
      setState(d.account ? 'connected' : 'none')
    }).catch(() => setState((s) => (s === 'loading' ? 'none' : s)))
  }, [orgId])
  useEffect(() => { refresh() }, [refresh, pathname])
  useEffect(() => {
    if (!orgId) return
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
  }, [orgId, refresh])
  useEffect(() => {
    const onChat = (e: Event) => setChatOpen(Boolean((e as CustomEvent).detail?.hasActiveConversation))
    window.addEventListener('active-conversation-changed', onChat)
    return () => window.removeEventListener('active-conversation-changed', onChat)
  }, [])

  if (state === 'loading' || !orgId) return <div className="h-full flex items-center justify-center bg-[#f4f6fa] dark:bg-[#0b141a]"><Loader2 className="animate-spin text-slate-400" /></div>
  if (state === 'none' || !account) return <InstagramNotConnected canConnect={can(viewer, 'settings.manage')} />

  const onChats = pathname === '/dashboard/instagram'
  return (
    <ShellContext.Provider value={{ orgId, viewer, account, summary, automation, setAutomation, refresh }}>
      <div className="h-full flex flex-col min-h-0 bg-[#f4f6fa] dark:bg-[#0b141a] text-slate-900 dark:text-slate-100">
        <div className={`${onChats && chatOpen ? 'hidden md:flex' : 'flex'} shrink-0 items-center gap-2 h-12 pl-2 pr-3 sm:px-4 bg-white dark:bg-[#111b21] border-b border-[#e3e8f2] dark:border-slate-800`}>
          <nav aria-label="Instagram" className="flex-1 min-w-0 flex items-stretch h-full overflow-x-auto no-scrollbar">
            {TABS.map(({ href, label, icon: Icon, count }) => {
              const on = href === '/dashboard/instagram' ? onChats : pathname.startsWith(href)
              const n = count(summary)
              return (
                <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={`relative shrink-0 flex items-center gap-1.5 px-3 text-[13px] font-semibold whitespace-nowrap ${on ? 'text-[#0E1B3D] dark:text-white' : 'text-[#6B7894] hover:text-[#0E1B3D] dark:hover:text-white'}`}>
                  <Icon size={15} />
                  {label}
                  {n > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#008069] text-white text-[11px] font-bold flex items-center justify-center">{n > 99 ? '99+' : n}</span>}
                  {on && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#008069]" />}
                </Link>
              )
            })}
          </nav>
          <AccountMenu orgId={orgId} account={account} canManage={can(viewer, 'settings.manage')} onDisconnected={() => { setAccount(null); setState('none') }} />
        </div>
        {account.lastError && (
          <p className="shrink-0 px-4 py-2 text-xs bg-[#fdf0f0] text-[#b91c1c] flex items-center gap-1.5"><AlertCircle size={13} className="shrink-0" /> {account.lastError} <Link href="/dashboard/settings?tab=instagram" className="underline font-semibold">Fix in Settings</Link></p>
        )}
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </ShellContext.Provider>
  )
}

/** The connected account in the tab bar: a tap opens Instagram settings and (admins) Disconnect. */
function AccountMenu({ orgId, account, canManage, onDisconnected }: { orgId: string; account: Account; canManage: boolean; onDisconnected: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  async function disconnect() {
    if (!window.confirm(DISCONNECT_ASK)) return
    setBusy(true)
    setError(null)
    const problem = await disconnectInstagram(orgId)
    setBusy(false)
    if (problem) { setError(problem); return }
    setOpen(false)
    onDisconnected()
  }

  const item = 'w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold rounded-lg'
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Instagram account" className="h-8 flex items-center gap-2 pl-1 pr-2 rounded-full text-xs font-semibold text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {account.picture ? <img src={account.picture} alt="" className="h-6 w-6 rounded-full object-cover border border-[#e3e8f2]" /> : <span className="h-6 w-6 rounded-full bg-[#eef1f6] flex items-center justify-center"><Instagram size={13} /></span>}
        <span className="hidden sm:block truncate max-w-[140px]">@{account.username}</span>
        <SettingsIcon size={15} className="text-[#6B7894]" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-30 w-64 max-w-[calc(100vw-24px)] p-1.5 rounded-xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 shadow-lg">
          <p className="px-3 pt-1.5 pb-2 text-xs text-[#6B7894] truncate">Connected as <span className="font-bold text-[#0E1B3D] dark:text-white">@{account.username}</span></p>
          <Link role="menuitem" href="/dashboard/settings?tab=instagram" onClick={() => setOpen(false)} className={`${item} text-[#0E1B3D] dark:text-slate-100 hover:bg-[#f4f6fa] dark:hover:bg-slate-800`}><SettingsIcon size={15} className="text-[#6B7894]" /> Instagram settings</Link>
          {canManage && (
            <button role="menuitem" type="button" onClick={disconnect} disabled={busy} className={`${item} text-[#b91c1c] hover:bg-[#fdf0f0] disabled:opacity-50`}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Unlink size={15} />} Disconnect Instagram</button>
          )}
          {error && <p className="px-3 py-2 text-xs text-[#b91c1c]">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** A tab's page: scrolls on its own under the tab bar. */
function TabPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`${wide ? 'max-w-6xl' : 'max-w-4xl'} mx-auto p-4 pb-24 md:p-6 space-y-4`}>{children}</div>
    </div>
  )
}

/** Instagram → Comments. */
export function InstagramCommentsTab() {
  const shell = useShell()
  if (!shell) return null
  return <TabPage wide><CommentsPanel orgId={shell.orgId} canReply={can(shell.viewer, 'records.write')} me={shell.account} onChange={shell.refresh} /></TabPage>
}

/** Instagram → Posts. */
export function InstagramPostsTab() {
  const shell = useShell()
  if (!shell) return null
  return <TabPage><PostsPanel orgId={shell.orgId} canPost={can(shell.viewer, 'automation.manage')} /></TabPage>
}

/** Instagram → Auto replies (the same settings as Settings → Instagram). */
export function InstagramAutoRepliesTab() {
  const shell = useShell()
  if (!shell) return null
  return (
    <TabPage>
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Zap size={18} className="text-[#008069]" /> Auto replies</h1>
        <p className="text-xs text-[#6B7894] dark:text-slate-400 mt-0.5">Answer DMs and comments by themselves: with AI from your knowledge base, or with your own words for chosen keywords.</p>
      </div>
      <AutoRepliesPanel orgId={shell.orgId} initial={shell.automation || DEFAULT_AUTOMATION} canEdit={can(shell.viewer, 'automation.manage')} onSaved={(a) => { shell.setAutomation(a); shell.refresh() }} />
    </TabPage>
  )
}

/** Shown in the Instagram menu when no account is connected yet. */
export function InstagramNotConnected({ canConnect }: { canConnect: boolean }) {
  return (
    <div className="h-full overflow-y-auto bg-[#f4f6fa] dark:bg-[#0b141a] flex items-center justify-center p-4">
      <div className={`${cardClass} max-w-md w-full p-6 sm:p-8 text-center space-y-3`}>
        <span className="mx-auto h-14 w-14 rounded-2xl bg-[#0E1B3D] flex items-center justify-center text-white"><Instagram size={24} /></span>
        <h1 className="text-lg font-bold">Bring your Instagram DMs here</h1>
        <p className="text-sm text-[#4a5672] dark:text-slate-300">Answer Instagram DMs and comments with your team, with AI replies from your knowledge base.</p>
        {canConnect
          ? <Link href="/dashboard/settings?tab=instagram" className={`${primaryButton} justify-center`}><Instagram size={14} /> Connect Instagram</Link>
          : <p className={hintClass}>Ask an admin of your workspace to connect Instagram in Settings.</p>}
      </div>
    </div>
  )
}

function Tile({ label, value, icon: Icon, href }: { label: string; value: string; icon: typeof Zap; href: string }) {
  return (
    <Link href={href} className={`${cardClass} p-3 sm:p-4 text-left hover:border-[#d5ddeb] min-w-0 block`}>
      <span className="flex items-center gap-1.5 text-[11px] sm:text-xs text-[#6B7894] dark:text-slate-400"><Icon size={13} className="shrink-0" /> <span className="truncate">{label}</span></span>
      <span className="block text-lg sm:text-2xl font-bold mt-1 text-[#0E1B3D] dark:text-white">{value}</span>
    </Link>
  )
}

/** What still keeps DMs and comments from arriving on their own (admins only). */
function SetupChecklist({ checks }: { checks: Checks }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
      <h2 className="text-sm font-bold flex items-center gap-2"><AlertCircle size={16} className="text-[#b91c1c]" /> Still to do</h2>
      {checks.messages === false && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">Allow messages in the Instagram app</p>
          <p className="text-[#4a5672] dark:text-slate-300">Instagram is keeping your DMs inside its own app. {DM_STEPS}</p>
        </div>
      )}
      {checks.webhook === false && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">Send new DMs and comments here as they happen</p>
          <p className="text-[#4a5672] dark:text-slate-300 break-words">Meta app → Instagram → API setup with Facebook login → Configure webhooks. Callback URL <code className="text-xs bg-[#eef1f6] dark:bg-slate-800 px-1 rounded">{origin}/api/webhooks/instagram</code>, verify token = the <code className="text-xs bg-[#eef1f6] dark:bg-slate-800 px-1 rounded">INSTAGRAM_WEBHOOK_VERIFY_TOKEN</code> set in Vercel. Subscribe to messages and comments.</p>
          <p className={hintClass}>Meta sends comments only after App Review (Advanced Access) with the app Live. Until then this page checks Instagram each time you open it or press Check now.</p>
        </div>
      )}
    </section>
  )
}

function SlowNote({ minutes }: { minutes: number }) {
  if (!minutes) return null
  return <p className="p-3 rounded-xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 text-sm text-[#4a5672] dark:text-slate-300 flex gap-2"><Clock size={16} className="shrink-0 mt-0.5" /> Instagram asked us to slow down for a while. What you see is saved; we check again in about {minutes} min.</p>
}

function RefreshButton({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="h-8 shrink-0 px-3 rounded-full border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] flex items-center gap-1.5 text-xs font-semibold text-[#4a5672] dark:text-slate-300 cursor-pointer" aria-label={label} title={label}>
      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Check now</span>
    </button>
  )
}

function Empty({ icon: Icon, title, text }: { icon: typeof Zap; title: string; text: string }) {
  return (
    <div className={`${cardClass} p-8 text-center`}>
      <span className="mx-auto h-11 w-11 rounded-full bg-[#eef1f6] dark:bg-slate-800 flex items-center justify-center text-[#6B7894]"><Icon size={20} /></span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-[#6B7894]">{text}</p>
    </div>
  )
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  return when(iso)
}
const waitingOn = (c: Comment) => !c.replied_at && !c.private_reply_at && !c.hidden && !c.parent_id

function Avatar({ name, picture, size = 'md' }: { name: string; picture?: string | null; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-sm'
  // eslint-disable-next-line @next/next/no-img-element
  if (picture) return <img src={picture} alt="" className={`${box} shrink-0 rounded-full object-cover border border-[#e3e8f2]`} />
  return <span className={`${box} shrink-0 rounded-full flex items-center justify-center font-bold ${tone(name)}`}>{initial(name)}</span>
}

function PostThumb({ post, size }: { post: Comment['post']; size: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (post?.image) return <img src={post.image} alt="" className={`${size} shrink-0 rounded-lg object-cover border border-[#e3e8f2] dark:border-slate-700`} />
  return <span className={`${size} shrink-0 rounded-lg bg-[#eef1f6] dark:bg-slate-800 flex items-center justify-center text-[#8a94a8]`}><ImagePlus size={16} /></span>
}

interface PostThread { key: string; post: Comment['post']; mediaType: string | null; top: Comment[]; replies: Map<string, Comment[]>; total: number; waiting: number; latest: string }

/** Comments by post, like Instagram: posts on the left (waiting first), the post's thread on the right. */
function CommentsPanel({ orgId, canReply, me, onChange }: { orgId: string; canReply: boolean; me: Account | null; onChange: () => void }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [list, setList] = useState<Comment[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [draft, setDraft] = useState('')
  const [asDm, setAsDm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const [syncing, setSyncing] = useState(false)

  // While Instagram is being checked, a plain reload would only bring the older list back (and could land last)
  const checking = useRef(false)
  const load = useCallback(async (sync = false) => {
    if (!sync && checking.current) return
    if (sync) { setSyncing(true); checking.current = true }
    const res = await fetch(`/api/instagram/comments?organizationId=${orgId}&filter=all${sync ? '&sync=1' : ''}`).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setList(d.comments || [])
    if (sync) {
      checking.current = false
      setSyncing(false)
      setWait(Number(d.waitMinutes) || 0)
      if (d.syncError) setError(`Could not read new comments from Instagram: ${d.syncError}`)
      onChange()
    }
  }, [orgId, onChange])
  const first = useRef(true)
  useEffect(() => { void load(first.current); first.current = false }, [load])

  const threads = useMemo(() => {
    const byPost = new Map<string, PostThread>()
    const ids = new Set((list || []).map((c) => c.comment_id))
    for (const c of list || []) {
      const key = c.media_id || 'other'
      const t: PostThread = byPost.get(key) || { key, post: c.post, mediaType: c.media_type, top: [], replies: new Map(), total: 0, waiting: 0, latest: c.created_at }
      if (c.parent_id && ids.has(c.parent_id)) t.replies.set(c.parent_id, [...(t.replies.get(c.parent_id) || []), c])
      else t.top.push(c)
      t.total++
      if (waitingOn(c)) t.waiting++
      if (c.created_at > t.latest) t.latest = c.created_at
      t.post = t.post || c.post
      byPost.set(key, t)
    }
    for (const t of byPost.values()) {
      t.top.sort((a, b) => a.created_at.localeCompare(b.created_at))
      for (const r of t.replies.values()) r.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
    return [...byPost.values()].sort((a, b) => (b.waiting > 0 ? 1 : 0) - (a.waiting > 0 ? 1 : 0) || b.latest.localeCompare(a.latest))
  }, [list])
  const shownThreads = filter === 'open' ? threads.filter((t) => t.waiting > 0) : threads
  const current = shownThreads.find((t) => t.key === selected) || null
  const thread = current || shownThreads[0] || null

  function startReply(c: Comment) {
    setReplyTo(c)
    setAsDm(false)
    setError('')
    // Instagram answers only top comments: a reply to a reply goes under its comment, naming the person
    setDraft(c.parent_id && c.from_username ? `@${c.from_username} ` : '')
  }

  async function act(c: Comment, action: string, text = '') {
    setBusy(`${c.comment_id}:${action}`)
    setError('')
    const res = await fetch('/api/instagram/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, commentId: c.comment_id, action, text }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setError(d.error || 'That did not work.')
    else { setReplyTo(null); setDraft(''); await load(); onChange() }
    setBusy(null)
  }

  function sendReply() {
    if (!replyTo || !draft.trim()) return
    const target = replyTo.parent_id ? (list || []).find((x) => x.comment_id === replyTo.parent_id) || replyTo : replyTo
    void act(target, asDm ? 'private' : 'reply', draft.trim())
  }

  const dmAllowed = (c: Comment) => !c.private_reply_at && Date.now() - Date.parse(c.created_at) < 7 * 86_400_000

  // A plain render function, not a component: a component made inside this one would be new on every
  // keystroke, and the reply box would lose what is being typed
  const renderComment = (c: Comment, nested = false) => {
    const who = c.from_username || 'someone'
    const replies = thread?.replies.get(c.comment_id) || []
    return (
      <div key={c.id} className={`flex gap-3 ${nested ? 'mt-3' : ''}`}>
        <Avatar name={who} size={nested ? 'sm' : 'md'} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-snug break-words ${c.hidden ? 'text-[#8a94a8]' : ''}`}><b className="font-semibold text-[#0E1B3D] dark:text-white mr-1.5">{who}</b>{c.text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[#8a94a8]">
            <span className="font-normal">{ago(c.created_at)}</span>
            {waitingOn(c) && <span className="inline-flex items-center gap-1 text-[#008069]"><span className="h-1.5 w-1.5 rounded-full bg-[#008069]" /> Waiting</span>}
            {c.hidden && <span className="inline-flex items-center gap-1"><EyeOff size={11} /> Hidden</span>}
            {canReply && <button type="button" onClick={() => startReply(c)} className="hover:text-[#0E1B3D] dark:hover:text-white cursor-pointer">Reply</button>}
            {canReply && <button type="button" disabled={busy !== null} onClick={() => act(c, c.hidden ? 'unhide' : 'hide')} className="hover:text-[#0E1B3D] dark:hover:text-white cursor-pointer">{busy === `${c.comment_id}:hide` || busy === `${c.comment_id}:unhide` ? 'Saving…' : c.hidden ? 'Show' : 'Hide'}</button>}
            {canReply && <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(`Delete @${who}'s comment from Instagram?`)) void act(c, 'delete') }} className="hover:text-[#b91c1c] cursor-pointer">Delete</button>}
          </div>

          {c.reply_text && (
            <div className="mt-3 flex gap-2.5">
              <Avatar name={me?.username || 'You'} picture={me?.picture} size="sm" />
              <div className="min-w-0">
                <p className="text-sm leading-snug break-words"><b className="font-semibold text-[#0E1B3D] dark:text-white mr-1.5">{me?.username || 'You'}</b>{c.reply_text}</p>
                <p className="mt-1 text-xs text-[#8a94a8] flex items-center gap-2">
                  {c.private_reply_at && !c.replied_at ? <span className="inline-flex items-center gap-1"><MessageCircle size={11} /> Sent as a DM</span> : <span>{c.replied_at ? ago(c.replied_at) : ''}</span>}
                  {c.auto_replied && <span className="inline-flex items-center gap-0.5 font-semibold text-[#008069]"><Zap size={11} /> Auto reply</span>}
                </p>
              </div>
            </div>
          )}

          {replies.map((r) => renderComment(r, true))}

          {replyTo?.comment_id === c.comment_id && (
            <div className="mt-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] focus-within:border-[#008069]">
              <textarea autoFocus rows={2} maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendReply() } }}
                placeholder={`Reply to ${who}…`} className="w-full bg-transparent text-sm resize-none outline-none px-3 pt-2.5" />
              <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
                {dmAllowed(c.parent_id ? (list || []).find((x) => x.comment_id === c.parent_id) || c : c) && (
                  <label className="flex items-center gap-1.5 text-xs text-[#4a5672] dark:text-slate-300 cursor-pointer pl-1" title="Instagram allows one DM per comment, within 7 days">
                    <input type="checkbox" checked={asDm} onChange={(e) => setAsDm(e.target.checked)} className="accent-[#008069]" /> Send as a DM instead
                  </label>
                )}
                <span className="flex-1" />
                <button type="button" onClick={() => { setReplyTo(null); setDraft('') }} className="h-8 px-3 rounded-lg text-xs font-semibold text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">Cancel</button>
                <button type="button" disabled={busy !== null || !draft.trim()} onClick={sendReply} className="h-8 px-4 rounded-lg text-xs font-bold bg-[#008069] hover:bg-[#006d5b] text-white disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5">
                  {busy?.endsWith(':reply') || busy?.endsWith(':private') ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {asDm ? 'Send DM' : 'Post'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        {(['open', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => { setFilter(f); setSelected(null) }} className={`h-8 px-3 rounded-full border cursor-pointer font-semibold ${filter === f ? 'border-[#008069] bg-[#e1f3ec] text-[#008069]' : 'border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[#4a5672]'}`}>
            {f === 'open' ? `Waiting${threads.reduce((n, t) => n + t.waiting, 0) ? ` · ${threads.reduce((n, t) => n + t.waiting, 0)}` : ''}` : 'All comments'}
          </button>
        ))}
        <span className="ml-auto" />
        <RefreshButton busy={syncing} onClick={() => { setError(''); void load(true) }} label="Check Instagram for new comments" />
      </div>
      <SlowNote minutes={wait} />
      {error && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">{error}</p>}

      {list === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : shownThreads.length === 0 ? <Empty icon={MessageCircle} title={filter === 'open' ? 'All caught up' : 'No comments yet'} text={filter === 'open' ? 'Every comment has an answer. New ones show here.' : 'New comments on your posts and reels show here.'} />
        : (
          <div className={`${cardClass} overflow-hidden md:grid md:grid-cols-[300px_1fr] md:h-[calc(100dvh-170px)] md:min-h-[420px]`}>
            {/* Posts with comments */}
            <div className={`${current ? 'hidden md:block' : 'block'} md:border-r border-[#eef1f6] dark:border-slate-800 md:overflow-y-auto`}>
              <p className="px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#8a94a8]">Posts and reels</p>
              <ul>
                {shownThreads.map((t) => {
                  const on = thread?.key === t.key
                  return (
                    <li key={t.key}>
                      <button type="button" onClick={() => { setSelected(t.key); setReplyTo(null) }} className={`w-full text-left flex items-center gap-3 px-4 py-3 cursor-pointer border-l-2 ${on ? 'md:bg-[#f4f6fa] md:dark:bg-slate-800/60 md:border-[#008069] border-transparent' : 'border-transparent hover:bg-[#f4f6fa] dark:hover:bg-slate-800/40'}`}>
                        <PostThumb post={t.post} size="h-12 w-12" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-[#0E1B3D] dark:text-slate-100 truncate">{t.post?.caption?.split('\n')[0] || (t.mediaType === 'REELS' ? 'Reel' : 'Post')}</span>
                          <span className="block text-xs text-[#8a94a8] mt-0.5">{t.total} {t.total === 1 ? 'comment' : 'comments'} · {ago(t.latest)}</span>
                        </span>
                        {t.waiting > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#008069] text-white text-[11px] font-bold flex items-center justify-center">{t.waiting}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* The post and its comments */}
            {thread && (
              <div className={`${current ? 'flex' : 'hidden md:flex'} flex-col min-w-0 md:overflow-hidden`}>
                <div className="flex items-start gap-3 p-4 border-b border-[#eef1f6] dark:border-slate-800">
                  <button type="button" onClick={() => { setSelected(null); setReplyTo(null) }} className="md:hidden h-9 w-9 -ml-1 shrink-0 rounded-full flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] cursor-pointer" aria-label="Back to posts"><ArrowLeft size={17} /></button>
                  <PostThumb post={thread.post} size="h-14 w-14" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#0E1B3D] dark:text-slate-100 line-clamp-2 break-words">{thread.post?.caption || (thread.mediaType === 'REELS' ? 'Reel' : 'Post')}</p>
                    <p className="text-xs text-[#8a94a8] mt-1">{thread.total} {thread.total === 1 ? 'comment' : 'comments'}{thread.waiting ? ` · ${thread.waiting} waiting` : ''}</p>
                  </div>
                  {thread.post?.link && <a href={thread.post.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-semibold text-[#008069] hover:underline whitespace-nowrap">Open on Instagram</a>}
                </div>
                <div className="flex-1 md:overflow-y-auto p-4 space-y-5">
                  {thread.top.map((c) => renderComment(c))}
                </div>
              </div>
            )}
          </div>
        )}
    </section>
  )
}

function Switch({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-[#6B7894] dark:text-slate-400 mt-0.5">{hint}</span>
      </span>
      <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${on ? 'bg-[#008069]' : 'bg-[#d5ddeb] dark:bg-slate-700'}`}><span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} /></span>
    </label>
  )
}

/** Automatic replies: AI for DMs and comments, keyword replies, a reply for every other comment, words to hide. */
function AutoRepliesPanel({ orgId, initial: start, canEdit, onSaved }: { orgId: string; initial: IgAutomation; canEdit: boolean; onSaved: (a: IgAutomation) => void }) {
  const [a, setA] = useState<IgAutomation>(start)
  const [keywords, setKeywords] = useState<string[]>(start.rules.map((r) => r.keywords.join(', ')))
  const [hide, setHide] = useState(start.hideWords.join(', '))
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const setRule = (i: number, patch: Partial<IgAutomation['rules'][number]>) => setA((x) => ({ ...x, rules: x.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  const addRule = () => { setA((x) => ({ ...x, rules: [...x.rules, { keywords: [], reply: '', dm: '' }] })); setKeywords((k) => [...k, '']) }
  const removeRule = (i: number) => { setA((x) => ({ ...x, rules: x.rules.filter((_, j) => j !== i) })); setKeywords((k) => k.filter((_, j) => j !== i)) }

  async function save() {
    setSaving(true)
    setNote(null)
    const automation = { ...a, rules: a.rules.map((r, i) => ({ ...r, keywords: (keywords[i] || '').split(',').map((w) => w.trim()).filter(Boolean) })), hideWords: hide.split(',').map((w) => w.trim()).filter(Boolean) }
    const res = await fetch('/api/instagram', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, automation }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setNote({ ok: false, text: d.error || 'Could not save.' })
    else {
      setNote({ ok: true, text: 'Saved. New DMs and comments get these replies.' })
      onSaved(d.automation)
      setA(d.automation)
      setKeywords(d.automation.rules.map((r: { keywords: string[] }) => r.keywords.join(', ')))
    }
    setSaving(false)
  }

  const off = !canEdit
  return (
    <section className="space-y-4">
      {off && <p className={`${cardClass} p-3 text-xs text-[#6B7894]`}>Only managers can change automatic replies.</p>}

      <div className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <h2 className="text-sm font-bold flex items-center gap-2"><Sparkles size={16} className="text-[#008069]" /> AI replies</h2>
        <Switch disabled={off} on={a.dmAi} onChange={(v) => setA((x) => ({ ...x, dmAi: v }))} label="AI answers DMs" hint="Answers from your knowledge base in the customer's language. When it can't answer, the chat goes to your team. Turn AI off in one chat to answer it yourself." />
        <Switch disabled={off} on={a.commentAi} onChange={(v) => setA((x) => ({ ...x, commentAi: v }))} label="AI replies to comments" hint="A short public reply when your knowledge base has the answer, and a warm thank-you for praise. It stays quiet on complaints and spam. Keyword replies below come first." />
      </div>

      <div className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2"><Zap size={16} className="text-[#008069]" /> Keyword replies for comments</h2>
          <p className={hintClass}>When a comment has one of the words, reply in public, send a DM, or both. Example: &quot;price, cost, rate&quot; → public &quot;Sent you a DM {'{name}'}&quot; + a DM with the price list. {'{name}'} becomes their @username.</p>
        </div>
        {a.rules.map((r, i) => (
          <div key={i} className="rounded-xl border border-[#e3e8f2] dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#4a5672]">Reply {i + 1}</span>
              {!off && <button type="button" onClick={() => removeRule(i)} className="ml-auto h-7 w-7 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f4f6fa] cursor-pointer" aria-label={`Remove reply ${i + 1}`}><Trash2 size={13} /></button>}
            </div>
            <div>
              <label className={labelClass} htmlFor={`kw-${i}`}>When a comment has any of these words</label>
              <input id={`kw-${i}`} disabled={off} value={keywords[i] || ''} onChange={(e) => setKeywords((k) => k.map((x, j) => (j === i ? e.target.value : x)))} placeholder="price, cost, rate, ధర, कीमत" className={inputClass} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor={`rp-${i}`}>Public reply</label>
                <textarea id={`rp-${i}`} disabled={off} rows={2} maxLength={900} value={r.reply} onChange={(e) => setRule(i, { reply: e.target.value })} placeholder="Sent you a DM {name}" className={textareaClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor={`dm-${i}`}>DM to them</label>
                <textarea id={`dm-${i}`} disabled={off} rows={2} maxLength={900} value={r.dm} onChange={(e) => setRule(i, { dm: e.target.value })} placeholder="Hi! It's ₹1,299. Order here: …" className={textareaClass} />
              </div>
            </div>
          </div>
        ))}
        {!off && a.rules.length < 20 && <button type="button" onClick={addRule} className={secondaryButton}><Plus size={13} /> Add a keyword reply</button>}
      </div>

      <div className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <Switch disabled={off} on={a.everyComment.on} onChange={(v) => setA((x) => ({ ...x, everyComment: { ...x.everyComment, on: v } }))} label="Reply to every other comment" hint="For comments no keyword reply matched (and the AI didn't answer)." />
        {a.everyComment.on && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="every-reply">Public reply</label>
              <textarea id="every-reply" disabled={off} rows={2} maxLength={900} value={a.everyComment.reply} onChange={(e) => setA((x) => ({ ...x, everyComment: { ...x.everyComment, reply: e.target.value } }))} placeholder="Thank you {name}!" className={textareaClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="every-dm">DM to them (optional)</label>
              <textarea id="every-dm" disabled={off} rows={2} maxLength={900} value={a.everyComment.dm} onChange={(e) => setA((x) => ({ ...x, everyComment: { ...x.everyComment, dm: e.target.value } }))} className={textareaClass} />
            </div>
          </div>
        )}
      </div>

      <div className={`${cardClass} p-4 sm:p-5 space-y-2`}>
        <h2 className="text-sm font-bold flex items-center gap-2"><EyeOff size={16} className="text-[#008069]" /> Hide comments with these words</h2>
        <input disabled={off} value={hide} onChange={(e) => setHide(e.target.value)} placeholder="spam words, abuse, competitor names…" className={inputClass} aria-label="Words to hide" />
        <p className={hintClass}>Hidden comments stay visible to the person who wrote them, and you can show them again from Comments.</p>
      </div>

      <p className="text-xs text-[#6B7894] dark:text-slate-400">Each comment is answered once, only if it is less than a day old, and Instagram allows one DM per comment. Replies go out the moment Instagram tells us (webhooks); until those are on, whenever this page checks Instagram.</p>
      {note && <p role="status" className={`text-sm ${note.ok ? 'text-[#0E1B3D] dark:text-slate-200' : 'text-[#b91c1c]'}`}>{note.text}</p>}
      {canEdit && <button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save auto replies</button>}
    </section>
  )
}

function PostsPanel({ orgId, canPost }: { orgId: string; canPost: boolean }) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [composing, setComposing] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(0)
  const [link, setLink] = useState('')
  const [showLink, setShowLink] = useState(false)
  const [caption, setCaption] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (fresh = false) => {
    if (fresh) setRefreshing(true)
    const res = await fetch(`/api/instagram/posts?organizationId=${orgId}${fresh ? '&fresh=1' : ''}`).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setPosts(d.posts || [])
    setRefreshing(false)
  }, [orgId])
  useEffect(() => { void load() }, [load])

  async function publish() {
    const check = checkCaption(caption)
    if ('error' in check) { setNote({ ok: false, text: check.error }); return }
    setBusy(true)
    setNote(null)
    // The server deletes photos uploaded for this post once Instagram has it
    const res = await fetch('/api/instagram/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, images, caption }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setNote({ ok: false, text: d.error || 'Could not post.' })
    else { setNote({ ok: true, text: 'Posted on Instagram.' }); reset(); await load(true) }
    setBusy(false)
  }

  function reset() {
    setImages([]); setCaption(''); setLink(''); setShowLink(false); setComposing(false)
  }

  /** Photos picked on the device: each is saved as a JPEG Instagram accepts and shown as a thumbnail. */
  async function upload(files: FileList | null) {
    const picked = Array.from(files || []).slice(0, 10 - images.length)
    if (fileInput.current) fileInput.current.value = ''
    if (!picked.length) return
    setNote(null)
    setUploading((n) => n + picked.length)
    for (const file of picked) {
      const form = new FormData()
      form.append('organizationId', orgId)
      form.append('file', file)
      const res = await fetch('/api/instagram/photos', { method: 'POST', body: form }).catch(() => null)
      const d = res ? await res.json().catch(() => ({})) : {}
      if (res?.ok && d.url) setImages((list) => (list.length < 10 ? [...list, d.url] : list))
      else setNote({ ok: false, text: `${file.name}: ${d.error || 'could not be uploaded.'}` })
      setUploading((n) => n - 1)
    }
  }

  /** Takes photos off the post; ones uploaded here are deleted from storage too. */
  function drop(urls: string[]) {
    if (!urls.length) return
    setImages((list) => list.filter((u) => !urls.includes(u)))
    void fetch('/api/instagram/photos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, urls }) }).catch(() => null)
  }

  function addLink() {
    const url = link.trim()
    if (!/^https:\/\/\S+$/.test(url)) { setNote({ ok: false, text: 'Paste a photo link that starts with https://' }); return }
    if (images.length >= 10) { setNote({ ok: false, text: 'A post can have up to 10 photos.' }); return }
    setNote(null)
    setImages((list) => (list.includes(url) ? list : [...list, url]))
    setLink('')
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-[#6B7894] dark:text-slate-400 flex-1">Your latest posts and reels. Tap one to open it on Instagram.</p>
        <RefreshButton busy={refreshing} onClick={() => void load(true)} label="Load the latest posts" />
        {canPost && !composing && <button type="button" onClick={() => { setComposing(true); setNote(null) }} className={primaryButton}><ImagePlus size={14} /> New post</button>}
      </div>
      {note?.ok && <p role="status" className="p-3 rounded-xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 text-sm flex gap-2"><Check size={16} className="shrink-0 mt-0.5 text-[#008069]" /> {note.text}</p>}

      {canPost && composing && (
        <div className={`${cardClass} p-4 sm:p-5 space-y-3`}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold flex items-center gap-2 flex-1"><ImagePlus size={16} className="text-[#008069]" /> New post</h2>
            <button type="button" onClick={() => { drop(images); reset() }} className="h-8 px-3 rounded-lg text-xs font-semibold text-[#6B7894] hover:bg-[#f4f6fa] cursor-pointer">Cancel</button>
          </div>
          <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {images.map((url, i) => (
              <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-[#eef1f6] dark:bg-slate-800 border border-[#e3e8f2] dark:border-slate-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 h-5 min-w-5 px-1 rounded bg-black/55 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                <button type="button" onClick={() => drop([url])} aria-label={`Remove photo ${i + 1}`} title="Remove" className="absolute top-1 right-1 h-7 w-7 rounded-full bg-white/90 text-[#0E1B3D] flex items-center justify-center hover:bg-white cursor-pointer"><Trash2 size={13} /></button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div key={`up-${i}`} className="aspect-square rounded-lg bg-[#eef1f6] dark:bg-slate-800 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-[#6B7894]" /></div>
            ))}
            {images.length + uploading < 10 && (
              <button type="button" onClick={() => fileInput.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300 hover:border-[#008069] hover:text-[#008069] flex flex-col items-center justify-center gap-1 text-xs font-semibold cursor-pointer">
                <ImagePlus size={20} /> {images.length ? 'Add photo' : 'Upload photos'}
              </button>
            )}
          </div>
          <p className={hintClass}>{images.length > 1 ? `${images.length} photos: posted as a carousel. ` : 'Pick up to 10 photos; 2 or more are posted as a carousel. '}Very tall or very wide photos are trimmed in the middle to fit Instagram.</p>
          {showLink ? (
            <div className="flex gap-2">
              <input aria-label="Photo link" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} placeholder="https://… (a JPEG photo on the web)" className={`${inputClass} flex-1 min-w-0`} />
              <button type="button" onClick={addLink} className={secondaryButton}>Add</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowLink(true)} className="text-xs font-semibold text-[#008069] cursor-pointer">or paste a photo link</button>
          )}
          <div>
            <label className={labelClass} htmlFor="ig-caption">Caption</label>
            <textarea id="ig-caption" rows={4} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} className={textareaClass} placeholder="New arrivals this week… #handloom" />
            <p className={hintClass}>{caption.length}/2200. Tip: Products → a product → Post on Instagram fills this in.</p>
          </div>
          {note && !note.ok && <p className="text-sm text-[#b91c1c]">{note.text}</p>}
          <button type="button" onClick={publish} disabled={busy || uploading > 0 || !images.length} className={primaryButton}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {busy ? 'Posting… (Instagram takes a few seconds)' : 'Post on Instagram'}</button>
        </div>
      )}

      {posts === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : posts.length === 0 ? <Empty icon={ImagePlus} title="No posts yet" text="Your latest Instagram posts show here." />
        : (
          <div className="grid grid-cols-3 gap-1 sm:gap-2">
            {posts.map((p) => (
              <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square overflow-hidden rounded-md sm:rounded-lg bg-[#eef1f6] dark:bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image ? <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <span className="h-full w-full flex items-center justify-center text-xs text-[#6B7894]">{p.type === 'VIDEO' ? 'Video' : 'Post'}</span>}
                {(p.type === 'VIDEO' || p.type === 'CAROUSEL_ALBUM') && <span className="absolute top-1.5 right-1.5 h-6 px-1.5 rounded-md bg-black/55 text-white text-[10px] font-bold flex items-center">{p.type === 'VIDEO' ? 'Reel' : 'Album'}</span>}
                {p.caption && <span className="absolute inset-0 hidden sm:flex items-end p-2.5 bg-black/55 text-white text-xs leading-snug opacity-0 group-hover:opacity-100 transition-opacity"><span className="line-clamp-4">{p.caption}</span></span>}
              </a>
            ))}
          </div>
        )}
    </section>
  )
}
