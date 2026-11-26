'use client'

import { useEffect } from 'react'
import { isNewVersionError } from '@/lib/new-version'

/**
 * What a page shows when something breaks while it loads, instead of the browser's bare "Application error".
 * When a new version of the app went live while this page was open, its old files are gone: the page then loads
 * itself again once by itself (remembered for a minute, so it never loops), which fixes it.
 */
const RELOAD_KEY = 'wama-reloaded-at'

export function ErrorScreen({ error, reset, home, homeLabel = 'Go to the start' }: { error: Error & { digest?: string }; reset: () => void; home?: string; homeLabel?: string }) {
  useEffect(() => {
    console.error(error)
    if (!isNewVersionError(error)) return
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        window.location.reload()
      }
    } catch {}
  }, [error])

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center bg-white rounded-2xl border border-[#e3e8f2] p-8">
        <p className="text-[19px] font-bold text-[#0E1B3D]">This page did not load properly</p>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[#4a5672]">Please try again. If it keeps happening, check your internet and reload the page.</p>
        <div className="mt-6 grid gap-2">
          <button type="button" onClick={() => { try { reset() } catch {} ; window.location.reload() }} className="h-11 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold cursor-pointer">Try again</button>
          {home && <a href={home} className="h-11 rounded-xl border border-[#d5ddeb] text-[#0E1B3D] text-[15px] font-semibold inline-flex items-center justify-center">{homeLabel}</a>}
        </div>
        {error?.digest && <p className="mt-4 text-[12px] text-[#8a94a8]">Code: {error.digest}</p>}
      </div>
    </main>
  )
}
