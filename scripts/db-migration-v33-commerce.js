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
    
    console.log('Adding commerce columns to organizations...')
    await client.query(`
      ALTER TABLE public.organizations 
      ADD COLUMN IF NOT EXISTS enable_commerce BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS meta_catalog_id TEXT,
      ADD COLUMN IF NOT EXISTS meta_commerce_account_id TEXT,
      ADD COLUMN IF NOT EXISTS commerce_payment_gateway TEXT DEFAULT 'razorpay',
      ADD COLUMN IF NOT EXISTS commerce_gateway_config_name TEXT,
      ADD COLUMN IF NOT EXISTS commerce_enable_cod BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS commerce_default_shipping_fee NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS commerce_free_shipping_threshold NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS commerce_address_flow_id TEXT;
    `)

    console.log('Creating commerce_products table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.commerce_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        retailer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        price NUMERIC NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        image_url TEXT,
        website_url TEXT,
        category TEXT,
        is_available BOOLEAN DEFAULT true,
        inventory_count INTEGER DEFAULT 100,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(organization_id, retailer_id)
      );

      CREATE INDEX IF NOT EXISTS idx_commerce_products_org 
      ON public.commerce_products(organization_id);
    `)

    console.log('Creating commerce_orders table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.commerce_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
        order_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'cart_submitted',
        checkout_type TEXT NOT NULL DEFAULT 'in_chat',
        catalog_id TEXT,
        subtotal NUMERIC NOT NULL DEFAULT 0,
        shipping_fee NUMERIC NOT NULL DEFAULT 0,
        tax_amount NUMERIC NOT NULL DEFAULT 0,
        total_amount NUMERIC NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'INR',
        payment_method TEXT,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        shipping_address JSONB,
        customer_note TEXT,
        meta_order_id TEXT,
        meta_payment_reference TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_commerce_orders_org 
      ON public.commerce_orders(organization_id);
      CREATE INDEX IF NOT EXISTS idx_commerce_orders_contact 
      ON public.commerce_orders(contact_id);
      CREATE INDEX IF NOT EXISTS idx_commerce_orders_status 
      ON public.commerce_orders(status);
    `)

    console.log('Creating commerce_order_items table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.commerce_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES commerce_products(id) ON DELETE SET NULL,
        retailer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price NUMERIC NOT NULL,
        total_price NUMERIC NOT NULL,
        image_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_commerce_order_items_order 
      ON public.commerce_order_items(order_id);
    `)

    console.log('Creating commerce_transactions table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.commerce_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES commerce_orders(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        gateway TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_commerce_transactions_order 
      ON public.commerce_transactions(order_id);
    `)

    console.log('Granting privileges & disabling RLS for commerce tables...')
    const tables = ['commerce_products', 'commerce_orders', 'commerce_order_items', 'commerce_transactions']
    for (const t of tables) {
      await client.query(`ALTER TABLE public."${t}" DISABLE ROW LEVEL SECURITY;`)
      await client.query(`GRANT ALL ON public."${t}" TO anon;`)
      await client.query(`GRANT ALL ON public."${t}" TO authenticated;`)
    }

    console.log('✅ Migration v33 Commerce successfully completed!')
  } catch (err) {
    console.error('❌ Migration failed:', err)
  } finally {
    await client.end()
  }
}

run()
