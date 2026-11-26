'use client'

import { ErrorScreen } from '@/components/errors/error-screen'

/** Anything that breaks outside the pages' own error screens (the whole app's last safety net). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f4f6fa', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        <ErrorScreen error={error} reset={reset} home="/" />
      </body>
    </html>
  )
}
