import { NextRequest, NextResponse } from 'next/server'
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

    // Launch background worker directly inside Node runtime
    // This eliminates fragile HTTP self-fetching that gets killed when requests return
    runCampaignWorker(campaignId).catch(err => {
      console.error('[Campaign Run] Background worker execution failed for campaign:', campaignId, err)
    })

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
