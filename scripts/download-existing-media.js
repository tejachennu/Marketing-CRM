const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
const { writeFile, mkdir } = require('fs/promises')

// Load .env
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL
const TWILIO_ACCOUNT_SID = env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN

async function downloadTwilioMedia(twilioMediaUrl) {
  try {
    const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
    
    // Fetch from Twilio with redirects manual
    let res = await fetch(twilioMediaUrl, {
      headers: {
        'Authorization': authHeader
      },
      redirect: 'manual'
    })
    
    // Check if it's a redirect
    if (res.status >= 300 && res.status < 400) {
      const redirectUrl = res.headers.get('location')
      if (redirectUrl) {
        console.log(`Following redirect manually for URL to S3: ${redirectUrl}`)
        res = await fetch(redirectUrl)
      } else {
        console.error('Redirect status received, but Location header is missing.')
        return null
      }
    }
    
    if (!res.ok) {
      console.error(`Failed to fetch media: ${res.statusText} status: ${res.status}`)
      return null
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    
    // Map content-type to file extension
    let ext = '.bin'
    if (contentType.includes('image/jpeg')) ext = '.jpg'
    else if (contentType.includes('image/png')) ext = '.png'
    else if (contentType.includes('image/gif')) ext = '.gif'
    else if (contentType.includes('image/webp')) ext = '.webp'
    else if (contentType.includes('audio/ogg') || contentType.includes('audio/x-ogg')) ext = '.ogg'
    else if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3')) ext = '.mp3'
    else if (contentType.includes('audio/wav') || contentType.includes('audio/x-wav')) ext = '.wav'
    else if (contentType.includes('audio/aac')) ext = '.aac'
    else if (contentType.includes('audio/amr')) ext = '.amr'
    else if (contentType.includes('video/mp4')) ext = '.mp4'
    else if (contentType.includes('video/webm')) ext = '.webm'
    else if (contentType.includes('application/pdf')) ext = '.pdf'
    
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads')
    await mkdir(uploadsDir, { recursive: true })
    
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const filename = `migrated-${uniqueSuffix}${ext}`
    const filePath = path.join(uploadsDir, filename)
    
    await writeFile(filePath, buffer)
    console.log(`Saved migrated media to: ${filePath}`)
    
    return `/uploads/${filename}`
  } catch (err) {
    console.error('Error downloading media:', err)
    return null
  }
}

async function run() {
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '').replace(/\r/g, '')
  console.log('Connecting to database:', cleanUrl.substring(0, 40) + '...')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  
  // Test connection with a count query
  const countRes = await client.query('SELECT COUNT(*) FROM messages')
  console.log('Total messages in DB:', countRes.rows[0].count)
  
  // Find messages that have a twilio media url
  const { rows } = await client.query(`
    SELECT id, media_url 
    FROM messages 
    WHERE media_url ILIKE '%api.twilio.com%'
  `)
  
  console.log(`Found ${rows.length} messages to migrate.`)
  
  for (const row of rows) {
    console.log(`Migrating message ${row.id} with url: ${row.media_url}`)
    const localUrl = await downloadTwilioMedia(row.media_url)
    if (localUrl) {
      await client.query(`
        UPDATE messages 
        SET media_url = $1 
        WHERE id = $2
      `, [localUrl, row.id])
      console.log(`Updated message ${row.id} in DB to ${localUrl}`)
    } else {
      console.error(`Failed to migrate message ${row.id}`)
    }
  }
  
  console.log('Migration complete.')
  await client.end()
}

run().catch(console.error)
