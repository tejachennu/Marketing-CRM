'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus, Sparkles, Trash2, Users } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'
import { formatRupees } from '@/lib/salon/invoice'
import { api, card, Chip, dangerButton, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { SalonSetup, Service, StaffMember } from './types'

const DURATIONS = [15, 30, 45, 60, 90, 120]
const GST_RATES = [0, 5, 12, 18, 28]
const CATEGORY_SUGGESTIONS = ['Hair', 'Skin', 'Nails', 'Spa', 'Makeup', 'Bridal']

type Flash = (tone: 'success' | 'error', text: string) => void

export function SalonSetupTab({ orgId, setup, onChange, flash }: { orgId: string; setup: SalonSetup; onChange: (setup: SalonSetup) => void; flash: Flash }) {
  const confirm = useConfirm()
  const [serviceForm, setServiceForm] = useState<Partial<Service> | null>(null)
  const [staffForm, setStaffForm] = useState<Partial<StaffMember> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [settings, setSettings] = useState(setup.settings)

  const categories = useMemo(() => {
    const groups = new Map<string, Service[]>()
    for (const service of setup.services) groups.set(service.category || 'General', [...(groups.get(service.category || 'General') || []), service])
    return [...groups.entries()]
  }, [setup.services])

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key)
    try { await task() } catch (err: any) { flash('error', err.message) } finally { setBusy(null) }
  }

  const addSample = () => run('sample', async () => {
    const data = await api('/api/salon/sample', { method: 'POST', body: JSON.stringify({ organizationId: orgId }) })
    onChange({ settings: data.settings, services: data.services, staff: data.staff })
    flash('success', `Added ${data.added.services} services and ${data.added.staff} team members. Change any of them below.`)
  })

  const saveService = () => run('service', async () => {
    const body = { organizationId: orgId, ...serviceForm }
    const data = await api('/api/salon/services', { method: serviceForm?.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
    const services = serviceForm?.id ? setup.services.map((s) => (s.id === data.service.id ? data.service : s)) : [...setup.services, data.service]
    onChange({ ...setup, services })
    setServiceForm(null)
    flash('success', `${data.service.name} saved.`)
  })

  const removeService = (service: Service) => run(`del-${service.id}`, async () => {
    if (!(await confirm({ title: `Remove ${service.name}?`, message: 'Past appointments and invoices keep it. It just stops appearing for new bookings.', confirmLabel: 'Remove', destructive: true }))) return
    await api(`/api/salon/services?organizationId=${orgId}&id=${service.id}`, { method: 'DELETE' })
    onChange({ ...setup, services: setup.services.filter((s) => s.id !== service.id) })
    setServiceForm(null)
  })

  const toggleService = (service: Service, active: boolean) => run(`act-${service.id}`, async () => {
    const data = await api('/api/salon/services', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, id: service.id, active }) })
    onChange({ ...setup, services: setup.services.map((s) => (s.id === service.id ? data.service : s)) })
  })

  const saveStaff = () => run('staff', async () => {
    const body = { organizationId: orgId, ...staffForm }
    const data = await api('/api/salon/staff', { method: staffForm?.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
    const staff = staffForm?.id ? setup.staff.map((m) => (m.id === data.member.id ? data.member : m)) : [...setup.staff, data.member]
    onChange({ ...setup, staff })
    setStaffForm(null)
    flash('success', `${data.member.name} saved.`)
  })

  const removeStaff = (member: StaffMember) => run(`del-${member.id}`, async () => {
    if (!(await confirm({ title: `Remove ${member.name}?`, message: 'Their past appointments stay on record.', confirmLabel: 'Remove', destructive: true }))) return
    await api(`/api/salon/staff?organizationId=${orgId}&id=${member.id}`, { method: 'DELETE' })
    onChange({ ...setup, staff: setup.staff.filter((m) => m.id !== member.id) })
    setStaffForm(null)
  })

  const saveSettings = () => run('settings', async () => {
    const data = await api('/api/salon/settings', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, ...settings }) })
    onChange({ ...setup, settings: data.settings })
    setSettings(data.settings)
    flash('success', 'Business details saved. New invoices will use them.')
  })

  return (
    <div className="space-y-6">
      {setup.services.length === 0 && (
        <div className={`${card} p-6 sm:p-8 text-center`}>
          <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-[#f472b6] to-[#7c3aed] text-white flex items-center justify-center"><Sparkles size={26} /></div>
          <h2 className="text-[22px] font-extrabold text-[#0E1B3D] dark:text-white mt-4">Set up your salon in one tap</h2>
          <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-1 max-w-md mx-auto">Add a ready-made menu of services with typical prices and a small team. You can change everything afterwards.</p>
          <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
            <button type="button" onClick={addSample} disabled={busy !== null} className={primaryButton}>{busy === 'sample' ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Add sample salon</button>
            <button type="button" onClick={() => setServiceForm({ category: 'Hair', duration_minutes: 30, tax_rate: 18, active: true })} className={secondaryButton}><Plus size={18} /> Add my own service</button>
          </div>
        </div>
      )}

      {/* Services */}
      {setup.services.length > 0 && (
        <section className={card}>
          <div className="px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-[#0E1B3D] dark:text-white">Services</h2>
              <p className="text-[14px] text-[#6B7894]">{setup.services.length} services · prices {settings.prices_include_tax ? 'include' : 'exclude'} GST</p>
            </div>
            <button type="button" onClick={() => setServiceForm({ category: categories[0]?.[0] || 'Hair', duration_minutes: 30, tax_rate: 18, active: true })} className={primaryButton}><Plus size={18} /> Add service</button>
          </div>
          <div className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {categories.map(([category, services]) => (
              <div key={category} className="px-5 py-4">
                <h3 className="text-[13.5px] font-bold text-[#6B7894] mb-2">{category}</h3>
                <ul className="space-y-1">
                  {services.map((service) => (
                    <li key={service.id} className="flex items-center gap-3 py-1.5">
                      <button type="button" onClick={() => setServiceForm(service)} className="flex-1 min-w-0 text-left cursor-pointer group">
                        <span className={`block text-[15.5px] font-semibold group-hover:text-[#1D5BEA] ${service.active ? 'text-[#0E1B3D] dark:text-white' : 'text-[#8a94a8] line-through'}`}>{service.name}</span>
                        <span className="block text-[13.5px] text-[#6B7894]">{service.duration_minutes} min · GST {Number(service.tax_rate)}%</span>
                      </button>
                      <span className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">{formatRupees(Number(service.price))}</span>
                      <Toggle checked={service.active} disabled={busy !== null} onChange={(value) => toggleService(service, value)} label={`${service.name} available`} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Staff */}
      <section className={card}>
        <div className="px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold text-[#0E1B3D] dark:text-white">Staff</h2>
            <p className="text-[14px] text-[#6B7894]">Who serves customers, and which services they do</p>
          </div>
          <button type="button" onClick={() => setStaffForm({ active: true, service_ids: [] })} className={secondaryButton}><Plus size={18} /> Add person</button>
        </div>
        {setup.staff.length === 0 ? (
          <p className="px-5 py-8 text-center text-[15px] text-[#6B7894]"><Users size={22} className="inline mr-1.5 -mt-0.5" /> No staff yet. Add the people who serve customers.</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3 p-4">
            {setup.staff.map((member) => (
              <li key={member.id}>
                <button type="button" onClick={() => setStaffForm(member)} className={`w-full text-left rounded-xl border border-[#e3e8f2] dark:border-slate-700 p-4 hover:border-[#9db5ef] cursor-pointer ${member.active ? '' : 'opacity-60'}`}>
                  <span className="flex items-center gap-3">
                    <span className="h-11 w-11 shrink-0 rounded-full bg-[#fdeef6] dark:bg-pink-950/40 text-[#be185d] dark:text-pink-300 flex items-center justify-center text-[16px] font-bold">{member.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block text-[16px] font-bold text-[#0E1B3D] dark:text-white truncate">{member.name}{member.active ? '' : ' (away)'}</span>
                      <span className="block text-[13.5px] text-[#6B7894]">{member.service_ids.length ? `${member.service_ids.length} services` : 'All services'}{member.phone ? ` · ${member.phone}` : ''}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Business details */}
      <section className={`${card} p-5 sm:p-6`}>
        <h2 className="text-[18px] font-bold text-[#0E1B3D] dark:text-white">Business details on invoices</h2>
        <p className="text-[14px] text-[#6B7894] mb-4">Printed on every GST invoice. Changing them never changes invoices already sent.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Business name"><input className={input} value={settings.business_name || ''} onChange={(e) => setSettings({ ...settings, business_name: e.target.value })} placeholder="Glow Salon & Spa" /></Field>
          <Field label="Phone"><input className={input} value={settings.phone || ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} placeholder="98765 43210" inputMode="tel" /></Field>
          <div className="sm:col-span-2"><Field label="Address"><textarea className={`${input} h-20 py-2.5`} value={settings.address || ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} placeholder="Shop 4, Road No. 12, Banjara Hills, Hyderabad 500034" /></Field></div>
          <Field label="GSTIN" hint="Leave empty if you are not registered for GST."><input className={`${input} uppercase`} value={settings.gstin || ''} onChange={(e) => setSettings({ ...settings, gstin: e.target.value })} placeholder="36ABCDE1234F1Z5" /></Field>
          <Field label="Email"><input className={input} value={settings.email || ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} placeholder="hello@glowsalon.in" inputMode="email" /></Field>
          <Field label="Invoice number starts with" hint={`Next invoices look like ${(settings.invoice_prefix || 'INV').toUpperCase()}-0001`}><input className={`${input} uppercase`} value={settings.invoice_prefix || ''} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} placeholder="GLOW" maxLength={12} /></Field>
          <Field label="Note at the bottom of invoices"><input className={input} value={settings.invoice_note || ''} onChange={(e) => setSettings({ ...settings, invoice_note: e.target.value })} placeholder="Thank you! See you again soon." /></Field>
        </div>
        <div className="mt-5 space-y-3">
          <label className="flex items-center justify-between gap-4 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Prices include GST</strong><span className="block text-[13.5px] text-[#6B7894]">On: ₹590 means ₹500 + ₹90 GST. Off: GST is added on top.</span></span><Toggle checked={settings.prices_include_tax} onChange={(value) => setSettings({ ...settings, prices_include_tax: value })} label="Prices include GST" /></label>
          <label className="flex items-center justify-between gap-4 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Speak replies at the counter</strong><span className="block text-[13.5px] text-[#6B7894]">The counter reads out what it understood.</span></span><Toggle checked={settings.voice_replies} onChange={(value) => setSettings({ ...settings, voice_replies: value })} label="Speak replies" /></label>
        </div>
        <div className="mt-5 flex justify-end"><button type="button" onClick={saveSettings} disabled={busy !== null} className={primaryButton}>{busy === 'settings' && <Loader2 size={18} className="animate-spin" />} Save details</button></div>
      </section>

      {serviceForm && (
        <Modal title={serviceForm.id ? 'Edit service' : 'Add a service'} onClose={() => setServiceForm(null)}
          footer={<>
            {serviceForm.id && <button type="button" onClick={() => removeService(serviceForm as Service)} disabled={busy !== null} className={`${dangerButton} sm:mr-auto`}><Trash2 size={17} /> Remove</button>}
            <button type="button" onClick={() => setServiceForm(null)} className={secondaryButton}>Cancel</button>
            <button type="button" onClick={saveService} disabled={busy !== null} className={primaryButton}>{busy === 'service' && <Loader2 size={18} className="animate-spin" />} Save</button>
          </>}>
          <div className="space-y-4">
            <Field label="Service name"><input className={input} value={serviceForm.name || ''} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="Haircut (Women)" autoFocus /></Field>
            <Field label="Category">
              <div className="flex flex-wrap gap-2 mb-2">{[...new Set([...categories.map(([c]) => c), ...CATEGORY_SUGGESTIONS])].map((category) => <Chip key={category} selected={serviceForm.category === category} onClick={() => setServiceForm({ ...serviceForm, category })}>{category}</Chip>)}</div>
              <input className={input} value={serviceForm.category || ''} onChange={(e) => setServiceForm({ ...serviceForm, category: e.target.value })} placeholder="Or type a new one" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Price (₹)"><input className={input} type="number" min={0} inputMode="decimal" value={serviceForm.price ?? ''} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value as any })} placeholder="600" /></Field>
              <Field label="Minutes"><input className={input} type="number" min={5} inputMode="numeric" value={serviceForm.duration_minutes ?? ''} onChange={(e) => setServiceForm({ ...serviceForm, duration_minutes: e.target.value as any })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">{DURATIONS.map((m) => <Chip key={m} selected={Number(serviceForm.duration_minutes) === m} onClick={() => setServiceForm({ ...serviceForm, duration_minutes: m })}>{m} min</Chip>)}</div>
            <Field label="GST"><div className="flex flex-wrap gap-2">{GST_RATES.map((rate) => <Chip key={rate} selected={Number(serviceForm.tax_rate) === rate} onClick={() => setServiceForm({ ...serviceForm, tax_rate: rate })}>{rate}%</Chip>)}</div></Field>
            <Field label="SAC code (optional)" hint="The GST service code printed on invoices, if your accountant gives you one."><input className={input} value={serviceForm.sac_code || ''} onChange={(e) => setServiceForm({ ...serviceForm, sac_code: e.target.value })} inputMode="numeric" placeholder="999721" /></Field>
          </div>
        </Modal>
      )}

      {staffForm && (
        <Modal wide title={staffForm.id ? `Edit ${staffForm.name || 'person'}` : 'Add a person'} onClose={() => setStaffForm(null)}
          footer={<>
            {staffForm.id && <button type="button" onClick={() => removeStaff(staffForm as StaffMember)} disabled={busy !== null} className={`${dangerButton} sm:mr-auto`}><Trash2 size={17} /> Remove</button>}
            <button type="button" onClick={() => setStaffForm(null)} className={secondaryButton}>Cancel</button>
            <button type="button" onClick={saveStaff} disabled={busy !== null} className={primaryButton}>{busy === 'staff' && <Loader2 size={18} className="animate-spin" />} Save</button>
          </>}>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Name"><input className={input} value={staffForm.name || ''} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} placeholder="Anitha" autoFocus /></Field>
              <Field label="Mobile (optional)"><input className={input} value={staffForm.phone || ''} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} placeholder="98765 43210" inputMode="tel" /></Field>
            </div>
            <Field label="Services they do" hint="Leave all unselected if they do everything.">
              <div className="space-y-3 mt-1">
                {categories.map(([category, services]) => (
                  <div key={category}>
                    <div className="text-[13px] font-bold text-[#6B7894] mb-1.5">{category}</div>
                    <div className="flex flex-wrap gap-2">
                      {services.map((service) => {
                        const selected = (staffForm.service_ids || []).includes(service.id)
                        return <Chip key={service.id} selected={selected} onClick={() => setStaffForm({ ...staffForm, service_ids: selected ? (staffForm.service_ids || []).filter((id) => id !== service.id) : [...(staffForm.service_ids || []), service.id] })}>{service.name}</Chip>
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Field>
            <label className="flex items-center justify-between gap-4 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Working</strong><span className="block text-[13.5px] text-[#6B7894]">Off: on leave or no longer with you. Not offered for new bookings.</span></span><Toggle checked={staffForm.active !== false} onChange={(value) => setStaffForm({ ...staffForm, active: value })} label="Working" /></label>
          </div>
        </Modal>
      )}
    </div>
  )
}
