'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

export interface Country {
  name: string
  code: string // ISO 3166-1 alpha-2
  dialCode: string // e.g. "+91"
  flag: string // Flag emoji
  format?: string
}

export const COUNTRIES: Country[] = [
  // Frequently used / Top countries
  { name: 'India', code: 'IN', dialCode: '+91', flag: '🇮🇳', format: '98765 43210' },
  { name: 'United States', code: 'US', dialCode: '+1', flag: '🇺🇸', format: '(555) 000-0000' },
  { name: 'United Kingdom', code: 'GB', dialCode: '+44', flag: '🇬🇧', format: '7911 123456' },
  { name: 'United Arab Emirates', code: 'AE', dialCode: '+971', flag: '🇦🇪', format: '50 123 4567' },
  { name: 'Saudi Arabia', code: 'SA', dialCode: '+966', flag: '🇸🇦', format: '50 123 4567' },
  { name: 'Canada', code: 'CA', dialCode: '+1', flag: '🇨🇦', format: '(555) 000-0000' },
  { name: 'Australia', code: 'AU', dialCode: '+61', flag: '🇦🇺', format: '412 345 678' },
  { name: 'Singapore', code: 'SG', dialCode: '+65', flag: '🇸🇬', format: '8123 4567' },
  { name: 'Qatar', code: 'QA', dialCode: '+974', flag: '🇶🇦', format: '3312 3456' },
  { name: 'Kuwait', code: 'KW', dialCode: '+965', flag: '🇰🇼', format: '5123 4567' },
  { name: 'Oman', code: 'OM', dialCode: '+968', flag: '🇴🇲', format: '9123 4567' },
  { name: 'Bahrain', code: 'BH', dialCode: '+973', flag: '🇧🇭', format: '3600 1234' },
  { name: 'Germany', code: 'DE', dialCode: '+49', flag: '🇩🇪', format: '151 1234567' },
  { name: 'France', code: 'FR', dialCode: '+33', flag: '🇫🇷', format: '6 12 34 56 78' },
  { name: 'Malaysia', code: 'MY', dialCode: '+60', flag: '🇲🇾', format: '12-345 6789' },
  { name: 'Indonesia', code: 'ID', dialCode: '+62', flag: '🇮🇩', format: '812-3456-7890' },
  { name: 'Philippines', code: 'PH', dialCode: '+63', flag: '🇵🇭', format: '917 123 4567' },
  { name: 'South Africa', code: 'ZA', dialCode: '+27', flag: '🇿🇦', format: '71 123 4567' },
  { name: 'Nigeria', code: 'NG', dialCode: '+234', flag: '🇳🇬', format: '802 123 4567' },
  { name: 'Kenya', code: 'KE', dialCode: '+254', flag: '🇰🇪', format: '712 345678' },
  { name: 'Bangladesh', code: 'BD', dialCode: '+880', flag: '🇧🇩', format: '1712-345678' },
  { name: 'Pakistan', code: 'PK', dialCode: '+92', flag: '🇵🇰', format: '301 2345678' },
  { name: 'Sri Lanka', code: 'LK', dialCode: '+94', flag: '🇱🇰', format: '71 234 5678' },
  { name: 'Nepal', code: 'NP', dialCode: '+977', flag: '🇳🇵', format: '984-1234567' },
  { name: 'New Zealand', code: 'NZ', dialCode: '+64', flag: '🇳🇿', format: '21 123 4567' },
  { name: 'Ireland', code: 'IE', dialCode: '+353', flag: '🇮🇪', format: '85 123 4567' },
  { name: 'Netherlands', code: 'NL', dialCode: '+31', flag: '🇳🇱', format: '6 12345678' },
  { name: 'Italy', code: 'IT', dialCode: '+39', flag: '🇮🇹', format: '312 345 6789' },
  { name: 'Spain', code: 'ES', dialCode: '+34', flag: '🇪🇸', format: '612 34 56 78' },
  { name: 'Switzerland', code: 'CH', dialCode: '+41', flag: '🇨🇭', format: '78 123 45 67' },
  { name: 'Sweden', code: 'SE', dialCode: '+46', flag: '🇸🇪', format: '70 123 45 67' },
  { name: 'Norway', code: 'NO', dialCode: '+47', flag: '🇳🇴', format: '412 34 567' },
  { name: 'Denmark', code: 'DK', dialCode: '+45', flag: '🇩🇰', format: '20 12 34 56' },
  { name: 'Finland', code: 'FI', dialCode: '+358', flag: '🇫🇮', format: '40 1234567' },
  { name: 'Belgium', code: 'BE', dialCode: '+32', flag: '🇧🇪', format: '470 12 34 56' },
  { name: 'Austria', code: 'AT', dialCode: '+43', flag: '🇦🇹', format: '664 1234567' },
  { name: 'Portugal', code: 'PT', dialCode: '+351', flag: '🇵🇹', format: '912 345 678' },
  { name: 'Poland', code: 'PL', dialCode: '+48', flag: '🇵🇱', format: '512 345 678' },
  { name: 'Greece', code: 'GR', dialCode: '+30', flag: '🇬🇷', format: '691 234 5678' },
  { name: 'Turkey', code: 'TR', dialCode: '+90', flag: '🇹🇷', format: '501 234 56 78' },
  { name: 'Egypt', code: 'EG', dialCode: '+20', flag: '🇪🇬', format: '100 123 4567' },
  { name: 'Israel', code: 'IL', dialCode: '+972', flag: '🇮🇱', format: '50-123-4567' },
  { name: 'Japan', code: 'JP', dialCode: '+81', flag: '🇯🇵', format: '90-1234-5678' },
  { name: 'South Korea', code: 'KR', dialCode: '+82', flag: '🇰🇷', format: '10-1234-5678' },
  { name: 'China', code: 'CN', dialCode: '+86', flag: '🇨🇳', format: '138 0013 8000' },
  { name: 'Hong Kong', code: 'HK', dialCode: '+852', flag: '🇭🇰', format: '9123 4567' },
  { name: 'Taiwan', code: 'TW', dialCode: '+886', flag: '🇹🇼', format: '912 345 678' },
  { name: 'Thailand', code: 'TH', dialCode: '+66', flag: '🇹🇭', format: '81 234 5678' },
  { name: 'Vietnam', code: 'VN', dialCode: '+84', flag: '🇻🇳', format: '91 234 56 78' },
  { name: 'Brazil', code: 'BR', dialCode: '+55', flag: '🇧🇷', format: '(11) 91234-5678' },
  { name: 'Mexico', code: 'MX', dialCode: '+52', flag: '🇲🇽', format: '55 1234 5678' },
  { name: 'Argentina', code: 'AR', dialCode: '+54', flag: '🇦🇷', format: '9 11 1234-5678' },
  { name: 'Colombia', code: 'CO', dialCode: '+57', flag: '🇨🇴', format: '300 123 4567' },
  { name: 'Chile', code: 'CL', dialCode: '+56', flag: '🇨🇱', format: '9 1234 5678' },
  { name: 'Peru', code: 'PE', dialCode: '+51', flag: '🇵🇪', format: '912 345 678' },
  { name: 'Russia', code: 'RU', dialCode: '+7', flag: '🇷🇺', format: '912 345-67-89' },
  { name: 'Ukraine', code: 'UA', dialCode: '+380', flag: '🇺🇦', format: '50 123 4567' },
]

export interface CountryPhoneInputProps {
  value: string // Complete E.164 phone string e.g. "+919876543210" or raw
  onChange: (fullValue: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  id?: string
  className?: string
  defaultCountryCode?: string // default "IN"
}

export function CountryPhoneInput({
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  id,
  className = '',
  defaultCountryCode = 'IN',
}: CountryPhoneInputProps) {
  // Find default country (India by default)
  const initialCountry = useMemo(() => {
    return COUNTRIES.find((c) => c.code === defaultCountryCode) || COUNTRIES[0]
  }, [defaultCountryCode])

  const [selectedCountry, setSelectedCountry] = useState<Country>(initialCountry)
  const [phoneNumber, setPhoneNumber] = useState<string>('')
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const phoneInputRef = useRef<HTMLInputElement>(null)

  // Parse incoming value on mount or when value changes externally
  useEffect(() => {
    if (!value) {
      setPhoneNumber('')
      return
    }

    const cleaned = value.trim()
    if (cleaned.startsWith('+')) {
      // Find matching country by longest dial code prefix
      const matchingCountry = [...COUNTRIES]
        .sort((a, b) => b.dialCode.length - a.dialCode.length)
        .find((c) => cleaned.startsWith(c.dialCode))

      if (matchingCountry) {
        setSelectedCountry(matchingCountry)
        setPhoneNumber(cleaned.slice(matchingCountry.dialCode.length).trim())
        return
      }
    }

    // If starts with country code without plus (e.g. 919876543210)
    if (cleaned.startsWith(selectedCountry.dialCode.replace('+', '')) && cleaned.length > 10) {
      const dialNoPlus = selectedCountry.dialCode.replace('+', '')
      setPhoneNumber(cleaned.slice(dialNoPlus.length).trim())
      return
    }

    setPhoneNumber(cleaned)
  }, [value, selectedCountry.dialCode])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
  }, [isDropdownOpen])

  // Filter countries by query (name, code, dial code)
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return COUNTRIES
    const q = searchQuery.toLowerCase().trim().replace(/^\+/, '')
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dialCode.replace('+', '').includes(q)
    )
  }, [searchQuery])

  // Handle phone number typing
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let inputVal = e.target.value

    // If user typed/pasted a '+' or international prefix
    if (inputVal.startsWith('+')) {
      const match = [...COUNTRIES]
        .sort((a, b) => b.dialCode.length - a.dialCode.length)
        .find((c) => inputVal.startsWith(c.dialCode))

      if (match) {
        setSelectedCountry(match)
        inputVal = inputVal.slice(match.dialCode.length)
      }
    }

    // Clean out non-digits except spaces/hyphens for readability
    const sanitizedDigits = inputVal.replace(/[^\d\s-]/g, '')
    setPhoneNumber(sanitizedDigits)

    const rawDigitsOnly = sanitizedDigits.replace(/\D/g, '')
    if (rawDigitsOnly) {
      onChange(`${selectedCountry.dialCode}${rawDigitsOnly}`)
    } else {
      onChange('')
    }
  }

  // Handle country selection
  const handleSelectCountry = (country: Country) => {
    setSelectedCountry(country)
    setIsDropdownOpen(false)
    setSearchQuery('')

    const rawDigitsOnly = phoneNumber.replace(/\D/g, '')
    if (rawDigitsOnly) {
      onChange(`${country.dialCode}${rawDigitsOnly}`)
    }

    setTimeout(() => {
      phoneInputRef.current?.focus()
    }, 50)
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center rounded-xl border border-slate-200 dark:border-[#2a3942] bg-white dark:bg-[#111b21] shadow-2xs hover:border-slate-350 dark:hover:border-slate-700 focus-within:border-[#00a884] focus-within:ring-2 focus-within:ring-[#00a884]/20 transition-all overflow-visible">
        {/* Country Code Trigger Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-50 dark:bg-[#1a2329] hover:bg-slate-100 dark:hover:bg-[#202d36] text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-[#2a3942] rounded-l-xl transition-colors cursor-pointer select-none shrink-0"
          title={`Selected: ${selectedCountry.name} (${selectedCountry.dialCode})`}
        >
          <span className="text-lg leading-none select-none">{selectedCountry.flag}</span>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {selectedCountry.dialCode}
          </span>
          <ChevronDown
            size={13}
            className={`text-slate-400 dark:text-slate-400 transition-transform duration-200 ${
              isDropdownOpen ? 'rotate-180 text-[#00a884]' : ''
            }`}
          />
        </button>

        {/* Local Phone Number Input */}
        <input
          ref={phoneInputRef}
          id={id}
          type="tel"
          disabled={disabled}
          required={required}
          value={phoneNumber}
          onChange={handlePhoneChange}
          placeholder={placeholder || selectedCountry.format || '98765 43210'}
          className="w-full px-3.5 py-2.5 bg-transparent text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden rounded-r-xl"
        />
      </div>

      {/* Searchable Country Selector Dropdown Popover */}
      {isDropdownOpen && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-72 sm:w-80 bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-200 dark:border-[#2a3942] shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Search Header */}
          <div className="p-2.5 border-b border-slate-100 dark:border-[#2a3942] bg-slate-50/70 dark:bg-[#121b22]/80">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search country or code (e.g. India, 91)..."
                className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:border-[#00a884] focus:outline-hidden transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Country List */}
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-[#2a3942]/60 scrollbar-thin">
            {filteredCountries.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No matching country found
              </div>
            ) : (
              filteredCountries.map((country) => {
                const isSelected = selectedCountry.code === country.code
                return (
                  <button
                    key={country.code}
                    type="button"
                    onClick={() => handleSelectCountry(country)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-[#008069] dark:text-emerald-400 font-bold'
                        : 'hover:bg-slate-50 dark:hover:bg-[#2a3942]/50 text-slate-800 dark:text-slate-200 font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-base shrink-0 leading-none">{country.flag}</span>
                      <span className="truncate">{country.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({country.code})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                        {country.dialCode}
                      </span>
                      {isSelected && <Check size={14} className="text-[#008069] dark:text-emerald-400" />}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
