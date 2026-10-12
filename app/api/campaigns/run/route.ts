import { NextRequest, NextResponse, after } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { runCampaignWorker } from './worker/route'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId } = body

    if (!campaignId) {
      return NextResponse.json(
        { error: 'Campaign ID is required' },
        { status: 400 }
      )
    }

    const authResult = await verifyRecordAccess(request, 'campaigns', campaignId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Run the worker after the response is sent. `after` keeps the serverless
    // function alive until the worker settles; a bare floating promise can be
    // frozen as soon as the response returns.
    after(() =>
      runCampaignWorker(campaignId).catch(err => {
        console.error('[Campaign Run] Background worker execution failed for campaign:', campaignId, err)
      })
    )

    return NextResponse.json({
      success: true,
      message: 'Campaign processing started in the background.'
    })
  } catch (error) {
    console.error('[API] Run campaign error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start campaign' },
      { status: 500 }
    )
  }
}
