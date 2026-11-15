import { Store } from 'lucide-react'

/** A store that does not exist, is switched off, or has not been saved yet. */
export default function StoreNotOpen() {
  return (
    <main className="min-h-screen bg-[#f4f6fa] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center bg-white rounded-2xl border border-[#e3e8f2] p-8">
        <span className="mx-auto h-14 w-14 rounded-full bg-[#eef1f6] text-[#1D5BEA] flex items-center justify-center">
          <Store size={26} />
        </span>
        <h1 className="mt-4 text-[20px] font-bold text-[#0E1B3D]">This store is not open right now</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[#4a5672]">
          The shop may be setting things up. Please check the link, or contact the shop directly.
        </p>
      </div>
    </main>
  )
}
