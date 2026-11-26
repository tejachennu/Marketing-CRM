'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { packSession, safeReturn, shopperAuth } from '@/lib/commerce/shopper-client'

/**
 * Starts Google sign-in, and finishes it when Google sends the shopper back here (?code=…). Then returns
 * to the store: on this address the session is already saved; on the store's own domain it is handed over
 * in the # part of the address, which browsers never send to a server.
 */
export function ShopperSignIn({ slug, name, colour, domain }: { slug: string; name: string; colour: string; domain: string | null }) {
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    // Once only: a second try with the same code always fails, which used to show an error after a good sign-in
    if (started.current) return
    started.current = true
    const auth = shopperAuth()
    const params = new URLSearchParams(window.location.search)
    const back = safeReturn(params.get('return'), window.location.origin, domain)
    const storeHome = back === window.location.origin ? `${back}/s/${slug}` : back
    if (!auth) {
      setError('Signing in is not available right now.')
      return
    }
    const failed = params.get('error_description') || params.get('error')
    if (failed) {
      setError(/provider is not enabled|unsupported provider/i.test(failed) ? 'Signing in with Google is not switched on yet. You can still order without signing in.' : 'Sign-in did not finish. Please try again.')
      return
    }
    const code = params.get('code')
    ;(async () => {
      if (code) {
        const exchanged = await auth.auth.exchangeCodeForSession(code)
        let session = exchanged.data?.session || null
        // The code was already used (Back pressed, or the page opened twice) but the shopper is signed in: carry on
        if (!session) session = (await auth.auth.getSession()).data.session
        if (!session) {
          setError('Sign-in did not finish. Please try again.')
          return
        }
        const data = { session }
        if (back === window.location.origin) window.location.replace(`${storeHome}?account=1`)
        else window.location.replace(`${storeHome}/?account=1#shopper=${packSession(data.session.access_token, data.session.refresh_token)}`)
        return
      }
      const here = `${window.location.origin}/s/${slug}/signin?return=${encodeURIComponent(back)}`
      const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here, queryParams: { prompt: 'select_account' } } })
      if (error) setError(/provider is not enabled|unsupported provider/i.test(error.message) ? 'Signing in with Google is not switched on yet. You can still order without signing in.' : 'Sign-in could not start. Please try again.')
    })()
  }, [slug, domain])

  return (
    <main style={{ ['--c' as any]: colour }} className="min-h-screen bg-[#f4f6fa] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#e3e8f2] p-8 text-center">
        <p className="text-[18px] font-bold text-[#0E1B3D]">{name}</p>
        {error ? (
          <>
            <p role="alert" className="mt-4 text-[14.5px] text-[#b91c1c] font-semibold">{error}</p>
            <a href={`/s/${slug}`} className="mt-6 inline-flex h-11 px-6 rounded-full bg-[var(--c)] text-white font-bold items-center">Back to the store</a>
          </>
        ) : (
          <p className="mt-4 text-[14.5px] text-[#4a5672] inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Signing you in…</p>
        )}
      </div>
    </main>
  )
}
