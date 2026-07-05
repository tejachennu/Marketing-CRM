import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

// -------------------------------------------------------------
// Tool Implementations (Strict Tenant Isolation)
// -------------------------------------------------------------

async function executeQueryLeads(params: any, orgId: string, supabase: any) {
  let query = supabase
    .from('leads')
    .select('id, title, status, priority, value, assigned_to, created_at, expected_close_date, source, pipeline_stage_id, last_activity_at, won_at, lost_at', { count: 'exact' })
    .eq('organization_id', orgId)

  if (params.status) query = query.eq('status', params.status)
  if (params.priority) query = query.eq('priority', params.priority)
  if (params.assigned_to) query = query.eq('assigned_to', params.assigned_to)
  if (params.search) query = query.or(`title.ilike.%${params.search}%,description.ilike.%${params.search}%`)
  if (params.min_value) query = query.gte('value', params.min_value)

  if (params.date_range) {
    const now = new Date()
    let startDate: Date
    switch (params.date_range) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0))
        break
      case 'this_week':
        startDate = new Date(now.setDate(now.getDate() - now.getDay()))
        break
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'last_7_days':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'last_30_days':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }
    query = query.gte('created_at', startDate.toISOString())
  }

  if (params.action === 'count') {
    const { count, error } = await query
    if (error) return { error: error.message }
    return { count }
  }

  if (params.action === 'aggregate') {
    const { data, error } = await query
    if (error) return { error: error.message }
    const totalValue = (data || []).reduce((sum: number, l: any) => sum + (l.value || 0), 0)
    const byStatus = { active: 0, won: 0, lost: 0, on_hold: 0 }
    ;(data || []).forEach((l: any) => {
      const s = l.status as keyof typeof byStatus
      if (byStatus[s] !== undefined) byStatus[s]++
    })
    return { total: data?.length || 0, totalValue, byStatus }
  }

  query = query.order('created_at', { ascending: false }).limit(params.limit || 10)
  const { data, count, error } = await query
  if (error) return { error: error.message }
  return { leads: data || [], total: count }
}

async function executeQueryContacts(params: any, orgId: string, supabase: any) {
  let query = supabase
    .from('contacts')
    .select('id, first_name, last_name, phone_number, email, company, tags, created_at', { count: 'exact' })
    .eq('organization_id', orgId)

  if (params.search) {
    query = query.or(`first_name.ilike.%${params.search}%,last_name.ilike.%${params.search}%,phone_number.ilike.%${params.search}%,email.ilike.%${params.search}%,company.ilike.%${params.search}%`)
  }
  if (params.tag) {
    query = query.contains('tags', [params.tag])
  }

  if (params.action === 'count') {
    const { count, error } = await query
    if (error) return { error: error.message }
    return { count }
  }

  query = query.order('created_at', { ascending: false }).limit(params.limit || 10)
  const { data, count, error } = await query
  if (error) return { error: error.message }
  return { contacts: data || [], total: count }
}

async function executeQueryConversations(params: any, orgId: string, supabase: any) {
  let query = supabase
    .from('conversations')
    .select('id, contact_id, is_active, last_message_at, unread_count, assigned_to, auto_reply_enabled, contact:contacts(first_name, last_name, phone_number)', { count: 'exact' })
    .eq('organization_id', orgId)

  if (params.action === 'unread') {
    query = query.gt('unread_count', 0)
  } else if (params.action === 'unanswered') {
    // Last message has no reply from human operator (you can query messages for more details, or just check unread)
    query = query.gt('unread_count', 0)
  }

  if (params.action === 'count') {
    const { count, error } = await query
    if (error) return { error: error.message }
    return { count }
  }

  query = query.order('last_message_at', { ascending: false }).limit(params.limit || 10)
  const { data, count, error } = await query
  if (error) return { error: error.message }
  return { conversations: data || [], total: count }
}

async function executeQueryTickets(params: any, orgId: string, supabase: any) {
  let query = supabase
    .from('tickets')
    .select('id, subject, status, contact_id, conversation_id, created_at, closed_at, assigned_to, contact:contacts(first_name, last_name)', { count: 'exact' })
    .eq('organization_id', orgId)

  if (params.status) query = query.eq('status', params.status)
  if (params.assigned_to) query = query.eq('assigned_to', params.assigned_to)

  if (params.action === 'count') {
    const { count, error } = await query
    if (error) return { error: error.message }
    return { count }
  }

  if (params.action === 'overdue') {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    query = query.eq('status', 'active').lt('created_at', threeDaysAgo)
  }

  query = query.order('created_at', { ascending: false }).limit(params.limit || 10)
  const { data, count, error } = await query
  if (error) return { error: error.message }
  return { tickets: data || [], total: count }
}

async function executeQueryCampaigns(params: any, orgId: string, supabase: any) {
  let query = supabase
    .from('campaigns')
    .select('id, name, type, status, created_at, contact_count, sent_count, failed_count', { count: 'exact' })
    .eq('organization_id', orgId)

  if (params.action === 'count') {
    const { count, error } = await query
    if (error) return { error: error.message }
    return { count }
  }

  query = query.order('created_at', { ascending: false }).limit(params.limit || 5)
  const { data, count, error } = await query
  if (error) return { error: error.message }
  return { campaigns: data || [], total: count }
}

async function executeGetMetrics(params: any, orgId: string, supabase: any) {
  const now = new Date()
  let startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  if (params.date_range) {
    switch (params.date_range) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0))
        break
      case 'this_week':
        startDate = new Date(now.setDate(now.getDate() - now.getDay()))
        break
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'last_7_days':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'last_30_days':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        break
    }
  }

  const startISO = startDate.toISOString()

  switch (params.metric) {
    case 'conversion_rate': {
      const { data: all } = await supabase.from('leads').select('status').eq('organization_id', orgId).gte('created_at', startISO)
      const total = all?.length || 0
      const won = (all || []).filter((l: any) => l.status === 'won').length
      return { conversion_rate: total > 0 ? ((won / total) * 100).toFixed(1) + '%' : '0%', won, total }
    }
    case 'total_revenue': {
      const { data } = await supabase.from('leads').select('value').eq('organization_id', orgId).eq('status', 'won').gte('won_at', startISO)
      const total = (data || []).reduce((s: number, l: any) => s + (l.value || 0), 0)
      return { total_revenue: total }
    }
    case 'pipeline_value': {
      const { data } = await supabase.from('leads').select('value').eq('organization_id', orgId).eq('status', 'active')
      const total = (data || []).reduce((s: number, l: any) => s + (l.value || 0), 0)
      return { pipeline_value: total }
    }
    case 'messages_sent': {
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('sender_type', 'user').gte('created_at', startISO)
      return { messages_sent: count || 0 }
    }
    case 'leads_created': {
      const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', startISO)
      return { leads_created: count || 0 }
    }
    default:
      return { error: 'Unknown metric type' }
  }
}

async function executeUpdateLead(params: any, orgId: string, supabase: any) {
  const { data: lead } = await supabase.from('leads').select('id, title').eq('id', params.lead_id).eq('organization_id', orgId).maybeSingle()
  if (!lead) return { error: 'Lead not found or access denied' }

  const updates: any = {}
  if (params.status) {
    updates.status = params.status
    if (params.status === 'won') updates.won_at = new Date().toISOString()
    if (params.status === 'lost') updates.lost_at = new Date().toISOString()
  }
  if (params.assigned_to) updates.assigned_to = params.assigned_to
  if (params.notes) updates.notes = params.notes
  updates.last_activity_at = new Date().toISOString()

  const { error } = await supabase.from('leads').update(updates).eq('id', params.lead_id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  return { success: true, message: `Lead "${lead.title}" updated successfully` }
}

async function executeCreateContact(params: any, orgId: string, supabase: any) {
  if (!params.phone_number) {
    return { error: 'Phone number is required to add a contact' }
  }

  const normalizedPhone = params.phone_number.replace(/[\s-()]/g, '')

  const { data: existing } = await supabase
    .from('contacts')
    .select('id, first_name, last_name')
    .eq('organization_id', orgId)
    .eq('phone_number', normalizedPhone)
    .maybeSingle()

  if (existing) {
    return { error: `Contact with phone number ${normalizedPhone} already exists as "${existing.first_name || ''} ${existing.last_name || ''}".` }
  }

  const { data: contact, error: createError } = await supabase
    .from('contacts')
    .insert([
      {
        organization_id: orgId,
        first_name: params.first_name || null,
        last_name: params.last_name || null,
        phone_number: normalizedPhone,
        email: params.email || null,
        company: params.company || null,
        tags: params.tags || []
      }
    ])
    .select()
    .single()

  if (createError) return { error: createError.message }

  const { data: conversation } = await supabase
    .from('conversations')
    .insert([
      {
        organization_id: orgId,
        contact_id: contact.id,
        is_active: true,
        last_message_at: new Date().toISOString()
      }
    ])
    .select()
    .single()

  return {
    success: true,
    contact_id: contact.id,
    conversation_id: conversation?.id || null,
    message: `Contact "${params.first_name || ''} ${params.last_name || ''}" added successfully with active conversation.`
  }
}

async function executeCreateTicket(params: any, orgId: string, supabase: any, userId: string) {
  if (params.contact_id) {
    const { data: contact } = await supabase.from('contacts').select('id').eq('id', params.contact_id).eq('organization_id', orgId).maybeSingle()
    if (!contact) return { error: 'Contact not found or access denied' }
  }
  if (params.conversation_id) {
    const { data: conv } = await supabase.from('conversations').select('id').eq('id', params.conversation_id).eq('organization_id', orgId).maybeSingle()
    if (!conv) return { error: 'Conversation not found or access denied' }
  }

  const { data, error } = await supabase.from('tickets').insert({
    organization_id: orgId,
    subject: params.subject,
    description: params.description || '',
    contact_id: params.contact_id || null,
    conversation_id: params.conversation_id || null,
    status: 'active',
    created_by: userId
  }).select().single()

  if (error) return { error: error.message }
  return { success: true, ticket_id: data.id, message: `Ticket "${params.subject}" created successfully` }
}

async function executeDraftMessage(params: any, orgId: string, supabase: any, apiKey: string) {
  const { data: conv } = await supabase.from('conversations').select('id, contact:contacts(first_name, last_name)').eq('id', params.conversation_id).eq('organization_id', orgId).maybeSingle()
  if (!conv) return { error: 'Conversation not found or access denied' }

  // Fetch last 10 messages for context
  const { data: messages } = await supabase
    .from('messages')
    .select('sender_type, body')
    .eq('conversation_id', params.conversation_id)
    .order('created_at', { ascending: false })
    .limit(10)

  const contextStr = (messages || [])
    .reverse()
    .map((m: any) => `${m.sender_type === 'user' ? 'Operator' : 'Client'}: ${m.body}`)
    .join('\n')

  const prompt = `You are a professional CRM sales assistant. Draft a WhatsApp reply to the client based on the following conversation history.
  
TONE: ${params.tone || 'professional'}
INSTRUCTION / GOAL: ${params.instruction || 'polite follow up'}

CONVERSATION HISTORY:
${contextStr}

Response must be concise, ready to send, and formatted for WhatsApp (use *bold* only, no Markdown headings or other syntax). Avoid conversational fillers like "Here is your message:".`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 300
      })
    })

    if (!res.ok) {
      return { error: `OpenAI drafting failed: ${res.status}` }
    }

    const json = await res.json()
    return { draft: json.choices?.[0]?.message?.content?.trim() }
  } catch (err: any) {
    return { error: err.message }
  }
}

async function executeGetDailyBriefing(orgId: string, supabase: any) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString()

  const [
    leadsCount,
    wonLeads,
    totalRev,
    activeTickets,
    unreadConvs,
    overdueTickets,
    closedTicketsToday,
    todayCampaigns,
    totalConvsToday,
    todayMessages
  ] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', todayISO),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'won').gte('won_at', todayISO),
    supabase.from('leads').select('value').eq('organization_id', orgId).eq('status', 'won').gte('won_at', todayISO),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gt('unread_count', 0),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active').lt('created_at', new Date(Date.now() - 3*24*60*60*1000).toISOString()),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'closed').gte('closed_at', todayISO),
    supabase.from('campaigns').select('id, name, status, sent_count, failed_count').eq('organization_id', orgId).gte('created_at', todayISO),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('last_message_at', todayISO),
    supabase.from('messages').select('conversation_id, sender_type').eq('organization_id', orgId).gte('created_at', todayISO)
  ])

  const totalWonVal = (totalRev.data || []).reduce((s: number, l: any) => s + (l.value || 0), 0)

  // Calculate unique whatsapp contacts that messaged us today
  const uniqueContacts = new Set((todayMessages.data || [])
    .filter((m: any) => m.sender_type === 'contact')
    .map((m: any) => m.conversation_id))

  return {
    today_leads_created: leadsCount.count || 0,
    today_leads_won: wonLeads.count || 0,
    today_revenue_won: totalWonVal,
    total_active_tickets: activeTickets.count || 0,
    total_unread_chats: unreadConvs.count || 0,
    overdue_tickets: overdueTickets.count || 0,
    today_tickets_resolved: closedTicketsToday.count || 0,
    today_campaigns_run: todayCampaigns.data || [],
    today_conversations_active: totalConvsToday.count || 0,
    today_contacts_interacted_whatsapp: uniqueContacts.size
  }
}

// -------------------------------------------------------------
// POST Route Handler
// -------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const orgId = user.organization_id
    if (!orgId) {
      return NextResponse.json({ error: 'Forbidden: No organization assigned' }, { status: 403 })
    }

    const body = await request.json()
    const { message, conversationHistory = [], context = {} } = body

    if (!message) {
      return NextResponse.json({ error: 'Missing message parameter' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // Load organization settings
    const { data: org } = await supabase
      .from('organizations')
      .select('openai_api_key, name, currency')
      .eq('id', orgId)
      .maybeSingle()

    const apiKey = org?.openai_api_key || process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API Key is not configured for your organization.' }, { status: 400 })
    }

    const currencySymbol = org?.currency || '$'

    // Define tools
    const tools = [
      {
        type: 'function',
        function: {
          name: 'query_leads',
          description: 'Search, filter, count, or aggregate pipeline leads. Use this to find lead details, won/lost deals, value aggregates, or close dates.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'count', 'aggregate', 'search'] },
              status: { type: 'string', enum: ['active', 'won', 'lost', 'on_hold'] },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              assigned_to: { type: 'string' },
              search: { type: 'string' },
              date_range: { type: 'string', enum: ['today', 'this_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days'] },
              min_value: { type: 'number' },
              limit: { type: 'number' }
            },
            required: ['action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'query_contacts',
          description: 'Query contacts database. Search by name, email, phone, company, or filter by specific tags.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'count', 'search'] },
              search: { type: 'string' },
              tag: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_contact',
          description: 'Create/add a new contact to the database and automatically open a new chat conversation.',
          parameters: {
            type: 'object',
            properties: {
              first_name: { type: 'string' },
              last_name: { type: 'string' },
              phone_number: { type: 'string', description: 'Mandatory phone number' },
              email: { type: 'string' },
              company: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } }
            },
            required: ['phone_number']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'query_conversations',
          description: 'Search active or unread customer conversations, check messaging rates, or find chats requiring human replies.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'count', 'unread', 'unanswered'] },
              limit: { type: 'number' }
            },
            required: ['action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'query_tickets',
          description: 'Query support tickets. Find active, closed, or overdue unresolved tickets.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'count', 'overdue', 'search'] },
              status: { type: 'string', enum: ['active', 'closed'] },
              assigned_to: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'query_campaigns',
          description: 'Query message campaigns list and get marketing stats.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'count'] },
              limit: { type: 'number' }
            },
            required: ['action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_metrics',
          description: 'Calculate metrics: conversion_rate, total_revenue, pipeline_value, messages_sent, leads_created.',
          parameters: {
            type: 'object',
            properties: {
              metric: { type: 'string', enum: ['conversion_rate', 'total_revenue', 'pipeline_value', 'messages_sent', 'leads_created'] },
              date_range: { type: 'string', enum: ['today', 'this_week', 'this_month', 'last_7_days', 'last_30_days'] }
            },
            required: ['metric']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_lead',
          description: 'Modify lead priority, notes, status (won/lost/active/on_hold), or owner assignment.',
          parameters: {
            type: 'object',
            properties: {
              lead_id: { type: 'string' },
              status: { type: 'string', enum: ['active', 'won', 'lost', 'on_hold'] },
              assigned_to: { type: 'string' },
              notes: { type: 'string' }
            },
            required: ['lead_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_ticket',
          description: 'Open a support ticket for a contact conversation.',
          parameters: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              description: { type: 'string' },
              contact_id: { type: 'string' },
              conversation_id: { type: 'string' }
            },
            required: ['subject']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'draft_message',
          description: 'Draft a reply for a chat thread based on tone, conversation history, and instructions.',
          parameters: {
            type: 'object',
            properties: {
              conversation_id: { type: 'string' },
              tone: { type: 'string', enum: ['professional', 'friendly', 'concise'] },
              instruction: { type: 'string' }
            },
            required: ['conversation_id', 'instruction']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_daily_briefing',
          description: 'Retrieve a daily summary of today\'s activities including leads created/won, revenue, active/overdue/closed tickets, unread chats, total active chats of the day, active campaigns, and number of WhatsApp members interacted today.',
          parameters: {
            type: 'object'
          }
        }
      }
    ]

    // Construct AI system prompt
    const systemPrompt = `You are CRM Copilot, an AI business assistant for a WhatsApp CRM platform. You help users manage their leads, contacts, conversations, tickets, and campaigns.
    
Rules:
- Always use the available tools to fetch real data before answering questions.
- Never make up or estimate data — always query first.
- Format numbers clearly (use currency symbol from org settings: "${currencySymbol}").
- Be concise but insightful — add brief analysis when showing data.
- For destructive actions (e.g. update_lead, create_ticket), explain what you will do and ask for confirmation unless the user explicitly asked.
- Use emoji sparingly for visual clarity.
- If asked about something outside CRM scope, politely redirect.
- Always respect tenant isolation — you can only access data from the user's organization.
- Current organization: "${org?.name || 'My Business'}"
- Current page path: "${context.currentPage || '/dashboard'}"
- Active selected conversation ID: "${context.selectedConversationId || 'None'}"
- Current date/time: ${new Date().toLocaleString()}`

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: message }
    ]

    let loopCount = 0
    let toolsUsed: string[] = []

    while (loopCount < 3) {
      loopCount++

      const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.3
        })
      })

      if (!openAiRes.ok) {
        const errorText = await openAiRes.text()
        console.error('[CRM Agent] OpenAI API error:', openAiRes.status, errorText)
        throw new Error(`OpenAI request failed: ${openAiRes.statusText}`)
      }

      const openAiJson = await openAiRes.json()
      const assistantMessage = openAiJson.choices?.[0]?.message

      if (!assistantMessage) {
        throw new Error('No reply from OpenAI model')
      }

      messages.push(assistantMessage)

      // If GPT doesn't want to call tools, return final text
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return NextResponse.json({
          reply: assistantMessage.content || '',
          toolsUsed
        })
      }

      // Execute tool calls
      for (const call of assistantMessage.tool_calls) {
        const toolName = call.function.name
        const toolArgs = JSON.parse(call.function.arguments || '{}')
        toolsUsed.push(toolName)

        console.log(`[CRM Agent] Executing tool: ${toolName} with args:`, toolArgs)
        let result: any

        try {
          switch (toolName) {
            case 'query_leads':
              result = await executeQueryLeads(toolArgs, orgId, supabase)
              break
            case 'query_contacts':
              result = await executeQueryContacts(toolArgs, orgId, supabase)
              break
            case 'create_contact':
              result = await executeCreateContact(toolArgs, orgId, supabase)
              break
            case 'query_conversations':
              result = await executeQueryConversations(toolArgs, orgId, supabase)
              break
            case 'query_tickets':
              result = await executeQueryTickets(toolArgs, orgId, supabase)
              break
            case 'query_campaigns':
              result = await executeQueryCampaigns(toolArgs, orgId, supabase)
              break
            case 'get_metrics':
              result = await executeGetMetrics(toolArgs, orgId, supabase)
              break
            case 'update_lead':
              result = await executeUpdateLead(toolArgs, orgId, supabase)
              break
            case 'create_ticket':
              result = await executeCreateTicket(toolArgs, orgId, supabase, user.id)
              break
            case 'draft_message':
              result = await executeDraftMessage(toolArgs, orgId, supabase, apiKey)
              break
            case 'get_daily_briefing':
              result = await executeGetDailyBriefing(orgId, supabase)
              break
            default:
              result = { error: `Tool ${toolName} is not implemented` }
          }
        } catch (err: any) {
          console.error(`[CRM Agent] Tool ${toolName} execution error:`, err)
          result = { error: err.message || 'Tool execution failed' }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result)
        })
      }
    }

    // Fallback if we exceeded loops without returning
    const finalTextRes = messages[messages.length - 1]?.content || 'I could not finalize your request.'
    return NextResponse.json({ reply: finalTextRes, toolsUsed })

  } catch (err: any) {
    console.error('[CRM Agent] Critical route error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
