/**
 * Shiprocket, with the business's OWN account (an "API user": Shiprocket → Settings → API → Configure →
 * Create API user, with an email that is not the main login). Endpoints and fields from Shiprocket's
 * official API docs (apidocs.shiprocket.in, read 17 Nov 2026):
 *   login       POST /v1/external/auth/login {email, password} → token (JWT, valid 10 days, "Bearer")
 *   rates       GET  /v1/external/courier/serviceability/?pickup_postcode&delivery_postcode&weight&cod&declared_value
 *   order       POST /v1/external/orders/create/adhoc → order_id, shipment_id
 *   AWB         POST /v1/external/courier/assign/awb {shipment_id, courier_id} → response.data.awb_code
 *   pickup      POST /v1/external/courier/generate/pickup {shipment_id: [id]}
 *   label       POST /v1/external/courier/generate/label {shipment_id: [id]} → label_url
 *   cancel      POST /v1/external/orders/cancel {ids: [order_id]}
 *   locations   GET  /v1/external/settings/company/pickup → data.shipping_address[]
 *   tracking    GET  /v1/external/courier/track/awb/{awb} → tracking_data
 * No network code runs at import; every call takes a fetcher so tests can stand in for Shiprocket.
 */

import { cleanPin, splitName, tenDigits, type RateOption, type ShipmentStatus, shiprocketStatus } from './shipping-rules'

export const SHIPROCKET_API = 'https://apiv2.shiprocket.in/v1/external'
/** Their token lasts 10 days; we log in again a day early. */
export const TOKEN_DAYS = 9

export interface ShiprocketAccount {
  email: string
  password: string
  token?: string | null
  tokenAt?: string | null
}

export class ShippingError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

type Fetcher = typeof fetch

/** Is the saved token still good? */
export function tokenFresh(tokenAt: string | null | undefined, now = Date.now()): boolean {
  const at = Date.parse(String(tokenAt || ''))
  return Number.isFinite(at) && now - at < TOKEN_DAYS * 86_400_000
}

/** Shiprocket's error in plain words (their 422s carry `message` and/or `errors`). */
function reason(data: any, status: number): string {
  if (status === 401 || status === 403) return 'Shiprocket did not accept the API user. Check the API user email and password (Shiprocket → Settings → API).'
  if (status === 429) return 'Shiprocket is busy (too many requests). Try again in a minute.'
  const errors = data?.errors && typeof data.errors === 'object' ? Object.values(data.errors).flat().map(String) : []
  const text = [data?.message, ...errors].filter(Boolean).join(' ').trim()
  return text ? `Shiprocket: ${text.slice(0, 300)}` : `Shiprocket answered ${status}.`
}

export async function shiprocketLogin(account: { email: string; password: string }, fetcher: Fetcher = fetch): Promise<string> {
  const res = await fetcher(`${SHIPROCKET_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
    signal: AbortSignal.timeout(15000),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || !data?.token) throw new ShippingError(reason(data, res.status === 400 ? 401 : res.status), 400)
  return String(data.token)
}

/**
 * A Shiprocket session: logs in when there is no fresh token (and once more if Shiprocket says the token
 * is no longer good), and hands a new token to `onToken` so it can be saved.
 */
export function shiprocketClient(account: ShiprocketAccount, options: { fetcher?: Fetcher; onToken?: (token: string) => Promise<void> | void } = {}) {
  const fetcher = options.fetcher || fetch
  let token = tokenFresh(account.tokenAt) ? String(account.token || '') : ''

  async function freshToken(): Promise<string> {
    token = await shiprocketLogin(account, fetcher)
    await options.onToken?.(token)
    return token
  }

  async function call(path: string, init: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}, retried = false): Promise<any> {
    if (!token) await freshToken()
    const qs = init.query ? '?' + new URLSearchParams(Object.entries(init.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
    const res = await fetcher(`${SHIPROCKET_API}${path}${qs}`, {
      method: init.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20000),
    })
    if (res.status === 401 && !retried) {
      await freshToken()
      return call(path, init, true)
    }
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new ShippingError(reason(data, res.status), res.status >= 500 ? 502 : 400)
    return data
  }

  return {
    call,
    /** Pickup locations saved in the Shiprocket account (the name must be used exactly). */
    async pickupLocations(): Promise<{ name: string; pin: string; city: string; primary: boolean }[]> {
      const data = await call('/settings/company/pickup')
      return (data?.data?.shipping_address || []).map((a: any) => ({
        name: String(a.pickup_location || ''), pin: String(a.pin_code || ''), city: String(a.city || ''), primary: a.is_primary_location === 1,
      })).filter((a: any) => a.name)
    },

    /** Couriers that can take this parcel, with price and days. */
    async rates(input: { fromPin: string; toPin: string; weightGrams: number; cod: boolean; value: number }): Promise<RateOption[]> {
      const data = await call('/courier/serviceability/', {
        query: { pickup_postcode: input.fromPin, delivery_postcode: input.toPin, weight: Math.max(0.05, input.weightGrams / 1000), cod: input.cod ? 1 : 0, declared_value: Math.round(input.value) },
      })
      return shiprocketRates(data)
    },

    /** Create the order, give it an AWB with the chosen courier, ask for pickup, and get the label. */
    async book(payload: Record<string, unknown>, courierId: string): Promise<ShiprocketBooking> {
      const created = await call('/orders/create/adhoc', { method: 'POST', body: payload })
      const shipmentId = created?.shipment_id
      const orderId = created?.order_id
      if (!shipmentId) throw new ShippingError(reason(created, 422))
      const booking: ShiprocketBooking = { providerOrderId: String(orderId || ''), shipmentId: String(shipmentId), awb: null, courierName: null, labelUrl: null, pickupAt: null, status: 'booked', warnings: [] }
      try {
        const awb = await call('/courier/assign/awb', { method: 'POST', body: { shipment_id: shipmentId, courier_id: Number(courierId) || undefined } })
        const d = awb?.response?.data || {}
        if (!d.awb_code) throw new ShippingError(reason(awb?.response || awb, 422))
        booking.awb = String(d.awb_code)
        booking.courierName = d.courier_name ? String(d.courier_name) : null
      } catch (error: any) {
        // The order exists in Shiprocket but no courier took it: cancel it so nothing is left half done
        await call('/orders/cancel', { method: 'POST', body: { ids: [Number(orderId)] } }).catch(() => null)
        throw error
      }
      try {
        const pickup = await call('/courier/generate/pickup', { method: 'POST', body: { shipment_id: [Number(shipmentId)] } })
        booking.pickupAt = pickup?.response?.pickup_scheduled_date ? String(pickup.response.pickup_scheduled_date) : null
        booking.status = 'pickup_scheduled'
      } catch (error: any) {
        booking.warnings.push(`Pickup not booked yet: ${error?.message || 'try again from Shiprocket'}`)
      }
      try {
        const label = await call('/courier/generate/label', { method: 'POST', body: { shipment_id: [Number(shipmentId)] } })
        if (label?.label_url) booking.labelUrl = String(label.label_url)
      } catch (error: any) {
        booking.warnings.push(`Label not ready yet: ${error?.message || 'open it in Shiprocket'}`)
      }
      return booking
    },

    async cancel(providerOrderId: string): Promise<void> {
      await call('/orders/cancel', { method: 'POST', body: { ids: [Number(providerOrderId)] } })
    },

    async label(shipmentId: string): Promise<string | null> {
      const label = await call('/courier/generate/label', { method: 'POST', body: { shipment_id: [Number(shipmentId)] } })
      return label?.label_url ? String(label.label_url) : null
    },

    async track(awb: string) {
      const data = await call(`/courier/track/awb/${encodeURIComponent(awb)}`)
      return shiprocketTracking(data)
    },
  }
}

export interface ShiprocketBooking {
  providerOrderId: string
  shipmentId: string
  awb: string | null
  courierName: string | null
  labelUrl: string | null
  pickupAt: string | null
  status: ShipmentStatus
  warnings: string[]
}

/** The serviceability answer as rate options. */
export function shiprocketRates(data: any): RateOption[] {
  const recommended = Number(data?.data?.recommended_courier_company_id ?? data?.data?.shiprocket_recommended_courier_id)
  return (data?.data?.available_courier_companies || []).map((c: any): RateOption => {
    const days = Number(c.estimated_delivery_days)
    const rate = Number(c.rate ?? c.freight_charge)
    return {
      provider: 'shiprocket',
      courierId: String(c.courier_company_id ?? ''),
      courierName: String(c.courier_name || 'Courier'),
      price: Number.isFinite(rate) ? Math.round(rate * 100) / 100 : NaN,
      codCharge: Number(c.cod_charges) || 0,
      days: Number.isFinite(days) && days > 0 ? days : null,
      etd: c.etd ? String(c.etd) : null,
      rating: Number.isFinite(Number(c.rating)) ? Number(c.rating) : null,
      cod: Number(c.cod) === 1,
      recommended: Number(c.courier_company_id) === recommended,
    }
  }).filter((o: RateOption) => o.courierId && Number.isFinite(o.price))
}

export interface TrackingUpdate {
  status: ShipmentStatus | null
  statusText: string
  expected: string | null
  events: { at: string; text: string; place: string }[]
}

/** Shiprocket's tracking answer (pull) as an update. */
export function shiprocketTracking(data: any): TrackingUpdate {
  const t = data?.tracking_data || {}
  const track = Array.isArray(t.shipment_track) ? t.shipment_track[0] || {} : {}
  const activities = Array.isArray(t.shipment_track_activities) ? t.shipment_track_activities : []
  const latest = activities[0] || {}
  const status = shiprocketStatus(t.shipment_status ?? latest['sr-status'], track.current_status || latest['sr-status-label'] || latest.activity)
  return {
    status,
    statusText: String(track.current_status || latest.activity || '').slice(0, 120),
    expected: track.edd ? String(track.edd) : t.etd ? String(t.etd) : null,
    events: activities.slice(0, 30).map((a: any) => ({ at: String(a.date || ''), text: String(a.activity || a['sr-status-label'] || ''), place: String(a.location || '') })),
  }
}

/** Shiprocket's webhook body (Settings → API → Webhooks) as an update for one AWB. */
export function shiprocketWebhook(body: any): (TrackingUpdate & { awb: string }) | null {
  const awb = String(body?.awb || '').trim()
  if (!awb) return null
  const scans = Array.isArray(body?.scans) ? body.scans : []
  return {
    awb,
    status: shiprocketStatus(body?.current_status_id ?? body?.shipment_status_id, body?.current_status || body?.shipment_status),
    statusText: String(body?.current_status || body?.shipment_status || '').slice(0, 120),
    expected: body?.etd ? String(body.etd) : null,
    events: scans.slice(-30).reverse().map((s: any) => ({ at: String(s.date || ''), text: String(s.activity || s['sr-status-label'] || ''), place: String(s.location || '') })),
  }
}

/** Our order as Shiprocket's "custom order" body (fields as in the official docs). */
export function shiprocketOrderPayload(input: {
  order: { order_number: string; created_at?: string | null; payment_method?: string | null; status?: string; subtotal?: unknown; shipping_fee?: unknown; total_amount?: unknown; shipping_address?: any }
  items: { title: string; retailer_id?: string | null; quantity: unknown; unit_price: unknown; hsn_code?: string | null }[]
  pickupLocation: string
  parcel: { weight_grams: number; length_cm: number; breadth_cm: number; height_cm: number }
  email?: string | null
  attempt?: number
}): Record<string, unknown> {
  const a = input.order.shipping_address || {}
  const name = splitName(a.full_name)
  const cod = isCod(input.order)
  const items = input.items.map((item, i) => ({
    name: String(item.title || 'Item').slice(0, 200),
    sku: String(item.retailer_id || `ITEM-${i + 1}`).slice(0, 50),
    units: Math.max(1, Math.round(Number(item.quantity) || 1)),
    selling_price: Math.round((Number(item.unit_price) || 0) * 100) / 100,
    discount: 0,
    tax: '',
    hsn: item.hsn_code ? String(item.hsn_code).replace(/\D/g, '').slice(0, 8) : '',
  }))
  const created = new Date(input.order.created_at || Date.now())
  const ist = new Date(created.getTime() + 330 * 60_000).toISOString()
  return {
    // A booking that was cancelled cannot reuse its order id in Shiprocket, so a second try adds "-2"
    order_id: input.attempt && input.attempt > 1 ? `${input.order.order_number}-${input.attempt}` : input.order.order_number,
    order_date: `${ist.slice(0, 10)} ${ist.slice(11, 16)}`,
    pickup_location: input.pickupLocation,
    billing_customer_name: name.first,
    billing_last_name: name.last,
    billing_address: String(a.address_line_1 || '').slice(0, 190),
    billing_address_2: String(a.address_line_2 || '').slice(0, 190),
    billing_city: String(a.city || '').slice(0, 30),
    billing_pincode: Number(cleanPin(a.pincode)),
    billing_state: String(a.state || '').slice(0, 50),
    billing_country: 'India',
    billing_email: input.email || 'orders@example.com',
    billing_phone: Number(tenDigits(a.phone_number)),
    shipping_is_billing: true,
    order_items: items,
    payment_method: cod ? 'COD' : 'Prepaid',
    shipping_charges: Number(input.order.shipping_fee) || 0,
    sub_total: Math.round((Number(input.order.total_amount) || 0) * 100) / 100,
    length: input.parcel.length_cm,
    breadth: input.parcel.breadth_cm,
    height: input.parcel.height_cm,
    weight: Math.max(0.05, Math.round(input.parcel.weight_grams) / 1000),
  }
}

/** Cash is collected at the door: COD orders that are not paid yet. */
export function isCod(order: { payment_method?: string | null; status?: string; payment_status?: string | null }): boolean {
  if (order.payment_status === 'paid') return false
  return order.payment_method === 'cod' || order.status === 'cod_confirmed'
}
