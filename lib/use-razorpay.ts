'use client'

/** Load Razorpay Checkout once and open it; resolves with Checkout's response, or null when closed. */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if ((window as any).Razorpay) return Promise.resolve(true)
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-razorpay-checkout]') as HTMLScriptElement | null
    const script = existing || document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.razorpayCheckout = 'true'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    if (!existing) document.body.appendChild(script)
  })
}

export async function openRazorpay(options: Record<string, any>): Promise<Record<string, string> | null> {
  if (!(await loadRazorpay())) throw new Error('The payment window could not be loaded. Check your internet connection and try again.')
  return new Promise((resolve) => {
    const checkout = new (window as any).Razorpay({
      ...options,
      theme: { color: '#1D5BEA' },
      handler: (response: Record<string, string>) => resolve(response),
      modal: { ondismiss: () => resolve(null) },
    })
    // A failed attempt keeps the window open so the customer can try again; it is reported, not fatal
    checkout.on('payment.failed', (response: any) => options.onFailure?.(response?.error?.description || 'The payment failed. No money was taken.'))
    checkout.open()
  })
}
