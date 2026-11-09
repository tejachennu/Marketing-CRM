'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { COUNTRIES, type Country } from './country-phone-input'

const INDIA = COUNTRIES[0]
const BY_LONGEST_CODE = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length)

/** Split a saved number (+971501234567, or 98765 43210 typed earlier) into its country and the rest. */
export function splitPhone(value: string | null | undefined, fallback: Country = INDIA): { country: Country; local: string } {
  const raw = String(value || '').trim().replace(/^whatsapp:/, '')
  if (raw.startsWith('+')) {
    const digits = `+${raw.replace(/\D/g, '')}`
    const match = BY_LONGEST_CODE.find((c) => digits.startsWith(c.dialCode))
    if (match) return { country: match, local: digits.slice(match.dialCode.length) }
  }
  return { country: fallback, local: raw.replace(/[^\d\s-]/g, '') }
}

/** The full number to save: +<country code><digits>, or '' when nothing is typed. */
export function joinPhone(country: Country, local: string): string {
  const digits = local.replace(/\D/g, '').replace(/^0+/, '')
  return digits ? `${country.dialCode}${digits}` : ''
}

/**
 * A mobile number with its country code: a small country picker (India first) and the number.
 * Typing or pasting a number that starts with + picks its country on its own.
 */
export function PhoneField({ value, onChange, inputClassName, placeholder, ariaLabel = 'Mobile number', autoFocus, disabled, id }: {
  value: string | null | undefined
  onChange: (full: string) => void
  /** Classes for the number box (the screen's own input style). */
  inputClassName: string
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
  disabled?: boolean
  id?: string
}) {
  const [{ country, local }, setParts] = useState(() => splitPhone(value))
  const emitted = useRef(joinPhone(country, local))

  // A new value from outside (a picked contact, a cleared form): show it
  useEffect(() => {
    const next = String(value || '')
    if (next === emitted.current) return
    const parts = splitPhone(next, country)
    emitted.current = joinPhone(parts.country, parts.local)
    setParts(parts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function update(nextCountry: Country, nextLocal: string) {
    let parts = { country: nextCountry, local: nextLocal }
    if (nextLocal.trim().startsWith('+')) parts = splitPhone(nextLocal, nextCountry)
    setParts(parts)
    emitted.current = joinPhone(parts.country, parts.local)
    onChange(emitted.current)
  }

  return (
    <span className="flex min-w-0 gap-2">
      {/* The closed picker shows only the flag and code; the real (native) list opens on tap */}
      <span className={`${inputClassName} relative w-[96px] shrink-0 flex items-center gap-1 pl-2.5 pr-7 focus-within:border-[#1D5BEA] focus-within:ring-2 focus-within:ring-[#1D5BEA]/20`}>
        <span aria-hidden className="text-[17px] leading-none">{country.flag}</span>
        <span aria-hidden className="font-semibold tabular-nums">{country.dialCode}</span>
        <ChevronDown size={15} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
        <select value={country.code} disabled={disabled} aria-label={`Country code, ${country.name} ${country.dialCode}`}
          onChange={(e) => update(COUNTRIES.find((c) => c.code === e.target.value) || INDIA, local)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed">
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name} ({c.dialCode})</option>)}
        </select>
      </span>
      <input id={id} className={`${inputClassName} min-w-0 flex-1`} value={local} inputMode="tel" autoComplete="off" autoFocus={autoFocus} disabled={disabled}
        aria-label={ariaLabel} placeholder={placeholder || country.format || '98765 43210'}
        onChange={(e) => update(country, e.target.value.replace(/[^\d\s+()-]/g, ''))} />
    </span>
  )
}
