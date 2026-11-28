'use client'

/**
 * Shop holidays (Front Desk → Team → Attendance → Holidays): days the shop is closed besides its weekly closed days.
 * One-off (Diwali this year) or repeating every year, every month on a date, or every month on a weekday. No bookings
 * are taken on them, the website says Closed, and attendance skips them. Managers change them; everyone can look.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarHeart, CalendarX2, Check, Loader2, Minus, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import {
  HOLIDAY_NAME_MAX, MAX_HOLIDAY_DAYS, MAX_MONTHLY_HOLIDAY_DAYS, cleanHoliday, nextTime, repeatChoices, spanLabel,
  type Holiday, type HolidayRepeat,
} from '@/lib/salon/holidays'
import { istDate } from '@/lib/salon/spoken'
import { api, card, Field, input, Modal, primaryButton, secondaryButton, dangerButton } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void
interface HolidayRow extends Holiday { label: string; next: { start: string; end: string; label: string } | null }
interface UpcomingRow { id: string; name: string; start: string; end: string; days: number; repeat: HolidayRepeat; label: string }
interface HolidaysData { today: string; canChange: boolean; holidays: HolidayRow[]; upcoming: UpcomingRow[]; suggestions: { name: string; start: string; repeat: HolidayRepeat }[] }

/** Festivals move every year: names to tap, added as "only once". */
const QUICK_NAMES = ['Diwali', 'Holi', 'Sankranti', 'Ugadi', 'Dussehra', 'Eid', 'Christmas', 'Family function']

const weekdayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })

export function SalonHolidays({ orgId, flash, onChanged }: { orgId: string; flash: Flash; onChanged?: () => void }) {
  const [data, setData] = useState<HolidaysData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Holiday> | null>(null)
  const [removing, setRemoving] = useState<HolidayRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api(`/api/salon/holidays?organizationId=${orgId}`))
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function save(holiday: Partial<Holiday>): Promise<string | null> {
    try {
      const result = await api('/api/salon/holidays', { method: 'POST', body: JSON.stringify({ organizationId: orgId, holiday }) })
      setData(result)
      flash('success', result.message || 'Saved.')
      onChanged?.()
      return null
    } catch (err: any) {
      return err.message || 'The holiday could not be saved.'
    }
  }

  async function addSuggestion(s: { name: string; start: string; repeat: HolidayRepeat }) {
    setBusy(s.name)
    const problem = await save({ name: s.name, start: s.start, repeat: s.repeat, days: 1 })
    if (problem) flash('error', problem)
    setBusy(null)
  }

  async function remove(row: HolidayRow) {
    setBusy(row.id)
    try {
      const result = await api(`/api/salon/holidays?organizationId=${orgId}&id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      setData(result)
      flash('success', result.message || 'Removed.')
      onChanged?.()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
      setRemoving(null)
    }
  }

  if (loading && !data) return <div className={`${card} flex justify-center py-14`}><Loader2 className="animate-spin text-[#008069]" /></div>
  if (!data) return <div className={`${card} px-5 py-10 text-center text-[15px] text-[#6B7894]`}>Holidays could not be loaded. <button type="button" onClick={load} className="font-semibold text-[#008069] cursor-pointer">Try again</button></div>

  const canChange = data.canChange
  const coming = data.upcoming.slice(0, 6)
  // Soonest first; one-offs that have gone at the end
  const sorted = [...data.holidays].sort((a, b) => (a.next?.start || '9999').localeCompare(b.next?.start || '9999') || a.name.localeCompare(b.name))
  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      <section className={`${card} p-4 @xl:p-5`}>
        <div className="flex flex-col @xl:flex-row @xl:items-start gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="h-11 w-11 shrink-0 rounded-xl bg-[#e7f5f0] dark:bg-emerald-950/40 text-[#008069] flex items-center justify-center"><CalendarHeart size={21} /></span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-extrabold text-[#0E1B3D] dark:text-white">Shop holidays</h3>
              <p className="text-[14px] text-[#4a5672] dark:text-slate-300 mt-0.5">Days your shop is closed. No bookings are taken (WhatsApp, booking page, website), your website says Closed, and attendance leaves these days out. You can still make bills.</p>
              <p className="text-[13px] text-[#6B7894] mt-1.5">Closed on the same day every week? Set it in Setup → WhatsApp → Closed on.</p>
            </div>
          </div>
          {canChange && <button type="button" onClick={() => setEditing({ days: 1, repeat: 'none', start: istDate() })} className={`${primaryButton} shrink-0 w-full @xl:w-auto`}><Plus size={18} /> Add holiday</button>}
        </div>
        {canChange && data.suggestions.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-[#eef1f6] dark:border-slate-800">
            <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8]">National holidays, every year</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.suggestions.map((s) => (
                <button key={s.name} type="button" disabled={busy === s.name} onClick={() => addSuggestion(s)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[13.5px] font-semibold text-[#0E1B3D] dark:text-slate-200 hover:border-[#8fcfbf] cursor-pointer disabled:opacity-60">
                  {busy === s.name ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} className="text-[#008069]" />}
                  {s.name} <span className="font-normal text-[#6B7894]">{spanLabel({ start: s.start, end: s.start })}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2 items-start">
        <section className={`${card} min-w-0`}>
          <div className="px-4 @xl:px-5 py-3.5 border-b border-[#eef1f6] dark:border-slate-800">
            <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Coming up</h3>
          </div>
          {!coming.length ? <p className="px-5 py-6 text-[14px] text-[#6B7894]">No holidays coming up.</p> : (
            <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {coming.map((span) => {
                const now = span.start <= data.today && span.end >= data.today
                return (
                  <li key={`${span.id}:${span.start}`} className="px-4 @xl:px-5 py-3 flex items-center gap-3">
                    <div className={`w-12 shrink-0 rounded-xl text-center py-1.5 ${now ? 'bg-[#008069] text-white' : 'bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white'}`}>
                      <p className="text-[11px] font-bold uppercase leading-none opacity-80">{weekdayName(span.start)}</p>
                      <p className="text-[17px] font-extrabold leading-tight">{Number(span.start.slice(8))}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{span.name}{now ? ' · today' : ''}</p>
                      <p className="text-[13px] text-[#6B7894] truncate">{span.label}{span.days > 1 ? ` · ${span.days} days` : ''}</p>
                    </div>
                    {span.repeat !== 'none' && <Repeat size={16} className="text-[#8a94a8] shrink-0" aria-label="Repeats" />}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className={`${card} min-w-0`}>
          <div className="px-4 @xl:px-5 py-3.5 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2">
            <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">All holidays</h3>
            <span className="text-[13px] font-semibold text-[#8a94a8]">{data.holidays.length}</span>
          </div>
          {!data.holidays.length ? (
            <div className="px-5 py-8 text-center">
              <CalendarX2 size={28} className="mx-auto text-[#a3adc2]" />
              <p className="mt-2 text-[14.5px] text-[#6B7894]">No holidays yet.{canChange ? ' Add your festival days, or tap a national holiday above.' : ''}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {sorted.map((row) => (
                <li key={row.id} className="px-4 @xl:px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{row.name}</p>
                    <p className="text-[13px] text-[#4a5672] dark:text-slate-300 truncate">{row.repeat === 'none' ? (row.next ? row.next.label : spanLabel({ start: row.start, end: row.start }, true)) : row.label}</p>
                    <p className="text-[12.5px] text-[#8a94a8] truncate">{row.next ? (row.repeat === 'none' ? (row.days > 1 ? `${row.days} days` : 'Only once') : `Next: ${row.next.label}`) : 'Done'}</p>
                  </div>
                  {canChange && (
                    <div className="flex items-center shrink-0">
                      <button type="button" aria-label={`Change ${row.name}`} onClick={() => setEditing(row)} className="h-10 w-10 rounded-lg flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer"><Pencil size={17} /></button>
                      <button type="button" aria-label={`Remove ${row.name}`} disabled={busy === row.id} onClick={() => setRemoving(row)} className="h-10 w-10 rounded-lg flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#fdf0f0] hover:text-[#b91c1c] dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50">{busy === row.id ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && <HolidaySheet start={editing} onClose={() => setEditing(null)} onSave={async (h) => { const problem = await save(h); if (!problem) setEditing(null); return problem }} />}
      {removing && (
        <Modal title={`Remove ${removing.name}?`} subtitle={removing.repeat === 'none' ? 'The shop takes bookings that day again.' : 'Every time it repeats goes. The shop takes bookings on those days again.'} icon={<Trash2 size={20} />} onClose={() => setRemoving(null)}
          footer={<>
            <button type="button" onClick={() => setRemoving(null)} className={secondaryButton}>Keep it</button>
            <button type="button" disabled={busy === removing.id} onClick={() => remove(removing)} className={dangerButton}>{busy === removing.id ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />} Remove</button>
          </>}>
          <p className="text-[14.5px] text-[#4a5672] dark:text-slate-300">{removing.label}{removing.next ? ` · next ${removing.next.label}` : ''}</p>
        </Modal>
      )}
    </div>
  )
}

/** Add or change a holiday: name, day, how many days, how it repeats, and when it next falls. */
function HolidaySheet({ start, onClose, onSave }: { start: Partial<Holiday>; onClose: () => void; onSave: (holiday: Partial<Holiday>) => Promise<string | null> }) {
  const [name, setName] = useState(start.name || '')
  const [day, setDay] = useState(start.start || istDate())
  const [days, setDays] = useState(start.days || 1)
  const [repeat, setRepeat] = useState<HolidayRepeat>(start.repeat || 'none')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const choices = useMemo(() => repeatChoices(day), [day])
  // A weekday choice that does not fit the new day (no "5th Monday") falls back to the last one
  const has = (v: HolidayRepeat) => choices.some((c) => c.value === v)
  const value: HolidayRepeat = has(repeat) ? repeat
    : repeat === 'monthly_weekday' && has('monthly_last_weekday') ? 'monthly_last_weekday'
    : repeat === 'monthly_last_weekday' && has('monthly_weekday') ? 'monthly_weekday'
    : 'none'
  const most = value === 'none' || value === 'yearly' ? MAX_HOLIDAY_DAYS : MAX_MONTHLY_HOLIDAY_DAYS
  const holiday = { id: start.id, name, start: day, days: Math.min(days, most), repeat: value }
  const checked = cleanHoliday(holiday)
  const next = 'value' in checked ? nextTime(checked.value) : null

  async function submit() {
    setError('')
    if ('error' in checked) { setError(checked.error); return }
    setSaving(true)
    const problem = await onSave(holiday)
    setSaving(false)
    if (problem) setError(problem)
  }

  const chip = (on: boolean) => `h-9 px-3 rounded-full border text-[13.5px] font-semibold cursor-pointer ${on ? 'border-[#008069] bg-[#e7f5f0] text-[#008069] dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200'}`
  return (
    <Modal title={start.id ? 'Change holiday' : 'Add holiday'} subtitle="The shop is closed that day" icon={<CalendarHeart size={20} />} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" disabled={saving} onClick={submit} className={primaryButton}>{saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} Save</button>
      </>}>
      <div className="space-y-4">
        <Field label="Name">
          <input value={name} maxLength={HOLIDAY_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Like Diwali" className={input} autoFocus={!start.id} />
        </Field>
        {!start.id && (
          <div className="flex flex-wrap gap-1.5 -mt-2" aria-label="Quick names">
            {QUICK_NAMES.map((n) => <button key={n} type="button" aria-pressed={name === n} onClick={() => setName(n)} className={chip(name === n)}>{n}</button>)}
          </div>
        )}
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
          <Field label={days > 1 ? 'First day' : 'Day'}><input type="date" value={day} min={value === 'none' ? istDate() : undefined} onChange={(e) => e.target.value && setDay(e.target.value)} className={input} /></Field>
          <Field label="How many days" group>
            <div className="flex items-center h-11 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] overflow-hidden">
              <button type="button" aria-label="One day less" disabled={days <= 1} onClick={() => setDays(Math.max(1, days - 1))} className="h-full w-11 shrink-0 flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-default"><Minus size={17} /></button>
              <span className="flex-1 text-center text-[15px] font-bold text-[#0E1B3D] dark:text-white" aria-live="polite">{Math.min(days, most)} {Math.min(days, most) === 1 ? 'day' : 'days'}</span>
              <button type="button" aria-label="One day more" disabled={days >= most} onClick={() => setDays(Math.min(most, days + 1))} className="h-full w-11 shrink-0 flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-default"><Plus size={17} /></button>
            </div>
          </Field>
        </div>
        <Field label="Repeats" group>
          <div role="radiogroup" aria-label="Repeats" className="grid gap-1.5">
            {choices.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={value === c.value} onClick={() => setRepeat(c.value)}
                className={`flex items-center gap-2.5 min-h-11 px-3.5 py-2 rounded-xl border text-left text-[14.5px] cursor-pointer ${value === c.value ? 'border-[#008069] bg-[#e7f5f0] text-[#0E1B3D] font-semibold dark:bg-emerald-950/40 dark:text-white' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200'}`}>
                <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${value === c.value ? 'border-[#008069] bg-[#008069] shadow-[inset_0_0_0_2px_white] dark:shadow-[inset_0_0_0_2px_#0b141a]' : 'border-[#c0c8d8]'}`} />
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <p className="text-[13.5px] text-[#4a5672] dark:text-slate-300">
          {'error' in checked ? (name.trim() ? checked.error : 'Give it a name and pick the day.') : next ? `Next: ${spanLabel(next, true)}. No bookings are taken ${next.days > 1 ? 'on those days' : 'that day'}.` : 'That day has already gone.'}
        </p>
        {error && <p role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 px-3.5 py-2.5 text-[14px] font-semibold text-[#b91c1c] dark:text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
