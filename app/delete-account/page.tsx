import Link from 'next/link'
import { DELETION_SUPPORT_EMAIL } from '@/lib/account-deletion'

export const metadata = {
  title: 'Delete your account | WAMA by Magnetora AI',
  description: 'How to ask for your WAMA CRM account and data to be deleted, from the app or by email.',
}

// The page Google Play links to: how to ask for an account to be deleted without the app installed.
export default function DeleteAccountPage() {
  const mail = `mailto:${DELETION_SUPPORT_EMAIL}?subject=${encodeURIComponent('Delete my account')}&body=${encodeURIComponent('Please delete my account.\n\nAccount email: \nBusiness name: ')}`
  return (
    <main className="min-h-screen bg-[#f4f6fa] px-4 py-10 text-[#4a5672] sm:py-16">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="rounded-2xl border border-[#e3e8f2] bg-white p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#1D5BEA]">Your account</p>
          <h1 className="mt-2 text-2xl font-bold text-[#0E1B3D] sm:text-3xl">Delete your account</h1>
          <p className="mt-3 leading-relaxed">
            You can ask us to delete your WAMA CRM account at any time. Our team checks that the request came from
            you, then deletes it and emails you when it is done.
          </p>
        </header>

        <section className="rounded-2xl border border-[#e3e8f2] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-bold text-[#0E1B3D]">Ask from the app</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-relaxed">
            <li>Open the WAMA CRM app and sign in.</li>
            <li>Go to <strong className="text-[#0E1B3D]">More</strong>, then <strong className="text-[#0E1B3D]">Delete my account</strong>.</li>
            <li>Tap <strong className="text-[#0E1B3D]">Send request</strong>. We email you a copy.</li>
          </ol>
        </section>

        <section className="rounded-2xl border border-[#e3e8f2] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-bold text-[#0E1B3D]">Ask by email</h2>
          <p className="mt-3 leading-relaxed">
            No app? Email us from the address you sign in with, and tell us your business name.
          </p>
          <a
            href={mail}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[#1D5BEA] px-4 py-2.5 font-semibold text-white hover:bg-[#174bc4]"
          >
            Email {DELETION_SUPPORT_EMAIL}
          </a>
        </section>

        <section className="rounded-2xl border border-[#e3e8f2] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-bold text-[#0E1B3D]">What is deleted</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">
            <li>
              <strong className="text-[#0E1B3D]">Business owners and admins:</strong> your login and the whole workspace,
              including customers, chats, bookings, bills, orders, products and settings, for everyone on your team.
            </li>
            <li>
              <strong className="text-[#0E1B3D]">Staff:</strong> only your own login. The business keeps its workspace.
            </li>
            <li>Some records, like bills and payments, may be kept for as long as the law requires, and then deleted.</li>
          </ul>
        </section>

        <p className="text-center text-sm">
          <Link href="/privacy" className="font-semibold text-[#1D5BEA] hover:text-[#174bc4]">Privacy Policy</Link>
          <span className="mx-2 text-[#8a94a8]">·</span>
          <Link href="/terms" className="font-semibold text-[#1D5BEA] hover:text-[#174bc4]">Terms</Link>
        </p>
      </div>
    </main>
  )
}
