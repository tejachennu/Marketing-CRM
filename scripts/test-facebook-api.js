const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
const http = require('http')

// Load environment variables
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not found in .env')
  process.exit(1)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTests() {
  console.log('🔌 Connecting to database...')
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('✅ Connected to database\n')

  // Find a test organization
  console.log('🔍 Locating test organization...')
  const orgRes = await client.query('SELECT id, slug, name, whatsapp_provider, whatsapp_api_token, whatsapp_default_phone, whatsapp_graph_api_version, whatsapp_phone_number_id FROM public.organizations LIMIT 1;')
  if (orgRes.rows.length === 0) {
    console.error('❌ No organizations found in the database. Run migration or seed database first.')
    await client.end()
    process.exit(1)
  }

  const org = orgRes.rows[0]
  console.log(`📌 Using organization: "${org.name}" (${org.id})`)

  // Save original credentials to restore later
  const originalConfig = {
    whatsapp_provider: org.whatsapp_provider,
    whatsapp_api_token: org.whatsapp_api_token,
    whatsapp_default_phone: org.whatsapp_default_phone,
    whatsapp_graph_api_version: org.whatsapp_graph_api_version,
    whatsapp_phone_number_id: org.whatsapp_phone_number_id
  }

  // Set mock Facebook credentials for the test
  console.log('⚙️ Setting up mock Facebook API config in DB...')
  const testApiToken = 'test-token-fb-999'
  const testPhoneId = 'test-phone-id-fb-888'
  await client.query(`
    UPDATE public.organizations 
    SET whatsapp_provider = 'facebook',
        whatsapp_api_token = $1,
        whatsapp_phone_number_id = $2,
        whatsapp_graph_api_version = 'v25.0'
    WHERE id = $3;
  `, [testApiToken, testPhoneId, org.id])
  console.log('✅ Temporary Facebook credentials configured in DB')

  // We hit port 3000 directly since next dev is already running
  const baseUrl = `http://localhost:3000/api/webhooks/facebook/${org.id}_${org.slug}`
  let testPassed = true

  try {
    // -------------------------------------------------------------
    // Test 1: GET Webhook Verification
    // -------------------------------------------------------------
    console.log('\n🧪 Test 1: Simulating Meta GET Webhook Verification...')
    const challengeStr = 'fb_challenge_abc_123'
    const getVerificationUrl = `${baseUrl}?hub.mode=subscribe&hub.verify_token=${org.id}&hub.challenge=${challengeStr}`

    const getRes = await new Promise((resolve, reject) => {
      http.get(getVerificationUrl, (res) => {
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body: rawData }))
      }).on('error', reject)
    })

    console.log(`Response Status: ${getRes.status}`)
    console.log(`Response Body: "${getRes.body}"`)

    if (getRes.status === 200 && getRes.body === challengeStr) {
      console.log('✅ GET Webhook Verification PASSED!')
    } else {
      console.error('❌ GET Webhook Verification FAILED!')
      testPassed = false
    }

    // -------------------------------------------------------------
    // Test 2: POST Incoming Message Ingestion
    // -------------------------------------------------------------
    console.log('\n🧪 Test 2: Simulating POST Incoming WhatsApp Message...')
    
    // Clean up test contact & messages if already exists to ensure fresh run
    const testPhoneNumber = '19876543210'
    await client.query('DELETE FROM public.messages WHERE twilio_message_sid = $1', [`FB_mock-wamid-test-id-1`])
    await client.query('DELETE FROM public.contacts WHERE phone_number = $1 AND organization_id = $2', [testPhoneNumber, org.id])

    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'test_waba_id',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550199999',
                  phone_number_id: testPhoneId
                },
                contacts: [
                  {
                    profile: {
                      name: 'Meta Tester'
                    },
                    wa_id: testPhoneNumber
                  }
                ],
                messages: [
                  {
                    from: testPhoneNumber,
                    id: 'mock-wamid-test-id-1',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: {
                      body: 'Testing direct Facebook webhook integration!'
                    },
                    type: 'text'
                  }
                ]
              }
            }
          ]
        }
      ]
    }

    const postData = JSON.stringify(webhookPayload)
    const postOptions = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/webhooks/facebook/${org.id}_${org.slug}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const postRes = await new Promise((resolve, reject) => {
      const req = http.request(postOptions, (res) => {
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body: rawData }))
      })
      req.on('error', reject)
      req.write(postData)
      req.end()
    })

    console.log(`Response Status: ${postRes.status}`)
    console.log(`Response Body: ${postRes.body}`)

    if (postRes.status === 200) {
      console.log('✅ POST webhook endpoint returned 200 OK')
    } else {
      console.error('❌ POST webhook request failed')
      testPassed = false
    }

    // Give database a brief moment to finish inserts
    await wait(2000)

    // Verify contact was created
    console.log('\n🔍 Verifying Database records...')
    const contactCheck = await client.query('SELECT * FROM public.contacts WHERE phone_number = $1 AND organization_id = $2', [testPhoneNumber, org.id])
    if (contactCheck.rows.length > 0) {
      console.log(`✅ Contact created successfully in CRM: "${contactCheck.rows[0].first_name}"`)
    } else {
      console.error('❌ Contact record missing in CRM')
      testPassed = false
    }

    // Verify message was stored
    const messageCheck = await client.query('SELECT * FROM public.messages WHERE twilio_message_sid = $1 AND organization_id = $2', ['FB_mock-wamid-test-id-1', org.id])
    if (messageCheck.rows.length > 0) {
      console.log(`✅ Message logged successfully in CRM: "${messageCheck.rows[0].body}"`)
    } else {
      console.error('❌ Message record missing in CRM')
      testPassed = false
    }

  } catch (err) {
    console.error('❌ Integration test run failed:', err)
    testPassed = false
  } finally {
    // Restore original credentials in DB
    console.log('\n🔄 Restoring original organization settings in DB...')
    await client.query(`
      UPDATE public.organizations 
      SET whatsapp_provider = $1,
          whatsapp_api_token = $2,
          whatsapp_default_phone = $3,
          whatsapp_graph_api_version = $4,
          whatsapp_phone_number_id = $5
      WHERE id = $6;
    `, [
      originalConfig.whatsapp_provider,
      originalConfig.whatsapp_api_token,
      originalConfig.whatsapp_default_phone,
      originalConfig.whatsapp_graph_api_version,
      originalConfig.whatsapp_phone_number_id,
      org.id
    ])
    console.log('✅ DB restored successfully')
    await client.end()
  }

  if (testPassed) {
    console.log('\n🎉 ALL FACEBOOK GATEWAY INTEGRATION TESTS PASSED!')
    process.exit(0)
  } else {
    console.error('\n❌ SOME GATEWAY INTEGRATION TESTS FAILED!')
    process.exit(1)
  }
}

runTests()
