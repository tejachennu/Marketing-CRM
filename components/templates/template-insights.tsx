'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, MousePointerClick } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TemplateInsights as Insights } from '@/lib/whatsapp-templates/meta-templates'

const RANGES = [7, 30, 90]
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-[#dadde1] dark:border-slate-800 bg-white dark:bg-[#111b21] p-3 sm:p-4">
      <p className="text-[12.5px] font-semibold text-[#65676b] dark:text-slate-400">{label}</p>
      <p className="text-[22px] font-bold text-[#1c2b33] dark:text-white mt-0.5">{value}</p>
      {note && <p className="text-[12px] text-[#65676b] dark:text-slate-400">{note}</p>}
    </div>
  )
}

/** A template's performance, as WhatsApp Manager's template insights show it. */
export function TemplateInsights({ orgId, templateId }: { orgId: string; templateId: string }) {
  const [days, setDays] = useState(7)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/whatsapp-templates/insights?${new URLSearchParams({ organizationId: orgId, templateId, days: String(days) })}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Insights could not be loaded from Meta.')
        if (!cancelled) setInsights(data)
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, templateId, days])

  const chart = (insights?.days || []).map((day) => ({
    date: new Date(day.start * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' }),
    Sent: day.sent,
    Delivered: day.delivered,
    Read: day.read,
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-[#1c2b33] dark:text-white">Performance</p>
        <div className="inline-flex rounded-lg border border-[#ced0d4] dark:border-slate-700 overflow-hidden text-[12.5px] font-semibold">
          {RANGES.map((value) => (
            <button key={value} type="button" onClick={() => setDays(value)} className={`px-3 h-8 cursor-pointer ${days === value ? 'bg-[#0064e0] text-white' : 'bg-white dark:bg-slate-900 text-[#1c2b33] dark:text-slate-300'}`}>{value} days</button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-[#f2b8c0] bg-[#fde8ea] dark:bg-rose-950/30 dark:border-rose-900 px-4 py-3 text-[13.5px] text-[#c11231] dark:text-rose-200 flex items-start gap-2">
          <AlertCircle size={17} className="shrink-0 mt-0.5" /> {error}
        </div>
      ) : !insights ? (
        <div className="p-10 flex items-center justify-center gap-2 text-[14px] text-[#65676b]"><Loader2 size={18} className="animate-spin" /> Loading insights from Meta…</div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Messages sent" value={insights.totals.sent.toLocaleString()} />
            <Stat label="Messages delivered" value={insights.totals.delivered.toLocaleString()} note={`${percent(insights.totals.delivered, insights.totals.sent)} of sent`} />
            <Stat label="Messages read" value={insights.totals.read.toLocaleString()} note={`${percent(insights.totals.read, insights.totals.delivered)} of delivered`} />
            <Stat label="Button clicks" value={insights.totals.clicked.toLocaleString()} note={`${percent(insights.totals.clicked, insights.totals.read)} of read`} />
          </div>

          <div className="rounded-xl border border-[#dadde1] dark:border-slate-800 bg-white dark:bg-[#111b21] p-3 sm:p-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e6eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#65676b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#65676b' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(0,100,224,0.06)' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Sent" fill="#0064e0" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Delivered" fill="#31a24c" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Read" fill="#f7b928" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-[#dadde1] dark:border-slate-800 bg-white dark:bg-[#111b21]">
            <p className="px-4 py-3 border-b border-[#dadde1] dark:border-slate-800 text-[14px] font-bold text-[#1c2b33] dark:text-white flex items-center gap-1.5"><MousePointerClick size={15} /> Button clicks</p>
            {insights.buttons.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13.5px] text-[#65676b] dark:text-slate-400">No button clicks in this period.</p>
            ) : (
              <ul className="divide-y divide-[#eceef1] dark:divide-slate-800">
                {insights.buttons.map((button) => (
                  <li key={`${button.type}-${button.text}`} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="min-w-0">
                      <span className="block font-semibold text-[#1c2b33] dark:text-slate-100 truncate">{button.text || 'Button'}</span>
                      <span className="block text-[12px] text-[#65676b] dark:text-slate-400">{button.type.replace(/_/g, ' ').toLowerCase()}</span>
                    </span>
                    <span className="font-bold text-[#1c2b33] dark:text-white">{button.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[12px] text-[#8a8d91]">Counts come from Meta and can take up to a day to appear. Read counts only include people who share read receipts.</p>
        </div>
      )}
    </div>
  )
}
