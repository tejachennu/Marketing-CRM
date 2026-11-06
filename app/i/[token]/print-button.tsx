'use client'

import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[15px] font-bold cursor-pointer">
      <Printer size={18} /> Print / Save as PDF
    </button>
  )
}
