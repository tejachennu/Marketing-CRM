/** Shapes the Spa & Salon screens work with (rows as the API returns them). */

export interface SalonSettings {
  business_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  invoice_prefix: string
  prices_include_tax: boolean
  invoice_note: string | null
  voice_replies: boolean
  logo_url?: string | null
  opens_at?: string
  closes_at?: string
  closed_weekdays?: number[]
  chat_assistant?: boolean
  auto_approve_bookings?: boolean
  reminders_enabled?: boolean
  feedback_enabled?: boolean
  feedback_delay_minutes?: number
  review_link?: string | null
  business_type?: 'salon' | 'clinic' | 'fitness' | 'repair' | 'other'
  service_categories?: string[]
  booking_flow?: Record<string, unknown>
  message_templates?: Record<string, { name: string; language: string; fields: string[]; url_field?: string | null } | undefined>
}

export interface Service {
  id: string
  category: string
  name: string
  price: number | string
  duration_minutes: number
  tax_rate: number | string
  sac_code: string | null
  active: boolean
}

export interface StaffMember {
  id: string
  name: string
  phone: string | null
  service_ids: string[]
  active: boolean
  commission_percent?: number | string
}

export interface SalonSetup {
  settings: SalonSettings
  services: Service[]
  staff: StaffMember[]
}

export interface BookedService {
  service_id: string | null
  name: string
  price: number
  duration_minutes: number
  tax_rate: number
  sac_code: string | null
  /** Who does (or did) this service */
  staff_id?: string | null
  staff_name?: string | null
}

export type AppointmentStatus = 'requested' | 'booked' | 'arrived' | 'in_service' | 'completed' | 'cancelled' | 'no_show'

export interface Appointment {
  id: string
  contact_id: string | null
  customer_name: string
  customer_phone: string | null
  staff_id: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  services: BookedService[]
  notes: string | null
  invoice_id: string | null
}

export interface Invoice {
  id: string
  number: string
  appointment_id: string | null
  customer_name: string
  customer_phone: string | null
  staff_name: string | null
  items: any[]
  subtotal: number
  discount: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
  status: 'unpaid' | 'paid' | 'void'
  payment_method: string | null
  issued_at: string
  paid_at: string | null
  public_token: string
}
