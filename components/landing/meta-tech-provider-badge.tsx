import { BadgeCheck } from 'lucide-react'

/**
 * "Official Meta Tech Provider" credential. Text and a generic verified mark only: Meta's own logo
 * is a trademark and is not used here.
 */
export function MetaTechProviderBadge({
  variant = 'light',
  size = 'md',
  className = '',
}: {
  /** light: on white or pale sections. dark: on the deep green bars and footer. */
  variant?: 'light' | 'dark'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dark = variant === 'dark'
  const sizes = {
    sm: { wrap: 'gap-1.5 pl-1 pr-2.5 py-1', icon: 'h-5 w-5', iconSize: 12, top: 'text-[8px]', main: 'text-[11px]' },
    md: { wrap: 'gap-2 pl-1.5 pr-3.5 py-1.5', icon: 'h-7 w-7', iconSize: 15, top: 'text-[9px]', main: 'text-[13px]' },
    lg: { wrap: 'gap-3 pl-2 pr-5 py-2', icon: 'h-10 w-10', iconSize: 21, top: 'text-[10px]', main: 'text-base' },
  }[size]

  return (
    <span
      className={`inline-flex items-center rounded-full border ${sizes.wrap} ${
        dark
          ? 'bg-white/[0.06] border-white/15 text-white'
          : 'bg-white border-[#d6e4ff] text-[#0c2014] shadow-[0_6px_20px_-10px_rgba(8,102,255,0.45)]'
      } ${className}`}
    >
      <span className={`${sizes.icon} shrink-0 rounded-full bg-gradient-to-br from-[#1877F2] to-[#0866FF] flex items-center justify-center text-white shadow-[inset_0_-2px_4px_rgba(0,0,0,0.15)]`}>
        <BadgeCheck size={sizes.iconSize} strokeWidth={2.4} />
      </span>
      <span className="flex flex-col leading-none text-left">
        <span className={`${sizes.top} font-bold uppercase tracking-[0.14em] ${dark ? 'text-[#8fb8ff]' : 'text-[#0866FF]'}`}>
          Official
        </span>
        <span className={`${sizes.main} font-extrabold tracking-tight mt-0.5 whitespace-nowrap`}>
          Meta Tech Provider
        </span>
      </span>
    </span>
  )
}
