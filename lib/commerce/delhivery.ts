/**
 * Delhivery (Express / B2C), with the business's OWN account. The API token comes from Delhivery's
 * onboarding team (different for test and live); the pickup warehouse must be registered with Delhivery
 * and its name used exactly (it is case sensitive). Endpoints and fields from Delhivery's official API docs
 * (delhivery-express-api-doc.readme.io, read 17 Nov 2026):
 *   auth        header "Authorization: Token <token>"
 *   PIN check   GET  /c/api/pin-codes/json/?filter_codes=<pin> → delivery_codes[].postal_code {pre_paid, cash/cod, pickup}
 *   charges     GET  /api/kinko/v1/invoice/charges/.json?md=S|E&cgm=<grams>&o_pin&d_pin&ss=Delivered (approximate; 40/min)
 *   shipment    POST /api/cmu/create.json  body "format=json&data=<JSON>" → packages[].waybill
 *   pickup      POST /fm/request/new/ {pickup_time, pickup_date, pickup_location, expected_package_count}
 *   cancel      POST /api/p/edit {waybill, cancellation: "true"}
 *   tracking    GET  /api/v1/packages/json/?waybill=<wb> → ShipmentData[].Shipment.Status
 *   push        Delhivery's team sets up a webhook to our URL: {Shipment: {Status: {...}, AWB, ReferenceNo}}
 * The public docs do not show a full tracking answer, so reading it is careful and checked against a real
 * account later.
 */

import { cleanPin, delhiverySafe, delhiveryStatus, tenDigits, type RateOption } from './shipping-rules'
import { ShippingError, isCod, type TrackingUpdate } from './shiprocket'

export const DELHIVERY_LIVE = 'https://track.delhivery.com'
export const DELHIVERY_TEST = 'https://staging-express.delhivery.com'

export interface DelhiveryAccount {
  token: string
  warehouse: string
  live: boolean
}

type Fetcher = typeof fetch

function reason(data: any, status: number, text = ''): string {
  if (status === 401 || status === 403) return 'Delhivery did not accept the API token. Check the token (and test or live) given by Delhivery\'s onboarding team.'
  if (status === 429) return 'Delhivery is busy (too many requests). Try again in a minute.'
  const pkg = Array.isArray(data?.packages) ? data.packages[0] : null
  const remark = [data?.rmk, data?.error && typeof data.error === 'string' ? data.error : '', pkg?.remarks ? [].concat(pkg.remarks).join(' ') : '', text].filter(Boolean).join(' ').trim()
  return remark ? `Delhivery: ${remark.slice(0, 300)}` : `Delhivery answered ${status}.`
}

export function delhiveryClient(account: DelhiveryAccount, fetcher: Fetcher = fetch) {
  const base = account.live ? DELHIVERY_LIVE : DELHIVERY_TEST
  const auth = { Authorization: `Token ${account.token}` }

  async function call(path: string, init: { method?: string; json?: unknown; form?: string; query?: Record<string, unknown> } = {}): Promise<any> {
    const qs = init.query ? '?' + new URLSearchParams(Object.entries(init.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
    const headers: Record<string, string> = { ...auth, Accept: 'application/json' }
    let body: string | undefined
    if (init.form !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = init.form }
    else if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json) }
    const res = await fetcher(`${base}${path}${qs}`, { method: init.method || 'GET', headers, body, signal: AbortSignal.timeout(20000) })
    const text = await res.text().catch(() => '')
    let data: any = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }
    if (!res.ok) throw new ShippingError(reason(data, res.status, data && Object.keys(data).length ? '' : text.slice(0, 120)), res.status >= 500 ? 502 : 400)
    return data
  }

  return {
    call,
    /** Is this PIN code served? (prepaid, COD) — an empty answer means no. */
    async pin(pin: string): Promise<{ served: boolean; prepaid: boolean; cod: boolean; place: string | null }> {
      const data = await call('/c/api/pin-codes/json/', { query: { filter_codes: pin } })
      return delhiveryPin(data)
    },

    /** Approximate price for surface and express (Delhivery's own words: "approximate"). */
    async rates(input: { fromPin: string; toPin: string; weightGrams: number; cod: boolean }): Promise<RateOption[]> {
      const served = await this.pin(input.toPin)
      if (!served.served || (input.cod && !served.cod) || (!input.cod && !served.prepaid)) return []
      const out: RateOption[] = []
      for (const mode of ['S', 'E'] as const) {
        try {
          const data = await call('/api/kinko/v1/invoice/charges/.json', { query: { md: mode, cgm: Math.max(50, Math.round(input.weightGrams)), o_pin: input.fromPin, d_pin: input.toPin, ss: 'Delivered' } })
          const row = Array.isArray(data) ? data[0] : data
          const price = Number(row?.total_amount ?? row?.gross_amount)
          if (Number.isFinite(price)) {
            out.push({ provider: 'delhivery', courierId: mode, courierName: mode === 'S' ? 'Delhivery Surface' : 'Delhivery Express', price: Math.round(price * 100) / 100, codCharge: Number(row?.charge_COD) || 0, days: null, etd: null, rating: null, cod: served.cod })
          }
        } catch (error: any) {
          if (error?.status === 400 && /token/i.test(error.message)) throw error
          // One mode can be missing from a contract; the other may still work
        }
      }
      return out
    },

    /** Create the shipment (Delhivery gives the waybill), then ask for a pickup. */
    async book(shipment: Record<string, unknown>, mode: string): Promise<{ awb: string; pickupId: string | null; warnings: string[] }> {
      const payload = { shipments: [{ ...shipment, shipping_mode: mode === 'E' ? 'Express' : 'Surface' }], pickup_location: { name: account.warehouse } }
      const data = await call('/api/cmu/create.json', { method: 'POST', form: `format=json&data=${encodeURIComponent(JSON.stringify(payload))}` })
      const pkg = Array.isArray(data?.packages) ? data.packages[0] : null
      const awb = pkg?.waybill ? String(pkg.waybill) : ''
      if (!awb || data?.success === false) throw new ShippingError(reason(data, 422))
      const warnings: string[] = []
      let pickupId: string | null = null
      try {
        pickupId = await this.pickup(1)
      } catch (error: any) {
        // Delhivery allows one open pickup per warehouse; a parcel booked later rides on the same pickup
        warnings.push(`Pickup not booked: ${error?.message || 'ask for it in Delhivery'} (one pickup a day per warehouse covers all parcels).`)
      }
      return { awb, pickupId, warnings }
    },

    /** A pickup at the warehouse: today if before 2 pm India time, else tomorrow, at 2 pm / 11 am. */
    async pickup(count: number, now = new Date()): Promise<string | null> {
      const ist = new Date(now.getTime() + 330 * 60_000)
      const today = ist.getUTCHours() < 14
      const day = new Date(ist.getTime() + (today ? 0 : 86_400_000)).toISOString().slice(0, 10)
      const data = await call('/fm/request/new/', { method: 'POST', json: { pickup_time: today ? '17:00:00' : '11:00:00', pickup_date: day, pickup_location: account.warehouse, expected_package_count: Math.max(1, count) } })
      return data?.pickup_id ? String(data.pickup_id) : null
    },

    async cancel(awb: string): Promise<void> {
      const data = await call('/api/p/edit', { method: 'POST', json: { waybill: awb, cancellation: 'true' } })
      if (data?.status === false) throw new ShippingError(reason({ rmk: data?.remark }, 400))
    },

    async track(awb: string): Promise<TrackingUpdate> {
      const data = await call('/api/v1/packages/json/', { query: { waybill: awb } })
      const shipment = Array.isArray(data?.ShipmentData) ? data.ShipmentData[0]?.Shipment : null
      if (!shipment) throw new ShippingError(reason({ rmk: data?.Error }, 404))
      return delhiveryShipment(shipment)
    },
  }
}

export function delhiveryPin(data: any): { served: boolean; prepaid: boolean; cod: boolean; place: string | null } {
  const code = Array.isArray(data?.delivery_codes) ? data.delivery_codes[0]?.postal_code : null
  if (!code) return { served: false, prepaid: false, cod: false, place: null }
  const yes = (v: unknown) => String(v ?? '').toUpperCase() === 'Y'
  const prepaid = yes(code.pre_paid)
  const cod = yes(code.cod) || yes(code.cash)
  return { served: prepaid || cod, prepaid, cod, place: code.district ? String(code.district) : null }
}

/** One Delhivery "Shipment" (tracking pull or push) as an update. */
export function delhiveryShipment(shipment: any): TrackingUpdate {
  const s = shipment?.Status || {}
  const scans = Array.isArray(shipment?.Scans) ? shipment.Scans : []
  const expected = shipment?.ExpectedDeliveryDate || shipment?.PromisedDeliveryDate || null
  return {
    status: delhiveryStatus(s.StatusType, s.Status),
    statusText: String(s.Instructions || s.Status || '').slice(0, 120),
    expected: expected ? String(expected).slice(0, 10) : null,
    events: scans.slice(-30).reverse().map((x: any) => {
      const d = x?.ScanDetail || x || {}
      return { at: String(d.ScanDateTime || d.StatusDateTime || ''), text: String(d.Instructions || d.Scan || ''), place: String(d.ScannedLocation || d.StatusLocation || '') }
    }),
  }
}

/** Delhivery's push body as an update for one waybill. */
export function delhiveryWebhook(body: any): (TrackingUpdate & { awb: string }) | null {
  const shipment = body?.Shipment || body?.shipment || null
  const awb = String(shipment?.AWB || shipment?.awb || '').trim()
  if (!awb) return null
  return { awb, ...delhiveryShipment(shipment) }
}

/** Our order as one Delhivery shipment (fields as in the official order creation docs). */
export function delhiveryShipmentPayload(input: {
  order: { order_number: string; created_at?: string | null; payment_method?: string | null; status?: string; payment_status?: string | null; total_amount?: unknown; shipping_address?: any }
  items: { title: string; quantity: unknown; hsn_code?: string | null }[]
  parcel: { weight_grams: number; length_cm: number; breadth_cm: number; height_cm: number }
  seller: { name: string; address: string; gstin?: string | null }
  attempt?: number
}): Record<string, unknown> {
  const a = input.order.shipping_address || {}
  const cod = isCod(input.order)
  const total = Math.round((Number(input.order.total_amount) || 0) * 100) / 100
  const quantity = input.items.reduce((sum, i) => sum + Math.max(1, Math.round(Number(i.quantity) || 1)), 0)
  const hsn = [...new Set(input.items.map((i) => String(i.hsn_code || '').replace(/\D/g, '')).filter(Boolean))].join(',')
  return {
    name: delhiverySafe(a.full_name || 'Customer', 100),
    add: delhiverySafe([a.address_line_1, a.address_line_2].filter(Boolean).join(', '), 250),
    pin: Number(cleanPin(a.pincode)),
    city: delhiverySafe(a.city, 60),
    state: delhiverySafe(a.state, 60),
    country: 'India',
    phone: tenDigits(a.phone_number),
    order: input.attempt && input.attempt > 1 ? `${input.order.order_number}-${input.attempt}` : input.order.order_number,
    payment_mode: cod ? 'COD' : 'Prepaid',
    cod_amount: cod ? total : 0,
    total_amount: total,
    products_desc: delhiverySafe(input.items.map((i) => `${i.title} x${Math.max(1, Math.round(Number(i.quantity) || 1))}`).join(', '), 200),
    quantity: String(quantity),
    weight: Math.max(50, Math.round(input.parcel.weight_grams)),
    shipment_length: Math.round(input.parcel.length_cm),
    shipment_width: Math.round(input.parcel.breadth_cm),
    shipment_height: Math.round(input.parcel.height_cm),
    seller_name: delhiverySafe(input.seller.name, 100),
    seller_add: delhiverySafe(input.seller.address, 200),
    seller_inv: input.order.order_number,
    ...(input.seller.gstin ? { seller_gst_tin: delhiverySafe(input.seller.gstin, 20) } : {}),
    ...(hsn ? { hsn_code: hsn } : {}),
    order_date: (input.order.created_at || new Date().toISOString()).slice(0, 19).replace('T', ' '),
  }
}
