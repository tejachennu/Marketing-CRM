'use client'

/**
 * The counter's sheets: book an appointment (or start a walk-in), bill, and the result with the
 * invoice link. Everything is chosen by tapping; voice fills the same sheets in (phase 4).
 */

import { useMemo, useState } from 'react'
import { Banknote, CalendarPlus, Check, Clock, Copy, CreditCard, ExternalLink, Loader2, MessageCircle, Plus, Receipt, Smartphone, Wand2 } from 'lucide-react'
import { computeInvoice, formatRupees, type Discount } from '@/lib/salon/invoice'
import { addDays, bookingSlots, formatIstDay, formatIstTime, fromIst, istDate } from '@/lib/salon/spoken'
import { api, Avatar, Chip, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { Appointment, SalonSetup, Service } from './types'

export type PaymentChoice = 'cash' | 'upi' | 'card' | null

export interface BookingDraft {
  contact_id?: string | null
  name?: string
  phone?: string
  service_ids?: string[]
  staff_id?: string | null
  date?: string
  time?: string
}

export interface BillDraft {
  extra_service_ids?: string[]
  discount?: Discount | null
  payment_method?: PaymentChoice
}

export type BillTarget =
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'walkin'; customer: { contact_id?: string | null; name: string; phone?: string | null }; service_ids: string[]; staff_id: string | null }

const DISCOUNTS: { label: string; value: Discount | null }[] = [
  { label: 'None', value: null },
  { label: '5%', value: { type: 'percent', value: 5 } },
  { label: '10%', value: { type: 'percent', value: 10 } },
  { label: '15%', value: { type: 'percent', value: 15 } },
  { label: '20%', value: { type: 'percent', value: 20 } },
  { label: '₹50 off', value: { type: 'amount', value: 50 } },
  { label: '₹100 off', value: { type: 'amount', value: 100 } },
]
const PAYMENTS: { value: PaymentChoice; label: string; icon: typeof Banknote }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote }, { value: 'upi', label: 'UPI', icon: Smartphone }, { value: 'card', label: 'Card', icon: CreditCard }, { value: null, label: 'Not paid yet', icon: Clock },
]

const sameDiscount = (a?: Discount | null, b?: Discount | null) => (!a && !b) || (a && b && a.type === b.type && a.value === b.value)

function ServicePicker({ services, selected, onChange }: { services: Service[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, Service[]>()
    for (const service of services.filter((s) => s.active)) map.set(service.category || 'General', [...(map.get(service.category || 'General') || []), service])
    return [...map.entries()]
  }, [services])
  return (
    <div className="space-y-3">
      {groups.map(([category, list]) => (
        <div key={category}>
          <div className="text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8] mb-1.5">{category}</div>
          <div className="flex flex-wrap gap-2">
            {list.map((service) => {
              const on = selected.includes(service.id)
              return (
                <Chip key={service.id} selected={on} onClick={() => onChange(on ? selected.filter((id) => id !== service.id) : [...selected, service.id])}>
                  {on && <Check size={15} strokeWidth={3} />} {service.name} <span className="font-normal opacity-70">{formatRupees(Number(service.price))}</span>
                </Chip>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface StaffLine { key: string; service_id: string | null; name: string }

/**
 * Who does (or did) each service. One tap on a name also fills the other services that person
 * does and nobody is down for yet, so a single person doing everything is one tap.
 */
export function WhoDidIt({ setup, lines, value, onChange, planned }: { setup: SalonSetup; lines: StaffLine[]; value: Record<string, string | null>; onChange: (next: Record<string, string | null>) => void; planned?: boolean }) {
  const team = setup.staff.filter((member) => member.active)
  if (!team.length || !lines.length) return null
  const canDo = (serviceId: string | null) => team.filter((member) => !member.service_ids.length || !serviceId || member.service_ids.includes(serviceId))
  function pick(key: string, staffId: string | null) {
    const next = { ...value, [key]: staffId }
    if (staffId) for (const line of lines) if (line.key !== key && !next[line.key] && canDo(line.service_id).some((member) => member.id === staffId)) next[line.key] = staffId
    onChange(next)
  }
  const many = lines.length > 1
  const chip = (on: boolean) => `shrink-0 inline-flex items-center gap-1.5 h-10 pl-1.5 pr-3 rounded-xl border text-[14px] font-semibold cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-200' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`
  return (
    <Field group label={many ? (planned ? 'Who will do each service?' : 'Who did each service?') : (planned ? 'Who will do it?' : 'Who did it?')}
      hint={many ? 'Tap a name once and it fills their other services too. Change any row with one tap.' : undefined}>
      <div className={many ? 'rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800' : ''}>
        {lines.map((line) => {
          const chosen = value[line.key] || null
          return (
            <div key={line.key} className={many ? 'px-3 py-2.5 sm:flex sm:items-center sm:gap-3' : ''}>
              {many && <div className="text-[14.5px] font-bold text-[#0E1B3D] dark:text-white sm:w-40 shrink-0 truncate mb-1.5 sm:mb-0">{line.name}</div>}
              <div className="flex gap-1.5 overflow-x-auto sm:flex-wrap -mx-1 px-1 pb-0.5" role="radiogroup" aria-label={`Who for ${line.name}`}>
                {canDo(line.service_id).map((member) => (
                  <button key={member.id} type="button" role="radio" aria-checked={chosen === member.id} onClick={() => pick(line.key, member.id)} className={chip(chosen === member.id)}>
                    <Avatar name={member.name} size={26} /> {member.name}
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={!chosen} onClick={() => pick(line.key, null)} className={`${chip(!chosen)} pl-3`}>Anyone</button>
              </div>
            </div>
          )
        })}
      </div>
    </Field>
  )
}

// ── Book (or start a walk-in) ────────────────────────────────────────────────

export function BookingSheet({ orgId, setup, mode, draft, onClose, onBooked, onWalkInReady }: {
  orgId: string
  setup: SalonSetup
  mode: 'booking' | 'walkin'
  draft?: BookingDraft
  onClose: () => void
  onBooked: (result: any) => void
  onWalkInReady: (target: Extract<BillTarget, { kind: 'walkin' }>) => void
}) {
  const today = istDate()
  const [name, setName] = useState(draft?.name || '')
  const [phone, setPhone] = useState(draft?.phone || '')
  const [serviceIds, setServiceIds] = useState<string[]>(draft?.service_ids || [])
  const [lineStaff, setLineStaff] = useState<Record<string, string | null>>(() => Object.fromEntries((draft?.service_ids || []).map((id) => [id, draft?.staff_id || null])))
  const [date, setDate] = useState(draft?.date || today)
  const [time, setTime] = useState(draft?.time || '')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const chosen = setup.services.filter((service) => serviceIds.includes(service.id))
  const chosenInOrder = serviceIds.map((id) => setup.services.find((service) => service.id === id)).filter(Boolean) as Service[]
  const minutes = chosen.reduce((sum, service) => sum + Number(service.duration_minutes || 0), 0)
  const price = chosen.reduce((sum, service) => sum + Number(service.price || 0), 0)
  const slots = bookingSlots(date)

  async function submit() {
    setError('')
    if (!serviceIds.length) { setError('Choose at least one service.'); return }
    if (mode === 'walkin') {
      // Who did each service is asked on the bill
      onWalkInReady({ kind: 'walkin', customer: { contact_id: draft?.contact_id || null, name: name.trim() || 'Walk-in customer', phone: phone.trim() || null }, service_ids: serviceIds, staff_id: draft?.staff_id || null })
      return
    }
    if (!name.trim() && !phone.trim()) { setError('Add the customer\'s name or phone number.'); return }
    const startsAt = fromIst(date, time)
    if (!time || !startsAt) { setError('Choose a time.'); return }
    setSaving(true)
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: {
        type: 'create_appointment', customer: { contact_id: draft?.contact_id || null, name: name.trim(), phone: phone.trim() || null },
        service_ids: serviceIds, staff_ids: serviceIds.map((id) => lineStaff[id] || null), starts_at: startsAt.toISOString(), send_whatsapp: sendWhatsApp,
      } }) })
      onBooked(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal wide title={mode === 'walkin' ? 'Walk-in bill' : 'New booking'} subtitle={mode === 'walkin' ? 'Pick the services, then bill. Name and number are optional.' : 'Pick services and a time. Nothing to type but the name.'}
      icon={mode === 'walkin' ? <Wand2 size={21} /> : <CalendarPlus size={21} />} onClose={onClose}
      footer={<>
        <span className="hidden sm:block mr-auto text-[14px] text-[#6B7894]">{chosen.length ? <><strong className="text-[#0E1B3D] dark:text-white">{chosen.length} service{chosen.length === 1 ? '' : 's'}</strong> · {minutes} min · <strong className="text-[#0E1B3D] dark:text-white">{formatRupees(price)}</strong></> : 'No services chosen yet'}</span>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className={`${primaryButton} sm:min-w-[220px]`}>
          {saving && <Loader2 size={18} className="animate-spin" />}
          {mode === 'walkin' ? `Next: bill ${price ? formatRupees(price) : ''}` : `Book${time ? ` · ${formatIstDay(date)} ${formatIstTime(fromIst(date, time) || new Date())}` : ''}`}
        </button>
      </>}>
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium">{error}</div>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={mode === 'walkin' ? 'Customer name (optional)' : 'Customer name'}><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'walkin' ? 'Leave empty for a walk-in' : 'Priya'} /></Field>
          <Field label="Mobile number (optional)" hint={mode === 'walkin' ? 'Only if they want the bill on WhatsApp.' : 'Confirmations and bills go to this WhatsApp number.'}><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" /></Field>
        </div>
        <Field group label="Services"><ServicePicker services={setup.services} selected={serviceIds} onChange={setServiceIds} /></Field>
        {mode === 'booking' && <WhoDidIt planned setup={setup} lines={chosenInOrder.map((service) => ({ key: service.id, service_id: service.id, name: service.name }))} value={lineStaff} onChange={setLineStaff} />}
        {mode === 'booking' && (
          <>
            <Field group label="Day">
              <div className="flex flex-wrap gap-2 items-center">
                {[0, 1, 2].map((offset) => { const day = addDays(today, offset); return <Chip key={day} selected={date === day} onClick={() => { setDate(day); setTime('') }}>{formatIstDay(day, today)}</Chip> })}
                <input type="date" aria-label="Another day" min={today} value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setTime('') } }} className={`${input} w-auto h-10`} />
              </div>
            </Field>
            <Field group label="Time">
              {slots.length ? (
                <div className="flex flex-wrap gap-2">{slots.map((slot) => <Chip key={slot} selected={time === slot} onClick={() => setTime(slot)}>{formatIstTime(fromIst(date, slot)!)}</Chip>)}</div>
              ) : <p className="text-[14px] text-[#6B7894]">No more times today. Pick another day, or enter a time:</p>}
              <input type="time" aria-label="Exact time" value={time} onChange={(e) => setTime(e.target.value)} className={`${input} w-auto h-10 mt-2`} />
            </Field>
            {phone.trim() && (
              <label className="flex items-center justify-between gap-4 rounded-2xl bg-[#e8f7f1]/70 dark:bg-emerald-950/20 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white">
                <span className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-[#00A884] text-white flex items-center justify-center"><MessageCircle size={18} /></span><span><strong>Send confirmation on WhatsApp</strong><span className="block text-[13px] text-[#4a5672] dark:text-slate-400">With the day, time and services</span></span></span>
                <Toggle checked={sendWhatsApp} onChange={setSendWhatsApp} label="Send confirmation on WhatsApp" />
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Bill ─────────────────────────────────────────────────────────────────────

export function BillSheet({ orgId, setup, target, draft, onClose, onBilled }: {
  orgId: string
  setup: SalonSetup
  target: BillTarget
  draft?: BillDraft
  onClose: () => void
  onBilled: (result: any) => void
}) {
  const [extra, setExtra] = useState<string[]>(draft?.extra_service_ids || [])
  const [discount, setDiscount] = useState<Discount | null>(draft?.discount || null)
  const [payment, setPayment] = useState<PaymentChoice>(draft?.payment_method === undefined ? 'cash' : draft.payment_method)
  const [addMore, setAddMore] = useState(false)
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const customer = target.kind === 'appointment' ? { name: target.appointment.customer_name, phone: target.appointment.customer_phone } : target.customer
  const fromList = (id: string, key: string) => {
    const s = setup.services.find((service) => service.id === id)
    return s ? { key, service_id: s.id, name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate), sac_code: s.sac_code } : null
  }
  type Line = { key: string; service_id: string | null; name: string; price: number; tax_rate: number; sac_code: string | null; staff_id?: string | null }
  // The lines in the order the server bills them, each with a key for "who did it"
  const walkInIds = target.kind === 'walkin' ? [...new Set([...target.service_ids, ...extra])] : []
  const lines: Line[] = target.kind === 'appointment'
    ? [...target.appointment.services.map((s, index) => ({ ...s, key: `b${index}`, price: Number(s.price), tax_rate: Number(s.tax_rate), staff_id: s.staff_id || target.appointment.staff_id })), ...extra.map((id) => fromList(id, `e:${id}`)).filter(Boolean) as Line[]]
    : walkInIds.map((id) => fromList(id, `s:${id}`)).filter(Boolean) as Line[]
  const [lineStaff, setLineStaff] = useState<Record<string, string | null>>(() => Object.fromEntries(lines.map((line) => [line.key, line.staff_id || (target.kind === 'walkin' ? target.staff_id : null) || null])))
  const staffName = (id: string | null | undefined) => (id ? setup.staff.find((member) => member.id === id)?.name : undefined)
  const registered = Boolean(setup.settings.gstin)
  const bill = computeInvoice(lines.map((line) => ({ ...line, tax_rate: registered ? Number(line.tax_rate) : 0 })), { pricesIncludeTax: setup.settings.prices_include_tax, discount })

  async function submit() {
    setError('')
    setSaving(true)
    try {
      const staff_ids = lines.map((line) => lineStaff[line.key] || null)
      const action = target.kind === 'appointment'
        ? { type: 'complete_and_bill', appointment_id: target.appointment.id, extra_service_ids: extra, staff_ids, discount, payment_method: payment, send_whatsapp: sendWhatsApp }
        : { type: 'walk_in_bill', customer: target.customer, service_ids: walkInIds, staff_ids, discount, payment_method: payment, send_whatsapp: sendWhatsApp }
      onBilled(await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action }) }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal wide title={`Bill ${customer.name || 'customer'}`} icon={<Receipt size={21} />}
      subtitle={[target.kind === 'appointment' ? `${formatIstTime(target.appointment.starts_at)} appointment` : 'Walk-in', customer.phone].filter(Boolean).join(' · ')} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving || !bill.lines.length} className="inline-flex items-center justify-center gap-2 h-12 px-5 sm:min-w-[260px] rounded-xl bg-[#00A884] hover:bg-[#008f70] text-white text-[16px] font-bold shadow-sm shadow-[#00A884]/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Receipt size={18} />} Bill {formatRupees(bill.total)}{payment ? ` · ${PAYMENTS.find((p) => p.value === payment)?.label}` : ''}
        </button>
      </>}>
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium">{error}</div>}
        <div className="rounded-2xl bg-[#f8fafc] dark:bg-slate-900/60 border border-[#e3e8f2] dark:border-slate-800 p-4 sm:p-5">
          <ul className="space-y-2.5">
            {bill.lines.map((line, index) => (
              <li key={index} className="flex items-baseline justify-between gap-3 text-[15.5px]">
                <span className="text-[#0E1B3D] dark:text-white font-semibold">{line.name}{staffName(lineStaff[lines[index]?.key]) && <span className="font-normal text-[13px] text-[#6B7894]"> · {staffName(lineStaff[lines[index]?.key])}</span>}</span>
                <span aria-hidden className="flex-1 border-b border-dotted border-[#c0c8d8] dark:border-slate-700 translate-y-[-4px]" />
                <span className="font-bold text-[#0E1B3D] dark:text-white">{formatRupees(line.price * line.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-dashed border-[#c0c8d8] dark:border-slate-700 space-y-1.5 text-[14.5px] text-[#4a5672] dark:text-slate-400">
            {bill.discount > 0 && <div className="flex justify-between"><span>Discount</span><span className="font-semibold text-[#047857] dark:text-emerald-300">− {formatRupees(bill.discount)}</span></div>}
            {registered && <div className="flex justify-between"><span>GST (CGST + SGST)</span><span>{formatRupees(bill.tax)}</span></div>}
            <div className="flex items-end justify-between pt-1.5">
              <span className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">Total</span>
              <span className="text-[28px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white leading-none">{formatRupees(bill.total)}</span>
            </div>
          </div>
        </div>
        {!addMore
          ? <button type="button" onClick={() => setAddMore(true)} className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-dashed border-[#d5ddeb] dark:border-slate-700 text-[15px] font-semibold text-[#4a5672] dark:text-slate-300 hover:border-[#9db5ef] hover:text-[#1D5BEA] cursor-pointer"><Plus size={18} /> Add another service</button>
          : <Field group label="Add services"><ServicePicker services={setup.services} selected={extra} onChange={setExtra} /></Field>}
        <WhoDidIt setup={setup} lines={lines} value={lineStaff} onChange={setLineStaff} />
        <Field group label="Discount"><div className="flex flex-wrap gap-2">{DISCOUNTS.map((option) => <Chip key={option.label} selected={Boolean(sameDiscount(discount, option.value))} onClick={() => setDiscount(option.value)}>{option.label}</Chip>)}</div></Field>
        <Field group label="Paid by">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PAYMENTS.map(({ value, label, icon: Icon }) => {
              const on = payment === value
              return (
                <button key={label} type="button" aria-pressed={on} onClick={() => setPayment(value)}
                  className={`relative h-[74px] rounded-2xl border-2 flex flex-col items-center justify-center gap-1 text-[14.5px] font-bold cursor-pointer transition-colors ${on ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-200' : 'border-[#e3e8f2] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`}>
                  {on && <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-[#1D5BEA] text-white flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>}
                  <Icon size={22} /> {label}
                </button>
              )
            })}
          </div>
        </Field>
        {customer.phone && (
          <label className="flex items-center justify-between gap-4 rounded-2xl bg-[#e8f7f1]/70 dark:bg-emerald-950/20 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white">
            <span className="flex items-center gap-3"><span className="h-9 w-9 shrink-0 rounded-xl bg-[#00A884] text-white flex items-center justify-center"><MessageCircle size={18} /></span><span><strong>Send the bill on WhatsApp</strong><span className="block text-[13px] text-[#4a5672] dark:text-slate-400">To {customer.phone}</span></span></span>
            <Toggle checked={sendWhatsApp} onChange={setSendWhatsApp} label="Send the bill on WhatsApp" />
          </label>
        )}
      </div>
    </Modal>
  )
}

// ── After billing ───────────────────────────────────────────────────────────

export function ResultSheet({ result, onClose, onCopied }: { result: any; onClose: () => void; onCopied: () => void }) {
  const invoice = result.invoice
  const link: string = result.link
  const phone = String(invoice?.customer_phone || '').replace(/\D/g, '')
  const shareText = `Your bill ${invoice?.number} from ${invoice?.business?.name || 'us'}: ${formatRupees(Number(invoice?.total))}. ${link}`
  const paid = invoice?.status === 'paid'
  const tile = 'flex flex-col items-center justify-center gap-1.5 h-[84px] rounded-2xl border border-[#e3e8f2] dark:border-slate-700 text-[14px] font-bold text-[#0E1B3D] dark:text-white hover:border-[#9db5ef] hover:bg-[#f8fafc] dark:hover:bg-slate-800 transition-colors cursor-pointer'
  return (
    <Modal title="Billed" subtitle={`${invoice?.number} · ${invoice?.customer_name}`} onClose={onClose} footer={<button type="button" onClick={onClose} className={`${primaryButton} sm:min-w-[140px]`}>Done</button>}>
      <div className="text-center pt-1 pb-2">
        <span className="relative mx-auto h-[72px] w-[72px] flex items-center justify-center">
          <span aria-hidden className="absolute inset-0 rounded-full bg-[#00A884]/15" />
          <span className="relative h-14 w-14 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow-lg shadow-[#00A884]/30"><Check size={30} strokeWidth={3} /></span>
        </span>
        <p className="text-[34px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white mt-3 leading-none">{formatRupees(Number(invoice?.total))}</p>
        <p className={`mt-2 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13.5px] font-bold ${paid ? 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'}`}>
          {paid ? <Check size={14} strokeWidth={3} /> : <Clock size={14} />} {paid ? `Paid${invoice?.payment_method ? ` · ${({ cash: 'Cash', upi: 'UPI', card: 'Card' } as Record<string, string>)[invoice.payment_method] || ''}` : ''}` : 'Not paid yet'}
        </p>
        {result.whatsapp?.sent && <p className="mt-3 flex items-center justify-center gap-1.5 text-[14px] font-semibold text-[#047857] dark:text-emerald-300"><MessageCircle size={15} /> Sent to the customer on WhatsApp</p>}
        {result.whatsapp && !result.whatsapp.sent && <p className="mt-4 rounded-xl bg-[#fff7e8] dark:bg-amber-950/30 text-[#92400e] dark:text-amber-200 px-4 py-2.5 text-[14px] text-left">{result.whatsapp.windowClosed ? 'WhatsApp could not deliver it: this customer has not messaged you in the last 24 hours. Share the link below instead.' : result.whatsapp.error}</p>}
      </div>
      <div className={`grid ${phone ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mt-4`}>
        <a href={link} target="_blank" rel="noopener noreferrer" className={tile}><ExternalLink size={20} className="text-[#1D5BEA]" /> Open bill</a>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(link).then(onCopied).catch(() => {}) }} className={tile}><Copy size={20} className="text-[#4a5672] dark:text-slate-300" /> Copy link</button>
        {phone && <a href={`https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className={tile}><MessageCircle size={20} className="text-[#00A884]" /> WhatsApp</a>}
      </div>
    </Modal>
  )
}
