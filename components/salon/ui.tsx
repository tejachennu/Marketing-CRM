'use client'

/** Small shared pieces for the Spa & Salon screens: API calls, the signed-in workspace, and UI bits. */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import type { RoleSubject } from '@/lib/rbac'

export async function api(path: string, init: RequestInit = {}) {
  const token = authSessionManager.getSession()?.access_token
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...init, headers, cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}). Please try again.`)
  return data
}

export interface Workspace {
  orgId: string
  orgName: string
  me: RoleSubject
}

/** The signed-in person and their workspace. */
export function useWorkspace(): { workspace: Workspace | null; error: string } {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    (async () => {
      try {
        await restoreSupabaseSession()
        const user = authSessionManager.getUser()
        if (!user?.id) return
        const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only, organizations(name)').eq('id', user.id).maybeSingle()
        if (!profile?.organization_id) { setError('Your account is not part of a workspace.'); return }
        setWorkspace({
          orgId: profile.organization_id,
          orgName: (profile as any).organizations?.name || '',
          me: { id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only },
        })
      } catch (err: any) {
        setError(err.message || 'Your workspace could not be loaded.')
      }
    })()
  }, [])
  return { workspace, error }
}

export const card = 'bg-white dark:bg-[#111b21] rounded-2xl border border-[#e3e8f2] dark:border-slate-800'
export const input = 'w-full h-11 px-3.5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-[15px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15'
export const primaryButton = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const secondaryButton = 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-100 text-[15px] font-semibold hover:bg-[#f4f6fa] dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50'
export const dangerButton = 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-[#f3c7c7] dark:border-red-900 text-[#b91c1c] dark:text-red-300 text-[15px] font-semibold hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 transition-colors cursor-pointer disabled:opacity-50'

export function Chip({ selected, onClick, children, disabled }: { selected?: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 min-h-10 px-3.5 py-1.5 rounded-xl border text-[14.5px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${selected ? 'border-[#1D5BEA] bg-[#eef3fe] text-[#1D5BEA] dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-slate-200 hover:border-[#9db5ef]'}`}>
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[14px] font-semibold text-[#0E1B3D] dark:text-white mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12.5px] text-[#6B7894] mt-1">{hint}</span>}
    </label>
  )
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0E1B3D]/40 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}
        className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} bg-white dark:bg-[#111b21] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-[20px] font-extrabold text-[#0E1B3D] dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-10 w-10 rounded-lg flex items-center justify-center text-[#6B7894] hover:bg-[#f1f4f9] dark:hover:bg-slate-800 cursor-pointer"><X size={20} /></button>
        </div>
        <div className="px-5 py-3 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 pb-5 pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${checked ? 'bg-[#00A884]' : 'bg-[#d5ddeb] dark:bg-slate-700'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export type ToastState = { tone: 'success' | 'error'; text: string } | null

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const flash = (tone: 'success' | 'error', text: string) => {
    setToast({ tone, text })
    window.setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 5000)
  }
  return { toast, flash, clear: () => setToast(null) }
}

export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null
  return (
    <div role="status" className={`fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] rounded-xl px-4 py-3 text-[15px] font-semibold shadow-lg ${toast.tone === 'success' ? 'bg-[#0E1B3D] text-white' : 'bg-[#b91c1c] text-white'}`}>
      {toast.text}
    </div>
  )
}
