'use client'

import { ErrorScreen } from '@/components/errors/error-screen'

/** A dashboard page that broke while loading: a plain message with Try again (the menu stays). */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} home="/dashboard" homeLabel="Open the dashboard" />
}
