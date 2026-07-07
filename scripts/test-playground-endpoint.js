const { POST } = require('../app/api/ai/playground/route')
const { NextRequest } = require('next/server')

async function run() {
  console.log('Testing POST handler directly...')
  try {
    // Create a mock request
    const req = {
      headers: {
        get: (name) => {
          if (name.toLowerCase() === 'authorization') return 'Bearer mock-token'
          return null
        }
      },
      json: async () => ({ query: 'Can I apply for PR extension?' })
    }

    const res = await POST(req)
    console.log('Status:', res.status)
    const json = await res.json()
    console.log('JSON Response:', json)
  } catch (err) {
    console.error('Error during execution:', err)
  }
}

run()
