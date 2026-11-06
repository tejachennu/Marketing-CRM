'use client'

/**
 * The counter's sheets: book an appointment (or start a walk-in), bill, and the result with the
 * invoice link. Everything is chosen by tapping; voice fills the same sheets in (phase 4).
 */

import { useMemo, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, Loader2, MessageCircle, Receipt } from 'lucide-react'
import { computeInvoice, formatRupees, type Discount } from '@/lib/salon/invoice'
import { addDays, bookingSlots, formatIstDay, formatIstTime, fromIst, istDate } from '@/lib/salon/spoken'
import { api, Chip, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
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
const PAYMENTS: { value: PaymentChoice; label: string }[] = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: null, label: 'Not paid yet' }]

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
          <div className="text-[13px] font-bold text-[#6B7894] mb-1.5">{category}</div>
          <div className="flex flex-wrap gap-2">
            {list.map((service) => {
              const on = selected.includes(service.id)
              return (
                <Chip key={service.id} selected={on} onClick={() => onChange(on ? selected.filter((id) => id !== service.id) : [...selected, service.id])}>
                  {service.name} <span className="font-normal opacity-70">{formatRupees(Number(service.price))}</span>
                </Chip>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function StaffPicker({ setup, serviceIds, selected, onChange }: { setup: SalonSetup; serviceIds: string[]; selected: string | null; onChange: (id: string | null) => void }) {
  const staff = setup.staff.filter((member) => member.active && (!member.service_ids.length || !serviceIds.length || serviceIds.some((id) => member.service_ids.includes(id))))
  if (!setup.staff.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      <Chip selected={!selected} onClick={() => onChange(null)}>Anyone</Chip>
      {staff.map((member) => <Chip key={member.id} selected={selected === member.id} onClick={() => onChange(member.id)}>{member.name}</Chip>)}
    </div>
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
  const [staffId, setStaffId] = useState<string | null>(draft?.staff_id || null)
  const [date, setDate] = useState(draft?.date || today)
  const [time, setTime] = useState(draft?.time || '')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const chosen = setup.services.filter((service) => serviceIds.includes(service.id))
  const minutes = chosen.reduce((sum, service) => sum + Number(service.duration_minutes || 0), 0)
  const price = chosen.reduce((sum, service) => sum + Number(service.price || 0), 0)
  const slots = bookingSlots(date)

  async function submit() {
    setError('')
    if (!serviceIds.length) { setError('Choose at least one service.'); return }
    if (mode === 'walkin') {
      onWalkInReady({ kind: 'walkin', customer: { contact_id: draft?.contact_id || null, name: name.trim() || 'Walk-in customer', phone: phone.trim() || null }, service_ids: serviceIds, staff_id: staffId })
      return
    }
    if (!name.trim() && !phone.trim()) { setError('Add the customer\'s name or phone number.'); return }
    const startsAt = fromIst(date, time)
    if (!time || !startsAt) { setError('Choose a time.'); return }
    setSaving(true)
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: {
        type: 'create_appointment', customer: { contact_id: draft?.contact_id || null, name: name.trim(), phone: phone.trim() || null },
        service_ids: serviceIds, staff_id: staffId, starts_at: startsAt.toISOString(), send_whatsapp: sendWhatsApp,
      } }) })
      onBooked(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal wide title={mode === 'walkin' ? 'Walk-in bill' : 'New booking'} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className={`${primaryButton} sm:min-w-[220px]`}>
          {saving && <Loader2 size={18} className="animate-spin" />}
          {mode === 'walkin' ? `Next: bill ${price ? formatRupees(price) : ''}` : `Book${time ? ` · ${formatIstDay(date)} ${formatIstTime(fromIst(date, time) || new Date())}` : ''}`}
        </button>
      </>}>
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium">{error}</div>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Customer name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'walkin' ? 'Optional' : 'Priya'} /></Field>
          <Field label="Mobile number" hint="Bills and reminders go to this WhatsApp number."><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" /></Field>
        </div>
        <Field group label={`Services${chosen.length ? ` · ${minutes} min · ${formatRupees(price)}` : ''}`}><ServicePicker services={setup.services} selected={serviceIds} onChange={setServiceIds} /></Field>
        {setup.staff.length > 0 && <Field group label="With"><StaffPicker setup={setup} serviceIds={serviceIds} selected={staffId} onChange={setStaffId} /></Field>}
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
              <label className="flex items-center justify-between gap-4 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Send confirmation on WhatsApp</strong></span><Toggle checked={sendWhatsApp} onChange={setSendWhatsApp} label="Send confirmation on WhatsApp" /></label>
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
  const baseLines = target.kind === 'appointment'
    ? target.appointment.services
    : setup.services.filter((s) => target.service_ids.includes(s.id)).map((s) => ({ service_id: s.id, name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate), duration_minutes: s.duration_minutes, sac_code: s.sac_code }))
  const extraLines = setup.services.filter((s) => extra.includes(s.id)).map((s) => ({ service_id: s.id, name: s.name, price: Number(s.price), tax_rate: Number(s.tax_rate), sac_code: s.sac_code }))
  const registered = Boolean(setup.settings.gstin)
  const bill = computeInvoice([...baseLines, ...extraLines].map((line) => ({ ...line, tax_rate: registered ? Number(line.tax_rate) : 0 })), { pricesIncludeTax: setup.settings.prices_include_tax, discount })

  async function submit() {
    setError('')
    setSaving(true)
    try {
      const action = target.kind === 'appointment'
        ? { type: 'complete_and_bill', appointment_id: target.appointment.id, extra_service_ids: extra, discount, payment_method: payment, send_whatsapp: sendWhatsApp }
        : { type: 'walk_in_bill', customer: target.customer, service_ids: [...target.service_ids, ...extra], staff_id: target.staff_id, discount, payment_method: payment, send_whatsapp: sendWhatsApp }
      onBilled(await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action }) }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal wide title={`Bill ${customer.name || 'customer'}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving || !bill.lines.length} className={`${primaryButton} sm:min-w-[240px] h-12 text-[16px]`}>
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Receipt size={18} />} Bill {formatRupees(bill.total)}{payment ? ` · ${PAYMENTS.find((p) => p.value === payment)?.label}` : ''}
        </button>
      </>}>
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-xl bg-[#fdf0f0] dark:bg-red-950/30 text-[#b91c1c] dark:text-red-300 px-4 py-3 text-[14.5px] font-medium">{error}</div>}
        <div className="rounded-xl border border-[#e3e8f2] dark:border-slate-700 divide-y divide-[#eef1f6] dark:divide-slate-800">
          {bill.lines.map((line, index) => (
            <div key={index} className="flex items-center justify-between px-4 py-2.5 text-[15px]">
              <span className="text-[#0E1B3D] dark:text-white">{line.name}</span>
              <span className="font-semibold text-[#0E1B3D] dark:text-white">{formatRupees(line.price * line.quantity)}</span>
            </div>
          ))}
          <div className="px-4 py-3 space-y-1 text-[14px] text-[#4a5672] dark:text-slate-400 bg-[#f8fafc] dark:bg-slate-900/40 rounded-b-xl">
            {bill.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>− {formatRupees(bill.discount)}</span></div>}
            {registered && <div className="flex justify-between"><span>GST (CGST + SGST)</span><span>{formatRupees(bill.tax)}</span></div>}
            <div className="flex justify-between text-[18px] font-extrabold text-[#0E1B3D] dark:text-white pt-1"><span>Total</span><span>{formatRupees(bill.total)}</span></div>
          </div>
        </div>
        {!addMore
          ? <button type="button" onClick={() => setAddMore(true)} className={`${secondaryButton} h-10`}>+ Add another service</button>
          : <Field group label="Add services"><ServicePicker services={setup.services} selected={extra} onChange={setExtra} /></Field>}
        <Field group label="Discount"><div className="flex flex-wrap gap-2">{DISCOUNTS.map((option) => <Chip key={option.label} selected={Boolean(sameDiscount(discount, option.value))} onClick={() => setDiscount(option.value)}>{option.label}</Chip>)}</div></Field>
        <Field group label="Paid by"><div className="flex flex-wrap gap-2">{PAYMENTS.map((option) => <Chip key={option.label} selected={payment === option.value} onClick={() => setPayment(option.value)}>{option.label}</Chip>)}</div></Field>
        {customer.phone && (
          <label className="flex items-center justify-between gap-4 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Send the bill on WhatsApp</strong><span className="block text-[13.5px] text-[#6B7894]">To {customer.phone}</span></span><Toggle checked={sendWhatsApp} onChange={setSendWhatsApp} label="Send the bill on WhatsApp" /></label>
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
  return (
    <Modal title="Billed" onClose={onClose} footer={<button type="button" onClick={onClose} className={primaryButton}>Done</button>}>
      <div className="text-center py-2">
        <CheckCircle2 size={48} className="mx-auto text-[#00A884]" />
        <p className="text-[26px] font-extrabold text-[#0E1B3D] dark:text-white mt-2">{formatRupees(Number(invoice?.total))}</p>
        <p className="text-[15px] text-[#4a5672] dark:text-slate-400">{invoice?.number} · {invoice?.customer_name} · {invoice?.status === 'paid' ? 'Paid' : 'Not paid yet'}</p>
        {result.whatsapp?.sent && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#e8f7f1] text-[#047857] px-3 py-1 text-[14px] font-semibold"><MessageCircle size={15} /> Sent on WhatsApp</p>}
        {result.whatsapp && !result.whatsapp.sent && <p className="mt-3 rounded-xl bg-[#fff7e8] text-[#92400e] px-4 py-2.5 text-[14px]">{result.whatsapp.windowClosed ? 'WhatsApp could not deliver it: this customer has not messaged you in the last 24 hours. Share the link below instead.' : result.whatsapp.error}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
        <a href={link} target="_blank" rel="noopener noreferrer" className={secondaryButton}><ExternalLink size={17} /> Open bill</a>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(link).then(onCopied).catch(() => {}) }} className={secondaryButton}><Copy size={17} /> Copy link</button>
        {phone && <a href={`https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className={secondaryButton}><MessageCircle size={17} /> Share</a>}
      </div>
    </Modal>
  )
}
