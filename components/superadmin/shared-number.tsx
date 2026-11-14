'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react'

type Api = (path: string, init?: RequestInit) => Promise<any>
interface Row { name: string; purpose: string; status: string; reason?: string | null }

const TONE: Record<string, string> = {
  APPROVED: 'bg-[#eef3fe] text-[#1D5BEA]',
  PENDING: 'bg-[#eef1f6] text-[#4a5672]',
  IN_APPEAL: 'bg-[#eef1f6] text-[#4a5672]',
}

/**
 * WAMA's own WhatsApp number (it sends booking messages for Starter workspaces): whether it is set up
 * in Vercel, and its four message templates on Meta, with a button to submit the missing ones.
 */
export function SharedNumberPanel({ api }: { api: Api }) {
  const [data, setData] = useState<{ configured: boolean; templates: Row[]; error?: string; from?: string; why?: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api('/api/superadmin/shared-number'))
    } catch (error: any) {
      setData({ configured: false, templates: [], error: error.message })
    }
  }, [api])

  useEffect(() => { load() }, [load])

  async function submit() {
    setBusy(true); setMessage('')
    try {
      const result = await api('/api/superadmin/shared-number', { method: 'POST', body: '{}' })
      setData({ configured: true, templates: result.templates || [], from: result.from })
      setMessage(result.errors?.length ? `Some were not accepted: ${result.errors.join('; ')}` : 'Sent to Meta. Approval usually takes a few minutes to a day.')
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const missing = (data?.templates || []).some((t) => t.status === 'MISSING' || t.status === 'REJECTED')
  return (
    <section className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white flex items-center gap-2"><MessageCircle size={17} className="text-[#1D5BEA]" /> WAMA&apos;s WhatsApp number</h2>
          <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400 mt-0.5">Sends booking confirmations, reminders, bills and feedback requests for Starter workspaces.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="h-9 px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[13.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"><RefreshCw size={14} /> Check</button>
          {data?.configured && missing && (
            <button type="button" disabled={busy} onClick={submit} className="h-9 px-3 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[13.5px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit templates
            </button>
          )}
        </div>
      </div>
      {!data ? (
        <div className="py-4"><Loader2 size={18} className="animate-spin text-[#1D5BEA]" /></div>
      ) : !data.configured ? (
        <p className="mt-3 text-[13.5px] rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-3 py-2.5">
          Not set up{data.why ? `: ${data.why}` : ''}. It uses the WhatsApp number connected in WAMA CRM&apos;s own workspace (Settings → WhatsApp, on Meta), or WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_API_TOKEN in Vercel. Until then Starter workspaces send nothing.
        </p>
      ) : (
        <>
        {data.from && <p className="mt-3 text-[13px] text-[#4a5672] dark:text-slate-400">Using {data.from}.</p>}
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.templates.map((t) => (
            <li key={t.name} className="rounded-xl border border-[#eef1f6] dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2 min-w-0">
              <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-[#0E1B3D] dark:text-white truncate">{t.name}</span>{t.reason && <span className="block text-[12px] text-[#b91c1c] truncate">{t.reason}</span>}</span>
              <span className={`shrink-0 text-[11.5px] font-bold px-2 py-0.5 rounded-full ${TONE[t.status] || 'bg-[#fdf0f0] text-[#b91c1c]'}`}>{t.status}</span>
            </li>
          ))}
        </ul>
        </>
      )}
      {(message || data?.error) && <p className="mt-2 text-[13px] text-[#4a5672] dark:text-slate-400">{message || data?.error}</p>}
    </section>
  )
}
