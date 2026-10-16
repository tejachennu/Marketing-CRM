'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Mail, RefreshCw, Send } from 'lucide-react'
import { authSessionManager } from '@/lib/auth-context'
import { useConfirm } from '@/lib/dialog-context'
import { SMTP_PRESETS, presetForHost } from '@/lib/smtp-presets'

interface MailboxView {
  host: string
  port: number
  secure: boolean
  user: string
  fromName: string
  hasPassword: boolean
}

interface PlatformEmailState {
  source: 'admin_panel' | 'environment' | 'none'
  tableReady: boolean
  migration?: string
  saved: MailboxView | null
  environment: MailboxView | null
}

interface TestResult {
  success: boolean
  to?: string
  server?: string
  error?: string
  hint?: string | null
  code?: string | null
}

const inputClass =
  'w-full px-3.5 py-2.5 bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] dark:placeholder-[#8696a0] text-neutral-800 dark:text-white'
const labelClass = 'block text-[10px] font-bold text-neutral-500 dark:text-[#8696a0] uppercase tracking-wider mb-1'

async function call(path: string, init: RequestInit = {}) {
  const token = authSessionManager.getSession()?.access_token
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

/** Superadmin panel: the mailbox the platform's own emails (login codes, invites) are sent from. */
export function PlatformEmailSettings() {
  const confirm = useConfirm()
  const [state, setState] = useState<PlatformEmailState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [presetId, setPresetId] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('465')
  const [secure, setSecure] = useState(true)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fromName, setFromName] = useState('')

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const fillForm = useCallback((mailbox: MailboxView | null) => {
    setHost(mailbox?.host || '')
    setPort(String(mailbox?.port || 465))
    setSecure(mailbox ? mailbox.secure : true)
    setUser(mailbox?.user || '')
    setFromName(mailbox?.fromName || '')
    setPassword('')
    setPresetId(presetForHost(mailbox?.host)?.id || (mailbox ? 'custom' : ''))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { ok, data } = await call('/api/superadmin/platform-email')
    if (!ok) {
      setLoadError(data?.error || 'Could not load the email settings')
    } else {
      setState(data)
      fillForm(data.saved || data.environment)
    }
    setLoading(false)
  }, [fillForm])

  useEffect(() => {
    load()
  }, [load])

  const current = state?.saved || state?.environment || null
  const knownMailbox = current && current.user.toLowerCase() === user.trim().toLowerCase() && current.hasPassword
  const preset = SMTP_PRESETS.find((item) => item.id === presetId) || null

  const choosePreset = (id: string) => {
    setPresetId(id)
    const chosen = SMTP_PRESETS.find((item) => item.id === id)
    if (chosen) {
      setHost(chosen.host)
      setPort(String(chosen.port))
      setSecure(chosen.secure)
    }
  }

  const changePort = (value: string) => {
    setPort(value)
    // The usual pairing; it can still be changed by hand
    if (value === '465') setSecure(true)
    if (value === '587') setSecure(false)
  }

  const form = () => ({ host, port: Number(port), secure, user, password, fromName })

  const sendTest = async () => {
    setTesting(true)
    setTestResult(null)
    setNotice(null)
    const { data } = await call('/api/superadmin/platform-email/test', { method: 'POST', body: JSON.stringify(form()) })
    setTestResult(data?.success !== undefined ? data : { success: false, error: data?.error || 'The test could not be run' })
    setTesting(false)
  }

  const save = async () => {
    setSaving(true)
    setNotice(null)
    const { ok, data } = await call('/api/superadmin/platform-email', { method: 'PUT', body: JSON.stringify(form()) })
    if (ok) {
      setState(data)
      fillForm(data.saved)
      setNotice({ ok: true, text: `Saved. Login codes and invites now go out from ${data.saved?.user}.` })
    } else {
      setNotice({ ok: false, text: data?.error || 'Could not save' })
    }
    setSaving(false)
  }

  const useEnvironment = async () => {
    const confirmed = await confirm({
      title: 'Use the server environment mailbox?',
      message: 'The mailbox saved here is removed, and platform emails go back to the one in the server environment variables.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    setSaving(true)
    setNotice(null)
    const { ok, data } = await call('/api/superadmin/platform-email', { method: 'DELETE' })
    if (ok) {
      setState(data)
      fillForm(data.environment)
      setNotice({ ok: true, text: 'Removed. Platform emails use the server environment mailbox again.' })
    } else {
      setNotice({ ok: false, text: data?.error || 'Could not remove' })
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-[#8696a0] p-6">
        <Loader2 size={14} className="animate-spin" /> Loading email settings…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-xs font-semibold text-red-600 dark:text-red-400">{loadError}</p>
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
          <RefreshCw size={12} /> Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 bg-white dark:bg-[#111b21] rounded-2xl border border-neutral-200/60 dark:border-neutral-800/80 p-6 shadow-sm max-w-3xl">
      <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-800 select-none">
        <Mail size={16} className="text-[#00a884]" />
        <h3 className="text-xs font-black uppercase tracking-wider text-neutral-900 dark:text-white">Platform Email</h3>
      </div>

      <p className="text-[11px] text-neutral-500 dark:text-[#8696a0] leading-relaxed font-semibold">
        The mailbox the platform&apos;s own emails come from: login verification codes and teammate invitations. Workspace emails (campaigns, ticket alerts) keep their own settings.
      </p>

      {/* What is in use right now */}
      <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800 bg-neutral-50 dark:bg-[#0b141a] p-4 text-xs font-semibold text-neutral-700 dark:text-neutral-200 space-y-1">
        {current ? (
          <>
            <div>
              Sending from <span className="font-black">{current.user}</span> as &ldquo;{current.fromName}&rdquo; via {current.host}:{current.port}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-[#8696a0]">
              {state?.source === 'admin_panel' ? 'Saved in this panel' : 'From the server environment variables'}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle size={14} /> No platform mailbox is set up, so login codes and invites cannot be emailed.
          </div>
        )}
      </div>

      {state && !state.tableReady && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-[11px] font-semibold text-amber-900 dark:text-amber-200 leading-relaxed">
          Saving here needs a database table: run <code className="font-mono">{state.migration}</code> in the Supabase SQL editor. Until then the server environment mailbox is used; &ldquo;Send test email&rdquo; already works.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className={labelClass}>Email provider</label>
          <select value={presetId} onChange={(e) => choosePreset(e.target.value)} className={inputClass}>
            <option value="" disabled>Choose your provider…</option>
            {SMTP_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
            <option value="custom">Other (enter the server yourself)</option>
          </select>
          {preset?.hint && <p className="mt-1.5 text-[10px] font-semibold text-neutral-500 dark:text-[#8696a0]">{preset.hint}</p>}
        </div>

        <div>
          <label className={labelClass}>Email address</label>
          <input type="email" value={user} onChange={(e) => setUser(e.target.value)} placeholder="info@magnetora.in" className={inputClass} autoComplete="off" />
        </div>
        <div>
          <label className={labelClass}>Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={knownMailbox ? 'Saved — leave blank to keep' : 'Mailbox password'}
              className={`${inputClass} pr-9`}
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696a0] cursor-pointer" aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass}>Sender name</label>
          <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="WAMACRM" maxLength={100} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Mail server (SMTP)</label>
          <input
            type="text"
            value={host}
            onChange={(e) => { setHost(e.target.value); setPresetId(presetForHost(e.target.value)?.id || 'custom') }}
            placeholder="smtpout.secureserver.net"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Port</label>
          <input type="number" min={1} max={65535} value={port} onChange={(e) => changePort(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Security</label>
          <select value={secure ? 'ssl' : 'starttls'} onChange={(e) => setSecure(e.target.value === 'ssl')} className={inputClass}>
            <option value="ssl">SSL/TLS (usually port 465)</option>
            <option value="starttls">STARTTLS (usually port 587)</option>
          </select>
        </div>
      </div>

      {testResult && (
        <div
          role="status"
          className={`rounded-xl border p-4 text-xs font-semibold leading-relaxed ${
            testResult.success
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
              : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
          }`}
        >
          {testResult.success ? (
            <div className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0" /> Test email sent to {testResult.to}. Check that inbox (and its spam folder).</div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> The test failed{testResult.server ? ` (${testResult.server})` : ''}.</div>
              {testResult.hint && <div>{testResult.hint}</div>}
              {testResult.error && (
                <div className="font-mono text-[10px] opacity-80 break-words">
                  {testResult.code ? `${testResult.code}: ` : ''}{testResult.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {notice && (
        <p className={`text-xs font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{notice.text}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <button
          onClick={sendTest}
          disabled={testing || saving}
          className="px-4 py-2 rounded-lg border border-[#00a884] text-[#00a884] hover:bg-[#00a884]/10 disabled:opacity-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          <span>Send test email to me</span>
        </button>
        <button
          onClick={save}
          disabled={saving || testing || !state?.tableReady}
          title={state?.tableReady ? undefined : 'Run the database migration first'}
          className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white rounded-lg transition-all text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          <span>Save</span>
        </button>
        {state?.saved && (
          <button onClick={useEnvironment} disabled={saving || testing} className="ml-auto px-3 py-2 text-[11px] font-bold text-neutral-500 dark:text-[#8696a0] hover:text-red-600 cursor-pointer">
            Use server environment instead
          </button>
        )}
      </div>
    </div>
  )
}
