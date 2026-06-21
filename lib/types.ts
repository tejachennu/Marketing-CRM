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
  twilio_account_sid?: string | null
  twilio_auth_token?: string | null
  twilio_whatsapp_number?: string | null
  sendgrid_api_key?: string | null
  sendgrid_from_email?: string | null
  openai_api_key?: string | null
}

export interface User {
  id: string
  organization_id: string
  email: string
  full_name: string | null
  role: 'owner' | 'admin' | 'member' | 'salesemployees' | 'saleslead'
  created_at: string
  updated_at: string
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
  created_at: string
}

export interface ConversationWithContact extends Conversation {
  contact?: Contact
  lead?: Lead
  last_message?: Message
}
