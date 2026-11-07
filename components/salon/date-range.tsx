'use client'

/** Pick the dates a list or report covers: a preset (Today, Last 7 days…) or any from–to range. */

import { CalendarRange } from 'lucide-react'
import { MAX_RANGE_DAYS, RANGE_PRESETS, rangeLabel, resolveRange, type DateRange } from '@/lib/salon/ranges'
import { istDate } from '@/lib/salon/spoken'
import { card } from './ui'

const dateInput = 'h-10 w-full sm:w-[150px] px-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[14.5px] text-[#0E1B3D] dark:text-white dark:[color-scheme:dark] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'

const days = (range: DateRange) => Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1

export function DateRangeFilter({ value, onChange, loading }: { value: DateRange; onChange: (range: DateRange) => void; loading?: boolean }) {
  const today = istDate()
  const count = days(value)
  const custom = value.preset === 'custom'
  const label = (
    <p className={`flex items-center gap-1.5 text-[13.5px] font-semibold text-[#4a5672] dark:text-slate-300 ${custom ? 'sm:ml-auto sm:pb-2.5' : 'lg:ml-auto'}`} aria-live="polite">
      <CalendarRange size={16} className={`shrink-0 text-[#1D5BEA] ${loading ? 'animate-pulse' : ''}`} />
      <span>{rangeLabel(value, today)}{count > 1 && <span className="font-normal text-[#8a94a8] whitespace-nowrap"> · {count} days{count >= MAX_RANGE_DAYS ? ' (longest)' : ''}</span>}</span>
    </p>
  )
  return (
    <div className={`${card} px-3 sm:px-4 py-3 space-y-3`}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div role="radiogroup" aria-label="Dates" className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((preset) => {
            const on = value.preset === preset.id
            return (
              <button key={preset.id} type="button" role="radio" aria-checked={on}
                onClick={() => onChange(preset.id === 'custom' ? { ...value, preset: 'custom' } : resolveRange(preset.id))}
                className={`h-9 px-3 sm:px-3.5 rounded-full border text-[13.5px] sm:text-[14px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${on ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#d5ddeb] dark:border-slate-700 text-[#4a5672] dark:text-slate-300 hover:border-[#9db5ef] hover:text-[#0E1B3D] dark:hover:text-white'}`}>
                {preset.label}
              </button>
            )
          })}
        </div>
        {!custom && label}
      </div>
      {custom && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-3 border-t border-[#eef1f6] dark:border-slate-800">
          <div className="grid grid-cols-2 sm:flex gap-2">
            <label className="block">
              <span className="block text-[12.5px] font-semibold text-[#6B7894] mb-1">From</span>
              <input type="date" value={value.from} max={today} onChange={(e) => e.target.value && onChange(resolveRange('custom', e.target.value, value.to))} className={dateInput} />
            </label>
            <label className="block">
              <span className="block text-[12.5px] font-semibold text-[#6B7894] mb-1">To</span>
              <input type="date" value={value.to} max={today} onChange={(e) => e.target.value && onChange(resolveRange('custom', value.from, e.target.value))} className={dateInput} />
            </label>
          </div>
          {label}
        </div>
      )}
    </div>
  )
}
