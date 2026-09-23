import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { compileMetaFlowJSON, NATIVE_FLOW_TEMPLATES } from '@/lib/flows/meta-flows-spec'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: flows, error } = await supabase
      .from('whatsapp_native_flows')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({
      flows: flows || [],
      templates: Object.entries(NATIVE_FLOW_TEMPLATES).map(([key, tmpl]) => ({
        id: key,
        name: tmpl.name,
        category: tmpl.category,
        description: tmpl.description,
        screensCount: tmpl.screens.length,
      })),
    })
  } catch (error: any) {
    console.error('[Native Flows GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, name, categories, template_key, screens } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    let flowName = name?.trim()
    let flowCategories = categories || ['LEAD_GENERATION']
    let flowScreens = screens

    // If instantiated from template
    if (template_key && NATIVE_FLOW_TEMPLATES[template_key]) {
      const tmpl = NATIVE_FLOW_TEMPLATES[template_key]
      if (!flowName) flowName = tmpl.name
      if (!categories) flowCategories = [tmpl.category]
      if (!flowScreens) flowScreens = tmpl.screens
    }

    if (!flowName) {
      flowName = 'Untitled WhatsApp Flow'
    }

    if (!flowScreens || flowScreens.length === 0) {
      flowScreens = [
        {
          id: 'SCREEN_WELCOME',
          title: 'Quick Information',
          terminal: true,
          layout: {
            type: 'SingleColumnLayout',
            children: [
              {
                id: 'full_name',
                type: 'TextInput',
                label: 'Your Full Name',
                name: 'full_name',
                required: true,
                helper_text: 'Enter your legal or business name',
              },
              {
                id: 'contact_email',
                type: 'TextInput',
                label: 'Email Address',
                name: 'email',
                input_type: 'email',
                required: true,
              },
            ],
          },
        },
      ]
    }

    const flowJson = compileMetaFlowJSON(flowScreens)

    const { data: newFlow, error } = await supabase
      .from('whatsapp_native_flows')
      .insert([
        {
          organization_id: organizationId,
          name: flowName,
          status: 'DRAFT',
          categories: flowCategories,
          screens: flowScreens,
          flow_json: flowJson,
        },
      ])
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ flow: newFlow }, { status: 201 })
  } catch (error: any) {
    console.error('[Native Flows POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
