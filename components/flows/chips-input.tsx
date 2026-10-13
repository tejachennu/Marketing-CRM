'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * Edit a list of short values (keywords, tags) as chips.
 * Type and press Enter or comma to add; Backspace on an empty field removes the last one.
 * A plain comma-separated text box cannot do this: re-rendering it from the parsed list
 * swallows the comma the moment it is typed.
 */
export function ChipsInput({
  values,
  onChange,
  placeholder = 'Type and press Enter',
  ariaLabel,
  maxItems = 20,
  maxLength = 50,
  disabled = false,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  ariaLabel: string
  maxItems?: number
  maxLength?: number
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const existing = new Set(values.map((value) => value.toLowerCase()))
    const next = [...values]
    for (const part of raw.split(',')) {
      const value = part.trim().slice(0, maxLength)
      if (!value || existing.has(value.toLowerCase()) || next.length >= maxItems) continue
      existing.add(value.toLowerCase())
      next.push(value)
    }
    if (next.length !== values.length) onChange(next)
    setDraft('')
  }

  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium"
        >
          <span className="truncate">{value}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="p-0.5 rounded hover:bg-emerald-500/20 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        value={draft}
        disabled={disabled || values.length >= maxItems}
        aria-label={ariaLabel}
        placeholder={values.length >= maxItems ? `Up to ${maxItems}` : values.length ? '' : placeholder}
        onChange={(event) => {
          // A pasted or typed comma commits everything before it
          if (event.target.value.includes(',')) add(event.target.value)
          else setDraft(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add(draft)
          } else if (event.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1))
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        className="flex-1 min-w-[90px] py-0.5 bg-transparent text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
      />
    </div>
  )
}
