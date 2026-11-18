'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Bot, Check, ChevronRight, EyeOff, Eye, ImagePlus, Camera as Instagram, Loader2, MessageCircle, RefreshCw, Reply, Send, Trash2, Unlink } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import { loadMetaSdk } from '@/lib/meta-sdk'
import { checkCaption } from '@/lib/instagram/rules'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/components/commerce/ui'

interface Account { igUserId: string; username: string | null; name: string | null; picture: string | null; subscribed: boolean; lastError: string | null }
interface Comment { id: string; comment_id: string; from_username: string | null; text: string; hidden: boolean; reply_text: string | null; replied_at: string | null; private_reply_at: string | null; created_at: string; media_type: string | null }
interface Chat { id: string; name: string; username: string | null; unread: number; at: string | null; last: string; ai: boolean }
interface Checks { webhook: boolean | null; messages: boolean | null }
interface Post { id: string; type: string; image: string; link: string; caption: string; at: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Instagram: connect the business's account; DMs go to Conversations; comments and posts are here. */
export default function InstagramPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<RoleSubject>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [login, setLogin] = useState<{ appId: string; configId: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [checks, setChecks] = useState<Checks | null>(null)
  const [tab, setTab] = useState<'messages' | 'comments' | 'posts'>('messages')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const loadAccount = useCallback(async (organizationId: string) => {
    const res = await fetch(`/api/instagram?organizationId=${organizationId}&checks=1`)
    const data = await res.json().catch(() => ({}))
    setAccount(data.account || null)
    setChecks(data.checks || null)
    setLogin(data.login || null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void (async () => {
      await restoreSupabaseSession()
      const user = authSessionManager.getUser()
      if (!user?.id) return
      const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only').eq('id', user.id).maybeSingle()
      if (!profile?.organization_id) return
      setViewer({ id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only })
      setOrgId(profile.organization_id)
      await loadAccount(profile.organization_id)
    })()
  }, [loadAccount])

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
          .then(async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || 'Could not connect.'); setAccount(d.account); say(true, `@${d.account?.username || 'Instagram'} is connected. DMs now arrive in Conversations.`) })
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

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-[#0b141a] text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto p-4 pb-24 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 shrink-0 rounded-2xl bg-[#0E1B3D] flex items-center justify-center text-white"><Instagram size={20} /></div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Instagram</h1>
            <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400">Instagram messages, comments and posts. Chats also show in Conversations next to WhatsApp.</p>
          </div>
        </div>

        {message && (
          <p role="status" className={`p-3 rounded-xl text-sm flex gap-2 ${message.ok ? 'bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
            {message.ok ? <Check size={16} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />} {message.text}
          </p>
        )}

        {!loaded ? (
          <div className={`${cardClass} py-12 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        ) : !account ? (
          <section className={`${cardClass} p-5 sm:p-6 space-y-3`}>
            <h2 className="text-base font-bold">Connect your Instagram professional account</h2>
            <ul className="text-sm text-slate-600 dark:text-slate-300 list-disc pl-5 space-y-1">
              <li>DMs arrive in Conversations next to WhatsApp, with AI replies from your knowledge base (turn AI off in a chat to answer yourself).</li>
              <li>See and answer comments on your posts and reels, in public or in a DM.</li>
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
              {account.picture ? <img src={account.picture} alt="" className="h-12 w-12 rounded-full object-cover" /> : <span className="h-12 w-12 rounded-full bg-[#eef1f6] flex items-center justify-center"><Instagram size={20} /></span>}
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">@{account.username || 'instagram'}</p>
                <p className={`text-xs ${account.subscribed && !account.lastError ? 'text-slate-500' : 'text-[#b91c1c]'}`}>{account.lastError || (account.subscribed ? 'Connected.' : 'Connected, but Instagram is not sending DMs and comments yet.')}</p>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {(!account.subscribed || account.lastError) && <button type="button" onClick={resubscribe} disabled={busy !== null} className={secondaryButton}><RefreshCw size={13} /> Try again</button>}
                  {account.lastError?.includes('connecting again') && <button type="button" onClick={connect} disabled={busy !== null} className={secondaryButton}><Instagram size={13} /> Connect again</button>}
                  <button type="button" onClick={disconnect} disabled={busy !== null} className={secondaryButton}><Unlink size={13} /> Disconnect</button>
                </div>
              )}
            </section>

            {canManage && checks && (checks.webhook === false || checks.messages === false) && <SetupChecklist checks={checks} />}

            <div role="tablist" className="inline-flex p-1 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800">
              {(['messages', 'comments', 'posts'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-9 px-3 sm:px-4 rounded-lg text-xs font-bold cursor-pointer ${tab === t ? 'bg-[#1D5BEA] text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t === 'messages' ? 'Messages' : t === 'comments' ? 'Comments' : 'Posts'}</button>
              ))}
            </div>

            {orgId && tab === 'messages' && <MessagesPanel orgId={orgId} />}
            {orgId && tab === 'comments' && <CommentsPanel orgId={orgId} canReply={can(viewer, 'records.write')} />}
            {orgId && tab === 'posts' && <PostsPanel orgId={orgId} canPost={can(viewer, 'automation.manage')} />}
          </>
        )}
      </div>
    </div>
  )
}

const DM_STEPS = 'In the Instagram app: Profile → ☰ → Settings and activity → Messages and story replies → Message controls → Connected tools → turn on "Allow access to messages".'

/** What still keeps DMs and comments from arriving on their own (admins only). */
function SetupChecklist({ checks }: { checks: Checks }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
      <h2 className="text-sm font-bold flex items-center gap-2"><AlertCircle size={16} className="text-[#b91c1c]" /> Still to do</h2>
      {checks.messages === false && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">Allow messages in the Instagram app</p>
          <p className="text-slate-600 dark:text-slate-300">Instagram is keeping your DMs inside its own app. {DM_STEPS}</p>
        </div>
      )}
      {checks.webhook === false && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">Send new DMs and comments here as they happen</p>
          <p className="text-slate-600 dark:text-slate-300 break-words">Meta app → Instagram → API setup with Facebook login → Configure webhooks. Callback URL <code className="text-xs bg-[#eef1f6] dark:bg-slate-800 px-1 rounded">{origin}/api/webhooks/instagram</code>, verify token = the <code className="text-xs bg-[#eef1f6] dark:bg-slate-800 px-1 rounded">INSTAGRAM_WEBHOOK_VERIFY_TOKEN</code> set in Vercel. Subscribe to messages and comments.</p>
          <p className={hintClass}>Meta sends comments only after App Review (Advanced Access) with the app Live. Until then, the Refresh buttons below read new DMs and comments from Instagram.</p>
        </div>
      )}
    </section>
  )
}

/** Instagram chats; a tap opens the chat in Conversations (reply, AI on/off, files). */
function MessagesPanel({ orgId }: { orgId: string }) {
  const [chats, setChats] = useState<Chat[] | null>(null)
  const [off, setOff] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setSyncing(true)
    setError('')
    const res = await fetch(`/api/instagram/messages?organizationId=${orgId}&sync=1`)
    const d = await res.json().catch(() => ({}))
    setChats(d.chats || [])
    setOff(d.messagesOff === true)
    if (d.syncError) setError(`Could not read new messages from Instagram: ${d.syncError}`)
    else if (!res.ok) setError(d.error || 'Could not load the chats.')
    setSyncing(false)
  }, [orgId])
  useEffect(() => { void load() }, [load])

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <p className={`${hintClass} flex-1`}>Open a chat to reply. Instagram allows replies within 24 hours of the customer's last message (7 days when a person answers).</p>
        <button type="button" onClick={() => void load()} disabled={syncing} className="h-8 w-8 shrink-0 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" aria-label="Check Instagram for new messages" title="Check Instagram for new messages"><RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /></button>
      </div>
      {off && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">Instagram is not letting WAMA read your DMs yet. {DM_STEPS} Then press refresh.</p>}
      {error && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">{error}</p>}
      {chats === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : chats.length === 0 ? <p className={`${cardClass} p-6 text-sm text-slate-500 text-center`}>No Instagram chats yet. When someone sends you a DM it shows here and in Conversations.</p>
        : (
          <ul className={`${cardClass} divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden`}>
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard?conversationId=${c.id}`} className="flex items-center gap-3 p-3 sm:p-4 hover:bg-[#f4f6fa] dark:hover:bg-slate-800/50">
                  <span className="h-10 w-10 shrink-0 rounded-full bg-[#eef1f6] dark:bg-slate-800 flex items-center justify-center text-sm font-bold text-[#0E1B3D] dark:text-slate-200">{(c.name.replace('@', '')[0] || 'I').toUpperCase()}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{c.name}</span>
                      {c.username && !c.name.startsWith('@') && <span className="text-xs text-slate-500 truncate hidden sm:inline">@{c.username}</span>}
                      {c.ai && <Bot size={12} className="shrink-0 text-slate-400" aria-label="AI replies on" />}
                    </span>
                    <span className="block text-xs text-slate-500 truncate">{c.last || ' '}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    {c.at && <span className="text-[11px] text-slate-500">{when(c.at)}</span>}
                    {c.unread > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#1D5BEA] text-white text-[11px] font-bold flex items-center justify-center">{c.unread}</span>}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

function CommentsPanel({ orgId, canReply }: { orgId: string; canReply: boolean }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [list, setList] = useState<Comment[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [syncing, setSyncing] = useState(false)
  const load = useCallback(async (sync = false) => {
    if (sync) setSyncing(true)
    const res = await fetch(`/api/instagram/comments?organizationId=${orgId}&filter=${filter}${sync ? '&sync=1' : ''}`)
    const d = await res.json().catch(() => ({}))
    setList(d.comments || [])
    if (sync) { setSyncing(false); if (d.syncError) setError(`Could not read new comments from Instagram: ${d.syncError}`) }
  }, [orgId, filter])
  const first = useRef(true)
  useEffect(() => { void load(first.current); first.current = false }, [load])

  async function act(c: Comment, action: string) {
    setBusy(`${c.comment_id}:${action}`)
    setError('')
    const res = await fetch('/api/instagram/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, commentId: c.comment_id, action, text: drafts[c.comment_id] || '' }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setError(d.error || 'That did not work.')
    else { setDrafts((x) => ({ ...x, [c.comment_id]: '' })); await load() }
    setBusy(null)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        {(['open', 'all'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={`h-8 px-3 rounded-full border cursor-pointer font-semibold ${filter === f ? 'border-[#1D5BEA] text-[#1D5BEA]' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}>{f === 'open' ? 'Not answered' : 'All'}</button>)}
        <button type="button" onClick={() => { setError(''); void load(true) }} disabled={syncing} className="ml-auto h-8 w-8 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" aria-label="Check Instagram for new comments" title="Check Instagram for new comments"><RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /></button>
      </div>
      {error && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">{error}</p>}
      {list === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : list.length === 0 ? <p className={`${cardClass} p-6 text-sm text-slate-500 text-center`}>{filter === 'open' ? 'No comments waiting for an answer.' : 'No comments yet. New comments on your posts and reels show here.'}</p>
        : list.map((c) => (
          <article key={c.id} className={`${cardClass} p-4 space-y-2`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm"><b>@{c.from_username || 'someone'}</b> <span className="text-xs text-slate-500">· {when(c.created_at)}{c.media_type ? ` · on a ${c.media_type === 'REELS' ? 'reel' : 'post'}` : ''}{c.hidden ? ' · hidden' : ''}</span></p>
                <p className={`text-sm mt-0.5 break-words ${c.hidden ? 'text-slate-400' : ''}`}>{c.text}</p>
                {c.reply_text && <p className="text-xs mt-1 text-slate-600 dark:text-slate-300 flex gap-1"><Reply size={12} className="shrink-0 mt-0.5" /> {c.private_reply_at ? 'In a DM: ' : 'You replied: '}{c.reply_text}</p>}
              </div>
            </div>
            {canReply && (
              <div className="space-y-2">
                <textarea rows={2} maxLength={1000} value={drafts[c.comment_id] || ''} onChange={(e) => setDrafts((x) => ({ ...x, [c.comment_id]: e.target.value }))} placeholder="Write a reply" className={inputClass} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null || !(drafts[c.comment_id] || '').trim()} onClick={() => act(c, 'reply')} className={secondaryButton}>{busy === `${c.comment_id}:reply` ? <Loader2 size={13} className="animate-spin" /> : <Reply size={13} />} Reply</button>
                  {!c.private_reply_at && <button type="button" disabled={busy !== null || !(drafts[c.comment_id] || '').trim()} onClick={() => act(c, 'private')} className={secondaryButton} title="Instagram allows one DM per comment, within 7 days"><MessageCircle size={13} /> Reply in DM</button>}
                  <button type="button" disabled={busy !== null} onClick={() => act(c, c.hidden ? 'unhide' : 'hide')} className={secondaryButton}>{c.hidden ? <Eye size={13} /> : <EyeOff size={13} />} {c.hidden ? 'Show' : 'Hide'}</button>
                  <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm('Delete this comment from Instagram?')) void act(c, 'delete') }} className={secondaryButton}><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            )}
          </article>
        ))}
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
            <textarea id="ig-caption" rows={4} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} className={inputClass} placeholder="New arrivals this week… #handloom" />
            <p className={hintClass}>{caption.length}/2200. Photos: JPEG, square to 4:5 portrait or 1.91:1 wide. Tip: Products → a product → Post on Instagram fills this in.</p>
          </div>
          {note && <p className={`text-sm ${note.ok ? 'text-slate-700' : 'text-[#b91c1c]'}`}>{note.text}</p>}
          <button type="button" onClick={publish} disabled={busy || !images.some((u) => u.trim())} className={primaryButton}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {busy ? 'Posting… (Instagram takes a few seconds)' : 'Post on Instagram'}</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Latest posts</h2>
        <button type="button" onClick={() => void load(true)} className={secondaryButton}><RefreshCw size={13} /> Refresh</button>
      </div>
      {posts === null ? <div className={`${cardClass} py-10 flex justify-center`}><Loader2 className="animate-spin text-slate-400" /></div>
        : posts.length === 0 ? <p className={`${cardClass} p-6 text-sm text-slate-500 text-center`}>No posts yet.</p>
        : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {posts.map((p) => (
              <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer" className={`${cardClass} overflow-hidden block`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image ? <img src={p.image} alt="" loading="lazy" className="aspect-square w-full object-cover" /> : <span className="aspect-square w-full flex items-center justify-center bg-[#eef1f6] text-xs text-slate-500">{p.type === 'VIDEO' ? 'Video' : 'Post'}</span>}
                <p className="p-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{p.caption || ' '}</p>
              </a>
            ))}
          </div>
        )}
    </section>
  )
}
