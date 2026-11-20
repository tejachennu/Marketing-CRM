'use client'

/**
 * A Book link on the website: picks that service or person in the booking form further down the page (the
 * 'wama-book' event, read by BookingWizard) and scrolls there. Without JavaScript it is a plain link to the form
 * with ?s= / ?p=.
 */

export function BookButton({ service, person, className, children }: { service?: string; person?: string; className?: string; children: React.ReactNode }) {
  const href = `${service ? `?s=${service}` : person ? `?p=${person}` : ''}#book`
  return (
    <a href={href} className={className} onClick={(event) => {
      event.preventDefault()
      window.dispatchEvent(new CustomEvent('wama-book', { detail: { service, person } }))
      document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      history.replaceState(null, '', `${window.location.pathname}#book`)
    }}>
      {children}
    </a>
  )
}
