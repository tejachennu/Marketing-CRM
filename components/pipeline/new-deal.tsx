'use client'

/** A new deal: find the customer by number or name (or add them), name the deal, and it is on the board. */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Search, UserRound, X } from 'lucide-react'
import { followUpPreset, PRIORITIES, PRIORITY_LABEL, SOURCES } from '@/lib/pipeline/rules'
import { api, Chip, Field, input, Modal, primaryButton, secondaryButton } from '../salon/ui'
import { PhoneField } from '../phone-field'
import { FOLLOW_PRESETS } from './deal-sheet'
import { selectInput, type Deal, type PipelineData } from './shared'

interface Match { id: string; name: string; phone: string | null; company: string | null; exact: boolean }

export function NewDeal({ data, stageId, onClose, onCreated, flash }: {
  data: PipelineData
  stageId?: string | null
  onClose: () => void
  onCreated: (deal: Deal) => void
  flash: (tone: 'success' | 'error', text: string) => void
}) {
  const { orgId, stages, team, currency, me } = data
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const [lookup, setLookup] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Match | null>(null)
  const [newContact, setNewContact] = useState({ name: '', phone: '', company: '' })
  const [edited, setEdited] = useState({ name: false, phone: false })
  const [form, setForm] = useState({ title: '', value: '', stage: stageId || ordered[0]?.id || '', priority: 'medium', source: 'whatsapp', owner: me.id || '', follow: 'tomorrow' as string, product: '' })
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const seq = useRef(0)

  // Look up saved contacts as the number or name is typed
  useEffect(() => {
    const typed = lookup.trim()
    if (picked || typed.length < 2) { setMatches([]); return }
    const id = ++seq.current
    setSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await api(`/api/pipeline/contacts?organizationId=${orgId}&q=${encodeURIComponent(typed)}`)
        if (id === seq.current) setMatches(result.contacts || [])
      } catch { if (id === seq.current) setMatches([]) } finally { if (id === seq.current) setSearching(false) }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [lookup, picked, orgId])

  // What was typed fills in the new contact: digits are the number, words the name
  const typedDigits = lookup.replace(/\D/g, '')
  const looksLikeNumber = typedDigits.length >= 6 && typedDigits.length >= lookup.replace(/[\s+()-]/g, '').length - 1
  const contactName = edited.name ? newContact.name : looksLikeNumber ? '' : lookup.trim()
  const contactPhone = edited.phone ? newContact.phone : looksLikeNumber ? lookup.trim() : ''

  const save = async () => {
    setError(null)
    const contact = picked ? null : { name: contactName, phone: contactPhone, company: newContact.company }
    if (!picked && !contact?.name && !contact?.phone) { setError({ text: 'Who is the deal with? Type their number or name.', field: 'contact' }); return }
    if (!form.title.trim()) { setError({ text: 'Give the deal a name, like "500 shirts for Mehta Exports".', field: 'title' }); return }
    setSaving(true)
    try {
      const result = await api('/api/pipeline/leads', {
        method: 'POST',
        body: JSON.stringify({
          organizationId: orgId,
          ...(picked ? { contact_id: picked.id } : { contact }),
          title: form.title, value: form.value === '' ? null : form.value, pipeline_stage_id: form.stage || null, priority: form.priority, source: form.source,
          product_service: form.product || null,
          ...(me.canAssign ? { assigned_to: form.owner || null } : {}),
          next_follow_up_at: form.follow === 'none' ? null : followUpPreset(form.follow as any),
        }),
      })
      flash('success', 'Deal added.')
      onCreated(result.lead)
    } catch (err: any) {
      setError({ text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
      <button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={17} />} Add deal</button>
    </>
  )

  return (
    <Modal title="New deal" subtitle="It goes on the board straight away" onClose={onClose} footer={footer} size="lg">
      <div className="space-y-4 pb-2">
        {/* Who */}
        <div>
          <span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">Customer</span>
          {picked ? (
            <div className="flex items-center gap-3 rounded-xl border border-[#1D5BEA] bg-[#eef3fe] dark:bg-blue-950/30 px-3.5 py-2.5">
              <UserRound size={18} className="text-[#1D5BEA] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-[#0E1B3D] dark:text-white truncate">{picked.name}</p>
                <p className="text-[13px] text-[#4a5672] dark:text-slate-300 truncate">{[picked.phone, picked.company].filter(Boolean).join(' · ')}</p>
              </div>
              <button type="button" onClick={() => { setPicked(null); setLookup('') }} aria-label="Choose someone else" className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-[#4a5672] hover:bg-white/70 cursor-pointer"><X size={17} /></button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
                <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Mobile number or name" autoFocus aria-label="Customer's mobile number or name"
                  className={`${input} pl-10 ${error?.field === 'contact' ? 'border-[#b91c1c]' : ''}`} />
                {searching && <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-[#8a94a8]" />}
              </div>
              {matches.length > 0 && (
                <ul className="mt-2 rounded-xl border border-[#e3e8f2] dark:border-slate-700 divide-y divide-[#eef1f6] dark:divide-slate-800 overflow-hidden">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setPicked(m)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">
                        <UserRound size={16} className="text-[#6B7894] shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-[#0E1B3D] dark:text-white truncate">{m.name}</span>
                          <span className="block text-[13px] text-[#6B7894] truncate">{[m.phone, m.company].filter(Boolean).join(' · ')}</span>
                        </span>
                        {m.exact && <span className="text-[12px] font-bold text-[#1D5BEA] shrink-0">This number</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {lookup.trim().length >= 2 && !searching && !matches.some((m) => m.exact) && (
                <div className="mt-2 rounded-xl border border-dashed border-[#d5ddeb] dark:border-slate-700 p-3 space-y-2">
                  <p className="text-[13.5px] font-semibold text-[#4a5672] dark:text-slate-300">{matches.length ? 'Or add someone new' : 'New customer'}: saved to Contacts too</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={contactName} onChange={(e) => { setNewContact({ ...newContact, name: e.target.value }); setEdited({ ...edited, name: true }) }} placeholder="Name" aria-label="Name" className={input} />
                    <PhoneField inputClassName={input} value={contactPhone} onChange={(phone) => { setNewContact({ ...newContact, phone }); setEdited({ ...edited, phone: true }) }} />
                    <input value={newContact.company} onChange={(e) => setNewContact({ ...newContact, company: e.target.value })} placeholder="Company (optional)" aria-label="Company" className={`${input} sm:col-span-2`} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Deal name"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} placeholder="500 shirts for Mehta Exports" className={`${input} ${error?.field === 'title' ? 'border-[#b91c1c]' : ''}`} /></Field>
          <Field label={`Value (${currency})`}><input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} inputMode="decimal" placeholder="85000" className={`${input} ${error?.field === 'value' ? 'border-[#b91c1c]' : ''}`} /></Field>
          <Field label="Stage"><select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className={`${selectInput} h-11`}>{ordered.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Source"><select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={`${selectInput} h-11`}>{SOURCES.filter((s) => s.value !== 'api').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
          {me.canAssign && (
            <Field label="Owner">
              <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} className={`${selectInput} h-11`}>
                <option value="">No owner</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.full_name || m.email} (me)` : m.full_name || m.email}</option>)}
              </select>
            </Field>
          )}
          <Field label="Product or service"><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} maxLength={120} placeholder="Optional" className={input} /></Field>
        </div>
        <Field label="Priority" group>
          <div className="flex flex-wrap gap-1.5">{PRIORITIES.map((p) => <Chip key={p} selected={form.priority === p} onClick={() => setForm({ ...form, priority: p })}>{PRIORITY_LABEL[p]}</Chip>)}</div>
        </Field>
        <Field label="Follow up" group>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_PRESETS.map((p) => <Chip key={p.id} selected={form.follow === p.id} onClick={() => setForm({ ...form, follow: p.id })}>{p.label}</Chip>)}
            <Chip selected={form.follow === 'none'} onClick={() => setForm({ ...form, follow: 'none' })}>Not now</Chip>
          </div>
        </Field>
        {error && <p role="alert" className="text-[14.5px] font-semibold text-[#b91c1c]">{error.text}</p>}
      </div>
    </Modal>
  )
}
