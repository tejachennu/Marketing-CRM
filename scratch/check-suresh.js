const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL

async function run() {
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '').replace(/\r/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const campaignId = 'e9d1b6be-cb0e-4d33-b892-c959c770a692'
  const phone = '8142354590'

  console.log('--- 1. CAMPAIGN LOGS FOR THIS PHONE & CAMPAIGN ---')
  const clRes = await client.query(`
    SELECT id, campaign_id, phone_number, status, created_at, variables_mapped
    FROM campaign_logs
    WHERE campaign_id = $1 AND (phone_number LIKE $2 OR phone_number LIKE $3)
  `, [campaignId, `%${phone}%`, `%${phone}`])
  console.log('Campaign logs count:', clRes.rows.length)
  console.log(clRes.rows)

  console.log('\n--- 2. ALL CONTACTS WITH THIS PHONE ---')
  const contactsRes = await client.query(`
    SELECT id, first_name, last_name, phone_number, organization_id, created_at
    FROM contacts
    WHERE phone_number LIKE $1
  `, [`%${phone}%`])
  console.log('Contacts count:', contactsRes.rows.length)
  console.log(contactsRes.rows)

  console.log('\n--- 3. ALL CONVERSATIONS FOR THESE CONTACTS ---')
  if (contactsRes.rows.length > 0) {
    const contactIds = contactsRes.rows.map(c => c.id)
    const convRes = await client.query(`
      SELECT id, contact_id, unread_count, last_message_at, is_active, created_at
      FROM conversations
      WHERE contact_id = ANY($1::uuid[])
    `, [contactIds])
    console.log('Conversations count:', convRes.rows.length)
    console.log(convRes.rows)
  }

  console.log('\n--- 4. EXACT QUERY IN getCampaignDetailedRecipients FOR THIS PHONE ---')
  const detailedRes = await client.query(`
    SELECT 
      cl.id as log_id,
      cl.phone_number,
      cl.status as dispatch_status,
      c.id as contact_id,
      c.first_name,
      c.last_name,
      conv.id as conversation_id
    FROM campaign_logs cl
    JOIN campaigns cmp ON cmp.id = cl.campaign_id
    LEFT JOIN contacts c ON (
      c.organization_id = cmp.organization_id AND (
        c.phone_number = cl.phone_number 
        OR c.phone_number = '+' || cl.phone_number
        OR '+' || c.phone_number = cl.phone_number
        OR (cl.email_address IS NOT NULL AND c.email = cl.email_address)
      )
    )
    LEFT JOIN conversations conv ON conv.contact_id = c.id
    WHERE cl.campaign_id = $1::uuid AND (cl.phone_number LIKE $2)
  `, [campaignId, `%${phone}%`])
  console.log('Detailed recipients count:', detailedRes.rows.length)
  console.log(detailedRes.rows)

  await client.end()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
