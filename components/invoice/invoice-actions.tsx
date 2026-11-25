'use client'

import { useState } from 'react'
import { Check, Printer, Share2, Star } from 'lucide-react'

// Phones: three equal tiles (icon over a short label). Wider screens: normal buttons in a row.
const base = 'inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 h-14 sm:h-11 px-2 sm:px-5 rounded-xl text-[12.5px] sm:text-[14.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D5BEA]'
const primary = `${base} bg-[#1D5BEA] hover:bg-[#174bc4] text-white`
const secondary = `${base} border border-[#d5ddeb] bg-white text-[#0E1B3D] hover:bg-[#f4f6fa]`

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={primary}>
      <Printer size={18} aria-hidden />
      <span className="sm:hidden">Save PDF</span>
      <span className="hidden sm:inline">Print / Save as PDF</span>
    </button>
  )
}

/** The phone's share sheet where there is one, else the link is copied. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = window.location.href
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return
      } catch (error: any) {
        if (error?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  return (
    <button type="button" onClick={share} className={secondary}>
      {copied ? <Check size={18} aria-hidden /> : <Share2 size={18} aria-hidden />}
      <span aria-live="polite">{copied ? 'Link copied' : 'Share'}</span>
    </button>
  )
}

export function RateLink({ href }: { href: string }) {
  return (
    <a href={href} className={secondary}>
      <Star size={18} aria-hidden />
      <span className="sm:hidden">Rate visit</span>
      <span className="hidden sm:inline">Rate your visit</span>
    </a>
  )
}
