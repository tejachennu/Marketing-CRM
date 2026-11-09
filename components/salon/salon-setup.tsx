'use client'

import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Clock3, Dumbbell, FolderPlus, Pencil, Tags, FileText, ImagePlus, Loader2, MessageCircle, Plus, Scissors, Sparkles, Stethoscope, Store, Trash2, Upload, Users, Wrench } from 'lucide-react'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { useConfirm } from '@/lib/dialog-context'
import { formatRupees } from '@/lib/salon/invoice'
import { categoryName, groupByCategory } from '@/lib/salon/categories'
import { BUSINESS_TYPE_IDS, BUSINESS_TYPES, businessType, type BusinessType } from '@/lib/salon/business'
import { api, Avatar, card, Chip, dangerButton, Field, input, Modal, primaryButton, secondaryButton, Toggle } from './ui'
import type { SalonSetup, Service, StaffMember } from './types'
import { PhoneField } from '../phone-field'
import { WhatsAppSettings } from './salon-whatsapp-settings'
import { SalonTemplates } from './salon-templates'

const DURATIONS = [15, 30, 45, 60, 90, 120]
const GST_RATES = [0, 5, 12, 18, 28]
const TYPE_ICONS: Record<BusinessType, typeof Scissors> = { salon: Scissors, clinic: Stethoscope, fitness: Dumbbell, repair: Wrench, other: Store }

type Flash = (tone: 'success' | 'error', text: string) => void
export type Section = 'services' | 'team' | 'business' | 'whatsapp' | 'templates'
const SECTIONS: { id: Section; label: string; hint: string; icon: typeof Scissors }[] = [
  { id: 'services', label: 'Services', hint: 'Menu and prices', icon: Scissors },
  { id: 'team', label: 'Team', hint: 'Staff and commission', icon: Users },
  { id: 'business', label: 'Business', hint: 'Invoice details and logo', icon: Store },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Chat, bookings, feedback', icon: MessageCircle },
  { id: 'templates', label: 'Templates', hint: 'Messages for Meta', icon: FileText },
]

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

/** Add, rename, reorder and remove the business's service categories. */
function CategoriesEditor({ orgId, categories, onSaved, onClose, flash }: {
  orgId: string
  categories: { name: string; count: number }[]
  onSaved: (data: { categories: string[]; services: Service[] }) => void
  onClose: () => void
  flash: Flash
}) {
  const confirm = useConfirm()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, task: () => Promise<any>, done?: string) {
    setBusy(key)
    try {
      const data = await task()
      onSaved(data)
      if (done) flash('success', done)
      return true
    } catch (err: any) {
      flash('error', err.message)
      return false
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    const name = categoryName(newName)
    if (!name) return
    if (await run('add', () => api('/api/salon/categories', { method: 'POST', body: JSON.stringify({ organizationId: orgId, name }) }), `Category "${name}" added.`)) setNewName('')
  }
  const rename = async () => {
    if (!editing) return
    const to = categoryName(editing.to)
    if (!to || to === editing.from) { setEditing(null); return }
    if (await run('rename', () => api('/api/salon/categories', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, from: editing.from, to }) }), `Renamed to "${to}".`)) setEditing(null)
  }
  const move = (index: number, by: -1 | 1) => {
    const names = categories.map((c) => c.name)
    const target = index + by
    if (target < 0 || target >= names.length) return
    ;[names[index], names[target]] = [names[target], names[index]]
    run('order', () => api('/api/salon/categories', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, categories: names }) }))
  }
  const remove = async (category: { name: string; count: number }) => {
    const others = categories.filter((c) => c.name !== category.name)
    const moveTo = others[0]?.name || 'General'
    const message = category.count
      ? `Its ${category.count} service${category.count === 1 ? '' : 's'} will move to "${moveTo}". Past bills are not changed.`
      : 'It has no services. Past bills are not changed.'
    if (!(await confirm({ title: `Remove "${category.name}"?`, message, confirmLabel: 'Remove', destructive: true }))) return
    const params = new URLSearchParams({ organizationId: orgId, name: category.name, moveTo })
    run(`del-${category.name}`, () => api(`/api/salon/categories?${params}`, { method: 'DELETE' }), `"${category.name}" removed.`)
  }

  return (
    <Modal title="Categories" onClose={onClose} footer={<button type="button" onClick={onClose} className={secondaryButton}>Done</button>}>
      <div className="space-y-4">
        <p className="text-[14px] text-[#6B7894] dark:text-slate-400">Group your services, like Hair, Skin or Consultation. The counter and the WhatsApp menu show them in this order.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input className={`${input} flex-1 min-w-0`} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="New category name" aria-label="New category name" />
          <button type="submit" disabled={busy !== null || !categoryName(newName)} className={`${primaryButton} shrink-0`}>{busy === 'add' ? <Loader2 size={18} className="animate-spin" /> : <FolderPlus size={18} />} Add</button>
        </form>
        {categories.length === 0 ? (
          <p className="text-center text-[14px] text-[#6B7894] py-4">No categories yet.</p>
        ) : (
          <ul className="rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800">
            {categories.map((category, index) => (
              <li key={category.name} className="flex items-center gap-1.5 px-3 py-2 min-h-14">
                {editing?.from === category.name ? (
                  <form className="flex flex-1 min-w-0 gap-2" onSubmit={(e) => { e.preventDefault(); rename() }}>
                    <input className={`${input} h-10 flex-1 min-w-0`} value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} maxLength={40} autoFocus aria-label={`New name for ${category.name}`} />
                    <button type="submit" disabled={busy !== null} className={`${primaryButton} h-10 shrink-0`}>{busy === 'rename' && <Loader2 size={16} className="animate-spin" />} Save</button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-[#0E1B3D] dark:text-white truncate">{category.name}</span>
                      <span className="block text-[12.5px] text-[#6B7894]">{category.count ? `${category.count} service${category.count === 1 ? '' : 's'}` : 'No services yet'}</span>
                    </span>
                    <button type="button" onClick={() => move(index, -1)} disabled={busy !== null || index === 0} aria-label={`Move ${category.name} up`} className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><ArrowUp size={16} /></button>
                    <button type="button" onClick={() => move(index, 1)} disabled={busy !== null || index === categories.length - 1} aria-label={`Move ${category.name} down`} className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><ArrowDown size={16} /></button>
                    <button type="button" onClick={() => setEditing({ from: category.name, to: category.name })} disabled={busy !== null} aria-label={`Rename ${category.name}`} className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"><Pencil size={16} /></button>
                    <button type="button" onClick={() => remove(category)} disabled={busy !== null || (categories.length === 1 && category.count > 0)} aria-label={`Remove ${category.name}`} className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 disabled:opacity-30 cursor-pointer">{busy === `del-${category.name}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function SectionHead({ icon, tone, title, subtitle, action }: { icon: React.ReactNode; tone: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center justify-between gap-3">
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

export function SalonSetupTab({ orgId, setup, onChange, flash, initialSection = 'services' }: { orgId: string; setup: SalonSetup; onChange: (setup: SalonSetup) => void; flash: Flash; initialSection?: Section }) {
  const confirm = useConfirm()
  const [serviceForm, setServiceForm] = useState<Partial<Service> | null>(null)
  const [staffForm, setStaffForm] = useState<Partial<StaffMember> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [settings, setSettings] = useState(setup.settings)
  const [section, setSection] = useState<Section>(initialSection)

  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const categories = useMemo(() => groupByCategory(setup.settings.service_categories, setup.services), [setup.settings.service_categories, setup.services])
  const newService = (category?: string) => setServiceForm({ category: category || categories[0]?.[0] || BUSINESS_TYPES[type].categories[0], duration_minutes: 30, tax_rate: BUSINESS_TYPES[type].kit?.taxRate ?? 18, active: true })

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key)
    try { await task() } catch (err: any) { flash('error', err.message) } finally { setBusy(null) }
  }

  const type = businessType(settings.business_type)
  const addKit = (kind: BusinessType) => run(`kit-${kind}`, async () => {
    const data = await api('/api/salon/sample', { method: 'POST', body: JSON.stringify({ organizationId: orgId, business_type: kind }) })
    onChange({ settings: data.settings, services: data.services, staff: data.staff })
    setSettings((current) => ({ ...current, business_type: kind }))
    if (BUSINESS_TYPES[kind].kit) flash('success', `Added ${data.added.services} services and ${data.added.staff} team members. Change any of them below.`)
    else { flash('success', 'Saved. Add your services below.'); setServiceForm({ category: BUSINESS_TYPES[kind].categories[0], duration_minutes: 30, tax_rate: 18, active: true }) }
    setSection('services')
  })
  const saveType = (kind: BusinessType) => run('type', async () => {
    const data = await api('/api/salon/settings', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, business_type: kind }) })
    onChange({ ...setup, settings: { ...setup.settings, ...data.settings } })
    setSettings((current) => ({ ...current, business_type: kind }))
    flash('success', `Business type: ${BUSINESS_TYPES[kind].label}.`)
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
    <div className="space-y-4 @xl:space-y-5">
      {setup.services.length === 0 && (
        <div className={`${card} p-5 @xl:p-8`}>
          <div className="text-center">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-[#1D5BEA] text-white flex items-center justify-center"><Sparkles size={26} /></div>
            <h2 className="text-[21px] @xl:text-[22px] font-extrabold text-[#0E1B3D] dark:text-white mt-4">What kind of business is this?</h2>
            <p className="text-[15px] text-[#4a5672] dark:text-slate-400 mt-1 max-w-lg mx-auto">Pick one to start with a ready list of services, prices and a small team. You can change everything afterwards.</p>
          </div>
          <div className="mt-5 grid grid-cols-1 min-[420px]:grid-cols-2 @3xl:grid-cols-5 gap-2.5">
            {BUSINESS_TYPE_IDS.map((kind) => {
              const Icon = TYPE_ICONS[kind]
              const info = BUSINESS_TYPES[kind]
              return (
                <button key={kind} type="button" onClick={() => addKit(kind)} disabled={busy !== null}
                  className="flex @3xl:flex-col items-center @3xl:items-start gap-3 text-left rounded-2xl border border-[#e3e8f2] dark:border-slate-700 p-3.5 hover:border-[#1D5BEA] hover:bg-[#f5f8ff] dark:hover:bg-blue-950/20 cursor-pointer disabled:opacity-60 transition-colors">
                  <span className="h-11 w-11 shrink-0 rounded-xl bg-[#eef3fe] dark:bg-blue-950/40 text-[#1D5BEA] dark:text-blue-300 flex items-center justify-center">{busy === `kit-${kind}` ? <Loader2 size={20} className="animate-spin" /> : <Icon size={21} />}</span>
                  <span className="min-w-0"><span className="block text-[15px] font-bold text-[#0E1B3D] dark:text-white">{info.label}</span><span className="block text-[13px] text-[#6B7894]">{info.kit ? info.hint : 'Start empty and add your own'}</span></span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 @4xl:grid-cols-[220px_minmax(0,1fr)] gap-4 @4xl:gap-6 items-start">
      <nav aria-label="Setup" className="@4xl:sticky @4xl:top-4 flex @4xl:flex-col gap-1.5 overflow-x-auto @4xl:overflow-visible -mx-3 px-3 min-[400px]:-mx-4 min-[400px]:px-4 @xl:mx-0 @xl:px-0 pb-1 @4xl:pb-0 [scrollbar-width:none]">
        {SECTIONS.map(({ id, label, hint, icon: Icon }) => (
          <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}
            className={`shrink-0 @4xl:w-full inline-flex items-center gap-2.5 h-11 @4xl:h-auto px-3.5 @4xl:px-3 @4xl:py-2.5 rounded-xl @4xl:rounded-2xl border text-left text-[14.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${section === id ? 'border-[#0E1B3D] bg-[#0E1B3D] text-white dark:border-white dark:bg-white dark:text-[#0E1B3D]' : 'border-[#e3e8f2] dark:border-slate-800 bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`}>
            <Icon size={18} className="shrink-0" />
            <span className="min-w-0"><span className="block">{label}</span><span className={`hidden @4xl:block text-[12.5px] font-normal truncate ${section === id ? 'opacity-75' : 'text-[#6B7894]'}`}>{hint}</span></span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-4 @xl:space-y-5">
      {/* Services */}
      {section === 'services' && setup.services.length === 0 && (
        <div className={`${card} px-5 py-10 text-center text-[15px] text-[#6B7894]`}>No services yet. Pick your kind of business above, or <button type="button" onClick={() => newService()} className="font-semibold text-[#1D5BEA] hover:underline cursor-pointer">add your own</button>. You can also <button type="button" onClick={() => setCategoriesOpen(true)} className="font-semibold text-[#1D5BEA] hover:underline cursor-pointer">create categories</button> first.</div>
      )}
      {section === 'services' && setup.services.length > 0 && (
        <section className={card}>
          <SectionHead icon={<Scissors size={21} />} tone="bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100" title="Services"
            subtitle={`${setup.services.filter((s) => s.active).length} of ${setup.services.length} on offer · prices ${settings.prices_include_tax ? 'include' : 'exclude'} GST`}
            action={<div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setCategoriesOpen(true)} className={secondaryButton} aria-label="Categories"><Tags size={18} /> <span className="hidden @xl:inline">Categories</span></button>
              <button type="button" onClick={() => newService()} className={primaryButton}><Plus size={18} /> <span className="hidden @xl:inline">Add service</span><span className="@xl:hidden">Add</span></button>
            </div>} />
          <div className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {categories.map(([category, services]) => (
              <div key={category} className="px-2 @xl:px-3 py-3">
                <h3 className="px-2 pb-1.5 flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-wide text-[#8a94a8]">{category} <span className="font-semibold normal-case tracking-normal">· {services.length}</span></h3>
                {services.length === 0 && (
                  <p className="px-2 py-1.5 text-[14px] text-[#6B7894]">No services in this category yet. <button type="button" onClick={() => newService(category)} className="font-semibold text-[#1D5BEA] hover:underline cursor-pointer">Add one</button></p>
                )}
                <ul>
                  {services.map((service) => (
                    <li key={service.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-[#f8fafc] dark:hover:bg-slate-900/60">
                      <button type="button" onClick={() => setServiceForm(service)} className="flex-1 min-w-0 text-left cursor-pointer group">
                        <span className={`block text-[15.5px] font-semibold truncate group-hover:text-[#1D5BEA] ${service.active ? 'text-[#0E1B3D] dark:text-white' : 'text-[#8a94a8] line-through'}`}>{service.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300"><Clock3 size={12} /> {service.duration_minutes} min</span>
                          <span className="inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">GST {Number(service.tax_rate)}%</span>
                          {service.sac_code && <span className="hidden @xl:inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">SAC {service.sac_code}</span>}
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
      {section === 'team' && <section className={card}>
        <SectionHead icon={<Users size={21} />} tone="bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100" title="Staff" subtitle="Who serves customers, and which services they do"
          action={<button type="button" onClick={() => setStaffForm({ active: true, service_ids: [] })} className={secondaryButton}><Plus size={18} /> <span className="hidden @xl:inline">Add person</span><span className="@xl:hidden">Add</span></button>} />
        {setup.staff.length === 0 ? (
          <p className="px-5 py-8 text-center text-[15px] text-[#6B7894]"><Users size={22} className="inline mr-1.5 -mt-0.5" /> No staff yet. Add the people who serve customers.</p>
        ) : (
          <ul className="grid @xl:grid-cols-2 @4xl:grid-cols-3 gap-3 p-4">
            {setup.staff.map((member) => (
              <li key={member.id}>
                <button type="button" onClick={() => setStaffForm(member)} className={`w-full text-left rounded-2xl border border-[#e3e8f2] dark:border-slate-700 p-4 hover:border-[#9db5ef] hover:shadow-sm transition cursor-pointer ${member.active ? '' : 'opacity-60'}`}>
                  <span className="flex items-center gap-3">
                    <Avatar name={member.name} size={46} />
                    <span className="min-w-0">
                      <span className="block text-[16px] font-bold text-[#0E1B3D] dark:text-white truncate">{member.name}{member.active ? '' : ' (away)'}</span>
                      <span className="block text-[13.5px] text-[#6B7894]">{member.service_ids.length ? `${member.service_ids.length} services` : 'All services'}{Number(member.commission_percent) > 0 ? ` · ${Number(member.commission_percent)}% commission` : ''}{member.phone ? ` · ${member.phone}` : ''}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>}

      {/* Business details */}
      {section === 'business' && <section className={card}>
        <SectionHead icon={<Store size={21} />} tone="bg-[#f4f6fa] text-[#0E1B3D] dark:bg-slate-800 dark:text-slate-100" title="Business details on invoices" subtitle="Printed on every invoice. Changing them never changes invoices already sent." />
        <div className="p-4 @xl:p-5 grid grid-cols-1 @5xl:grid-cols-5 gap-6">
          <div className="@5xl:col-span-3 min-w-0">
            <div className="mb-5" role="group" aria-label="Kind of business">
              <p className="text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">Kind of business</p>
              <div className="flex flex-wrap gap-2">
                {BUSINESS_TYPE_IDS.map((kind) => <Chip key={kind} selected={type === kind} disabled={busy !== null} onClick={() => type !== kind && saveType(kind)}>{type === kind && <Check size={15} strokeWidth={3} />} {BUSINESS_TYPES[kind].label}</Chip>)}
              </div>
              <p className="text-[12.5px] text-[#6B7894] mt-1">The WhatsApp assistant describes you this way, and Setup suggests matching categories.</p>
            </div>
            <LogoPicker orgId={orgId} logo={settings.logo_url} flash={flash}
              onSaved={(saved) => { onChange({ ...setup, settings: { ...setup.settings, logo_url: saved?.logo_url ?? null } }); setSettings((current) => ({ ...current, logo_url: saved?.logo_url ?? null })) }} />
            <div className="grid @xl:grid-cols-2 gap-4">
              <Field label="Business name"><input className={input} value={settings.business_name || ''} onChange={(e) => setSettings({ ...settings, business_name: e.target.value })} placeholder="Your business name" /></Field>
              <Field group label="Phone"><PhoneField inputClassName={input} ariaLabel="Business phone" value={settings.phone} onChange={(phone) => setSettings({ ...settings, phone })} /></Field>
              <div className="@xl:col-span-2"><Field label="Address"><textarea className={`${input} h-20 py-2.5`} value={settings.address || ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} placeholder="Shop 4, Road No. 12, Banjara Hills, Hyderabad 500034" /></Field></div>
              <Field label="GSTIN" hint="Leave empty if you are not registered for GST."><input className={`${input} uppercase`} value={settings.gstin || ''} onChange={(e) => setSettings({ ...settings, gstin: e.target.value })} placeholder="36ABCDE1234F1Z5" /></Field>
              <Field label="Email"><input className={input} value={settings.email || ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} placeholder="hello@yourbusiness.in" inputMode="email" /></Field>
              <Field label="Invoice number starts with" hint={`Next invoices look like ${(settings.invoice_prefix || 'INV').toUpperCase()}-0001`}><input className={`${input} uppercase`} value={settings.invoice_prefix || ''} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} placeholder="GLOW" maxLength={12} /></Field>
              <Field label="Note at the bottom of invoices"><input className={input} value={settings.invoice_note || ''} onChange={(e) => setSettings({ ...settings, invoice_note: e.target.value })} placeholder="Thank you! See you again soon." /></Field>
            </div>
            <div className="mt-5 rounded-2xl border border-[#e3e8f2] dark:border-slate-800 divide-y divide-[#eef1f6] dark:divide-slate-800">
              <label className="flex items-center justify-between gap-4 px-4 py-3.5 text-[15px] text-[#0E1B3D] dark:text-white"><span><strong>Prices include GST</strong><span className="block text-[13.5px] text-[#6B7894]">On: ₹590 means ₹500 + ₹90 GST. Off: GST is added on top.</span></span><Toggle checked={settings.prices_include_tax} onChange={(value) => setSettings({ ...settings, prices_include_tax: value })} label="Prices include GST" /></label>
            </div>
            <div className="mt-5 flex justify-end"><button type="button" onClick={saveSettings} disabled={busy !== null} className={primaryButton}>{busy === 'settings' && <Loader2 size={18} className="animate-spin" />} Save details</button></div>
          </div>
          <div className="@5xl:col-span-2 min-w-0">
            <div className="@5xl:sticky @5xl:top-4">
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
      </section>}

      {section === 'whatsapp' && <WhatsAppSettings orgId={orgId} setup={setup} onChange={onChange} flash={flash} />}
      {section === 'templates' && <SalonTemplates orgId={orgId} flash={flash} onSaved={(message_templates) => onChange({ ...setup, settings: { ...setup.settings, message_templates } })} />}
      </div>
      </div>

      {serviceForm && (
        <Modal title={serviceForm.id ? 'Edit service' : 'Add a service'} onClose={() => setServiceForm(null)}
          footer={<>
            {serviceForm.id && <button type="button" onClick={() => removeService(serviceForm as Service)} disabled={busy !== null} className={`${dangerButton} sm:mr-auto`}><Trash2 size={17} /> Remove</button>}
            <button type="button" onClick={() => setServiceForm(null)} className={secondaryButton}>Cancel</button>
            <button type="button" onClick={saveService} disabled={busy !== null} className={primaryButton}>{busy === 'service' && <Loader2 size={18} className="animate-spin" />} Save</button>
          </>}>
          <div className="space-y-4">
            <Field label="Service name"><input className={input} value={serviceForm.name || ''} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="Consultation" autoFocus /></Field>
            <Field group label="Category">
              <div className="flex flex-wrap gap-2 mb-2">{[...new Set([...categories.map(([c]) => c), ...BUSINESS_TYPES[type].categories])].map((category) => <Chip key={category} selected={serviceForm.category === category} onClick={() => setServiceForm({ ...serviceForm, category })}>{category}</Chip>)}</div>
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

      {categoriesOpen && (
        <CategoriesEditor orgId={orgId} categories={categories.map(([name, services]) => ({ name, count: services.length }))} flash={flash} onClose={() => setCategoriesOpen(false)}
          onSaved={(data) => onChange({ ...setup, services: data.services, settings: { ...setup.settings, service_categories: data.categories } })} />
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
              <Field group label="Mobile (optional)"><PhoneField inputClassName={input} value={staffForm.phone} onChange={(phone) => setStaffForm({ ...staffForm, phone })} /></Field>
            </div>
            <Field group label="Commission" hint="Their share of the services they do (before GST, after discounts). Team shows what they have earned.">
              <div className="flex flex-wrap items-center gap-2">
                {[0, 10, 20, 30, 40].map((percent) => <Chip key={percent} selected={Number(staffForm.commission_percent || 0) === percent} onClick={() => setStaffForm({ ...staffForm, commission_percent: percent })}>{percent ? `${percent}%` : 'None'}</Chip>)}
                <label className="inline-flex items-center gap-1.5 text-[14px] text-[#4a5672] dark:text-slate-300">Other <input type="number" min={0} max={100} step={0.5} inputMode="decimal" aria-label="Commission percent" value={staffForm.commission_percent ?? ''} onChange={(e) => setStaffForm({ ...staffForm, commission_percent: e.target.value as any })} className={`${input} w-24 h-10`} /> %</label>
              </div>
            </Field>
            <Field group label="Services they do" hint="Leave all unselected if they do everything.">
              <div className="space-y-3 mt-1">
                {categories.filter(([, services]) => services.length > 0).map(([category, services]) => (
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
