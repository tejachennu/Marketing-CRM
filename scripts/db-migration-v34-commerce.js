/**
 * db-migration-v34-commerce.js
 *
 * Optional hardening for the WhatsApp store. The app works without it; with it:
 *   - the express delivery charge becomes a store setting (it is a fixed 50 otherwise),
 *   - the database itself refuses a second order for the same WhatsApp cart, and a second
 *     order with the same order number (payments are matched to orders by that number).
 *
 * Run with: node scripts/db-migration-v34-commerce.js
 */

const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const env = { ...process.env }
for (const file of ['.env.local', '.env']) {
  const envPath = path.join(__dirname, '..', file)
  if (!fs.existsSync(envPath)) continue
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const match = line.match(/^([^=#]+)=\s*['"]?(.*?)['"]?\s*$/)
    if (match && env[match[1].trim()] === undefined) env[match[1].trim()] = match[2]
  })
}

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
if (!POSTGRES_URL) {
  console.log('No POSTGRES_URL found in the environment; nothing was changed.')
  process.exit(0)
}

const client = new Client({
  connectionString: POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
})

async function step(label, sql) {
  try {
    await client.query(sql)
    console.log(`ok    ${label}`)
  } catch (err) {
    console.log(`skip  ${label}: ${err.message}`)
  }
}

async function run() {
  await client.connect()
  console.log('Connected to the database')

  await step(
    'express delivery charge setting',
    `ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS commerce_express_fee NUMERIC DEFAULT 50;`
  )

  // These two fail (and are skipped) if duplicates already exist; remove the duplicates and run again.
  await step(
    'one order per WhatsApp cart',
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_orders_cart
       ON public.commerce_orders (organization_id, meta_order_id)
       WHERE meta_order_id IS NOT NULL;`
  )
  await step(
    'order numbers unique per store',
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_orders_number
       ON public.commerce_orders (organization_id, order_number);`
  )
  await step(
    'payment reference lookup',
    `CREATE INDEX IF NOT EXISTS idx_commerce_orders_payment_reference
       ON public.commerce_orders (organization_id, meta_payment_reference)
       WHERE meta_payment_reference IS NOT NULL;`
  )

  await client.end()
  console.log('Done')
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message)
  try { await client.end() } catch {}
  process.exit(1)
})
