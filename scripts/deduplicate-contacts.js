const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

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

function standardizePhone(phone) {
  if (!phone) return ''
  let clean = phone.replace('whatsapp:', '').trim()
  if (!clean.startsWith('+')) {
    clean = '+' + clean
  }
  return clean
}

async function run() {
  console.log('🔌 Connecting to database...')
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('✅ Connected to database\n')

  // 1. Fetch all contacts
  console.log('🔍 Fetching all contacts...')
  const contactsRes = await client.query('SELECT id, organization_id, phone_number, whatsapp_number, first_name, created_at FROM public.contacts;')
  const contacts = contactsRes.rows
  console.log(`📊 Found ${contacts.length} total contacts in database`)

  // 2. Group contacts by organization and standardized phone number
  const groups = {}
  for (const contact of contacts) {
    const stdPhone = standardizePhone(contact.phone_number)
    const key = `${contact.organization_id}_${stdPhone}`
    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(contact)
  }

  let mergedCount = 0
  let standardizedCount = 0

  for (const key of Object.keys(groups)) {
    const group = groups[key]
    const stdPhone = key.split('_')[1]

    if (group.length > 1) {
      console.log(`\n⚠️ Duplicate contact group found for phone: ${stdPhone} (${group.length} contacts)`)
      
      // Sort contacts: prefer the one that already starts with '+' as primary, or the older one by created_at
      group.sort((a, b) => {
        const aHasPlus = a.phone_number.startsWith('+')
        const bHasPlus = b.phone_number.startsWith('+')
        if (aHasPlus && !bHasPlus) return -1
        if (!aHasPlus && bHasPlus) return 1
        return new Date(a.created_at) - new Date(b.created_at)
      })

      const primary = group[0]
      const duplicates = group.slice(1)
      console.log(`   🌟 Primary Contact: "${primary.first_name}" (ID: ${primary.id}, Phone: ${primary.phone_number})`)

      // Ensure the primary contact has the standardized format
      if (primary.phone_number !== stdPhone) {
        await client.query(
          'UPDATE public.contacts SET phone_number = $1, whatsapp_number = $2 WHERE id = $3;',
          [stdPhone, `whatsapp:${stdPhone}`, primary.id]
        )
        standardizedCount++
      }

      for (const duplicate of duplicates) {
        console.log(`   🔗 Merging Duplicate Contact: "${duplicate.first_name}" (ID: ${duplicate.id}, Phone: ${duplicate.phone_number})`)

        // Find duplicate's conversations
        const convsRes = await client.query('SELECT id FROM public.conversations WHERE contact_id = $1;', [duplicate.id])
        const duplicateConvs = convsRes.rows

        // Find primary's conversations
        const primaryConvsRes = await client.query(
          'SELECT id FROM public.conversations WHERE contact_id = $1 AND organization_id = $2 AND is_active = true ORDER BY last_message_at DESC LIMIT 1;',
          [primary.id, primary.organization_id]
        )
        const primaryConv = primaryConvsRes.rows[0]

        if (primaryConv) {
          // If primary has an active conversation, merge messages from duplicate's conversations into the primary's conversation
          for (const dConv of duplicateConvs) {
            console.log(`      📥 Reassigning messages from conversation ${dConv.id} to primary conversation ${primaryConv.id}`)
            await client.query('UPDATE public.messages SET conversation_id = $1 WHERE conversation_id = $2;', [primaryConv.id, dConv.id])
            // Delete duplicate's conversation
            await client.query('DELETE FROM public.conversations WHERE id = $1;', [dConv.id])
          }
        } else {
          // If primary doesn't have an active conversation, reassign the duplicate's conversations to the primary contact
          console.log(`      🔄 Reassigning duplicate's conversations to primary contact ID: ${primary.id}`)
          await client.query('UPDATE public.conversations SET contact_id = $1 WHERE contact_id = $2;', [primary.id, duplicate.id])
        }

        // Delete duplicate contact
        await client.query('DELETE FROM public.contacts WHERE id = $1;', [duplicate.id])
        mergedCount++
      }
    } else {
      // Single contact in group, just ensure its phone is standardized
      const contact = group[0]
      if (contact.phone_number !== stdPhone) {
        console.log(`✨ Standardizing phone number for contact: "${contact.first_name}" (${contact.phone_number} -> ${stdPhone})`)
        await client.query(
          'UPDATE public.contacts SET phone_number = $1, whatsapp_number = $2 WHERE id = $3;',
          [stdPhone, `whatsapp:${stdPhone}`, contact.id]
        )
        standardizedCount++
      }
    }
  }

  console.log(`\n🎉 Cleanup completed successfully!`)
  console.log(`   ✅ Standardized: ${standardizedCount} contacts`)
  console.log(`   ✅ Merged & deleted: ${mergedCount} duplicate contacts`)

  await client.end()
}

run().catch((err) => {
  console.error('❌ Database cleanup failed:', err)
  process.exit(1)
})
