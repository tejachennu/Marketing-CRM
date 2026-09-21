'use client'

import React, { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyPhoneButtonProps {
  phoneNumber: string
  className?: string
  iconSize?: number
  showText?: boolean
  displayText?: string
  title?: string
}

export function CopyPhoneButton({
  phoneNumber,
  className = '',
  iconSize = 12,
  showText = false,
  displayText,
  title = 'Copy phone number'
}: CopyPhoneButtonProps) {
  const [copied, setCopied] = useState(false)

  if (!phoneNumber) return null

  // Clean raw number (remove 'whatsapp:' prefix if present)
  const cleanNumber = phoneNumber.replace(/^whatsapp:/i, '').trim()

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(cleanNumber)
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea')
        textarea.value = cleanNumber
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy phone number:', err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `${title}: ${cleanNumber}`}
      aria-label={copied ? 'Copied to clipboard' : `Copy ${cleanNumber}`}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 select-none group cursor-pointer ${
        copied ? '!text-emerald-500 font-semibold' : ''
      } ${className}`}
    >
      {showText && (
        <span className="font-mono text-inherit">
          {displayText || cleanNumber}
        </span>
      )}
      {copied ? (
        <span className="inline-flex items-center gap-1 text-emerald-500 font-bold text-[10px]">
          <Check size={iconSize} className="shrink-0 animate-in zoom-in-75 duration-150" />
          {showText && <span className="text-[9px] uppercase tracking-wider">Copied</span>}
        </span>
      ) : (
        <Copy
          size={iconSize}
          className="shrink-0 transition-transform group-hover:scale-110 opacity-70 group-hover:opacity-100"
        />
      )}
    </button>
  )
}

export default CopyPhoneButton
