export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
  enable_ai?: boolean
  enable_email?: boolean
  enable_messages?: boolean
  enable_phone_calls?: boolean
  enable_sms?: boolean
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  contact_address?: string | null
  twilio_account_sid?: string | null
  twilio_auth_token?: string | null
  twilio_whatsapp_number?: string | null
  sendgrid_api_key?: string | null
  sendgrid_from_email?: string | null
  openai_api_key?: string | null
  chatbot_base_prompt?: string | null
  email_provider?: 'sendgrid' | 'smtp' | null
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_email?: string | null
  smtp_password?: string | null
  whatsapp_provider?: 'twilio' | 'facebook' | null
  whatsapp_api_token?: string | null
  whatsapp_default_phone?: string | null
  whatsapp_graph_api_version?: string | null
  whatsapp_phone_number_id?: string | null
  whatsapp_business_account_id?: string | null
  max_teammates?: number | null
  ticket_email_enabled?: boolean | null
  ticket_email_recipients?: string[] | null
  currency?: string | null
  enable_commerce?: boolean | null
  meta_catalog_id?: string | null
  meta_commerce_account_id?: string | null
  commerce_payment_gateway?: 'razorpay' | 'payu' | 'cashfree' | 'link' | 'cod' | null
  commerce_gateway_config_name?: string | null
  commerce_enable_cod?: boolean | null
  commerce_default_shipping_fee?: number | null
  commerce_free_shipping_threshold?: number | null
  commerce_address_flow_id?: string | null
}

export interface User {
  id: string
  organization_id: string
  email: string
  full_name: string | null
  // ── New canonical roles ──────────────────────────────────────────
  // super_admin  : Platform-level (your internal use, cross-org)
  // org_admin    : Full org access — all chats, leads, settings
  // org_manager  : Manages team, can assign & grant employee permissions
  // sales_employee: Restricted — only assigned chats/leads by default
  // ── Legacy roles kept for backward compat ───────────────────────
  role: 'super_admin' | 'org_admin' | 'org_manager' | 'sales_employee'
     | 'owner' | 'admin' | 'member' | 'agent' | 'viewer'
     | 'salesemployees' | 'saleslead' | 'superadmin' | 'OrgAdmin' | 'Manager'
  created_at: string
  updated_at: string
  // Permission overrides (set by admin/manager per user)
  see_all?: boolean    // true → sees all org chats & leads regardless of role
  read_only?: boolean  // true → can view only, cannot send/edit
}

export interface Contact {
  id: string
  organization_id: string
  phone_number: string
  whatsapp_number?: string | null
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  tags?: string[]
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

export interface PipelineStage {
  id: string
  organization_id: string
  name: string
  color: string
  position: number
  created_at: string
}

export interface Lead {
  id: string
  organization_id: string
  contact_id: string
  title: string | null
  description: string | null
  pipeline_stage_id: string | null
  value: number | null
  assigned_to: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'active' | 'won' | 'lost' | 'on_hold'
  source: string | null
  expected_close_date: string | null
  notes: string | null
  product_service: string | null
  won_lost_reason: string | null
  last_activity_at: string | null
  won_at: string | null
  lost_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  organization_id: string
  contact_id: string
  lead_id: string | null
  twilio_conversation_sid: string | null
  is_active: boolean
  last_message_at: string | null
  unread_count: number
  assigned_to: string | null
  auto_reply_enabled?: boolean | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  organization_id: string
  conversation_id: string
  sender_type: 'user' | 'contact'
  sender_id: string | null
  body: string
  media_url: string | null
  twilio_message_sid: string | null
  read_at: string | null
  status?: string | null
  error_message?: string | null
  created_at: string
}

export interface ConversationWithContact extends Conversation {
  contact?: Contact
  lead?: Lead
  last_message?: Message
}

export interface CommerceProduct {
  id: string
  organization_id: string
  retailer_id: string
  title: string
  description?: string | null
  price: number
  currency: string
  image_url?: string | null
  website_url?: string | null
  category?: string | null
  is_available: boolean
  inventory_count?: number | null
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface CommerceOrderItem {
  id: string
  order_id: string
  product_id?: string | null
  retailer_id: string
  title: string
  quantity: number
  unit_price: number
  total_price: number
  image_url?: string | null
  created_at: string
}

export interface CommerceOrder {
  id: string
  organization_id: string
  contact_id?: string | null
  conversation_id?: string | null
  lead_id?: string | null
  order_number: string
  status: 'cart_submitted' | 'awaiting_address' | 'payment_pending' | 'paid' | 'cod_confirmed' | 'shipped' | 'delivered' | 'canceled'
  checkout_type: 'in_chat' | 'website_redirect'
  catalog_id?: string | null
  subtotal: number
  shipping_fee: number
  tax_amount: number
  total_amount: number
  currency: string
  payment_method?: 'whatsapp_pay' | 'razorpay_link' | 'cod' | null
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded'
  shipping_address?: {
    full_name?: string
    phone_number?: string
    address_line_1?: string
    address_line_2?: string
    city?: string
    state?: string
    pincode?: string
    delivery_speed?: string
    notes?: string
  } | null
  customer_note?: string | null
  meta_order_id?: string | null
  meta_payment_reference?: string | null
  items?: CommerceOrderItem[]
  contact?: Contact
  created_at: string
  updated_at: string
}

export interface CommerceTransaction {
  id: string
  order_id: string
  organization_id: string
  gateway: string
  transaction_id: string
  amount: number
  currency: string
  status: string
  raw_payload?: Record<string, any>
  created_at: string
}

