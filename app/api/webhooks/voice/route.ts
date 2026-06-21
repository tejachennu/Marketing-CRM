import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

function xmlResponse(twiml: string) {
  return new NextResponse(twiml, {
    headers: {
      'Content-Type': 'text/xml',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'start'
    const workflowId = searchParams.get('workflowId')
    const stepId = searchParams.get('stepId')

    // Parse Twilio parameters from body (form-urlencoded)
    const bodyText = await request.text()
    const params = new URLSearchParams(bodyText)
    const from = params.get('From') || ''
    const to = params.get('To') || ''
    const callSid = params.get('CallSid') || ''
    const digits = params.get('Digits') || ''

    console.log(`[Voice Webhook] Call: ${callSid} | From: ${from} | To: ${to} | Action: ${action}`)

    // 1. Resolve organization_id
    let orgId: string | null = null

    // Try via existing contact
    const phoneNumber = from.replace('whatsapp:', '')
    if (phoneNumber) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('organization_id')
        .eq('phone_number', phoneNumber)
        .limit(1)
        .maybeSingle()
      if (contact) {
        orgId = contact.organization_id
      }
    }

    // Fallback: active users
    if (!orgId) {
      const { data: realUsers } = await supabase
        .from('users')
        .select('organization_id')
        .not('email', 'like', '%@test.local')
        .order('updated_at', { ascending: false })
        .limit(1)

      if (realUsers && realUsers.length > 0) {
        orgId = realUsers[0].organization_id
      } else {
        const { data: anyUsers } = await supabase
          .from('users')
          .select('organization_id')
          .order('updated_at', { ascending: false })
          .limit(1)

        if (anyUsers && anyUsers.length > 0) {
          orgId = anyUsers[0].organization_id
        } else {
          const { data: orgs } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
          if (orgs && orgs.length > 0) {
            orgId = orgs[0].id
          }
        }
      }
    }

    if (!orgId) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">Error. Organization not found. Goodbye.</Say>
          <Hangup />
        </Response>`)
    }

    // 2. Fetch workflow
    let workflow: any = null
    if (workflowId) {
      const { data } = await supabase
        .from('voice_workflows')
        .select('*')
        .eq('id', workflowId)
        .single()
      workflow = data
    } else {
      // Find active workflow
      const { data } = await supabase
        .from('voice_workflows')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      workflow = data
    }

    if (!workflow) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">Thank you for calling. No voice menu is currently configured. Goodbye.</Say>
          <Hangup />
        </Response>`)
    }

    const steps = workflow.steps || []
    if (steps.length === 0) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">This directory has no steps configured. Goodbye.</Say>
          <Hangup />
        </Response>`)
    }

    // Action Handlers
    if (action === 'gather') {
      // Handle digit selection
      const currentStep = steps.find((s: any) => s.id === stepId)
      if (!currentStep) {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">Error. Menu step not found. Goodbye.</Say>
            <Hangup />
          </Response>`)
      }

      const routes = currentStep.routes || {}
      const targetStepId = routes[digits]

      if (targetStepId) {
        // Redirect to targeted step
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Redirect method="POST">/api/webhooks/voice?action=start&amp;workflowId=${workflow.id}&amp;stepId=${targetStepId}</Redirect>
          </Response>`)
      } else {
        // Invalid digit, replay same menu
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">Invalid selection.</Say>
            <Redirect method="POST">/api/webhooks/voice?action=start&amp;workflowId=${workflow.id}&amp;stepId=${currentStep.id}</Redirect>
          </Response>`)
      }
    }

    if (action === 'record-complete') {
      const nextStepId = searchParams.get('nextStepId')
      if (nextStepId) {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Redirect method="POST">/api/webhooks/voice?action=start&amp;workflowId=${workflow.id}&amp;stepId=${nextStepId}</Redirect>
          </Response>`)
      } else {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">Thank you. Your message has been recorded. Goodbye.</Say>
            <Hangup />
          </Response>`)
      }
    }

    // Default Action: 'start' (Execute current step)
    // Find target step, default to 'start' or first step in array
    let currentStep = steps.find((s: any) => s.id === stepId)
    if (!currentStep && !stepId) {
      currentStep = steps.find((s: any) => s.id === 'start') || steps[0]
    }

    if (!currentStep) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">Error. Flow step not found. Goodbye.</Say>
          <Hangup />
        </Response>`)
    }

    // Generate TwiML based on step type
    switch (currentStep.type) {
      case 'say': {
        const next = currentStep.next_step
        if (next) {
          return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Say voice="alice">${currentStep.text}</Say>
              <Redirect method="POST">/api/webhooks/voice?action=start&amp;workflowId=${workflow.id}&amp;stepId=${next}</Redirect>
            </Response>`)
        } else {
          return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Say voice="alice">${currentStep.text}</Say>
              <Hangup />
            </Response>`)
        }
      }

      case 'dial': {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Dial>${currentStep.phoneNumber}</Dial>
          </Response>`)
      }

      case 'record': {
        const next = currentStep.next_step || ''
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">${currentStep.text || 'Please leave your message after the tone. Press pound when finished.'}</Say>
            <Record action="/api/webhooks/voice?action=record-complete&amp;workflowId=${workflow.id}&amp;nextStepId=${next}" maxLength="120" playBeep="true" finishOnKey="#" />
          </Response>`)
      }

      case 'gather': {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Gather action="/api/webhooks/voice?action=gather&amp;workflowId=${workflow.id}&amp;stepId=${currentStep.id}" numDigits="${currentStep.numDigits || 1}" timeout="${currentStep.timeout || 5}" method="POST">
              <Say voice="alice">${currentStep.prompt}</Say>
            </Gather>
            <Say voice="alice">We did not receive any input. Goodbye.</Say>
            <Hangup />
          </Response>`)
      }

      case 'hangup':
      default: {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Hangup />
          </Response>`)
      }
    }

  } catch (error: any) {
    console.error('[Voice Webhook Error]:', error)
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice">An internal server error occurred. Goodbye.</Say>
        <Hangup />
      </Response>`)
  }
}
