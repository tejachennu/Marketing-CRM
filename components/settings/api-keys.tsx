'use client'

/** Settings → API: create keys for the public API (shown once), see when each was last used, revoke them. */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BookOpen, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '@/components/salon/ui'
import { useConfirm } from '@/lib/dialog-context'
import { ALL_SCOPES, API_SCOPES, type ApiScope } from '@/lib/public-api/scopes'

interface KeyRecord { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'Never')
const fieldClass = 'w-full h-11 px-3.5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base sm:text-[15px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'

export function ApiKeysPanel({ orgId, cardClass }: { orgId: string; cardClass: string }) {
  const confirm = useConfirm()
  const [keys, setKeys] = useState<KeyRecord[] | null>(null)
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiScope[]>([...ALL_SCOPES])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/settings/api-keys?organizationId=${orgId}`)
      setKeys(data.keys || [])
      setNotice(data.notice || '')
    } catch (err: any) {
      setError(err.message)
      setKeys([])
    }
  }, [orgId])
  useEffect(() => { load() }, [load])

  async function create() {
    setError('')
    if (!name.trim()) { setError('Give the key a name, like "Website booking form".'); return }
    setBusy('create')
    try {
      const data = await api('/api/settings/api-keys', { method: 'POST', body: JSON.stringify({ organizationId: orgId, name, scopes }) })
      setCreated({ key: data.key, name: data.record.name })
      setCopied(false)
      setCreating(false)
      setName('')
      setScopes([...ALL_SCOPES])
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function revoke(key: KeyRecord) {
    if (!(await confirm({ title: `Revoke “${key.name}”?`, message: 'Anything using this key stops working at once. This cannot be undone.', confirmLabel: 'Revoke key', destructive: true }))) return
    setBusy(key.id)
    try {
      await api(`/api/settings/api-keys?organizationId=${orgId}&id=${key.id}`, { method: 'DELETE' })
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const active = (keys || []).filter((k) => !k.revoked_at)
  const revoked = (keys || []).filter((k) => k.revoked_at)

  return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <div className={cardClass}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#eef3fe] dark:bg-blue-950/40 text-[#1D5BEA] dark:text-blue-300 flex items-center justify-center"><KeyRound size={21} /></span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">API keys</h2>
              <p className="text-[14px] text-[#6B7894] dark:text-slate-400">Connect your website, app or till: add contacts, send WhatsApp messages, take bookings and create bills.</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link href="/developers" target="_blank" className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[15px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 flex-1 sm:flex-none"><BookOpen size={17} /> Documentation</Link>
            {!creating && <button type="button" onClick={() => { setCreating(true); setError('') }} className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold cursor-pointer flex-1 sm:flex-none"><Plus size={17} /> New key</button>}
          </div>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14px]">{error}</p>}
        {notice && <p className="mt-4 rounded-xl bg-[#fff7e8] dark:bg-amber-950/30 text-[#92400e] dark:text-amber-200 px-4 py-3 text-[14px]">{notice}</p>}

        {created && (
          <div className="mt-5 rounded-2xl border-2 border-[#00A884] bg-[#e8f7f1]/60 dark:bg-emerald-950/20 p-4 space-y-3">
            <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><Check size={18} className="text-[#00A884]" /> “{created.name}” is ready. Copy the key now: it is not shown again.</p>
            <div className="flex flex-col sm:flex-row gap-2 min-w-0">
              <code className="flex-1 min-w-0 rounded-xl bg-[#0E1B3D] text-white px-3.5 py-3 text-[13.5px] font-semibold [overflow-wrap:anywhere] select-all">{created.key}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(created.key).then(() => setCopied(true)).catch(() => {})} className="inline-flex items-center justify-center gap-2 h-11 sm:h-auto px-4 rounded-xl bg-[#00A884] hover:bg-[#008f70] text-white text-[15px] font-bold cursor-pointer">{copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied' : 'Copy key'}</button>
            </div>
            <p className="text-[13px] text-[#4a5672] dark:text-slate-300 flex items-start gap-1.5"><AlertTriangle size={15} className="shrink-0 mt-0.5 text-[#b45309]" /> Keep it on your server. Never put it in a web page or mobile app.</p>
            <button type="button" onClick={() => setCreated(null)} className="text-[14px] font-semibold text-[#1D5BEA] dark:text-blue-300 hover:underline cursor-pointer">I have saved it</button>
          </div>
        )}

        {creating && (
          <div className="mt-5 rounded-2xl border border-[#e3e8f2] dark:border-slate-700 p-4 space-y-4">
            <label className="block">
              <span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Website booking form" autoFocus className={fieldClass} />
              <span className="block text-[12.5px] text-[#6B7894] mt-1">What will use this key, so you know which to revoke later.</span>
            </label>
            <fieldset>
              <legend className="text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">What it may do</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALL_SCOPES.map((scope) => {
                  const on = scopes.includes(scope)
                  return (
                    <label key={scope} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${on ? 'border-[#1D5BEA] bg-[#f5f8ff] dark:bg-blue-950/20' : 'border-[#e3e8f2] dark:border-slate-700'}`}>
                      <input type="checkbox" checked={on} onChange={() => setScopes(on ? scopes.filter((s) => s !== scope) : [...scopes, scope])} className="mt-0.5 h-4 w-4 accent-[#1D5BEA]" />
                      <span className="min-w-0"><span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white">{API_SCOPES[scope]}</span><code className="text-[12px] text-[#6B7894]">{scope}</code></span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="inline-flex items-center justify-center h-11 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[15px] font-semibold text-[#0E1B3D] dark:text-white cursor-pointer">Cancel</button>
              <button type="button" onClick={create} disabled={busy !== null || !scopes.length} className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold cursor-pointer disabled:opacity-50">{busy === 'create' && <Loader2 size={17} className="animate-spin" />} Create key</button>
            </div>
          </div>
        )}

        <div className="mt-5">
          {keys === null ? <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
            : active.length === 0 ? <p className="rounded-2xl border-2 border-dashed border-[#e3e8f2] dark:border-slate-800 px-4 py-8 text-center text-[14.5px] text-[#6B7894]">No API keys yet. Create one to connect another system.</p>
            : (
              <ul className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800">
                {active.map((key) => (
                  <li key={key.id} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white truncate">{key.name}</p>
                      <p className="text-[13px] text-[#6B7894] [overflow-wrap:anywhere]"><code className="font-semibold">{key.prefix}</code> · created {when(key.created_at)} · last used {when(key.last_used_at)}</p>
                      <p className="mt-1 flex flex-wrap gap-1">{key.scopes.map((s) => <span key={s} className="inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">{s}</span>)}</p>
                    </div>
                    <button type="button" onClick={() => revoke(key)} disabled={busy !== null} className="self-start sm:self-auto inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-[#f3c7c7] dark:border-red-900 text-[14px] font-semibold text-[#b91c1c] dark:text-red-300 hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50">{busy === key.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          {revoked.length > 0 && <p className="mt-3 text-[13px] text-[#8a94a8]">{revoked.length} revoked key{revoked.length === 1 ? '' : 's'} kept for the record.</p>}
        </div>
      </div>
    </div>
  )
}
