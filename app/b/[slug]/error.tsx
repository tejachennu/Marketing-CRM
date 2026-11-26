'use client'

import { ErrorScreen } from '@/components/errors/error-screen'

/** A business's page that broke while loading: a plain message with Try again, never the bare browser error. */
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="min-h-screen bg-[#f4f6fa]"><ErrorScreen error={error} reset={reset} /></div>
}
