'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, Zap, ShieldCheck, Unlink } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'

interface WhatsAppEmbeddedSignupProps {
  organizationId: string
  isConnected: boolean
  currentWabaId?: string
  currentPhoneNumberId?: string
  currentPhoneNumber?: string
  onSuccess: (data: {
    wabaId: string
    phoneNumberId: string
    displayPhoneNumber: string
  }) => void
  onDisconnect?: () => void
}

declare global {
  interface Window {
    fbAsyncInit?: () => void
    FB?: any
  }
}

export function WhatsAppEmbeddedSignup({
  organizationId,
  isConnected,
  currentWabaId,
  currentPhoneNumberId,
  currentPhoneNumber,
  onSuccess,
  onDisconnect,
}: WhatsAppEmbeddedSignupProps) {
  const confirm = useConfirm()
  const [sdkLoaded, setSdkLoaded] = useState(false)
  const [isLaunching, setIsLaunching] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  // Something the owner still has to sort out after a successful connection
  const [notice, setNotice] = useState<string | null>(null)

  const capturedDataRef = useRef<{ wabaId?: string; phoneNumberId?: string; businessId?: string; catalogIds?: string[] }>({})
  // The error Meta reported inside its window, shown if the window then closes without connecting
  const signupErrorRef = useRef<string | null>(null)

  const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162'
  const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || '1797596798044163'
  // Embedded Signup v4 takes its whole setup from the Facebook Login for Business configuration,
  // and Meta documents that `extras` must then be empty. A configuration made for v2 or v3
  // (NEXT_PUBLIC_META_ES_VERSION=v2) needs the older fields instead.
  const legacySignup = ['v2', 'v3'].includes(process.env.NEXT_PUBLIC_META_ES_VERSION || '')
  const SIGNUP_EXTRAS = legacySignup ? { setup: {}, featureType: '', sessionInfoVersion: '3' } : {}

  // Load and initialize Facebook JavaScript SDK
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.FB) {
      setSdkLoaded(true)
      return
    }

    window.fbAsyncInit = function () {
      window.FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v25.0',
      })
      setSdkLoaded(true)
    }

    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script')
      js.id = 'facebook-jssdk'
      js.src = 'https://connect.facebook.net/en_US/sdk.js'
      js.async = true
      js.defer = true
      js.onload = () => {
        if (window.FB) setSdkLoaded(true)
      }
      document.body.appendChild(js)
    }
  }, [META_APP_ID])

  // Listen for Meta's WA_EMBEDDED_SIGNUP postMessage events
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleMessage = (event: MessageEvent) => {
      // Only messages from Meta's own pages (www, web, business, ...) are read
      let host = ''
      try {
        const origin = new URL(event.origin)
        host = origin.protocol === 'https:' ? origin.hostname : ''
      } catch {
        return
      }
      if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          console.log('[Meta Embedded Signup] PostMessage Event:', data)
          // FINISH, FINISH_ONLY_WABA, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, ...: the flow completed
          if (typeof data.event === 'string' && data.event.startsWith('FINISH') && data.data) {
            const { phone_number_id, waba_id, business_id, catalog_ids } = data.data
            capturedDataRef.current = {
              phoneNumberId: phone_number_id,
              wabaId: waba_id,
              businessId: business_id,
              // Present only when the customer chose to share catalogs
              catalogIds: Array.isArray(catalog_ids) ? catalog_ids : undefined,
            }
          } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
            // An error the customer hit in Meta's window comes as CANCEL with an error_message
            const { current_step, error_message, error_code, session_id } = data.data || {}
            if (error_message) {
              console.error('[Meta Embedded Signup] Error in Meta window:', { error_message, error_code, session_id })
              signupErrorRef.current = `${error_message}${session_id ? ` (Meta session ID: ${session_id})` : ''}`
            } else {
              console.log('[Meta Embedded Signup] User cancelled at step:', current_step)
            }
          }
        }
      } catch {
        // Ignore unparseable non-Meta window messages
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  /** Waits until Meta has reported the finished sign-up's IDs, or up to `timeoutMs`. */
  const waitForSignupSession = async (timeoutMs = 4000) => {
    const startedAt = Date.now()
    while (!capturedDataRef.current.wabaId && !signupErrorRef.current && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const handleLaunchSignup = () => {
    // Facebook only opens its login window from https pages; on http FB.login does nothing
    if (window.location.protocol !== 'https:') {
      setError('Meta sign-up only works over https. Locally, run "npm run dev:https" and open https://localhost:3000.')
      return
    }
    if (!window.FB) {
      setError('Facebook SDK is still loading. Please wait 2 seconds and try again.')
      return
    }

    setError(null)
    setSuccessMessage(null)
    setNotice(null)
    setIsLaunching(true)
    capturedDataRef.current = {}
    signupErrorRef.current = null

    try {
      window.FB.login(
        function (response: any) {
          console.log('[Meta Embedded Signup] FB.login response:', response)

          if (response?.authResponse) {
            const code = response.authResponse.code
            const directAccessToken = response.authResponse.accessToken

            setIsLaunching(false)
            setIsProcessing(true)

            // Meta's "finished" message, which carries the account and number IDs, can arrive after this
            // callback. The code stays valid for 30 seconds, so waiting a few for it is safe.
            waitForSignupSession()
              .then(() => fetch('/api/whatsapp/embedded-signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: code || undefined,
                  accessToken: directAccessToken || undefined,
                  wabaId: capturedDataRef.current.wabaId,
                  phoneNumberId: capturedDataRef.current.phoneNumberId,
                  businessId: capturedDataRef.current.businessId,
                  catalogIds: capturedDataRef.current.catalogIds,
                  organizationId,
                }),
              }))
              .then((res) => res.json().then((result) => ({ res, result })))
              .then(({ res, result }) => {
                if (!res.ok || !result.success) {
                  throw new Error(result.error || 'Failed to complete WhatsApp onboarding with Meta.')
                }

                setSuccessMessage(
                  'WhatsApp is connected. Before this number can message customers, add a payment method in WhatsApp Manager (Overview → Add payment method).'
                )
                if (result.data?.webhook && result.data.webhook.routed === false) {
                  setNotice(`Messages customers send to this number will not arrive here yet. ${result.data.webhook.reason || ''}`.trim())
                }

                onSuccess({
                  wabaId: result.data.wabaId,
                  phoneNumberId: result.data.phoneNumberId,
                  displayPhoneNumber: result.data.displayPhoneNumber,
                })
              })
              .catch((apiErr: any) => {
                console.error('[Meta Embedded Signup] API error:', apiErr)
                setError(apiErr.message || 'Failed to save Meta WhatsApp credentials')
              })
              .finally(() => {
                setIsProcessing(false)
              })
          } else {
            setIsLaunching(false)
            if (signupErrorRef.current) {
              setError(`Meta could not finish the sign-up: ${signupErrorRef.current}`)
            } else if (response?.status === 'not_authorized') {
              setError('Authorization was not completed in Meta dialog.')
            }
          }
        },
        {
          config_id: META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: SIGNUP_EXTRAS,
        }
      )
    } catch (err: any) {
      console.error('[Meta Embedded Signup] Launch error:', err)
      setIsLaunching(false)
      setError(err?.message || 'Could not launch Meta popup. Please check your browser popup blocker.')
    }
  }

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect WhatsApp?',
      message: 'This WhatsApp Business Account will stop sending and receiving messages in the CRM.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (!confirmed) return

    setError(null)
    setSuccessMessage(null)
    setNotice(null)
    setIsDisconnecting(true)

    try {
      const res = await fetch(`/api/whatsapp/embedded-signup?organizationId=${organizationId}`, {
        method: 'DELETE',
      })
      const result = await res.json()

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to disconnect WhatsApp Business Account.')
      }

      setSuccessMessage('WhatsApp Business Account disconnected successfully.')
      if (onDisconnect) {
        onDisconnect()
      }
    } catch (err: any) {
      console.error('[Meta Embedded Signup] Disconnect error:', err)
      setError(err?.message || 'Failed to disconnect WhatsApp')
    } finally {
      setIsDisconnecting(false)
    }
  }

  const isLoading = isLaunching || isProcessing

  return (
    <div className="bg-gradient-to-br from-[#00a884]/5 via-transparent to-blue-500/5 dark:from-[#00a884]/10 dark:to-blue-500/10 border border-[#00a884]/30 dark:border-[#00a884]/20 rounded-xl p-4 sm:p-5 mb-4 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#00a884] text-white">
              <Zap size={14} className="fill-current" />
            </span>
            <h4 className="text-xs font-bold text-[#111b21] dark:text-white uppercase tracking-wider">
              1-Click Meta Embedded Sign-Up
            </h4>
            {isConnected && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <ShieldCheck size={11} /> Connected
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#667781] dark:text-[#8696a0] max-w-xl leading-relaxed">
            Connect your WhatsApp Business Account directly with Meta in seconds. Meta handles phone verification, WABA creation, and webhook routing automatically.
          </p>

        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {isConnected && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isLoading || isDisconnecting}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer border border-red-200 dark:border-red-900/50 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/60 text-red-600 dark:text-red-400 disabled:opacity-60"
            >
              {isDisconnecting ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
              <span>Disconnect</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleLaunchSignup}
            disabled={isLoading || isDisconnecting}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer ${
              isConnected
                ? 'bg-white dark:bg-[#1f2c34] hover:bg-gray-50 dark:hover:bg-[#2a3942] text-[#111b21] dark:text-white border border-[#e9edef] dark:border-[#2a3942]'
                : 'bg-[#00a884] hover:bg-[#008f6f] text-white shadow-[#00a884]/20 shadow-md'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>{isLaunching ? 'Waiting for Meta...' : 'Connecting Account...'}</span>
              </>
            ) : isConnected ? (
              <>
                <RefreshCw size={13} />
                <span>Reconnect WhatsApp</span>
              </>
            ) : (
              <>
                <Zap size={14} className="fill-current" />
                <span>Connect WhatsApp with Meta</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Success notification */}
      {successMessage && (
        <div className="mt-3.5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-medium">{successMessage}</span>
        </div>
      )}

      {notice && (
        <div role="alert" className="mt-3.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 text-xs flex items-start gap-2">
          <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* Error notification */}
      {error && (
        <div className="mt-3.5 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-start gap-2 animate-in fade-in duration-200">
          <AlertCircle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Failed to connect:</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Connected Account Quick Summary */}
      {isConnected && (currentWabaId || currentPhoneNumberId || currentPhoneNumber) && (
        <div className="mt-3 pt-3 border-t border-[#00a884]/15 dark:border-[#00a884]/10 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
          {currentPhoneNumber && (
            <div className="bg-white/60 dark:bg-[#111b21]/60 px-2.5 py-1.5 rounded border border-[#e9edef] dark:border-[#2a3942]">
              <span className="text-[#667781] dark:text-[#8696a0] block text-[10px] uppercase font-bold">Sender Number</span>
              <span className="font-semibold text-[#111b21] dark:text-white font-mono">{currentPhoneNumber}</span>
            </div>
          )}
          {currentPhoneNumberId && (
            <div className="bg-white/60 dark:bg-[#111b21]/60 px-2.5 py-1.5 rounded border border-[#e9edef] dark:border-[#2a3942]">
              <span className="text-[#667781] dark:text-[#8696a0] block text-[10px] uppercase font-bold">Phone Number ID</span>
              <span className="font-mono text-[#111b21] dark:text-white truncate block">{currentPhoneNumberId}</span>
            </div>
          )}
          {currentWabaId && (
            <div className="bg-white/60 dark:bg-[#111b21]/60 px-2.5 py-1.5 rounded border border-[#e9edef] dark:border-[#2a3942]">
              <span className="text-[#667781] dark:text-[#8696a0] block text-[10px] uppercase font-bold">WABA ID</span>
              <span className="font-mono text-[#111b21] dark:text-white truncate block">{currentWabaId}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
