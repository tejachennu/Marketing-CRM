'use client'

/**
 * Settings → Knowledge Base → "Add knowledge from": a website (one page or the whole site), a PDF / Word / text
 * file, or pasted text. Each is read, split into parts and searched by the AI together with the FAQs. The list
 * shows how each was read (Reading… / Ready · parts / Could not read: why), with Read again, See parts and Delete.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, Globe, Loader2, RefreshCw, Trash2, Type, Upload } from 'lucide-react'
import { SOURCE_FILES, SOURCE_LABELS, fileEnding, type SourceKind } from '@/lib/ai/knowledge-text'
import { uploadKnowledgeFile } from './knowledge-upload'

interface Source {
  id: string
  kind: SourceKind
  title: string
  url: string | null
  file_name: string | null
  wholeSite: boolean
  status: 'processing' | 'ready' | 'failed'
  error: string | null
  chunk_count: number
  page_count: number
  read_at: string | null
  updated_at: string
}

type Mode = 'website' | 'file' | 'text'

const ICON: Record<SourceKind, typeof Globe> = { website: Globe, pdf: FileText, document: FileText, text: Type }
const input = 'w-full px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#d5ddeb] dark:border-[#2a3942] rounded-lg text-[13px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/20'
const blue = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#008069] hover:bg-[#006d5b] disabled:opacity-50 text-white text-xs font-bold'
const plain = 'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#d5ddeb] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] hover:bg-[#f4f6fa] text-[#4a5672] dark:text-white text-[11px] font-bold disabled:opacity-50'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '')

export function KnowledgeSources({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('website')
  const [url, setUrl] = useState('')
  const [wholeSite, setWholeSite] = useState(true)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [parts, setParts] = useState<{ id: string; list: { id: string; title: string; content: string }[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge/sources?organizationId=${organizationId}`)
      const data = await res.json().catch(() => ({}))
      if (Array.isArray(data.sources)) setSources(data.sources)
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => { load() }, [load])
  // While something is being read, check every 4 seconds
  const reading = sources.some((s) => s.status === 'processing')
  useEffect(() => {
    if (!reading) return
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [reading, load])

  async function send(body: Record<string, any>) {
    const res = await fetch('/api/knowledge/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, ...body }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'That did not work. Try again.')
    return data.source as Source
  }

  async function add(body: Record<string, any>) {
    setBusy(true)
    setError('')
    try {
      const source = await send(body)
      setSources((list) => [source, ...list.filter((s) => s.id !== source.id)])
      setUrl(''); setTitle(''); setText('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function pickFile(files: FileList | null) {
    const file = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (!SOURCE_FILES[fileEnding(file.name)]) { setError('Use a PDF, Word (.docx), .txt, .md or .csv file.'); return }
    setBusy(true)
    setError('')
    try {
      const { path } = await uploadKnowledgeFile(organizationId, file, 'source')
      const source = await send({ kind: 'file', path, fileName: file.name, title })
      setSources((list) => [source, ...list])
      setTitle('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function refresh(s: Source) {
    try {
      const source = await send({ action: 'refresh', id: s.id })
      setSources((list) => list.map((x) => (x.id === s.id ? source : x)))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove(s: Source) {
    if (!window.confirm(`Delete "${s.title}"? The AI will stop using it.`)) return
    const res = await fetch(`/api/knowledge/sources?organizationId=${organizationId}&id=${s.id}`, { method: 'DELETE' })
    if (res.ok) setSources((list) => list.filter((x) => x.id !== s.id))
    else setError((await res.json().catch(() => ({}))).error || 'It could not be deleted.')
  }

  async function showParts(s: Source) {
    if (parts?.id === s.id) { setParts(null); return }
    const res = await fetch(`/api/knowledge/sources?organizationId=${organizationId}&id=${s.id}&parts=1`)
    const data = await res.json().catch(() => ({}))
    setParts({ id: s.id, list: data.parts || [] })
  }

  const tabs: [Mode, string, typeof Globe][] = [['website', 'Website', Globe], ['file', 'PDF or document', FileText], ['text', 'Paste text', Type]]

  return (
    <section className="bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-[#202d36] p-5 sm:p-6" aria-labelledby="sources-title">
      <h3 id="sources-title" className="text-sm font-bold text-[#0E1B3D] dark:text-white">Add knowledge from your website, PDFs and documents</h3>
      <p className="text-[12px] text-[#6B7894] dark:text-[#8696a0] mt-0.5 mb-4">The AI reads them, splits them into small parts and answers customers from them, together with your FAQs.</p>

      {canEdit && (
        <>
          <div role="tablist" aria-label="What to add" className="flex flex-wrap gap-2 mb-3">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => { setMode(key); setError('') }}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-bold border transition-colors ${mode === key ? 'bg-[#0E1B3D] border-[#0E1B3D] text-white' : 'bg-white dark:bg-[#1f2c34] border-[#d5ddeb] dark:border-[#2a3942] text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa]'}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-[#e3e8f2] dark:border-[#2a3942] bg-[#f4f6fa] dark:bg-[#0b141a] p-3 sm:p-4">
            {mode === 'website' && (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add({ kind: 'website', url, wholeSite }) }}>
                <input aria-label="Website address" className={input} inputMode="url" placeholder="www.yourshop.com" value={url} onChange={(e) => setUrl(e.target.value)} />
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[#0E1B3D] dark:text-white">
                  <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" name="site" checked={wholeSite} onChange={() => setWholeSite(true)} className="accent-[#008069]" /> Whole website (up to 25 pages)</label>
                  <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" name="site" checked={!wholeSite} onChange={() => setWholeSite(false)} className="accent-[#008069]" /> Only this page</label>
                </div>
                <button type="submit" className={blue} disabled={busy || !url.trim()}>{busy && <Loader2 size={13} className="animate-spin" />} Read website</button>
              </form>
            )}
            {mode === 'file' && (
              <div className="space-y-3">
                <input aria-label="Name (optional)" className={input} placeholder="Name (optional), like Price list 2026" value={title} onChange={(e) => setTitle(e.target.value)} />
                <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => pickFile(e.target.files)} />
                <button type="button" className={blue} disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Choose a file
                </button>
                <p className="text-[11px] text-[#8a94a8]">PDF, Word (.docx), .txt, .md or .csv, up to 25 MB. Scanned PDFs (photos of pages) have no words to read.</p>
              </div>
            )}
            {mode === 'text' && (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add({ kind: 'text', title, text }) }}>
                <input aria-label="Name" className={input} placeholder="Name, like Return policy" value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea aria-label="Text" rows={5} className={`${input} resize-y`} placeholder="Paste or type the text" value={text} onChange={(e) => setText(e.target.value)} />
                <button type="submit" className={blue} disabled={busy || !title.trim() || text.trim().length < 20}>{busy && <Loader2 size={13} className="animate-spin" />} Add text</button>
              </form>
            )}
            {error && <p role="alert" className="mt-2 text-[12px] font-semibold text-[#b91c1c]">{error}</p>}
          </div>
        </>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-[#8a94a8]" /></div>
        ) : sources.length === 0 ? (
          <p className="text-[12px] text-[#8a94a8]">Nothing added yet.</p>
        ) : (
          <ul className="divide-y divide-[#eef1f6] dark:divide-[#202d36]">
            {sources.map((s) => {
              const Icon = ICON[s.kind] || FileText
              return (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="h-8 w-8 shrink-0 rounded-lg bg-[#eef1f6] dark:bg-[#1f2c34] text-[#008069] flex items-center justify-center"><Icon size={15} /></span>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="text-[13px] font-semibold text-[#0E1B3D] dark:text-white break-words">{s.title}</p>
                      <p className="text-[11px] text-[#8a94a8] break-all">
                        {SOURCE_LABELS[s.kind]}{s.kind === 'website' ? ` · ${s.wholeSite ? 'whole site' : 'one page'}` : s.file_name ? ` · ${s.file_name}` : ''}
                      </p>
                      {s.status === 'processing' && <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#4a5672]"><Loader2 size={12} className="animate-spin" /> Reading… this can take a minute</p>}
                      {s.status === 'ready' && (
                        <p className="mt-1 text-[12px] text-[#4a5672] dark:text-slate-300">
                          Ready · {s.chunk_count} {s.chunk_count === 1 ? 'part' : 'parts'}{s.page_count > 1 ? ` from ${s.page_count} ${s.kind === 'website' ? 'pages' : 'pages'}` : ''}{s.read_at ? ` · read ${when(s.read_at)}` : ''}
                        </p>
                      )}
                      {s.error && <p className={`mt-1 text-[12px] font-semibold ${s.status === 'failed' ? 'text-[#b91c1c]' : 'text-[#6B7894]'}`}>{s.status === 'failed' ? 'Could not read: ' : ''}{s.error}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      {s.status === 'ready' && s.chunk_count > 0 && (
                        <button type="button" className={plain} aria-expanded={parts?.id === s.id} onClick={() => showParts(s)}>
                          <ChevronDown size={12} className={parts?.id === s.id ? 'rotate-180' : ''} /> Parts
                        </button>
                      )}
                      {canEdit && s.status !== 'processing' && s.kind !== 'text' && <button type="button" className={plain} onClick={() => refresh(s)}><RefreshCw size={12} /> Read again</button>}
                      {canEdit && <button type="button" className={plain} aria-label={`Delete ${s.title}`} onClick={() => remove(s)}><Trash2 size={12} /></button>}
                    </div>
                  </div>
                  {parts?.id === s.id && (
                    <ol className="mt-2 ml-11 space-y-2 max-h-72 overflow-y-auto pr-1">
                      {parts.list.map((p) => (
                        <li key={p.id} className="rounded-lg border border-[#e3e8f2] dark:border-[#2a3942] bg-[#f4f6fa] dark:bg-[#0b141a] p-2">
                          <p className="text-[11px] font-bold text-[#4a5672] break-words">{p.title}</p>
                          <p className="text-[12px] text-[#0E1B3D] dark:text-slate-200 whitespace-pre-wrap break-words line-clamp-4">{p.content}</p>
                        </li>
                      ))}
                      {parts.list.length >= 50 && <li className="text-[11px] text-[#8a94a8]">Showing the first 50 parts.</li>}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
