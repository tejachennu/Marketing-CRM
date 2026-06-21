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

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL

async function run() {
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '').replace(/\r/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  
  // Find contact
  const contactRes = await client.query(`
    SELECT id, phone_number, first_name 
    FROM contacts 
    WHERE phone_number = '+916303012453' OR phone_number = '916303012453'
  `)
  
  console.log('Contact info:', contactRes.rows)
  
  if (contactRes.rows.length > 0) {
    const contactId = contactRes.rows[0].id
    
    // Find conversation
    const convRes = await client.query(`
      SELECT id, unread_count, last_message_at 
      FROM conversations 
      WHERE contact_id = $1
    `, [contactId])
    
    console.log('Conversations:', convRes.rows)
    
    for (const conv of convRes.rows) {
      const msgRes = await client.query(`
        SELECT id, body, media_url, sender_type, created_at 
        FROM messages 
        WHERE conversation_id = $1 
        ORDER BY created_at ASC
      `, [conv.id])
      console.log(`Messages for conv ${conv.id}:`, msgRes.rows)
    }
  }

  await client.end()
}

run().catch(console.error)
