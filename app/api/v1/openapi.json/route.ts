import { NextResponse } from 'next/server'
import { messageOrigin } from '@/lib/salon/jobs'
import { openApiSpec } from '@/lib/public-api/spec'

export const runtime = 'nodejs'

// GET /api/v1/openapi.json: the API as an OpenAPI 3.1 file (import it into Postman or Insomnia). No key needed.
export async function GET(request: Request) {
  return NextResponse.json(openApiSpec(messageOrigin(new URL(request.url).origin)), { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } })
}
