import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'
import { getChatbotAnalytics } from '@/lib/ai-analytics'

/**
 * GET /api/ai/analytics
 * 
 * Returns aggregated chatbot analytics for the user's organization.
 * Query params:
 *   - days: Number of days to look back (default: 30, max: 90)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const orgId = user.organization_id
    if (!orgId) {
      return NextResponse.json({ error: 'Forbidden: No organization assigned' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const daysParam = parseInt(searchParams.get('days') || '30', 10)
    const days = Math.min(Math.max(daysParam, 1), 90) // Clamp between 1 and 90

    const analytics = await getChatbotAnalytics(orgId, days)

    if (!analytics) {
      return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
    }

    return NextResponse.json({ analytics })
  } catch (err: any) {
    console.error('[AI Analytics API] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
