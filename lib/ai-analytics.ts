/**
 * AI Analytics — Non-blocking event tracking for chatbot interactions
 * 
 * Records every chatbot interaction (queries, FAQ matches, escalations, cache hits)
 * to the `chatbot_analytics` table for performance monitoring and optimization.
 * 
 * All tracking is fire-and-forget to avoid slowing down responses.
 */

import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export interface ChatbotAnalyticsEvent {
  organization_id: string
  conversation_id?: string | null
  session_id?: string | null
  query: string
  condensed_query?: string | null
  confidence_level?: 'high' | 'medium' | 'low' | null
  best_similarity?: number | null
  matched_faq_count?: number
  matched_faq_titles?: string[]
  was_escalated?: boolean
  was_cached?: boolean
  was_greeting?: boolean
  response_time_ms?: number | null
  model_used?: string
  source: 'playground' | 'whatsapp' | 'copilot'
}

/**
 * Track a chatbot interaction event (non-blocking).
 * 
 * This function fires and forgets — it will not throw errors or slow down
 * the calling route. Errors are logged to console.
 * 
 * @param event - The analytics event data to record
 */
export function trackChatbotEvent(event: ChatbotAnalyticsEvent): void {
  // Fire and forget — don't await
  _insertEvent(event).catch(err => {
    console.error('[AI-Analytics] Failed to track event:', err?.message || err)
  })
}

async function _insertEvent(event: ChatbotAnalyticsEvent): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('chatbot_analytics')
      .insert({
        organization_id: event.organization_id,
        conversation_id: event.conversation_id || null,
        session_id: event.session_id || null,
        query: event.query,
        condensed_query: event.condensed_query || null,
        confidence_level: event.confidence_level || null,
        best_similarity: event.best_similarity || null,
        matched_faq_count: event.matched_faq_count ?? 0,
        matched_faq_titles: event.matched_faq_titles || [],
        was_escalated: event.was_escalated ?? false,
        was_cached: event.was_cached ?? false,
        was_greeting: event.was_greeting ?? false,
        response_time_ms: event.response_time_ms || null,
        model_used: event.model_used || 'gpt-4o-mini',
        source: event.source
      })

    if (error) {
      console.error('[AI-Analytics] Insert error:', error.message)
    }
  } catch (err: any) {
    console.error('[AI-Analytics] Exception:', err?.message || err)
  }
}

const ANALYTICS_PAGE_SIZE = 1000
const ANALYTICS_MAX_EVENTS = 50000

/**
 * Get aggregated chatbot analytics for an organization.
 * 
 * @param orgId - Organization ID
 * @param days - Number of days to look back (default: 30)
 * @returns Aggregated analytics data
 */
export async function getChatbotAnalytics(orgId: string, days: number = 30) {
  const supabase = getSupabaseClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // PostgREST caps a response at 1,000 rows, so a busy organization's totals were
  // silently truncated. Page through the window instead.
  const events: any[] = []
  for (let from = 0; from < ANALYTICS_MAX_EVENTS; from += ANALYTICS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('chatbot_analytics')
      .select('query, condensed_query, confidence_level, matched_faq_count, was_escalated, was_cached, was_greeting, response_time_ms, source')
      .eq('organization_id', orgId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + ANALYTICS_PAGE_SIZE - 1)

    if (error) {
      console.error('[AI-Analytics] Query error:', error.message)
      return null
    }

    events.push(...(data || []))
    if (!data || data.length < ANALYTICS_PAGE_SIZE) break
  }

  const totalQueries = events.length
  const faqHits = events.filter(e => (e.matched_faq_count || 0) > 0).length
  const escalations = events.filter(e => e.was_escalated).length
  const cacheHits = events.filter(e => e.was_cached).length
  const greetings = events.filter(e => e.was_greeting).length
  const avgResponseTime = events.reduce((sum, e) => sum + (e.response_time_ms || 0), 0) / (totalQueries || 1)

  // Top unanswered queries (no FAQ matches, not greetings)
  const unansweredQueries = events
    .filter(e => (e.matched_faq_count || 0) === 0 && !e.was_greeting)
    .map(e => e.condensed_query || e.query)
  
  const unansweredCounts: Record<string, number> = {}
  for (const q of unansweredQueries) {
    const normalized = q.toLowerCase().trim()
    unansweredCounts[normalized] = (unansweredCounts[normalized] || 0) + 1
  }
  const topUnanswered = Object.entries(unansweredCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }))

  // Breakdown by source
  const bySource: Record<string, number> = {}
  for (const e of events) {
    bySource[e.source] = (bySource[e.source] || 0) + 1
  }

  // Confidence level distribution
  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0, unknown: 0 }
  for (const e of events) {
    const level = e.confidence_level || 'unknown'
    byConfidence[level] = (byConfidence[level] || 0) + 1
  }

  return {
    period_days: days,
    total_queries: totalQueries,
    faq_hit_rate: totalQueries > 0 ? ((faqHits / totalQueries) * 100).toFixed(1) + '%' : '0%',
    faq_hits: faqHits,
    escalation_rate: totalQueries > 0 ? ((escalations / totalQueries) * 100).toFixed(1) + '%' : '0%',
    escalations,
    cache_hit_rate: totalQueries > 0 ? ((cacheHits / totalQueries) * 100).toFixed(1) + '%' : '0%',
    cache_hits: cacheHits,
    greeting_ratio: totalQueries > 0 ? ((greetings / totalQueries) * 100).toFixed(1) + '%' : '0%',
    greetings,
    avg_response_time_ms: Math.round(avgResponseTime),
    top_unanswered: topUnanswered,
    by_source: bySource,
    by_confidence: byConfidence
  }
}
