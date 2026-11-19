'use client'

/**
 * The photos, videos, files and links an FAQ carries. When the AI answers with that FAQ, they are sent after the
 * answer on WhatsApp and Instagram (a price list photo, a brochure PDF, a "how to reach us" video, a booking link).
 */

import { useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Link2, Loader2, Paperclip, Video, X } from 'lucide-react'
import { MAX_MEDIA, MEDIA_LABELS, mediaTypeOf, type KnowledgeMedia } from '@/lib/ai/knowledge-text'
import { uploadKnowledgeFile } from './knowledge-upload'

const ICONS = { image: ImageIcon, video: Video, document: FileText, link: Link2 }
const input = 'min-w-0 flex-1 px-3 py-2 bg-white dark:bg-[#1f2c34] border border-[#d5ddeb] dark:border-[#2a3942] rounded-lg text-[13px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA]'
const plain = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-[#d5ddeb] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] hover:bg-[#f4f6fa] text-[#4a5672] dark:text-white text-xs font-bold disabled:opacity-50'

export function MediaEditor({ organizationId, value, onChange }: { organizationId: string; value: KnowledgeMedia[]; onChange: (next: KnowledgeMedia[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState({ url: '', name: '' })
  const [error, setError] = useState('')
  const full = value.length >= MAX_MEDIA

  async function pick(files: FileList | null) {
    const file = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    const type = mediaTypeOf(file.name)
    if (!type) { setError('Use a photo (JPG, PNG, WebP), a video (MP4) or a file (PDF, Word, Excel).'); return }
    setError('')
    setUploading(true)
    try {
      const { publicUrl } = await uploadKnowledgeFile(organizationId, file, 'attachment')
      onChange([...value, { type, url: publicUrl, name: file.name }])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function addLink() {
    let url = link.url.trim()
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
    if (!/^https:\/\/[^\s.]+\.[^\s]+$/i.test(url)) { setError('Type a full web address, like https://yourshop.com/book.'); return }
    setError('')
    onChange([...value, { type: 'link', url, ...(link.name.trim() ? { name: link.name.trim().slice(0, 120) } : {}) }])
    setLink({ url: '', name: '' })
    setLinkOpen(false)
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#4a5672] dark:text-[#8696a0] mb-1.5">Send with this answer (optional)</p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2">
          {value.map((m, i) => {
            const Icon = ICONS[m.type]
            return (
              <li key={m.url} className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-[#d5ddeb] dark:border-[#2a3942] bg-[#f4f6fa] dark:bg-[#1f2c34] pl-2 pr-1 py-1 text-[12px] text-[#0E1B3D] dark:text-white">
                <Icon size={13} className="shrink-0 text-[#1D5BEA]" aria-hidden />
                <span className="shrink-0 text-[#6B7894]">{MEDIA_LABELS[m.type]}:</span>
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="truncate max-w-[180px] sm:max-w-[260px] hover:underline">{m.name || m.url}</a>
                <button type="button" aria-label={`Remove ${m.name || MEDIA_LABELS[m.type]}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="p-0.5 rounded text-[#6B7894] hover:text-[#b91c1c]"><X size={13} /></button>
              </li>
            )
          })}
        </ul>
      )}
      {linkOpen ? (
        <div className="flex flex-wrap gap-2 mb-2">
          <input aria-label="Link address" className={input} placeholder="https://yourshop.com/book" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
          <input aria-label="Link words" className={input} placeholder="Words, like Book online" value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} />
          <div className="flex gap-2">
            <button type="button" className="inline-flex items-center h-8 px-3 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-xs font-bold" onClick={addLink}>Add link</button>
            <button type="button" className={plain} onClick={() => { setLinkOpen(false); setError('') }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.mp4,.3gp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={(e) => pick(e.target.files)} />
          <button type="button" className={plain} disabled={full || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Photo, video or file
          </button>
          <button type="button" className={plain} disabled={full || uploading} onClick={() => setLinkOpen(true)}><Link2 size={13} /> Link</button>
          {full && <span className="text-[11px] text-[#8a94a8] self-center">Up to {MAX_MEDIA}.</span>}
        </div>
      )}
      {error && <p role="alert" className="mt-1.5 text-[12px] font-semibold text-[#b91c1c]">{error}</p>}
    </div>
  )
}
