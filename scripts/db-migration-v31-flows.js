const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let envContent = ''
try {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
} catch (e) {
  try {
    envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  } catch (e2) {}
}

const env = {}
if (envContent) {
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
    if (match) env[match[1].trim()] = match[2]
  })
}

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
if (!POSTGRES_URL) {
  console.log('ℹ️ No POSTGRES_URL found in environment, skipping direct DB query.')
  process.exit(0)
}

const client = new Client({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
})

async function run() {
  try {
    await client.connect()
    console.log('✅ Connected to database')
    
    console.log('Creating WhatsApp Flows & Workflows tables...')
    await client.query(`
      -- 1. WhatsApp Workflows (Conversational Node Graphs)
      CREATE TABLE IF NOT EXISTS public.whatsapp_workflows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          trigger_type VARCHAR(50) NOT NULL DEFAULT 'keyword',
          trigger_config JSONB DEFAULT '{}'::jsonb,
          canvas_nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
          canvas_edges JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_active BOOLEAN DEFAULT false,
          execution_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_whatsapp_workflows_org 
      ON public.whatsapp_workflows(organization_id);

      -- 2. Meta WhatsApp Native Flows (In-Chat Forms & Screens)
      CREATE TABLE IF NOT EXISTS public.whatsapp_native_flows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          flow_id_meta VARCHAR(100),
          name VARCHAR(255) NOT NULL,
          categories JSONB DEFAULT '["LEAD_GENERATION"]'::jsonb,
          flow_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          status VARCHAR(50) DEFAULT 'DRAFT',
          screens JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_whatsapp_native_flows_org 
      ON public.whatsapp_native_flows(organization_id);

      -- 3. Flow Active Execution Sessions (State Machine)
      CREATE TABLE IF NOT EXISTS public.flow_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          workflow_id UUID REFERENCES public.whatsapp_workflows(id) ON DELETE CASCADE,
          conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
          contact_phone VARCHAR(50) NOT NULL,
          current_node_id VARCHAR(100) NOT NULL,
          state_data JSONB DEFAULT '{}'::jsonb,
          status VARCHAR(50) DEFAULT 'IN_PROGRESS',
          last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_flow_sessions_conv 
      ON public.flow_sessions(conversation_id);

      CREATE INDEX IF NOT EXISTS idx_flow_sessions_phone 
      ON public.flow_sessions(organization_id, contact_phone);

      -- 4. Native Flow Submissions
      CREATE TABLE IF NOT EXISTS public.flow_submissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          flow_id UUID REFERENCES public.whatsapp_native_flows(id) ON DELETE CASCADE,
          conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
          contact_phone VARCHAR(50) NOT NULL,
          response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_flow_submissions_org 
      ON public.flow_submissions(organization_id);
    `)
    console.log('✅ WhatsApp Flows tables and indexes created successfully!')
  } catch (err) {
    console.error('❌ Migration error:', err)
  } finally {
    await client.end()
  }
}

run()
