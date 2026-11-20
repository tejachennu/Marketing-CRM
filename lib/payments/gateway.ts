/**
 * Which online payment a business uses for its store page and bookings: its own Razorpay or its own Stripe.
 * Pure, no imports (browser-safe). The business picks one when both are connected (organizations.pay_gateway);
 * otherwise the one that is connected is used.
 */

export type Gateway = 'razorpay' | 'stripe'
export const GATEWAYS: Gateway[] = ['razorpay', 'stripe']
export const GATEWAY_NAMES: Record<Gateway, string> = { razorpay: 'Razorpay', stripe: 'Stripe' }

const has = (v: unknown) => String(v ?? '').trim().length > 0

/** The gateways whose keys are saved. */
export function connectedGateways(org: Record<string, any> | null | undefined): Gateway[] {
  const list: Gateway[] = []
  if (has(org?.store_razorpay_key_id) && has(org?.store_razorpay_key_secret)) list.push('razorpay')
  if (has(org?.stripe_secret_key)) list.push('stripe')
  return list
}

/** The gateway customers pay through: the business's pick when it is connected, else the connected one; null when none. */
export function onlineGateway(org: Record<string, any> | null | undefined): Gateway | null {
  const list = connectedGateways(org)
  const pick = org?.pay_gateway
  if (list.includes(pick)) return pick
  return list[0] || null
}

/** How customers pay through it, in plain words for the page. */
export function gatewayMethods(gateway: Gateway | null): string {
  if (gateway === 'stripe') return 'Card, Apple Pay or Google Pay'
  if (gateway === 'razorpay') return 'UPI, card or net banking'
  return ''
}
