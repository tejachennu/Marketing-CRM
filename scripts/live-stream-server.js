const http = require('http')
const WebSocket = require('ws')
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
const url = require('url')
const twilio = require('twilio')

// Load environment variables from .env
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const PORT = env.PORT || 5050
const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL
const OPENAI_API_KEY = env.OPENAI_API_KEY
const TWILIO_ACCOUNT_SID = env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not found in environment')
  process.exit(1)
}
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not found in environment')
  process.exit(1)
}

// Database helper
async function getDbClient() {
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true)
  
  if (req.method === 'POST' && parsedUrl.pathname === '/incoming-call') {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    req.on('end', async () => {
      try {
        const params = new URLSearchParams(body)
        const callSid = params.get('CallSid') || ''
        const fromNumber = params.get('From') || ''

        console.log(`[Stream Server] Incoming call: ${callSid} | From: ${fromNumber}`)

        const db = await getDbClient()
        
        // 1. Resolve Organization ID
        let orgId = null
        const phoneNumberClean = fromNumber.replace('whatsapp:', '')
        
        if (phoneNumberClean) {
          const { rows } = await db.query(
            "SELECT organization_id FROM public.contacts WHERE phone_number = $1 LIMIT 1",
            [phoneNumberClean]
          )
          if (rows.length > 0) orgId = rows[0].organization_id
        }

        if (!orgId) {
          const { rows } = await db.query(
            "SELECT organization_id FROM public.users NOT LIKE '%@test.local' ORDER BY updated_at DESC LIMIT 1"
          ).catch(() => ({ rows: [] }))
          
          if (rows.length > 0) {
            orgId = rows[0].organization_id
          } else {
            const { rows: backupRows } = await db.query(
              "SELECT organization_id FROM public.users ORDER BY updated_at DESC LIMIT 1"
            )
            if (backupRows.length > 0) {
              orgId = backupRows[0].organization_id
            } else {
              const { rows: orgRows } = await db.query(
                "SELECT id FROM public.organizations LIMIT 1"
              )
              if (orgRows.length > 0) orgId = orgRows[0].id
            }
          }
        }

        if (!orgId) {
          res.writeHead(500, { 'Content-Type': 'text/xml' })
          res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error. Organization not resolved.</Say><Hangup/></Response>`)
          await db.end()
          return
        }

        // 2. Fetch AI Realtime Settings
        const { rows: orgSettings } = await db.query(
          "SELECT ai_realtime_prompt, ai_realtime_variables FROM public.organizations WHERE id = $1 LIMIT 1",
          [orgId]
        )

        const customPrompt = orgSettings.length > 0 ? orgSettings[0].ai_realtime_prompt : 'You are a customer assistant.'
        
        // 3. Log Call
        await db.query(
          `INSERT INTO public.live_stream_calls (organization_id, call_sid, phone_number, custom_prompt, status)
           VALUES ($1, $2, $3, $4, 'initiated')
           ON CONFLICT (call_sid) DO UPDATE SET status = 'initiated'`,
          [orgId, callSid, fromNumber, customPrompt]
        )

        await db.end()

        // 4. Return TwiML Media Connect Stream
        const host = req.headers.host
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">Connecting to the live AI assistant. Please wait...</Say>
            <Connect>
              <Stream url="wss://${host}/media-stream">
                <Parameter name="callSid" value="${callSid}" />
                <Parameter name="orgId" value="${orgId}" />
              </Stream>
            </Connect>
          </Response>`

        res.writeHead(200, { 'Content-Type': 'text/xml' })
        res.end(twiml)

      } catch (err) {
        console.error('[Stream Server] POST /incoming-call error:', err)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    })
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('WebSocket Twilio Realtime Proxy Server is running.')
  }
})

// WebSocket Server
const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', (wsConnection) => {
  console.log('[Proxy WebSocket] Twilio Media Stream connected.')
  
  let streamSid = null
  let callSid = null
  let orgId = null
  let openAiWs = null
  let promptText = ''
  let variableSchema = []

  wsConnection.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString())
      
      if (data.event === 'start') {
        streamSid = data.streamSid
        callSid = data.start.customParameters?.callSid
        orgId = data.start.customParameters?.orgId

        console.log(`[Proxy WebSocket] Stream: ${streamSid} | Call: ${callSid} | Org: ${orgId}`)

        if (!orgId || !callSid) {
          console.error('[Proxy WebSocket] Missing customParameters. Closing...')
          wsConnection.close()
          return
        }

        // Fetch settings from db
        const db = await getDbClient()
        const { rows } = await db.query(
          "SELECT ai_realtime_prompt, ai_realtime_variables FROM public.organizations WHERE id = $1 LIMIT 1",
          [orgId]
        )
        await db.query(
          "UPDATE public.live_stream_calls SET status = 'active', updated_at = now() WHERE call_sid = $1",
          [callSid]
        )
        await db.end()

        promptText = rows.length > 0 ? rows[0].ai_realtime_prompt : 'You are a customer assistant.'
        variableSchema = rows.length > 0 ? (rows[0].ai_realtime_variables || []) : ["name", "email", "reason"]

        // Connect to OpenAI Realtime API
        connectToOpenAi()

      } else if (data.event === 'media') {
        if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
          const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
          }
          openAiWs.send(JSON.stringify(audioAppend))
        }
      } else if (data.event === 'stop') {
        console.log(`[Proxy WebSocket] Twilio stopped stream: ${streamSid}`)
        wsConnection.close()
      }

    } catch (err) {
      console.error('[Proxy WebSocket] Error handling message:', err)
    }
  })

  wsConnection.on('close', () => {
    console.log('[Proxy WebSocket] Twilio Media Stream disconnected.')
    if (openAiWs) {
      openAiWs.close()
    }
    if (callSid) {
      updateCallStatus(callSid, 'ended')
    }
  })

  // OpenAI Realtime connection
  function connectToOpenAi() {
    console.log('[OpenAI WebSocket] Connecting to OpenAI Realtime API...')
    
    openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    })

    openAiWs.on('open', () => {
      console.log('[OpenAI WebSocket] Connected to OpenAI Realtime API.')
      
      // Build dynamic save_variables function properties
      const properties = {}
      variableSchema.forEach((variable) => {
        properties[variable] = {
          type: 'string',
          description: `The ${variable} parameter details extracted from the caller.`
        }
      })

      // Send session.update configuration
      const sessionUpdate = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: promptText,
          voice: 'alloy',
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600
          },
          tools: [
            {
              type: 'function',
              name: 'save_variables',
              description: 'Call this function immediately after you have collected the required fields from the caller. The call will be terminated upon completion.',
              parameters: {
                type: 'object',
                properties: properties,
                required: variableSchema
              }
            }
          ],
          tool_choice: 'auto'
        }
      }

      openAiWs.send(JSON.stringify(sessionUpdate))
    })

    openAiWs.on('message', async (message) => {
      try {
        const response = JSON.parse(message.toString())

        if (response.type === 'response.audio.delta') {
          // Send audio delta back to Twilio
          const mediaMessage = {
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: response.delta
            }
          }
          if (wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(JSON.stringify(mediaMessage))
          }
        } else if (response.type === 'input_audio_buffer.speech_started') {
          console.log('[OpenAI WebSocket] User interruption detected. Clearing Twilio buffer.')
          // Clear Twilio playback buffer
          const clearMessage = {
            event: 'clear',
            streamSid: streamSid
          }
          if (wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(JSON.stringify(clearMessage))
          }
          // Request response truncation from OpenAI
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }))
        } else if (response.type === 'response.function_call_arguments.done') {
          // OpenAI Realtime Tool triggered!
          console.log(`[OpenAI WebSocket] Tool triggered: ${response.name} | Call: ${callSid}`)
          
          if (response.name === 'save_variables') {
            const args = JSON.parse(response.arguments)
            console.log('[OpenAI WebSocket] Extracted Output Variables:', args)
            
            // Save extracted variables to Database
            const db = await getDbClient()
            await db.query(
              `UPDATE public.live_stream_calls 
               SET extracted_variables = $1, status = 'completed', updated_at = now() 
               WHERE call_sid = $2`,
              [args, callSid]
            )
            await db.end()
            
            console.log(`[OpenAI WebSocket] Variables successfully stored for Call ${callSid}`)

            // Terminate Twilio call programmatically
            if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
              try {
                const twClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
                await twClient.calls(callSid).update({ status: 'completed' })
                console.log(`[Twilio API] Call ${callSid} programmatically ended.`)
              } catch (twErr) {
                console.error('[Twilio API] Error ending call programmatically:', twErr)
              }
            }
          }
        }
      } catch (err) {
        console.error('[OpenAI WebSocket] Error processing message:', err)
      }
    })

    openAiWs.on('close', () => {
      console.log('[OpenAI WebSocket] OpenAI Realtime connection closed.')
    })

    openAiWs.on('error', (err) => {
      console.error('[OpenAI WebSocket] Error:', err)
    })
  }

  async function updateCallStatus(callId, status) {
    try {
      const db = await getDbClient()
      // Keep 'completed' status if already set by function call
      await db.query(
        `UPDATE public.live_stream_calls 
         SET status = CASE WHEN status = 'completed' THEN 'completed' ELSE $1 END, updated_at = now()
         WHERE call_sid = $2`,
        [status, callId]
      )
      await db.end()
    } catch (err) {
      console.error('[DB Helper] Error updating call status:', err)
    }
  }
})

// Handle upgrade requests
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname
  
  if (pathname === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

// Start Server
server.listen(PORT, () => {
  console.log(`🚀 Twilio OpenAI Realtime Media Stream Server is running on port ${PORT}`)
  console.log(`👉 Webhook URL: http://localhost:${PORT}/incoming-call`)
  console.log(`👉 WebSocket URL: ws://localhost:${PORT}/media-stream`)
})
