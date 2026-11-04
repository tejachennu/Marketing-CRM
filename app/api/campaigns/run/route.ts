import { NextRequest, NextResponse, after } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { workerDeadline } from '@/lib/scheduler/campaign-worker'
import { runCampaignWorker } from './worker/route'

// The campaign runs in this invocation, so it gets as long as Vercel allows (the plan's limit
// applies when it is lower); the worker pauses before the end and the watchdog resumes it
export const maxDuration = 300

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

    const authResult = await verifyRecordAccess(request, 'campaigns', campaignId, { permission: 'campaigns.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Run the worker after the response is sent. `after` keeps the serverless
    // function alive until the worker settles; a bare floating promise can be
    // frozen as soon as the response returns.
    const deadline = workerDeadline(maxDuration)
    after(() =>
      runCampaignWorker(campaignId, { deadline }).catch(err => {
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
