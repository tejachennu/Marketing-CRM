'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { MAX_EXTRA_PHOTOS, readVideo } from '@/lib/commerce/product-media'
import { hintClass, inputClass, labelClass, type ShowToast } from './ui'

async function upload(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/media/upload', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !String(data.url || '').startsWith('https://')) throw new Error(data.error || 'The photo could not be uploaded. Try a smaller JPG or PNG.')
  return data.url
}

/** In the product form: more photos (upload, remove, first = next after the main photo) and a video link. */
export function ProductMedia({ images, video, onImages, onVideo, showToast }: { images: string[]; video: string; onImages: (list: string[]) => void; onVideo: (url: string) => void; showToast: ShowToast }) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const videoOk = !video.trim() || readVideo(video.trim())
  return (
    <div className="space-y-3">
      <div>
        <p className={labelClass}>More photos (optional)</p>
        <div className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={url} className="relative h-16 w-16 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 2}`} className="h-full w-full object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 2}`} onClick={() => onImages(images.filter((u) => u !== url))} className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-[#0E1B3D]/80 text-white flex items-center justify-center cursor-pointer"><X size={12} /></button>
            </div>
          ))}
          {images.length < MAX_EXTRA_PHOTOS && (
            <button type="button" onClick={() => file.current?.click()} aria-label="Add a photo" className="h-16 w-16 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-400 cursor-pointer">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}
            </button>
          )}
        </div>
        <input ref={file} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
          const picked = Array.from(e.target.files || []).slice(0, MAX_EXTRA_PHOTOS - images.length)
          e.target.value = ''
          if (!picked.length) return
          setBusy(true)
          try {
            const urls: string[] = []
            for (const f of picked) urls.push(await upload(f))
            onImages([...images, ...urls].slice(0, MAX_EXTRA_PHOTOS))
          } catch (err: any) {
            showToast('error', err.message)
          } finally {
            setBusy(false)
          }
        }} />
        <p className={hintClass}>Up to {MAX_EXTRA_PHOTOS} more photos: other sides, close-ups, how it looks when worn or used.</p>
      </div>
      <div>
        <label className={labelClass} htmlFor="product-video">Video link (optional)</label>
        <input id="product-video" type="url" placeholder="https://youtube.com/shorts/… or a .mp4 link" value={video} onChange={(e) => onVideo(e.target.value)} className={inputClass} />
        {!videoOk ? <p className="text-[11px] text-[#b91c1c] mt-1">Use a YouTube link (video or Short) or a link that ends in .mp4.</p> : <p className={hintClass}>Plays on the product page. A short clip works best.</p>}
      </div>
    </div>
  )
}
