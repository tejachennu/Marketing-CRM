'use client'

/** Setup → WhatsApp templates: the salon's message pack, where each stands on Meta, submit in one tap. */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, FileCheck2, Loader2, Megaphone, RefreshCw, Send } from 'lucide-react'
import { api, card, primaryButton, secondaryButton } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void

const STATUS: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300'],
  PENDING: ['In review', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  IN_APPEAL: ['In review', 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'],
  REJECTED: ['Rejected', 'bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/40 dark:text-red-300'],
  PAUSED: ['Paused', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
  DISABLED: ['Disabled', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
  NOT_SUBMITTED: ['Not submitted', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
  UNKNOWN: ['Not checked', 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300'],
}

const preview = (body: string, samples: Record<string, string>) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => samples[n] || `{{${n}}}`)

export function SalonTemplates({ orgId, flash }: { orgId: string; flash: Flash }) {
  const [data, setData] = useState<{ connected: boolean; message?: string; templates: any[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await api(`/api/salon/templates?organizationId=${orgId}`)) } catch (err: any) { flash('error', err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])
  useEffect(() => { load() }, [load])

  async function submit(keys?: string[]) {
    setBusy(keys?.[0] || 'all')
    try {
      const result = await api('/api/salon/templates', { method: 'POST', body: JSON.stringify({ organizationId: orgId, keys }) })
      setData((current) => ({ ...(current as any), templates: result.templates }))
      const failed = Object.entries(result.results || {}).filter(([, r]: any) => !r.ok)
      if (failed.length) flash('error', `${failed.length} not accepted: ${(failed[0][1] as any).error}`)
      else flash('success', 'Sent to Meta for review. It usually takes minutes to a few hours.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  const templates = data?.templates || []
  const waiting = templates.filter((t) => t.status === 'NOT_SUBMITTED').length
  const groups: { title: string; hint: string; category: string; icon: typeof FileCheck2 }[] = [
    { title: 'Sent by the salon', hint: 'Used automatically when a customer has not messaged in 24 hours', category: 'UTILITY', icon: FileCheck2 },
    { title: 'Marketing', hint: 'Send them to your customers from Campaigns', category: 'MARKETING', icon: Megaphone },
  ]

  return (
    <section className={card}>
      <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex flex-col @xl:flex-row @xl:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300 flex items-center justify-center"><FileCheck2 size={21} /></span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">WhatsApp message templates</h2>
            <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400">WhatsApp needs approved templates to message customers after 24 hours</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={() => load()} aria-label="Check again" title="Check again" className="h-10 w-10 shrink-0 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><RefreshCw size={17} /></button>
          {data?.connected && waiting > 0 && <button type="button" onClick={() => submit()} disabled={busy !== null} className={`${primaryButton} h-10`}>{busy === 'all' ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />} Submit all {waiting}</button>}
        </div>
      </div>
      {!data ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#1D5BEA]" /></div> : (
        <div className="p-4 @xl:p-5 space-y-5">
          {data.message && <p className="rounded-xl bg-[#fff7e8] dark:bg-amber-950/30 text-[#92400e] dark:text-amber-200 px-4 py-3 text-[14px]">{data.message}</p>}
          {groups.map((group) => (
            <div key={group.category}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8] flex items-center gap-1.5"><group.icon size={14} /> {group.title} <span className="normal-case tracking-normal font-semibold">· {group.hint}</span></p>
                {group.category === 'MARKETING' && <Link href="/dashboard/campaigns" className="shrink-0 inline-flex items-center gap-1 text-[13.5px] font-bold text-[#1D5BEA] dark:text-blue-300 hover:underline">Campaigns <ArrowRight size={14} /></Link>}
              </div>
              <ul className="grid grid-cols-1 @2xl:grid-cols-2 gap-3">
                {templates.filter((t) => t.category === group.category).map((template) => {
                  const [label, tone] = STATUS[template.status] || STATUS.PENDING
                  return (
                    <li key={template.key} className="min-w-0 rounded-2xl border border-[#e3e8f2] dark:border-slate-800 p-4 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">{template.title}</p>
                          <p className="text-[12.5px] text-[#8a94a8] truncate">{template.use}</p>
                        </div>
                        <span className={`shrink-0 inline-flex items-center h-6 px-2 rounded-md text-[12px] font-bold ${tone}`}>{label}</span>
                      </div>
                      <div className="mt-3 rounded-xl bg-[#e8f7f1]/60 dark:bg-emerald-950/20 px-3 py-2.5 text-[13.5px] text-[#0E1B3D] dark:text-slate-200 flex-1 [overflow-wrap:anywhere]">
                        {preview(template.body, template.samples)}
                        {template.buttons.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{template.buttons.map((b: string) => <span key={b} className="inline-flex items-center h-7 px-2.5 rounded-lg bg-white dark:bg-slate-900 text-[12.5px] font-semibold text-[#1D5BEA] dark:text-blue-300 border border-[#d5ddeb] dark:border-slate-700">{b}</span>)}</div>}
                      </div>
                      {template.status === 'REJECTED' && template.rejectedReason && <p className="mt-2 text-[12.5px] text-[#b91c1c] dark:text-red-300">Meta: {String(template.rejectedReason).replace(/_/g, ' ').toLowerCase()}</p>}
                      {data.connected && template.status === 'NOT_SUBMITTED' && (
                        <button type="button" onClick={() => submit([template.key])} disabled={busy !== null} className={`${secondaryButton} h-9 mt-3 self-start text-[14px]`}>{busy === template.key ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />} Submit</button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
