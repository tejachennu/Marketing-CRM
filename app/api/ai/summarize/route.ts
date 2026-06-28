import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { leadId, conversationId: providedConvId } = body
    if (!leadId) {
      return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // 1. Fetch lead details (description, notes, title, value, status, priority, contact_id)
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, organization_id, contact_id, title, description, notes, value, status, priority, product_service, source, expected_close_date, assigned_to, created_at')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // 2. Auth check
    const authResult = await verifyRecordAccess(request, 'leads', leadId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // 3. Load org OpenAI key
    let openAiKey = process.env.OPENAI_API_KEY || ''
    if (lead.organization_id) {
      try {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('openai_api_key')
          .eq('id', lead.organization_id)
          .single()
        if (orgData?.openai_api_key) {
          openAiKey = orgData.openai_api_key
        }
      } catch (dbErr) {
        console.error('[AI Summarize] Error loading organization OpenAI key:', dbErr)
      }
    }

    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured' }, { status: 400 })
    }

    // 4. Find conversation for this lead
    let conversationId = providedConvId || null
    if (!conversationId) {
      const { data: convByLead } = await supabase
        .from('conversations')
        .select('id')
        .eq('lead_id', leadId)
        .maybeSingle()

      if (convByLead?.id) {
        conversationId = convByLead.id
      } else if (lead.contact_id) {
        const { data: convByContact } = await supabase
          .from('conversations')
          .select('id')
          .eq('contact_id', lead.contact_id)
          .maybeSingle()
        if (convByContact?.id) {
          conversationId = convByContact.id
        }
      }
    }

    // 5. Check for previous analysis to enable incremental reading
    let lastMessageAt: string | null = null
    const { data: prevAnalysis } = await supabase
      .from('lead_ai_analyses')
      .select('id, last_message_at, summary')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (prevAnalysis?.last_message_at) {
      lastMessageAt = prevAnalysis.last_message_at
    }

    // 6. Fetch messages (incrementally if previous analysis exists)
    let transcript = ''
    let latestMessageId: string | null = null
    let latestMessageAt: string | null = null

    if (conversationId) {
      let msgQuery = supabase
        .from('messages')
        .select('id, body, sender_type, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (lastMessageAt) {
        msgQuery = msgQuery.gt('created_at', lastMessageAt)
      }

      const { data: messages } = await msgQuery

      if (messages && messages.length > 0) {
        transcript = messages.map(m => {
          const sender = m.sender_type === 'user' ? 'Operator' : 'Client'
          return `${sender}: ${m.body || '[Media/Attachment]'}`
        }).join('\n')

        const lastMsg = messages[messages.length - 1]
        latestMessageId = lastMsg.id
        latestMessageAt = lastMsg.created_at
      }
    }

    // 7. Fetch lead activities (notes, status changes)
    const { data: activities } = await supabase
      .from('lead_activities')
      .select('activity_type, content, created_at, user:users(full_name)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })

    const activitiesText = (activities || []).map(a => {
      const userName = (a.user as any)?.full_name || 'System'
      const date = new Date(a.created_at).toLocaleDateString()
      return `[${date}] ${userName} - ${a.activity_type}: ${a.content || ''}`
    }).join('\n')

    // 8. Build comprehensive context
    const leadContext = [
      `Lead Title: ${lead.title || 'Untitled'}`,
      `Status: ${lead.status}`,
      `Priority: ${lead.priority}`,
      `Value: ${lead.value || 'Not set'}`,
      `Product/Service: ${lead.product_service || 'Not specified'}`,
      `Source: ${lead.source || 'Unknown'}`,
      `Expected Close: ${lead.expected_close_date || 'Not set'}`,
      `Description: ${lead.description || 'None'}`,
      `Notes: ${lead.notes || 'None'}`,
      `Created: ${new Date(lead.created_at).toLocaleDateString()}`,
    ].join('\n')

    const previousSummary = prevAnalysis?.summary
      ? `\n\nPrevious AI Analysis Summary:\n${prevAnalysis.summary}`
      : ''

    // Check if we have enough data to analyze
    const hasTranscript = transcript.length > 0
    const hasActivities = activitiesText.length > 0
    const hasLeadData = lead.description || lead.notes

    if (!hasTranscript && !hasActivities && !hasLeadData) {
      return NextResponse.json({
        error: 'No data available to analyze. Add notes, activities, or have a WhatsApp conversation first.'
      }, { status: 400 })
    }

    // 9. Build GPT prompt
    const systemPrompt = `You are a senior CRM sales analyst and strategist. Analyze all available data about this sales lead and provide a comprehensive intelligence report.

Your analysis must include:
1. "summary": A 3-4 sentence executive summary about where this lead stands, key developments, and overall trajectory.
2. "suggestions": 3-5 specific, actionable next steps the sales team should take. Be concrete (e.g., "Send follow-up pricing proposal within 48 hours" not "Follow up").
3. "lead_rating": Rate the lead as "Hot", "Warm", or "Cold" with a brief 1-sentence justification.
4. "closure_probability": Assess as "High", "Medium", or "Low" whether this deal is moving towards closure. Include a 1-sentence reasoning.
5. "key_insights": 3-5 bullet points highlighting the most important observations from the data (buying signals, objections, timeline clues, budget indicators, etc.)

Return ONLY a JSON object with these exact keys: summary, suggestions, lead_rating, closure_probability, key_insights.
- "suggestions" should be a string with numbered items (1. ... 2. ... etc.)
- "key_insights" should be a string with bullet points (• ... )
- "lead_rating" format: "Hot - <reason>" or "Warm - <reason>" or "Cold - <reason>"
- "closure_probability" format: "High - <reason>" or "Medium - <reason>" or "Low - <reason>"`

    let userPrompt = `=== LEAD INFORMATION ===\n${leadContext}`

    if (previousSummary) {
      userPrompt += `\n\n=== PREVIOUS AI ANALYSIS ===\n${previousSummary}`
    }

    if (activitiesText) {
      userPrompt += `\n\n=== ACTIVITY LOG & NOTES ===\n${activitiesText}`
    }

    if (transcript) {
      const label = lastMessageAt ? '=== NEW CHAT MESSAGES (since last analysis) ===' : '=== CHAT TRANSCRIPT ==='
      userPrompt += `\n\n${label}\n${transcript}`
    }

    userPrompt += '\n\nAnalyze all available data and generate the JSON intelligence report.'

    // 10. Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 800
      })
    })

    const data = await response.json()
    if (response.status !== 200 || data.error) {
      console.error('[AI Summarize OpenAI Error]', data.error || data)
      return NextResponse.json({
        error: data.error?.message || 'OpenAI API call failed'
      }, { status: response.status || 500 })
    }

    const contentText = data.choices?.[0]?.message?.content || '{}'
    let analysis: any = {}
    try {
      analysis = JSON.parse(contentText)
    } catch (e) {
      console.error('[AI Summarize] Failed to parse GPT output:', e)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    // 11. Save analysis to lead_ai_analyses table
    const { data: saved, error: saveErr } = await supabase
      .from('lead_ai_analyses')
      .insert({
        lead_id: leadId,
        organization_id: lead.organization_id,
        conversation_id: conversationId,
        last_message_id: latestMessageId,
        last_message_at: latestMessageAt,
        summary: analysis.summary || '',
        suggestions: analysis.suggestions || '',
        lead_rating: analysis.lead_rating || '',
        closure_probability: analysis.closure_probability || '',
        raw_analysis: analysis,
        created_by: authResult.user?.id || null,
      })
      .select()
      .single()

    if (saveErr) {
      console.error('[AI Summarize] Error saving analysis:', saveErr)
      // Return the analysis even if saving fails
      return NextResponse.json({
        analysis,
        saved: false,
        error: 'Analysis generated but failed to save'
      })
    }

    return NextResponse.json({
      analysis: saved,
      saved: true
    })
  } catch (error: any) {
    console.error('[AI Summarize API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

// GET: Fetch analysis history for a lead
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('leadId')

    if (!leadId) {
      return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('lead_ai_analyses')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) throw error

    return NextResponse.json({ analyses: data || [] })
  } catch (error: any) {
    console.error('[AI Summarize GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
