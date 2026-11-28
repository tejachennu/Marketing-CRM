'use client'

/** The services on the website: category tabs, a search when the menu is long, and Book on each one (when booking is on). */

import { useMemo, useState } from 'react'
import { Clock, Search } from 'lucide-react'
import { duration } from '@/lib/salon/website'
import { BookButton } from './book-button'
import { moneyText } from '@/lib/money'

interface Item { id: string; name: string; category: string; price: number; minutes: number }

export function ServicesMenu({ services, showPrices, money, bookable = true }: { services: Item[]; showPrices: boolean; money?: string; bookable?: boolean }) {
  const categories = useMemo(() => [...new Set(services.map((s) => s.category))], [services])
  const [tab, setTab] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const rupees = (n: number) => moneyText(Math.round(n), money || 'INR')
  const shown = services.filter((s) => (!tab || s.category === tab) && (!q.trim() || `${s.name} ${s.category}`.toLowerCase().includes(q.trim().toLowerCase())))
  const groups = tab || q.trim() ? [{ name: tab || 'Results', items: shown }] : categories.map((c) => ({ name: c, items: shown.filter((s) => s.category === c) }))
  void money
  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
        {categories.length > 1 && (
          <div role="tablist" aria-label="Service types" className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible flex-1">
            <button type="button" role="tab" aria-selected={!tab} onClick={() => setTab(null)} className={`shrink-0 h-9 px-4 rounded-full text-[13.5px] font-bold border cursor-pointer ${!tab ? 'bg-[var(--c)] border-[var(--c)] text-white' : 'bg-white border-[#d5ddeb] text-[#4a5672]'}`}>All</button>
            {categories.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={tab === c} onClick={() => setTab(c)} className={`shrink-0 h-9 px-4 rounded-full text-[13.5px] font-bold border cursor-pointer ${tab === c ? 'bg-[var(--c)] border-[var(--c)] text-white' : 'bg-white border-[#d5ddeb] text-[#4a5672]'}`}>{c}</button>
            ))}
          </div>
        )}
        {services.length > 10 && (
          <div className="relative sm:w-64 shrink-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services" aria-label="Search services" className="w-full h-10 pl-9 pr-3 rounded-full border border-[#d5ddeb] bg-white text-[14px] focus:outline-none focus:border-[var(--c)]" />
          </div>
        )}
      </div>
      {shown.length === 0 && <p className="mt-6 text-[14.5px] text-[#6B7894]">No service matches. Try another word.</p>}
      <div className="mt-5 space-y-6">
        {groups.filter((g) => g.items.length).map((g) => (
          <div key={g.name}>
            {groups.length > 1 && <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894] mb-2">{g.name}</h3>}
            <ul className="grid sm:grid-cols-2 gap-3">
              {g.items.map((s) => (
                <li key={s.id} className="bg-white rounded-xl border border-[#e3e8f2] p-4 flex items-center gap-3 min-w-0 hover:border-[var(--c)] transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15.5px] font-bold text-[#0E1B3D] break-words">{s.name}</p>
                    <p className="mt-0.5 text-[13px] text-[#6B7894] flex flex-wrap items-center gap-x-3">
                      <span className="inline-flex items-center gap-1"><Clock size={13} /> {duration(s.minutes)}</span>
                      {showPrices && s.price > 0 && <span className="font-bold text-[#0E1B3D] text-[14px]">{rupees(s.price)}</span>}
                    </p>
                  </div>
                  {bookable && <BookButton service={s.id} className="shrink-0 h-9 px-4 leading-9 rounded-full border-2 border-[var(--c)] text-[var(--c)] text-[13.5px] font-bold hover:bg-[var(--c)] hover:text-white transition-colors">Book</BookButton>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
