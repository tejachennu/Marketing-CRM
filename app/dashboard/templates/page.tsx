'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowLeft, Bell, CheckCircle2, ChevronRight, Copy, CornerDownRight, ExternalLink, FileText, KeyRound, Languages, Loader2, MoreHorizontal, Pencil,
  Plus, RefreshCw, Search, ShieldCheck, Trash2, Wrench, X, Megaphone, BookOpen, BarChart3,
} from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import {
  CATEGORY_LABELS, REJECTION_REASONS, STATUS_INFO, TEMPLATE_LANGUAGES, TEMPLATE_TYPES,
  draftFromMeta, emptyDraft, languageLabel, validateDraft,
  type TemplateCategory, type TemplateDraft, type TemplateType,
} from '@/lib/whatsapp-templates/template-model'
import type { MetaTemplate } from '@/lib/whatsapp-templates/meta-templates'
import { TemplateEditor } from '@/components/templates/template-editor'
import { TemplatePreview } from '@/components/templates/template-preview'
import { TemplateLibrary } from '@/components/templates/template-library'
import { TemplateInsights } from '@/components/templates/template-insights'

const primary = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#0064e0] hover:bg-[#0058c7] text-white text-[14px] font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
const secondary = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#e4e6eb] hover:bg-[#d8dadf] dark:bg-slate-800 dark:hover:bg-slate-700 text-[#1c2b33] dark:text-slate-100 text-[14px] font-semibold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap'
const select = 'h-9 px-3 text-[14px] rounded-lg bg-white dark:bg-slate-900 border border-[#ced0d4] dark:border-slate-700 text-[#1c2b33] dark:text-white focus:outline-none focus:border-[#0064e0]'

const TONES: Record<string, string> = {
  green: 'bg-[#e6f4ea] text-[#1e7e34] dark:bg-emerald-950/60 dark:text-emerald-300',
  yellow: 'bg-[#fef4d6] text-[#8a6100] dark:bg-amber-950/60 dark:text-amber-300',
  red: 'bg-[#fde8ea] text-[#c11231] dark:bg-rose-950/60 dark:text-rose-300',
  gray: 'bg-[#eceef1] text-[#4b4f56] dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-[#e7f0fd] text-[#0064e0] dark:bg-blue-950/60 dark:text-blue-300',
}
const QUALITY: Record<string, { label: string; dot: string }> = {
  GREEN: { label: 'High quality', dot: 'bg-[#31a24c]' },
  YELLOW: { label: 'Medium quality', dot: 'bg-[#f7b928]' },
  RED: { label: 'Low quality', dot: 'bg-[#e41e3f]' },
}
const CATEGORY_ICONS: Record<TemplateCategory, any> = { MARKETING: Megaphone, UTILITY: Wrench, AUTHENTICATION: KeyRound }

type View = { kind: 'list' } | { kind: 'setup' } | { kind: 'edit'; template?: MetaTemplate } | { kind: 'library' } | { kind: 'insights'; template: MetaTemplate }

function StatusPill({ template }: { template: MetaTemplate }) {
  const info = STATUS_INFO[template.status] || { label: template.status, tone: 'gray', help: '' }
  const quality = template.status === 'APPROVED' ? QUALITY[String(template.quality_score?.score || '').toUpperCase()] : undefined
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span title={info.help} className={`inline-flex items-center gap-1.5 self-start px-2 py-0.5 rounded-md text-[12.5px] font-semibold ${TONES[info.tone]}`}>
        {template.status === 'APPROVED' && <CheckCircle2 size={13} />} {info.label}
      </span>
      {quality && <span className="inline-flex items-center gap-1.5 text-[12px] text-[#65676b] dark:text-slate-400"><span className={`h-2 w-2 rounded-full ${quality.dot}`} />{quality.label}</span>}
      {template.status === 'APPROVED' && !quality && <span className="text-[12px] text-[#65676b] dark:text-slate-400">Quality pending</span>}
    </span>
  )
}

export default function TemplatesPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<RoleSubject>(null)
  const [templates, setTemplates] = useState<MetaTemplate[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([])
  const [view, setView] = useState<View>({ kind: 'list' })
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // List filters
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [language, setLanguage] = useState('')
  const [status, setStatus] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MetaTemplate | null>(null)
  // Adding a language to an existing template: its name and category are fixed
  const [lockedName, setLockedName] = useState<string | null>(null)
  // Status changes seen since the page opened (Meta approving, rejecting, pausing…)
  const [updates, setUpdates] = useState<Array<{ id: string; name: string; language: string; from: string; to: string; at: string }>>([])
  const lastStatuses = useRef<Map<string, string> | null>(null)

  // Create / edit
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showProblems, setShowProblems] = useState(false)

  const canManage = can(viewer, 'campaigns.manage')

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const sync = useCallback(async (organizationId: string) => {
    setSyncing(true)
    try {
      const res = await fetch(`/api/whatsapp-templates?organizationId=${organizationId}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Templates could not be loaded from Meta.')
      const list: MetaTemplate[] = data.templates || []
      // Report what changed since the last sync, like WhatsApp Manager's notifications
      const previous = lastStatuses.current
      if (previous) {
        const changes = list
          .filter((template) => previous.has(template.id) && previous.get(template.id) !== template.status)
          .map((template) => ({ id: template.id, name: template.name, language: template.language, from: previous.get(template.id) || '', to: template.status, at: new Date().toISOString() }))
        if (changes.length) {
          setUpdates((current) => [...changes, ...current].slice(0, 10))
          const first = changes[0]
          const label = (STATUS_INFO[first.to]?.label || first.to).toLowerCase()
          setToast({ kind: first.to === 'REJECTED' || first.to === 'DISABLED' ? 'error' : 'success', text: changes.length === 1 ? `“${first.name}” (${languageLabel(first.language)}) is now ${label}.` : `${changes.length} templates changed status.` })
        }
      }
      lastStatuses.current = new Map(list.map((template) => [template.id, template.status]))
      setTemplates(list)
      setSyncedAt(data.syncedAt || new Date().toISOString())
      setLoadError('')
    } catch (err: any) {
      setLoadError(err.message)
      setTemplates((current) => current || [])
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    (async () => {
      await restoreSupabaseSession()
      const user = authSessionManager.getUser()
      if (!user?.id) return
      const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only').eq('id', user.id).maybeSingle()
      if (!profile?.organization_id) return
      setOrgId(profile.organization_id)
      setViewer({ id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only })
      sync(profile.organization_id)
      // Published WhatsApp flows, for "Complete flow" buttons (admins only; others type the flow ID)
      fetch(`/api/commerce/meta-detect?organizationId=${profile.organization_id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setFlows((data?.flows || []).filter((flow: any) => String(flow.status).toUpperCase() === 'PUBLISHED').map((flow: any) => ({ id: String(flow.id), name: flow.name }))))
        .catch(() => {})
    })()
  }, [sync])

  // While a template is in review, check Meta every 20 seconds so approvals and rejections show up
  // on their own; also check again when the tab comes back into view
  const reviewing = (templates || []).some((template) => ['PENDING', 'IN_APPEAL'].includes(template.status))
  useEffect(() => {
    if (!orgId || view.kind !== 'list') return
    const onFocus = () => { if (document.visibilityState === 'visible') sync(orgId) }
    document.addEventListener('visibilitychange', onFocus)
    const timer = reviewing ? setInterval(() => { if (document.visibilityState === 'visible') sync(orgId) }, 20000) : null
    return () => { document.removeEventListener('visibilitychange', onFocus); if (timer) clearInterval(timer) }
  }, [orgId, view.kind, reviewing, sync])

  const filtered = useMemo(() => (templates || []).filter((template) =>
    (!query || template.name.includes(query.trim().toLowerCase().replace(/\s+/g, '_')) || String(template.components?.find((component: any) => component.type === 'BODY')?.text || '').toLowerCase().includes(query.trim().toLowerCase())) &&
    (!category || template.category === category) &&
    (!language || template.language === language) &&
    (!status || template.status === status)
  ).sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language)), [templates, query, category, language, status])

  const problems = useMemo(() => validateDraft(draft), [draft])
  const editing = view.kind === 'edit' ? view.template : undefined
  const nameTaken = view.kind !== 'list' && !editing && (templates || []).some((template) => template.name === draft.name && template.language === draft.language)

  function startCreate() {
    setLockedName(null)
    setDraft(emptyDraft('MARKETING', 'custom'))
    setSubmitError('')
    setShowProblems(false)
    setView({ kind: 'setup' })
  }

  function startEdit(template: MetaTemplate) {
    setDraft(draftFromMeta(template))
    setSubmitError('')
    setShowProblems(false)
    setView({ kind: 'edit', template })
  }

  function startAddLanguage(template: MetaTemplate) {
    const copy = draftFromMeta(template)
    const used = new Set((templates || []).filter((item) => item.name === template.name).map((item) => item.language))
    copy.language = TEMPLATE_LANGUAGES.find((item) => !used.has(item.code))?.code || copy.language
    // The text is a starting point to translate; Meta-hosted samples must be uploaded again
    copy.headerHandle = copy.headerHandle.startsWith('http') ? '' : copy.headerHandle
    copy.cards = copy.cards.map((card) => ({ ...card, headerHandle: card.headerHandle.startsWith('http') ? '' : card.headerHandle }))
    setLockedName(template.name)
    setDraft(copy)
    setSubmitError('')
    setShowProblems(false)
    setView({ kind: 'setup' })
  }

  function startDuplicate(template: MetaTemplate) {
    setLockedName(null)
    const copy = draftFromMeta(template)
    copy.name = `${template.name}_copy`.slice(0, 512)
    // Meta-hosted sample media can't be reused as a new sample: upload it again
    copy.headerHandle = copy.headerHandle.startsWith('http') ? '' : copy.headerHandle
    copy.cards = copy.cards.map((card) => ({ ...card, headerHandle: card.headerHandle.startsWith('http') ? '' : card.headerHandle }))
    setDraft(copy)
    setSubmitError('')
    setShowProblems(false)
    setView({ kind: 'setup' })
  }

  async function submit() {
    setShowProblems(true)
    if (!orgId || problems.length > 0 || nameTaken) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/whatsapp-templates', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing
          ? { organizationId: orgId, templateId: editing.id, draft, changeCategory: editing.status !== 'APPROVED' && editing.category !== draft.category }
          : { organizationId: orgId, draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Meta did not accept the template.')
      setToast({ kind: 'success', text: editing ? `“${draft.name}” was updated and sent for review.` : `“${draft.name}” was submitted. Meta usually reviews it within minutes.` })
      setView({ kind: 'list' })
      sync(orgId)
    } catch (err: any) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(template: MetaTemplate, allLanguages: boolean) {
    if (!orgId) return
    setConfirmDelete(null)
    const params = new URLSearchParams({ organizationId: orgId, name: template.name, ...(allLanguages ? {} : { templateId: template.id }) })
    const res = await fetch(`/api/whatsapp-templates?${params}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setToast({ kind: 'error', text: data.error || 'The template could not be deleted.' })
    setToast({ kind: 'success', text: `“${template.name}” was deleted.` })
    sync(orgId)
  }

  // ── Set up: category, type, name and language ────────────────────────────
  if (view.kind === 'setup') {
    const types = TEMPLATE_TYPES[draft.category]
    return (
      <Shell>
        <Header title={lockedName ? `Add language to ${lockedName}` : 'Create template'} subtitle={lockedName ? 'Same name and category; choose the language, then translate the content.' : undefined} onBack={() => setView({ kind: 'list' })} />
        <div className="max-w-4xl space-y-4">
          <section className="bg-white dark:bg-[#111b21] rounded-xl border border-[#dadde1] dark:border-slate-800 p-4 sm:p-5">
            <h2 className="text-[17px] font-bold text-[#1c2b33] dark:text-white">Set up your template</h2>
            <p className="text-[13.5px] text-[#65676b] dark:text-slate-400 mt-0.5 mb-4">Choose the category that best describes your message template. Then select the type of message you want to send.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map((value) => {
                const Icon = CATEGORY_ICONS[value]
                const active = draft.category === value
                return (
                  <button key={value} type="button" disabled={Boolean(lockedName) && !active} onClick={() => setDraft({ ...emptyDraft(value, TEMPLATE_TYPES[value][0].type), name: draft.name, language: draft.language })} className={`text-left p-3 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl border-2 transition-colors cursor-pointer ${active ? 'border-[#0064e0] bg-[#e7f0fd] dark:bg-blue-950/30' : 'border-[#dadde1] dark:border-slate-700 hover:bg-[#f5f6f7] dark:hover:bg-slate-800/60'}`}>
                    <span className="flex items-center gap-2 text-[15px] font-bold text-[#1c2b33] dark:text-white"><Icon size={17} className={active ? 'text-[#0064e0]' : 'text-[#65676b]'} /> {CATEGORY_LABELS[value].title}</span>
                    <span className="block text-[12.5px] text-[#65676b] dark:text-slate-400 mt-1 leading-snug">{CATEGORY_LABELS[value].description}</span>
                  </button>
                )
              })}
            </div>
            <div className="space-y-2">
              {types.map((option) => (
                <label key={option.type} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${draft.type === option.type ? 'border-[#0064e0] bg-[#f5f9ff] dark:bg-blue-950/20' : 'border-[#dadde1] dark:border-slate-700 hover:bg-[#f5f6f7] dark:hover:bg-slate-800/60'}`}>
                  <input type="radio" disabled={Boolean(lockedName)} checked={draft.type === option.type} onChange={() => setDraft({ ...emptyDraft(draft.category, option.type as TemplateType), name: draft.name, language: draft.language })} className="mt-1 accent-[#0064e0]" />
                  <span>
                    <span className="block text-[14px] font-semibold text-[#1c2b33] dark:text-white">{option.title}</span>
                    <span className="block text-[13px] text-[#65676b] dark:text-slate-400">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {draft.category === 'UTILITY' && !lockedName && (
              <div className="mt-3 rounded-lg bg-[#f5f9ff] dark:bg-blue-950/20 border border-[#cfe0fb] dark:border-blue-900 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[13px] text-[#1c2b33] dark:text-slate-200"><strong>Skip the review.</strong> Meta's template library has ready-made utility templates that are approved as soon as you create them.</span>
                <button type="button" onClick={() => setView({ kind: 'library' })} className={`${secondary} shrink-0`}><BookOpen size={15} /> Browse library</button>
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-[#111b21] rounded-xl border border-[#dadde1] dark:border-slate-800 p-4 sm:p-5">
            <h2 className="text-[17px] font-bold text-[#1c2b33] dark:text-white">Template name and language</h2>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3 mt-3">
              <label className="block">
                <span className="flex justify-between text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200 mb-1">Name your template <span className="font-normal text-[#8a8d91]">{draft.name.length}/512</span></span>
                <input value={draft.name} disabled={Boolean(lockedName)} onChange={(event) => setDraft({ ...draft, name: event.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })} placeholder="Enter a template name" className={`${select} w-full disabled:bg-[#f5f6f7] dark:disabled:bg-slate-800`} />
                <span className="block text-[12px] text-[#65676b] mt-1">Lowercase letters, numbers and underscores.</span>
              </label>
              <label className="block">
                <span className="block text-[13px] font-semibold text-[#1c2b33] dark:text-slate-200 mb-1">Select language</span>
                <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })} className={`${select} w-full`}>
                  {TEMPLATE_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
            </div>
            {nameTaken && <p className="mt-2 text-[12.5px] text-[#e41e3f]">A template with this name and language already exists. Choose another name, or add another language to it under a new name.</p>}
          </section>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setView({ kind: 'list' })} className={secondary}>Discard</button>
            <button type="button" disabled={!draft.name || nameTaken} onClick={() => setView({ kind: 'edit' })} className={primary}>Next <ChevronRight size={16} /></button>
          </div>
        </div>
      </Shell>
    )
  }

  // ── Insights: one template's performance ─────────────────────────────────
  if (view.kind === 'insights' && orgId) {
    const template = view.template
    return (
      <Shell>
        <Header title={template.name} subtitle={`${CATEGORY_LABELS[template.category as TemplateCategory]?.title || template.category} · ${languageLabel(template.language)} · Insights`} onBack={() => setView({ kind: 'list' })} />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <TemplateInsights orgId={orgId} templateId={template.id} />
          <div className="lg:sticky lg:top-4 space-y-3">
            <p className="text-[15px] font-bold text-[#1c2b33] dark:text-white">Template preview</p>
            <TemplatePreview draft={draftFromMeta(template)} />
          </div>
        </div>
      </Shell>
    )
  }

  // ── Template library: Meta's pre-approved utility templates ──────────────
  if (view.kind === 'library' && orgId) {
    return (
      <Shell>
        <Header title="Browse template library" subtitle="Pre-approved utility templates from Meta. Add your website or phone number and send them right away." onBack={() => setView({ kind: 'list' })} />
        <TemplateLibrary
          orgId={orgId}
          existingNames={new Set((templates || []).map((template) => template.name))}
          onCancel={() => setView({ kind: 'list' })}
          onCreated={(name) => {
            setToast({ kind: 'success', text: `“${name}” was created from the library and is ready to send.` })
            setView({ kind: 'list' })
            sync(orgId)
          }}
        />
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </Shell>
    )
  }

  // ── Edit: content and live preview ───────────────────────────────────────
  if (view.kind === 'edit' && orgId) {
    const typeTitle = TEMPLATE_TYPES[draft.category]?.find((option) => option.type === draft.type)?.title || 'Default'
    return (
      <Shell>
        <Header
          title={editing ? `Edit ${draft.name}` : draft.name}
          subtitle={`${CATEGORY_LABELS[draft.category].title} · ${typeTitle} · ${languageLabel(draft.language)}`}
          onBack={() => (editing ? setView({ kind: 'list' }) : setView({ kind: 'setup' }))}
        />
        {editing?.status === 'REJECTED' && (
          <div className="mb-4 rounded-xl border border-[#f2b8c0] bg-[#fde8ea] dark:bg-rose-950/30 dark:border-rose-900 px-4 py-3 text-[13.5px] text-[#1c2b33] dark:text-rose-100 flex items-start gap-2.5">
            <AlertCircle size={17} className="shrink-0 mt-0.5 text-[#c11231]" />
            <span><strong>Rejected by Meta.</strong> {REJECTION_REASONS[String(editing.rejected_reason || 'NONE')] || editing.rejected_reason} Fix the content below and submit it again.</span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <TemplateEditor draft={draft} onChange={setDraft} problems={showProblems ? problems : []} orgId={orgId} flows={flows} mode={editing ? 'edit' : 'create'} approved={editing?.status === 'APPROVED'} />
          <div className="lg:sticky lg:top-4 space-y-3">
            <p className="text-[15px] font-bold text-[#1c2b33] dark:text-white">Template preview</p>
            <TemplatePreview draft={draft} />
            {showProblems && problems.length > 0 && (
              <div className="rounded-xl border border-[#f2b8c0] bg-[#fff5f6] dark:bg-rose-950/30 dark:border-rose-900 p-3">
                <p className="text-[13px] font-bold text-[#c11231] mb-1">Fix {problems.length === 1 ? 'this' : `these ${problems.length} things`} before submitting</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[12.5px] text-[#1c2b33] dark:text-rose-100">{problems.slice(0, 8).map((problem) => <li key={problem.message}>{problem.message}</li>)}</ul>
              </div>
            )}
            {submitError && <p role="alert" className="rounded-xl border border-[#f2b8c0] bg-[#fde8ea] dark:bg-rose-950/30 p-3 text-[13px] text-[#c11231] dark:text-rose-200">Meta: {submitError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setView({ kind: 'list' })} className={`${secondary} flex-1`}>Discard</button>
              <button type="button" onClick={submit} disabled={submitting || !canManage} className={`${primary} flex-1`}>
                {submitting ? <Loader2 size={15} className="animate-spin" /> : null} {editing ? 'Submit changes' : 'Submit for review'}
              </button>
            </div>
            {!canManage && <p className="text-[12px] text-[#65676b]">Only admins and managers can submit templates.</p>}
          </div>
        </div>
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </Shell>
    )
  }

  // ── List ─────────────────────────────────────────────────────────────────
  const rowInfo = (template: MetaTemplate, index: number) => ({
    body: template.components?.find((component: any) => component.type === 'BODY')?.text || '',
    editable: !['PENDING', 'IN_APPEAL', 'DISABLED', 'PENDING_DELETION', 'DELETED'].includes(template.status),
    // Further languages of the same template sit under its first row, as in WhatsApp Manager
    continued: index > 0 && filtered[index - 1].name === template.name,
  })
  type Row = ReturnType<typeof rowInfo>

  const rowTitle = (template: MetaTemplate, row: Row) => (
    <button type="button" onClick={() => (canManage && row.editable ? startEdit(template) : undefined)} className="block w-full min-w-0 text-left">
      {row.continued ? (
        <span className="flex items-center gap-1.5 pl-1 text-[13px] text-[#65676b] dark:text-slate-400"><CornerDownRight size={14} /> {languageLabel(template.language)} version</span>
      ) : (
        <span className="block text-[14px] font-semibold text-[#1c2b33] dark:text-white hover:underline break-all">{template.name}</span>
      )}
      <span className={`block text-[12.5px] text-[#65676b] dark:text-slate-400 line-clamp-2 md:line-clamp-1 break-words ${row.continued ? 'pl-6' : ''}`}>{row.body || (template.category === 'AUTHENTICATION' ? 'One-time passcode' : '')}</span>
    </button>
  )

  const rowNotes = (template: MetaTemplate) => (
    <>
      {template.status === 'REJECTED' && (
        <span className="block text-[12px] text-[#c11231] mt-1">
          {REJECTION_REASONS[String(template.rejected_reason || 'NONE')] || template.rejected_reason}{' '}
          <a href="https://business.facebook.com/business-support-home" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[#0064e0] hover:underline">Request review <ExternalLink size={11} /></a>
        </span>
      )}
      {template.previous_category && <span className="block text-[12px] text-[#8a6100] mt-1">Category changed by Meta from {CATEGORY_LABELS[template.previous_category as TemplateCategory]?.title || template.previous_category}</span>}
    </>
  )

  const rowActions = (template: MetaTemplate, row: Row) => canManage && (
    <div className="relative shrink-0">
      <button type="button" aria-label={`Actions for ${template.name}`} onClick={() => setMenuFor(menuFor === template.id ? null : template.id)} className="h-8 w-8 rounded-lg flex items-center justify-center text-[#65676b] hover:bg-[#e4e6eb] dark:hover:bg-slate-800 cursor-pointer"><MoreHorizontal size={17} /></button>
      {menuFor === template.id && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-[#dadde1] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-1">
          {template.status === 'APPROVED' && <MenuItem icon={BarChart3} label="View insights" onClick={() => { setMenuFor(null); setView({ kind: 'insights', template }) }} />}
          {row.editable && <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuFor(null); startEdit(template) }} />}
          <MenuItem icon={Languages} label="Add language" onClick={() => { setMenuFor(null); startAddLanguage(template) }} />
          <MenuItem icon={Copy} label="Duplicate" onClick={() => { setMenuFor(null); startDuplicate(template) }} />
          <MenuItem icon={Trash2} label="Delete" danger onClick={() => { setMenuFor(null); setConfirmDelete(template) }} />
        </div>
      )}
    </div>
  )

  const languagesInUse = [...new Set((templates || []).map((template) => template.language))]
  return (
    <Shell>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#1c2b33] dark:text-white">Message templates</h1>
          <p className="text-[13.5px] text-[#65676b] dark:text-slate-400">Create and manage the templates you send to start conversations on WhatsApp. Synced live with Meta.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => orgId && sync(orgId)} disabled={syncing || !orgId} className={secondary} title={syncedAt ? `Last synced ${new Date(syncedAt).toLocaleTimeString()}` : 'Sync with Meta'}>
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Sync
          </button>
          {canManage && <button type="button" onClick={() => setView({ kind: 'library' })} disabled={!orgId} className={secondary}><BookOpen size={15} /> <span className="hidden sm:inline">Browse template library</span><span className="sm:hidden">Library</span></button>}
          {canManage && <button type="button" onClick={startCreate} className={primary}><Plus size={16} /> Create template</button>}
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mb-4 rounded-xl border border-[#f2b8c0] bg-[#fde8ea] dark:bg-rose-950/30 dark:border-rose-900 px-4 py-3 text-[13.5px] text-[#c11231] dark:text-rose-200 flex items-start gap-2">
          <AlertCircle size={17} className="shrink-0 mt-0.5" /> {loadError}
        </div>
      )}

      {updates.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#dadde1] dark:border-slate-800 bg-white dark:bg-[#111b21] p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="flex items-center gap-1.5 text-[14px] font-bold text-[#1c2b33] dark:text-white"><Bell size={15} /> Status updates</p>
            <button type="button" onClick={() => setUpdates([])} className="text-[12.5px] font-semibold text-[#0064e0] cursor-pointer">Clear</button>
          </div>
          <ul className="space-y-1">
            {updates.map((update) => (
              <li key={`${update.id}-${update.at}`} className="text-[13px] text-[#1c2b33] dark:text-slate-200">
                <strong>{update.name}</strong> ({languageLabel(update.language)}): {STATUS_INFO[update.from]?.label || update.from} → <span className={update.to === 'APPROVED' ? 'text-[#1e7e34] font-semibold' : update.to === 'REJECTED' || update.to === 'DISABLED' ? 'text-[#c11231] font-semibold' : 'font-semibold'}>{STATUS_INFO[update.to]?.label || update.to}</span>
                <span className="text-[#8a8d91]"> · {new Date(update.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-[#111b21] rounded-xl border border-[#dadde1] dark:border-slate-800">
        <div className="p-3 sm:p-4 flex flex-col lg:flex-row gap-2 border-b border-[#dadde1] dark:border-slate-800">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8d91]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or content" className={`${select} w-full pl-9`} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={select} aria-label="Category">
              <option value="">Category</option>
              {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value].title}</option>)}
            </select>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} className={select} aria-label="Language">
              <option value="">Language</option>
              {languagesInUse.map((code) => <option key={code} value={code}>{languageLabel(code)}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={select} aria-label="Status">
              <option value="">Status</option>
              {['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL'].map((value) => <option key={value} value={value}>{STATUS_INFO[value].label}</option>)}
            </select>
          </div>
        </div>

        {templates === null ? (
          <div className="p-10 flex items-center justify-center gap-2 text-[14px] text-[#65676b]"><Loader2 size={18} className="animate-spin" /> Loading templates from Meta…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText size={32} className="mx-auto text-[#bcc0c4]" />
            <p className="mt-2 text-[15px] font-semibold text-[#1c2b33] dark:text-white">{templates.length ? 'No templates match these filters' : 'No message templates yet'}</p>
            <p className="text-[13.5px] text-[#65676b] dark:text-slate-400">{templates.length ? 'Clear a filter to see more.' : 'Create your first template to start sending campaigns.'}</p>
          </div>
        ) : (
          <>
            {/* Phones: one card per template */}
            <ul className="md:hidden">
              {filtered.map((template, index) => {
                const row = rowInfo(template, index)
                return (
                  <li key={template.id} className={`relative px-3 sm:px-4 ${row.continued ? 'pb-3' : 'py-3 border-t first:border-t-0 border-[#ebedf0] dark:border-slate-800'}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">{rowTitle(template, row)}</div>
                      {rowActions(template, row)}
                    </div>
                    <div className={`mt-2 flex flex-wrap items-start gap-x-3 gap-y-1 text-[12.5px] text-[#65676b] dark:text-slate-400 ${row.continued ? 'pl-6' : ''}`}>
                      <StatusPill template={template} />
                      <span className="pt-0.5">{CATEGORY_LABELS[template.category as TemplateCategory]?.title || template.category} · {languageLabel(template.language)}</span>
                    </div>
                    {rowNotes(template)}
                  </li>
                )
              })}
            </ul>

            {/* Larger screens: the table, as in WhatsApp Manager */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left table-fixed min-w-[720px]">
                <thead>
                  <tr className="text-[12.5px] font-semibold text-[#65676b] dark:text-slate-400 bg-[#f5f6f7] dark:bg-slate-900/60">
                    <th className="px-4 py-2.5">Template name</th>
                    <th className="px-4 py-2.5 w-[130px]">Category</th>
                    <th className="px-4 py-2.5 w-[150px]">Language</th>
                    <th className="px-4 py-2.5 w-[170px]">Status</th>
                    <th className="px-2 py-2.5 w-14"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((template, index) => {
                    const row = rowInfo(template, index)
                    return (
                      <tr key={template.id} className={`${row.continued ? '' : 'border-t border-[#ebedf0] dark:border-slate-800'} hover:bg-[#f7f8fa] dark:hover:bg-slate-900/40 align-top`}>
                        <td className="px-4 py-3 min-w-0">{rowTitle(template, row)}{rowNotes(template)}</td>
                        <td className="px-4 py-3 text-[13.5px] text-[#1c2b33] dark:text-slate-200">{CATEGORY_LABELS[template.category as TemplateCategory]?.title || template.category}</td>
                        <td className="px-4 py-3 text-[13.5px] text-[#1c2b33] dark:text-slate-200">{languageLabel(template.language)}</td>
                        <td className="px-4 py-3"><StatusPill template={template} /></td>
                        <td className="px-2 py-2.5 relative">{rowActions(template, row)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {templates && templates.length > 0 && (
          <p className="px-4 py-2.5 text-[12.5px] text-[#65676b] dark:text-slate-400 border-t border-[#ebedf0] dark:border-slate-800 flex items-center gap-1.5">
            <ShieldCheck size={13} /> {filtered.length} of {templates.length} templates{syncedAt ? ` · synced ${new Date(syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}{reviewing ? ' · checking Meta for review results every 20 seconds' : ''}
          </p>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111b21] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[17px] font-bold text-[#1c2b33] dark:text-white">Delete “{confirmDelete.name}”?</h2>
              <button type="button" aria-label="Close" onClick={() => setConfirmDelete(null)} className="h-8 w-8 rounded-lg flex items-center justify-center text-[#65676b] hover:bg-[#e4e6eb] cursor-pointer"><X size={16} /></button>
            </div>
            <p className="mt-2 text-[13.5px] text-[#65676b] dark:text-slate-400">Messages already sent are not affected, but you won't be able to send it again. You can't create a new template with the same name for 30 days.</p>
            <div className="mt-5 flex flex-col sm:flex-row justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className={secondary}>Cancel</button>
              {(templates || []).filter((template) => template.name === confirmDelete.name).length > 1 && (
                <button type="button" onClick={() => remove(confirmDelete, true)} className={secondary}>Delete all languages</button>
              )}
              <button type="button" onClick={() => remove(confirmDelete, false)} className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#e41e3f] hover:bg-[#c11231] text-white text-[14px] font-semibold cursor-pointer">
                Delete {(templates || []).filter((template) => template.name === confirmDelete.name).length > 1 ? languageLabel(confirmDelete.language) : 'template'}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[#f0f2f5] dark:bg-[#0b141a]">
      <div className="max-w-7xl mx-auto p-4 pb-24 md:p-8 md:pb-10">{children}</div>
    </div>
  )
}

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <button type="button" onClick={onBack} aria-label="Back" className="h-9 w-9 rounded-lg flex items-center justify-center bg-white dark:bg-slate-800 border border-[#dadde1] dark:border-slate-700 text-[#1c2b33] dark:text-slate-200 hover:bg-[#f5f6f7] cursor-pointer"><ArrowLeft size={17} /></button>
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold text-[#1c2b33] dark:text-white truncate">{title || 'New template'}</h1>
        {subtitle && <p className="text-[13px] text-[#65676b] dark:text-slate-400">{subtitle}</p>}
      </div>
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-2 px-3 py-2 text-[13.5px] hover:bg-[#f2f3f5] dark:hover:bg-slate-800 cursor-pointer text-left ${danger ? 'text-[#e41e3f]' : 'text-[#1c2b33] dark:text-slate-200'}`}>
      <Icon size={15} /> {label}
    </button>
  )
}

function Toast({ toast, onClose }: { toast: { kind: 'success' | 'error'; text: string }; onClose: () => void }) {
  return (
    <div role={toast.kind === 'error' ? 'alert' : 'status'} className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-[13.5px] font-medium ${toast.kind === 'error' ? 'bg-[#e41e3f] text-white' : 'bg-[#1c2b33] text-white'}`}>
      {toast.kind === 'error' ? <AlertCircle size={17} className="shrink-0 mt-px" /> : <CheckCircle2 size={17} className="shrink-0 mt-px text-[#31a24c]" />}
      <span className="flex-1">{toast.text}</span>
      <button type="button" aria-label="Dismiss" onClick={onClose} className="cursor-pointer"><X size={15} /></button>
    </div>
  )
}
