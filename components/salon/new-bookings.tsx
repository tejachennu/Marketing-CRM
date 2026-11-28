'use client'

import { useEffect, useMemo, useState } from 'react'
import { BellRing, Check, ChevronRight } from 'lucide-react'
import { bookingWhen, freshBookings, serviceNames, sourceLabel, type FreshBooking } from '@/lib/salon/new-bookings'
import { istDate } from '@/lib/salon/spoken'
import { card } from './ui'

const seenKey = (orgId: string) => `wama-seen-bookings:${orgId}`

function readSeen(orgId: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(seenKey(orgId)) || '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(-200) : []
  } catch {
    return []
  }
}

/**
 * "New bookings from customers": bookings made on the website, the booking page, WhatsApp or the API in the last
 * three days, whatever day they are for (the counter shows one day at a time, so a booking for Saturday was easy to
 * miss). A tap opens that day; "Got it" hides them on this device.
 */
export function NewBookings({ orgId, bookings, onOpenDay }: { orgId: string; bookings: FreshBooking[]; onOpenDay: (day: string) => void }) {
  const [seen, setSeen] = useState<string[]>([])
  useEffect(() => { setSeen(readSeen(orgId)) }, [orgId])
  const list = useMemo(() => freshBookings(bookings, Date.now(), seen), [bookings, seen])
  if (!list.length) return null

  const gotIt = () => {
    const next = [...new Set([...seen, ...list.map((b) => b.id)])].slice(-200)
    setSeen(next)
    try { localStorage.setItem(seenKey(orgId), JSON.stringify(next)) } catch {}
  }

  return (
    <section className={`${card} overflow-hidden`} aria-label="New bookings from customers">
      <div className="flex items-center gap-3 px-4 @xl:px-5 py-3 border-b border-[#eef1f6] dark:border-slate-800">
        <span className="h-9 w-9 shrink-0 rounded-xl bg-[#e7f5f0] dark:bg-emerald-950/40 text-[#008069] flex items-center justify-center"><BellRing size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] font-extrabold text-[#0E1B3D] dark:text-white">New bookings from customers <span className="text-[#008069]">{list.length}</span></h3>
          <p className="text-[12.5px] text-[#6B7894] truncate">Made on your website, WhatsApp or app. Tap one to see its day.</p>
        </div>
        <button type="button" onClick={gotIt} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13.5px] font-semibold text-[#008069] hover:bg-[#e7f5f0] dark:hover:bg-emerald-950/40 cursor-pointer"><Check size={16} /> Got it</button>
      </div>
      <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
        {list.slice(0, 6).map((b) => {
          const services = serviceNames(b)
          return (
            <li key={b.id}>
              <button type="button" onClick={() => onOpenDay(istDate(b.starts_at))} className="w-full text-left px-4 @xl:px-5 py-3 flex items-center gap-3 hover:bg-[#f8fafc] dark:hover:bg-slate-900/60 cursor-pointer">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{bookingWhen(b.starts_at)}</p>
                  <p className="text-[13px] text-[#4a5672] dark:text-slate-300 truncate">{[b.customer_name || 'Customer', services].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="shrink-0 h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300 inline-flex items-center">{sourceLabel(b.source)}</span>
                <ChevronRight size={17} className="shrink-0 text-[#8a94a8]" />
              </button>
            </li>
          )
        })}
      </ul>
      {list.length > 6 && <p className="px-4 @xl:px-5 py-2.5 text-[13px] text-[#6B7894] border-t border-[#eef1f6] dark:border-slate-800">And {list.length - 6} more. See them in Appointments.</p>}
    </section>
  )
}
