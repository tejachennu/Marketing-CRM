import { useId } from 'react'

/** The WAMA CRM mark: a WhatsApp chat bubble whose W climbs into a growth arrow. */
export function WamaMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="-6 0 412 400" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`wama-${id}`} gradientUnits="userSpaceOnUse" x1="60" y1="40" x2="350" y2="360">
          <stop offset="0" stopColor="#25D366" />
          <stop offset="0.55" stopColor="#00A884" />
          <stop offset="1" stopColor="#1D5BEA" />
        </linearGradient>
      </defs>
      <path fill={`url(#wama-${id})`} d="M200 28 C302 28 380 102 380 196 C380 290 302 364 200 364 C171 364 144 358 120 347 L48 372 L70 304 C42 274 20 238 20 196 C20 102 98 28 200 28 Z" />
      <path d="M94 150 L142 262 L198 178 L250 262 L300 140" fill="none" stroke="#FFFFFF" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
      <path fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="6" strokeLinejoin="round" d="M323.5 82.6 L331.4 150.6 L270.2 125.6 Z" />
    </svg>
  )
}

/** Mark and wordmark. `tone="light"` is for dark backgrounds. */
export function WamaLogo({ size = 36, tone = 'dark', className = '' }: { size?: number; tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <WamaMark size={size} />
      <span className={`font-extrabold tracking-tight leading-none ${tone === 'light' ? 'text-white' : 'text-[#0E1B3D] dark:text-white'}`} style={{ fontSize: size * 0.62 }}>
        WAMA <span className={tone === 'light' ? 'text-[#7CF0A8]' : 'text-[#1D5BEA] dark:text-[#7CF0A8]'}>CRM</span>
      </span>
    </span>
  )
}
