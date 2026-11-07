'use client'

import { useMemo, useRef, useState } from 'react'
import { Clock3, ImagePlus, Loader2, Plus, Scissors, Sparkles, Store, Trash2, Upload, Users } from 'lucide-react'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { useConfirm } from '@/lib/dialog-context'
import { formatRupees } from '@/lib/salon/invoice'
import { api, Avatar, card, Chip, dangerButton, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { SalonSetup, Service, StaffMember } from './types'

const DURATIONS = [15, 30, 45, 60, 90, 120]
const GST_RATES = [0, 5, 12, 18, 28]
const CATEGORY_SUGGESTIONS = ['Hair', 'Skin', 'Nails', 'Spa', 'Makeup', 'Bridal']

type Flash = (tone: 'success' | 'error', text: string) => void

/** Shrink a picture to at most `max` pixels on its longest side, keeping transparency for PNGs. */
async function shrinkImage(file: File, max = 512): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('That image could not be opened. Try a PNG or JPG.'))
      element.src = url
    })
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
    if (scale === 1 && file.size <= 600_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That image could not be read.'))), type, 0.9))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function LogoPicker({ orgId, logo, onSaved, flash }: { orgId: string; logo: string | null | undefined; onSaved: (settings: any) => void; flash: Flash }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const shown = isSafeLogoUrl(logo) ? logo : null

  async function upload(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { flash('error', 'Use a PNG, JPG or WebP image for the logo.'); return }
    setBusy('upload')
    try {
      const form = new FormData()
      form.append('organizationId', orgId)
      form.append('file', await shrinkImage(file), 'logo')
      const data = await api('/api/salon/logo', { method: 'POST', body: form })
      onSaved(data.settings)
      flash('success', 'Logo saved. New invoices will show it.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function remove() {
    setBusy('remove')
    try {
      const data = await api(`/api/salon/logo?organizationId=${orgId}`, { method: 'DELETE' })
      onSaved(data.settings)
      flash('success', 'Logo removed from new invoices.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-5 flex items-center gap-4 rounded-2xl border border-[#e3e8f2] dark:border-slate-800 p-4">
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy !== null} aria-label={shown ? 'Change logo' : 'Upload logo'}
        className="h-20 w-20 shrink-0 rounded-2xl border-2 border-dashed border-[#d5ddeb] dark:border-slate-700 bg-[#f8fafc] dark:bg-slate-900 flex items-center justify-center overflow-hidden hover:border-[#9db5ef] cursor-pointer disabled:cursor-wait">
        {busy === 'upload' ? <Loader2 size={22} className="animate-spin text-[#1D5BEA]" />
          // eslint-disable-next-line @next/next/no-img-element
          : shown ? <img src={shown} alt="Your logo" className="max-h-full max-w-full object-contain p-1.5" />
          : <ImagePlus size={24} className="text-[#a3adc2]" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white">Logo</p>
        <p className="text-[13px] text-[#6B7894] dark:text-slate-400">Printed at the top of every invoice. PNG, JPG or WebP; a square logo looks best.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy !== null} className={`${secondaryButton} h-10`}>
            {busy === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {shown ? 'Change logo' : 'Upload logo'}
          </button>
          {shown && <button type="button" onClick={remove} disabled={busy !== null} className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-[14.5px] font-semibold text-[#b91c1c] dark:text-red-300 hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50">
            {busy === 'remove' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Remove
          </button>}
        </div>
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Logo file" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file) }} />
    </div>
  )
}

function SectionHead({ icon, tone, title, subtitle, action }: { icon: React.ReactNode; tone: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center ${tone}`}>{icon}</span>
        <div className="min-w-0">
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">{title}</h2>
          <p className="text-[13.5px] text-[#6B7894] dark:text-slate-400 truncate">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

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
          <div className="mx-auto h-14 w-14 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center"><Sparkles size={26} /></div>
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
          <SectionHead icon={<Scissors size={21} />} tone="bg-[#fdeef6] text-[#be185d] dark:bg-pink-950/40 dark:text-pink-300" title="Services"
            subtitle={`${setup.services.filter((s) => s.active).length} of ${setup.services.length} on offer · prices ${settings.prices_include_tax ? 'include' : 'exclude'} GST`}
            action={<button type="button" onClick={() => setServiceForm({ category: categories[0]?.[0] || 'Hair', duration_minutes: 30, tax_rate: 18, active: true })} className={primaryButton}><Plus size={18} /> <span className="hidden sm:inline">Add service</span><span className="sm:hidden">Add</span></button>} />
          <div className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {categories.map(([category, services]) => (
              <div key={category} className="px-2 sm:px-3 py-3">
                <h3 className="px-2 pb-1.5 flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8]">{category} <span className="font-semibold normal-case tracking-normal">· {services.length}</span></h3>
                <ul>
                  {services.map((service) => (
                    <li key={service.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-[#f8fafc] dark:hover:bg-slate-900/60">
                      <button type="button" onClick={() => setServiceForm(service)} className="flex-1 min-w-0 text-left cursor-pointer group">
                        <span className={`block text-[15.5px] font-semibold truncate group-hover:text-[#1D5BEA] ${service.active ? 'text-[#0E1B3D] dark:text-white' : 'text-[#8a94a8] line-through'}`}>{service.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300"><Clock3 size={12} /> {service.duration_minutes} min</span>
                          <span className="inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">GST {Number(service.tax_rate)}%</span>
                          {service.sac_code && <span className="hidden sm:inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">SAC {service.sac_code}</span>}
                        </span>
                      </button>
                      <span className={`text-[16.5px] font-extrabold ${service.active ? 'text-[#0E1B3D] dark:text-white' : 'text-[#8a94a8]'}`}>{formatRupees(Number(service.price))}</span>
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
        <SectionHead icon={<Users size={21} />} tone="bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300" title="Staff" subtitle="Who serves customers, and which services they do"
          action={<button type="button" onClick={() => setStaffForm({ active: true, service_ids: [] })} className={secondaryButton}><Plus size={18} /> <span className="hidden sm:inline">Add person</span><span className="sm:hidden">Add</span></button>} />
        {setup.staff.length === 0 ? (
          <p className="px-5 py-8 text-center text-[15px] text-[#6B7894]"><Users size={22} className="inline mr-1.5 -mt-0.5" /> No staff yet. Add the people who serve customers.</p>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {setup.staff.map((member) => (
              <li key={member.id}>
                <button type="button" onClick={() => setStaffForm(member)} className={`w-full text-left rounded-2xl border border-[#e3e8f2] dark:border-slate-700 p-4 hover:border-[#9db5ef] hover:shadow-sm transition cursor-pointer ${member.active ? '' : 'opacity-60'}`}>
                  <span className="flex items-center gap-3">
                    <Avatar name={member.name} size={46} />
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
      <section className={card}>
        <SectionHead icon={<Store size={21} />} tone="bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300" title="Business details on invoices" subtitle="Printed on every invoice. Changing them never changes invoices already sent." />
        <div className="p-4 sm:p-5 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <LogoPicker orgId={orgId} logo={settings.logo_url} flash={flash}
              onSaved={(saved) => { onChange({ ...setup, settings: { ...setup.settings, logo_url: saved?.logo_url ?? null } }); setSettings((current) => ({ ...current, logo_url: saved?.logo_url ?? null })) }} />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Business name"><input className={input} value={settings.business_name || ''} onChange={(e) => setSettings({ ...settings, business_name: e.target.value })} placeholder="Glow Salon & Spa" /></Field>
              <Field label="Phone"><input className={input} value={settings.phone || ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} placeholder="98765 43210" inputMode="tel" /></Field>
              <div className="sm:col-span-2"><Field label="Address"><textarea className={`${input} h-20 py-2.5`} value={settings.address || ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} placeholder="Shop 4, Road No. 12, Banjara Hills, Hyderabad 500034" /></Field></div>
              <Field label="GSTIN" hint="Leave empty if you are not registered for GST."><input className={`${input} uppercase`} value={settings.gstin || ''} onChange={(e) => setSettings({ ...settings, gstin: e.target.value })} placeholder="36ABCDE1234F1Z5" /></Field>
              <Field label="Email"><input className={input} value={settings.email || ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} placeholder="hello@glowsalon.in" inputMode="email" /></Field>
              <Field label="Invoice number starts with" hint={`Next invoices look like ${(settings.invoice_prefix || 'INV').toUpperCase()}-0001`}><input className={`${input} uppercase`} value={settings.invoice_prefix || ''} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} placeholder="GLOW" maxLength={12} /></Field>
              <Field label="Note at the bottom of invoices"><input className={input} value={settings.invoice_note || ''} onChange={(e) => setSettings({ ...settings, invoice_note: e.target.value })} placeholder="Thank you! See you again soon." /></Field>
            </div>
            <div className="mt-5 rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800">
              <label className="flex items-center justify-between gap-4 px-4 py-3.5 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Prices include GST</strong><span className="block text-[13.5px] text-[#6B7894]">On: ₹590 means ₹500 + ₹90 GST. Off: GST is added on top.</span></span><Toggle checked={settings.prices_include_tax} onChange={(value) => setSettings({ ...settings, prices_include_tax: value })} label="Prices include GST" /></label>
              <label className="flex items-center justify-between gap-4 px-4 py-3.5 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Speak replies at the counter</strong><span className="block text-[13.5px] text-[#6B7894]">The counter reads out what it understood.</span></span><Toggle checked={settings.voice_replies} onChange={(value) => setSettings({ ...settings, voice_replies: value })} label="Speak replies" /></label>
            </div>
            <div className="mt-5 flex justify-end"><button type="button" onClick={saveSettings} disabled={busy !== null} className={primaryButton}>{busy === 'settings' && <Loader2 size={18} className="animate-spin" />} Save details</button></div>
          </div>
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-4">
              <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8] mb-2">How the top of your invoice looks</p>
              <div className="rounded-2xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#0b141a] shadow-sm overflow-hidden">
                <div className="h-1.5 bg-[#1D5BEA]" />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {isSafeLogoUrl(settings.logo_url) && <img src={settings.logo_url} alt="" className="h-12 w-auto max-w-[96px] object-contain shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] font-extrabold text-[#0E1B3D] dark:text-white break-words">{settings.business_name || 'Your business name'}</p>
                      {settings.address && <p className="text-[12.5px] text-[#4a5672] dark:text-slate-400 mt-1 whitespace-pre-line">{settings.address}</p>}
                      {(settings.phone || settings.email) && <p className="text-[12.5px] text-[#4a5672] dark:text-slate-400">{[settings.phone, settings.email].filter(Boolean).join(' · ')}</p>}
                      {settings.gstin && <p className="text-[12.5px] text-[#4a5672] dark:text-slate-400 mt-1">GSTIN <strong className="text-[#0E1B3D] dark:text-white">{settings.gstin.toUpperCase()}</strong></p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10.5px] font-bold tracking-[0.14em] text-[#1D5BEA]">{settings.gstin ? 'TAX INVOICE' : 'BILL'}</p>
                      <p className="text-[15px] font-extrabold text-[#0E1B3D] dark:text-white">{(settings.invoice_prefix || 'INV').toUpperCase().replace(/[^A-Z0-9/-]/g, '').slice(0, 12) || 'INV'}-0001</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2" aria-hidden>
                    <div className="h-2.5 rounded-full bg-[#eef1f6] dark:bg-slate-800 w-full" />
                    <div className="h-2.5 rounded-full bg-[#eef1f6] dark:bg-slate-800 w-4/5" />
                    <div className="h-2.5 rounded-full bg-[#eef1f6] dark:bg-slate-800 w-3/5" />
                  </div>
                  {settings.invoice_note && <p className="mt-4 pt-3 border-t border-[#eef1f6] dark:border-slate-800 text-[12.5px] text-[#4a5672] dark:text-slate-400">{settings.invoice_note}</p>}
                </div>
              </div>
              {!settings.gstin && <p className="mt-2 text-[12.5px] text-[#8a94a8]">Without a GSTIN, bills carry no GST and are titled “Bill”.</p>}
            </div>
          </div>
        </div>
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
            <Field group label="Category">
              <div className="flex flex-wrap gap-2 mb-2">{[...new Set([...categories.map(([c]) => c), ...CATEGORY_SUGGESTIONS])].map((category) => <Chip key={category} selected={serviceForm.category === category} onClick={() => setServiceForm({ ...serviceForm, category })}>{category}</Chip>)}</div>
              <input className={input} value={serviceForm.category || ''} onChange={(e) => setServiceForm({ ...serviceForm, category: e.target.value })} placeholder="Or type a new one" aria-label="Category" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Price (₹)"><input className={input} type="number" min={0} inputMode="decimal" value={serviceForm.price ?? ''} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value as any })} placeholder="600" /></Field>
              <Field label="Minutes"><input className={input} type="number" min={5} inputMode="numeric" value={serviceForm.duration_minutes ?? ''} onChange={(e) => setServiceForm({ ...serviceForm, duration_minutes: e.target.value as any })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">{DURATIONS.map((m) => <Chip key={m} selected={Number(serviceForm.duration_minutes) === m} onClick={() => setServiceForm({ ...serviceForm, duration_minutes: m })}>{m} min</Chip>)}</div>
            <Field group label="GST"><div className="flex flex-wrap gap-2">{GST_RATES.map((rate) => <Chip key={rate} selected={Number(serviceForm.tax_rate) === rate} onClick={() => setServiceForm({ ...serviceForm, tax_rate: rate })}>{rate}%</Chip>)}</div></Field>
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
            <Field group label="Services they do" hint="Leave all unselected if they do everything.">
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
