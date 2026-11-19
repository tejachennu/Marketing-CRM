'use client'

/**
 * Uploading a knowledge file from the browser straight to storage (big PDFs and videos work; the app's own
 * request size limit does not apply): a one-time upload address from /api/knowledge/upload-url, then the file.
 */

import { supabase } from '@/lib/supabase'

export async function uploadKnowledgeFile(organizationId: string, file: File, purpose: 'source' | 'attachment'): Promise<{ path: string; publicUrl: string }> {
  const res = await fetch('/api/knowledge/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, fileName: file.name, size: file.size, purpose }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'The upload could not start.')
  const { error } = await supabase.storage.from(data.bucket).uploadToSignedUrl(data.path, data.token, file, { contentType: file.type || undefined })
  if (error) throw new Error('The file could not be uploaded. Check your internet and try again.')
  return { path: data.path, publicUrl: data.publicUrl }
}
