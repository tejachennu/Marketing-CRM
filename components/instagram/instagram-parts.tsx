'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Check, Clock, EyeOff, Eye, ImagePlus, Camera as Instagram, Loader2, MessageCircle, MessageSquare, Plus, RefreshCw, Reply, Send, Settings as SettingsIcon, Sparkles, Trash2, Unlink, Zap } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import { loadMetaSdk } from '@/lib/meta-sdk'
import { DEFAULT_AUTOMATION, checkCaption, type IgAutomation } from '@/lib/instagram/rules'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton, textareaClass } from '@/components/commerce/ui'

interface Account { igUserId: string; username: string | null; name: string | null; picture: string | null; subscribed: boolean; lastError: string | null; slowDownMinutes?: number }
interface Comment { id: string; comment_id: string; parent_id: string | null; from_username: string | null; text: string; hidden: boolean; reply_text: string | null; replied_at: string | null; private_reply_at: string | null; created_at: string; media_type: string | null; auto_replied?: boolean; post: { image: string; link: string; caption: string } | null }
interface Post { id: string; type: string; image: string; link: string; caption: string; at: string }
interface Checks { webhook: boolean | null; messages: boolean | null }
interface Summary { unreadChats: number; openComments: number }

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}
const TONES = ['bg-[#eef1f6] text-[#0E1B3D]', 'bg-[#e8effd] text-[#1D5BEA]', 'bg-[#e3e8f2] text-[#4a5672]']
const tone = (name: string) => TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]
const initial = (name: string) => (name.replace('@', '').trim()[0] || 'I').toUpperCase()
const autoOn = (a: IgAutomation | null) => Boolean(a && (a.dmAi || a.commentAi || a.rules.length || a.everyComment.on || a.hideWords.length))

const DM_STEPS = 'In the Instagram app: Profile → ☰ → Settings and activity → Messages and story replies → Message controls → Connected tools → turn on "Allow access to messages".'

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
    if (!orgId || !window.confirm('Disconnect Instagram? New DMs and comments stop arriving. Chats already here stay.')) return
    setBusy('disconnect')
    await fetch(`/api/instagram?organizationId=${orgId}`, { method: 'DELETE' }).catch(() => null)
    setAccount(null)
    setBusy(null)
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
          {message.ok ? <Check size={16} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />} {message.text}
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
                : <p className="text-xs text-[#6B7894] flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#1D5BEA]" /> Connected</p>}
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {(!account.subscribed || account.lastError) && <button type="button" onClick={resubscribe} disabled={busy !== null} className={secondaryButton}><RefreshCw size={13} /> Try again</button>}
                {account.lastError?.includes('connecting again') && <button type="button" onClick={connect} disabled={busy !== null} className={secondaryButton}><Instagram size={13} /> Connect again</button>}
                <button type="button" onClick={disconnect} disabled={busy !== null} className={secondaryButton}><Unlink size={13} /> Disconnect</button>
              </div>
            )}
          </section>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Tile label="Unread chats" value={String(summary?.unreadChats ?? 0)} icon={MessageSquare} href="/dashboard/instagram" />
            <Tile label="Comments waiting" value={String(summary?.openComments ?? 0)} icon={MessageCircle} href="/dashboard/instagram/comments" />
            <Tile label="Auto replies" value={autoOn(automation) ? 'On' : 'Off'} icon={Zap} href="#instagram-auto" />
          </div>

          {canManage && checks && (checks.webhook === false || checks.messages === false) && <SetupChecklist checks={checks} />}

          {orgId && (
            <div id="instagram-auto" className="space-y-3 scroll-mt-20">
              <h2 className="text-base font-bold flex items-center gap-2"><Zap size={17} className="text-[#1D5BEA]" /> Auto replies</h2>
              <AutoRepliesPanel orgId={orgId} initial={automation || DEFAULT_AUTOMATION} canEdit={can(viewer, 'automation.manage')} onSaved={setAutomation} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Instagram → Comments and posts (chats are in the Instagram inbox). */
export function InstagramCommentsPage() {
  const { orgId, viewer } = useViewer()
  const [tab, setTab] = useState<'comments' | 'posts'>('comments')
  const [open, setOpen] = useState<number | null>(null)
  const refresh = useCallback(() => {
    if (!orgId) return
    void fetch(`/api/instagram?organizationId=${orgId}`).then((r) => r.json()).then((d) => setOpen(d.summary?.openComments ?? null)).catch(() => null)
  }, [orgId])
  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="h-full overflow-y-auto bg-[#f4f6fa] dark:bg-[#0b141a] text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto p-4 pb-24 md:p-8 space-y-4 sm:space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/instagram" className="h-10 w-10 shrink-0 rounded-full border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] flex items-center justify-center text-[#4a5672] hover:border-[#d5ddeb]" aria-label="Back to Instagram chats"><ArrowLeft size={17} /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Comments and posts</h1>
            <p className="text-xs sm:text-[13px] text-[#6B7894] dark:text-slate-400">Answer comments on your posts and reels, and post new photos.</p>
          </div>
          <Link href="/dashboard/settings?tab=instagram" className={secondaryButton}><SettingsIcon size={13} /> <span className="hidden sm:inline">Settings</span></Link>
        </div>

        <div role="tablist" className="inline-flex p-1 rounded-xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800">
          {(['comments', 'posts'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-9 px-4 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${tab === t ? 'bg-[#1D5BEA] text-white' : 'text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800'}`}>
              {t === 'comments' ? 'Comments' : 'Posts'}
              {t === 'comments' && Boolean(open) && <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] flex items-center justify-center ${tab === t ? 'bg-white/25 text-white' : 'bg-[#e8effd] text-[#1D5BEA]'}`}>{open}</span>}
            </button>
          ))}
        </div>

        {orgId && tab === 'comments' && <CommentsPanel orgId={orgId} canReply={can(viewer, 'records.write')} onChange={refresh} />}
        {orgId && tab === 'posts' && <PostsPanel orgId={orgId} canPost={can(viewer, 'automation.manage')} />}
      </div>
    </div>
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

/** The Instagram menu: the inbox when connected, else a way to connect. */
export function InstagramHome({ inbox }: { inbox: React.ReactNode }) {
  const { orgId, viewer } = useViewer()
  const [state, setState] = useState<'loading' | 'connected' | 'none'>('loading')
  useEffect(() => {
    if (!orgId) return
    void fetch(`/api/instagram?organizationId=${orgId}`).then((r) => r.json()).then((d) => setState(d.account ? 'connected' : 'none')).catch(() => setState('connected'))
  }, [orgId])
  if (state === 'loading') return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
  if (state === 'none') return <InstagramNotConnected canConnect={can(viewer, 'settings.manage')} />
  return <>{inbox}</>
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

function CommentsPanel({ orgId, canReply, onChange }: { orgId: string; canReply: boolean; onChange: () => void }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [list, setList] = useState<Comment[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const [syncing, setSyncing] = useState(false)

  // While Instagram is being checked, a plain reload would only bring the older list back (and could land last)
  const checking = useRef(false)
  const load = useCallback(async (sync = false) => {
    if (!sync && checking.current) return
    if (sync) { setSyncing(true); checking.current = true }
    const res = await fetch(`/api/instagram/comments?organizationId=${orgId}&filter=${filter}${sync ? '&sync=1' : ''}`).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setList(d.comments || [])
    if (sync) {
      checking.current = false
      setSyncing(false)
      setWait(Number(d.waitMinutes) || 0)
      if (d.syncError) setError(`Could not read new comments from Instagram: ${d.syncError}`)
      onChange()
    }
  }, [orgId, filter, onChange])
  const first = useRef(true)
  useEffect(() => { void load(first.current); first.current = false }, [load])

  async function act(c: Comment, action: string) {
    setBusy(`${c.comment_id}:${action}`)
    setError('')
    const res = await fetch('/api/instagram/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, commentId: c.comment_id, action, text: draft }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setError(d.error || 'That did not work.')
    else { setDraft(''); setOpen(null); await load(); onChange() }
    setBusy(null)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        {(['open', 'all'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={`h-8 px-3 rounded-full border cursor-pointer font-semibold ${filter === f ? 'border-[#1D5BEA] bg-[#e8effd] text-[#1D5BEA]' : 'border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] text-[#4a5672]'}`}>{f === 'open' ? 'Not answered' : 'All'}</button>)}
        <span className="ml-auto" />
        <RefreshButton busy={syncing} onClick={() => { setError(''); void load(true) }} label="Check Instagram for new comments" />
      </div>
      <SlowNote minutes={wait} />
      {error && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">{error}</p>}
      {list === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : list.length === 0 ? <Empty icon={MessageCircle} title={filter === 'open' ? 'All caught up' : 'No comments yet'} text={filter === 'open' ? 'No comments waiting for an answer.' : 'New comments on your posts and reels show here.'} />
        : list.map((c) => {
          const who = c.from_username || 'someone'
          const replying = open === c.comment_id
          return (
            <article key={c.id} className={`${cardClass} p-3 sm:p-4`}>
              <div className="flex items-start gap-3">
                {c.post?.image
                  ? <a href={c.post.link} target="_blank" rel="noopener noreferrer" className="shrink-0" title="Open the post on Instagram">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={c.post.image} alt="" className="h-12 w-12 sm:h-14 sm:w-14 rounded-lg object-cover border border-[#e3e8f2]" /></a>
                  : <span className={`h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-lg flex items-center justify-center text-base font-bold ${tone(who)}`}>{initial(who)}</span>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm flex flex-wrap items-baseline gap-x-2 min-w-0"><b className="truncate max-w-full">@{who}</b> <span className="text-[11px] text-[#8a94a8]">{when(c.created_at)}{c.media_type ? ` · ${c.media_type === 'REELS' ? 'reel' : 'post'}` : ''}{c.parent_id ? ' · reply' : ''}</span></p>
                  <p className={`text-sm mt-0.5 break-words ${c.hidden ? 'text-[#8a94a8] line-through' : ''}`}>{c.text}</p>
                  {(c.reply_text || c.hidden || c.auto_replied) && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {c.auto_replied && <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-[#e8effd] text-[#1D5BEA] text-[10px] font-bold"><Zap size={10} /> Auto</span>}
                      {c.hidden && <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-[#eef1f6] text-[#4a5672] text-[10px] font-bold"><EyeOff size={10} /> Hidden</span>}
                      {c.reply_text && <span className="text-xs text-[#4a5672] dark:text-slate-300 flex gap-1 min-w-0"><Reply size={12} className="shrink-0 mt-0.5" /> <span className="break-words">{c.private_reply_at && !c.replied_at ? 'In a DM: ' : ''}{c.reply_text}</span></span>}
                    </div>
                  )}
                </div>
              </div>
              {canReply && (
                replying ? (
                  <div className="mt-3 space-y-2">
                    <textarea autoFocus rows={2} maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Reply to @${who}`} className={textareaClass} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy !== null || !draft.trim()} onClick={() => act(c, 'reply')} className={primaryButton}>{busy === `${c.comment_id}:reply` ? <Loader2 size={13} className="animate-spin" /> : <Reply size={13} />} Reply in public</button>
                      {!c.private_reply_at && <button type="button" disabled={busy !== null || !draft.trim()} onClick={() => act(c, 'private')} className={secondaryButton} title="Instagram allows one DM per comment, within 7 days"><MessageCircle size={13} /> Send as DM</button>}
                      <button type="button" onClick={() => { setOpen(null); setDraft('') }} className="h-9 px-3 text-xs font-semibold text-[#6B7894] cursor-pointer">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 sm:pl-[68px]">
                    <button type="button" disabled={busy !== null} onClick={() => { setOpen(c.comment_id); setDraft('') }} className={secondaryButton}><Reply size={13} /> Reply</button>
                    <button type="button" disabled={busy !== null} onClick={() => act(c, c.hidden ? 'unhide' : 'hide')} className={secondaryButton}>{c.hidden ? <Eye size={13} /> : <EyeOff size={13} />} {c.hidden ? 'Show' : 'Hide'}</button>
                    <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm('Delete this comment from Instagram?')) void act(c, 'delete') }} className={secondaryButton}><Trash2 size={13} /> Delete</button>
                  </div>
                )
              )}
            </article>
          )
        })}
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
      <span aria-hidden className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${on ? 'bg-[#1D5BEA]' : 'bg-[#d5ddeb] dark:bg-slate-700'}`}><span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} /></span>
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
        <h2 className="text-sm font-bold flex items-center gap-2"><Sparkles size={16} className="text-[#1D5BEA]" /> AI replies</h2>
        <Switch disabled={off} on={a.dmAi} onChange={(v) => setA((x) => ({ ...x, dmAi: v }))} label="AI answers DMs" hint="Answers from your knowledge base in the customer's language. When it can't answer, the chat goes to your team. Turn AI off in one chat to answer it yourself." />
        <Switch disabled={off} on={a.commentAi} onChange={(v) => setA((x) => ({ ...x, commentAi: v }))} label="AI replies to comments" hint="A short public reply when your knowledge base has the answer, and a warm thank-you for praise. It stays quiet on complaints and spam. Keyword replies below come first." />
      </div>

      <div className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2"><Zap size={16} className="text-[#1D5BEA]" /> Keyword replies for comments</h2>
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
        <h2 className="text-sm font-bold flex items-center gap-2"><EyeOff size={16} className="text-[#1D5BEA]" /> Hide comments with these words</h2>
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
  const [images, setImages] = useState<string[]>([''])
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (fresh = false) => {
    const res = await fetch(`/api/instagram/posts?organizationId=${orgId}${fresh ? '&fresh=1' : ''}`)
    const d = await res.json().catch(() => ({}))
    setPosts(d.posts || [])
  }, [orgId])
  useEffect(() => { void load() }, [load])

  async function publish() {
    const check = checkCaption(caption)
    if ('error' in check) { setNote({ ok: false, text: check.error }); return }
    setBusy(true)
    setNote(null)
    const res = await fetch('/api/instagram/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, images: images.map((u) => u.trim()).filter(Boolean), caption }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setNote({ ok: false, text: d.error || 'Could not post.' })
    else { setNote({ ok: true, text: 'Posted on Instagram.' }); setImages(['']); setCaption(''); await load(true) }
    setBusy(false)
  }

  return (
    <section className="space-y-4">
      {canPost && (
        <div className={`${cardClass} p-4 sm:p-5 space-y-3`}>
          <h2 className="text-sm font-bold flex items-center gap-2"><ImagePlus size={16} className="text-[#1D5BEA]" /> New post</h2>
          {images.map((url, i) => (
            <input key={i} aria-label={`Photo link ${i + 1}`} value={url} onChange={(e) => setImages((list) => list.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Photo link (https://…, JPEG)" className={inputClass} />
          ))}
          {images.length < 10 && <button type="button" onClick={() => setImages((l) => [...l, ''])} className="text-xs font-semibold text-[#1D5BEA] cursor-pointer">+ Add another photo (carousel)</button>}
          <div>
            <label className={labelClass} htmlFor="ig-caption">Caption</label>
            <textarea id="ig-caption" rows={4} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} className={textareaClass} placeholder="New arrivals this week… #handloom" />
            <p className={hintClass}>{caption.length}/2200. Photos: JPEG, square to 4:5 portrait or 1.91:1 wide. Tip: Products → a product → Post on Instagram fills this in.</p>
          </div>
          {note && <p className={`text-sm ${note.ok ? 'text-[#0E1B3D] dark:text-slate-200' : 'text-[#b91c1c]'}`}>{note.text}</p>}
          <button type="button" onClick={publish} disabled={busy || !images.some((u) => u.trim())} className={primaryButton}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {busy ? 'Posting… (Instagram takes a few seconds)' : 'Post on Instagram'}</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Latest posts</h2>
        <button type="button" onClick={() => void load(true)} className={secondaryButton}><RefreshCw size={13} /> Refresh</button>
      </div>
      {posts === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : posts.length === 0 ? <Empty icon={ImagePlus} title="No posts yet" text="Your latest Instagram posts show here." />
        : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {posts.map((p) => (
              <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer" className={`${cardClass} overflow-hidden block hover:border-[#d5ddeb]`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image ? <img src={p.image} alt="" loading="lazy" className="aspect-square w-full object-cover" /> : <span className="aspect-square w-full flex items-center justify-center bg-[#eef1f6] text-xs text-[#6B7894]">{p.type === 'VIDEO' ? 'Video' : 'Post'}</span>}
                <p className="p-2 text-xs text-[#4a5672] dark:text-slate-300 line-clamp-2">{p.caption || ' '}</p>
              </a>
            ))}
          </div>
        )}
    </section>
  )
}
